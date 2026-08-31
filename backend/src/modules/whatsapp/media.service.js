import crypto from 'node:crypto';
import { saveLocal, getLocal } from '../../shared/services/localStorage.service.js';
import { logger } from '../../shared/utils/logger.js';
import * as evolution from './evolution.client.js';
import { textoDeBot, esDeBot } from './mensajes-de-bot.js';

// Los adjuntos de WhatsApp.
//
// WhatsApp NO da una URL publica de los ficheros: viajan cifrados y solo se
// pueden pedir a traves de Evolution, que los descifra. Por eso hay que
// bajarlos en cuanto llegan y guardarlos nosotros — si se deja para cuando la
// gestora abra el chat, puede que ya no esten.

const EXTENSIONES = {
  'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/wav': 'wav',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

const extensionDe = (mime, nombreArchivo) => {
  const limpio = String(mime || '').split(';')[0].trim();
  if (EXTENSIONES[limpio]) return EXTENSIONES[limpio];
  const delNombre = String(nombreArchivo || '').split('.').pop();
  return delNombre && delNombre.length <= 5 ? delNombre.toLowerCase() : 'bin';
};

// Lo que WhatsApp manda pero NO es una conversacion: confirmaciones de
// entrega, claves de cifrado, reacciones, ediciones, borrados, encuestas y
// llamadas. Llegan por el mismo canal que los mensajes y, si se guardan,
// aparecen en el chat como «otro» y ensucian la lista con conversaciones que
// no tienen ni un mensaje que leer.
const NO_ES_CONVERSACION = [
  'protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo',
  'reactionMessage', 'pollUpdateMessage', 'pollCreationMessage',
  'ephemeralMessage', 'viewOnceMessage', 'call', 'callLogMesssage',
  'deviceSentMessage', 'keepInChatMessage', 'editedMessage',
  // Sobres CIFRADOS: WhatsApp los usa para los votos de encuestas y para los
  // eventos. Van cifrados con una clave que solo tienen quien los creo y quien
  // participa, asi que aqui no hay nada que descifrar ni que enseñar — no es
  // que no sepamos leerlos, es que no se pueden leer.
  //
  // Sin esto salia una burbuja «Mensaje que el CRM aun no sabe mostrar —
  // miralo en el movil» que ademas mentia: en el movil tampoco se ve como
  // mensaje, porque es la maquinaria de una encuesta y no una conversacion.
  'secretEncryptedMessage', 'encReactionMessage', 'encEventUpdateMessage',
  'pollResultSnapshotMessage', 'eventCoverImage',
];

/** ¿Este mensaje es contenido de verdad, o ruido del protocolo? */
export function esRuido(message) {
  if (!message) return true;
  const claves = Object.keys(message);
  if (claves.length === 0) return true;
  // Si TODAS las claves son de protocolo, no hay nada que enseñar.
  return claves.every((k) => NO_ES_CONVERSACION.includes(k));
}

/**
 * Los sobres: mensajes que ENVUELVEN a otro mensaje.
 *
 * WhatsApp mete el mensaje de verdad dentro de otro cuando es temporal, de una
 * sola vista, o un documento con pie. Sin abrirlos, el de dentro no se ve nunca
 * y el mensaje entero acaba como «otro» sin texto — que es como se ven hoy en
 * produccion los avisos que entran en el numero de los leads: una fila tras
 * otra de «Descargar otro» y ni una palabra.
 */
const SOBRES = [
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
  'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'deviceSentMessage',
  'editedMessage',
];

/**
 * Abre los sobres hasta llegar al mensaje de verdad.
 *
 * Con tope de vueltas: un mensaje mal formado que se apunte a si mismo no puede
 * dejar colgado el proceso que atiende el webhook.
 */
export function abrirSobres(message, vueltas = 0) {
  if (!message || typeof message !== 'object' || vueltas > 5) return message;
  for (const sobre of SOBRES) {
    const dentro = message[sobre]?.message;
    if (dentro) return abrirSobres(dentro, vueltas + 1);
  }
  return message;
}

/** Del tipo de mensaje de WhatsApp al tipo que guardamos. */
export function tipoDeMensaje(envuelto) {
  if (!envuelto) return { tipo: 'texto', clave: null };
  // Se abre el sobre ANTES de mirar. Sin esto, un documento con pie o un mensaje
  // temporal caian en «otro» sin texto por no haber mirado dentro.
  const message = abrirSobres(envuelto);
  if (!message) return { tipo: 'texto', clave: null };
  if (message.audioMessage) return { tipo: 'audio', clave: 'audioMessage' };
  if (message.imageMessage) return { tipo: 'imagen', clave: 'imageMessage' };
  if (message.videoMessage) return { tipo: 'video', clave: 'videoMessage' };
  if (message.documentMessage) return { tipo: 'documento', clave: 'documentMessage' };
  if (message.stickerMessage) return { tipo: 'sticker', clave: 'stickerMessage' };
  if (message.conversation || message.extendedTextMessage) return { tipo: 'texto', clave: null };
  // Botones, menus, plantillas, sitios y contactos. No traen fichero que bajar,
  // asi que van como texto: darles un tipo propio haria que la pantalla les
  // pintara un adjunto que no existe. Antes caian en 'otro' y salian en blanco.
  if (esDeBot(message)) return { tipo: 'texto', clave: null };
  return { tipo: 'otro', clave: null };
}

/** El texto que acompaña al adjunto, si lo hay. Abre el sobre primero. */
export const textoDe = (envuelto = {}) => leerTexto(abrirSobres(envuelto) || {});

const leerTexto = (m = {}) =>
  m.conversation
  || m.extendedTextMessage?.text
  || m.imageMessage?.caption
  || m.videoMessage?.caption
  || m.documentMessage?.caption
  // Lo ultimo, para no pisar nunca un texto de verdad: solo entra cuando arriba
  // no habia nada, que es justo cuando la burbuja salia vacia.
  || textoDeBot(m)
  || null;

/**
 * Lo que WhatsApp mando y el CRM no supo leer.
 *
 * En produccion, el numero por el que entran los leads enseña una fila tras otra
 * de «Descargar otro» y ni una palabra. Son mensajes que acaban en tipo «otro»
 * sin texto, y desde aqui NO se puede saber de que tipo son: hay medio centenar
 * de clases de mensaje y adivinar cual es seria justo eso, adivinar.
 *
 * Asi que se apuntan LAS CLAVES, que es el nombre del tipo —«listMessage»,
 * «productMessage»...—. Nunca el contenido: son mensajes de personas.
 *
 * Con una linea de este registro en produccion se arregla de verdad y en cinco
 * minutos, en vez de probar a ciegas contra un servidor al que no se llega.
 */
export function apuntarDesconocido(envuelto, contexto = {}) {
  try {
    const m = abrirSobres(envuelto);
    logger.warn({
      ...contexto,
      claves: Object.keys(m || {}),
      // Si venia envuelto, tambien de que sobre: puede ser el sobre lo que falta.
      sobre: m === envuelto ? null : Object.keys(envuelto || {}),
    }, 'WhatsApp: tipo de mensaje que el CRM no sabe leer');
  } catch { /* apuntar no puede tumbar la entrada de un mensaje */ }
}

/**
 * Baja un adjunto entrante y lo deja en disco. Devuelve la clave con la que
 * luego se sirve, o null si no se pudo.
 *
 * Nunca lanza: que falle la descarga de una foto no puede hacer que se pierda
 * el mensaje entero. Se guarda el mensaje con su tipo y sin fichero, y en el
 * chat sale como «no se pudo descargar».
 */
export async function bajarYGuardar({ key, message, instancia }) {
  // Al reintentar desde la base no tenemos el mensaje original, solo su clave.
  // El puente si lo tiene, y en su respuesta vienen el tipo y el mime.
  const { tipo, clave } = message ? tipoDeMensaje(message) : { tipo: null, clave: 'reintento' };
  if (!clave) return null;
  try {
    const r = await evolution.bajarMedia(key, instancia);
    if (!r.ok || !r.base64) {
      logger.warn({ waId: key?.id, tipo }, 'WhatsApp: no se pudo bajar el adjunto');
      return null;
    }
    const mime = r.mimetype || (message && clave !== 'reintento' ? message[clave]?.mimetype : null)
      || 'application/octet-stream';
    const ext = extensionDe(mime, r.fileName);
    // Nombre imprevisible a proposito: el fichero se sirve por un endpoint con
    // sesion, pero si algun dia se expone la carpeta, que no se pueda adivinar.
    const nombre = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    const ruta = `whatsapp/${instancia}/${nombre}`;
    await saveLocal(ruta, Buffer.from(r.base64, 'base64'));
    return {
      ruta,
      mime,
      tipo: tipo || r.mediaType || null,
      nombreArchivo: r.fileName || nombre,
      tamano: Number(r.size?.fileLength || r.size || 0) || null,
    };
  } catch (err) {
    logger.error({ err: err.message, waId: key?.id }, 'WhatsApp: fallo bajando el adjunto');
    return null;
  }
}

/** Lee un adjunto ya guardado, para servirlo. */
export async function leer(ruta) {
  const { buffer, size } = await getLocal(ruta);
  return { buffer, size };
}


// ── La cola de descargas ─────────────────────────────────────────────────────
//
// Los adjuntos se bajan DESPUES de contestar al webhook, y de UNO EN UNO.
//
// Se hacia dentro del webhook y fue el fallo mas caro de la sesion: al
// emparejar llegan miles de mensajes de historial, y por cada uno el CRM le
// pedia el fichero de vuelta al mismo servicio que se los estaba mandando.
// Miles de peticiones cruzadas en los dos sentidos: se saturo la cola de
// conexiones y se perdieron 2.463 mensajes.
//
// De uno en uno tarda mas, pero no tumba nada y los mensajes no se pierden:
// el texto ya esta guardado y la foto aparece unos segundos despues.

const cola = [];
let trabajando = false;

// Cuanto historial de adjuntos merece la pena bajar al enlazar.
//
// Sin tope, un movil con anos de uso mete 17.893 adjuntos en la cola: a un
// cuarto de segundo cada uno son mas de setenta minutos, y lo que mandas AHORA
// se pone detras de todos ellos. Paso: se envio una foto y salio «no se pudo
// descargar» porque tenia 17.000 stickers por delante.
const DIAS_HISTORIAL = Number(process.env.WA_MEDIA_DIAS || 30);

/**
 * ¿Merece la pena bajar este adjunto ahora?
 *
 * Lo de ahora, siempre. Del historial, solo lo reciente — y ningun sticker: en
 * el caso real eran 12.487 de los 17.893, el setenta por ciento de la cola,
 * para pintar monigotes de conversaciones de hace anos. Lo que se descarta no
 * se pierde: queda como «descargar» en el chat, a un clic.
 */
export function mereceDescarga({ tipo, ts, esHistorial }) {
  if (!esHistorial) return true;
  if (tipo === 'sticker') return false;
  const dias = (Date.now() - new Date(ts).getTime()) / 86400000;
  return Number.isFinite(dias) && dias <= DIAS_HISTORIAL;
}

/**
 * Anota un adjunto para bajarlo cuando se pueda.
 *
 * Lo urgente va DELANTE. Un mensaje que acaba de llegar se ve en el chat en
 * segundos aunque haya miles de archivos viejos esperando detras.
 */
export function encolar(tarea, urgente = false) {
  if (urgente) cola.unshift(tarea); else cola.push(tarea);
  if (!trabajando) arrancar();
}

async function arrancar() {
  trabajando = true;
  // El finally NO es adorno: sin el, cualquier fallo dejaba la bandera en true
  // para siempre y la cola quedaba muerta. Se bajaron 64 archivos y los otros
  // 1.900 se quedaron esperando a un trabajador que ya no existia.
  try {
    await trabajar();
  } catch (err) {
    logger.error({ err: err.message }, 'Cola de adjuntos: se detuvo por un fallo');
  } finally {
    trabajando = false;
    // Si quedaron cosas mientras fallaba, se vuelve a arrancar.
    if (cola.length) setTimeout(arrancar, 2000);
  }
}

async function trabajar() {
  const { query } = await import('../../shared/config/db.js');
  let hechos = 0;
  let fallados = 0;
  while (cola.length) {
    const t = cola.shift();
    try {
      const a = await bajarYGuardar({ key: t.key, message: t.message, instancia: t.instancia });
      if (a) {
        await query(
          `UPDATE wa_mensajes
              SET media_url = $2, media_mime = COALESCE($3, media_mime),
                  nombre_archivo = COALESCE(nombre_archivo, $4)
            WHERE id = $1`,
          [t.mensajeId, a.ruta, a.mime, a.nombreArchivo]
        );
        hechos++;
      } else {
        fallados++;
      }
    } catch (err) {
      fallados++;
      logger.warn({ err: err.message, mensajeId: t.mensajeId }, 'Cola de adjuntos: fallo uno');
    }
    // Cada 50, un parte: sin esto no habia forma de saber si seguia viva.
    if ((hechos + fallados) % 50 === 0) {
      logger.info({ hechos, fallados, quedan: cola.length }, 'Cola de adjuntos');
    }
    // Un respiro entre descargas: sin esto se vuelve a saturar al que nos los
    // sirve, que es el mismo que nos manda los mensajes.
    await new Promise((r) => setTimeout(r, 250));
  }
  logger.info({ hechos, fallados }, 'Cola de adjuntos: terminada');
}

/**
 * Reencolar lo que se quedo sin archivo.
 *
 * Para descifrar un adjunto hace falta el mensaje original, que lo tiene quien
 * nos lo mando. Pero guardamos su identificador (wa_id) y el jid de la
 * conversacion, y con eso se puede reconstruir la clave y volver a pedirlo.
 *
 * Sirve para recuperar lo que se perdio cuando la cola se quedo muerta.
 */
export async function reencolarPendientes(instancia, limite = 5000) {
  const { query } = await import('../../shared/config/db.js');
  // Solo los de ESA sesion: cada quien reintenta lo suyo, y el mensaje original
  // que hace falta para descifrarlo vive en el socket de esa misma sesion.
  const { rows } = await query(
    `SELECT m.id, m.wa_id, m.direccion, c.jid, c.instancia
       FROM wa_mensajes m
       JOIN wa_conversaciones c ON c.id = m.conversacion_id
      WHERE m.media_url IS NULL
        AND m.tipo NOT IN ('texto', 'otro')
        AND m.wa_id IS NOT NULL
        AND c.instancia = $1
      ORDER BY m.ts DESC
      LIMIT $2`,
    [instancia, limite]
  );
  for (const r of rows) {
    encolar({
      mensajeId: r.id,
      key: { remoteJid: r.jid, fromMe: r.direccion === 'saliente', id: r.wa_id },
      // El mensaje original lo tiene el puente; aqui solo hace falta la clave.
      message: null,
      instancia: r.instancia,
    });
  }
  logger.info({ reencolados: rows.length, instancia }, 'Cola de adjuntos: reintentando los que faltaban');
  return rows.length;
}

/**
 * Cuantos quedan por bajar, para poder ensenarlo en pantalla.
 *
 * La cola es una sola —se baja de uno en uno a proposito, para no saturar a
 * quien nos sirve los ficheros—, pero el numero que se ensena es el de TU
 * sesion: si no, a quien acaba de enlazar le salian los 2.000 archivos de un
 * companero como si fueran suyos.
 */
export const pendientes = (instancia) =>
  instancia ? cola.filter((t) => t.instancia === instancia).length : cola.length;

/**
 * Reanudar lo que quedo a medias.
 *
 * La cola vive en memoria: si el servidor se reinicia mientras baja adjuntos,
 * los que faltaban se quedaban sin fichero para siempre y en el chat salia
 * «no se pudo descargar» sin que nadie lo volviera a intentar.
 *
 * Al arrancar se buscan los mensajes que deberian tener archivo y no lo tienen.
 * No se puede reencolar sin el mensaje original —hace falta para descifrarlo—,
 * asi que de momento solo se cuentan y se avisa: sirve para saber cuantos hay y
 * decidir si merece la pena volver a sincronizar.
 */
export async function pendientesEnBase() {
  try {
    const { query } = await import('../../shared/config/db.js');
    const { rows } = await query(
      `SELECT COUNT(*)::int n FROM wa_mensajes
        WHERE media_url IS NULL AND tipo NOT IN ('texto', 'otro')`
    );
    if (rows[0].n > 0) {
      logger.warn({ pendientes: rows[0].n }, 'WhatsApp: mensajes con archivo que no llego a bajarse');
    }
    return rows[0].n;
  } catch {
    return 0;
  }
}
