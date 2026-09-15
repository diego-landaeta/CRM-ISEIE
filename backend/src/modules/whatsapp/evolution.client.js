import { logger } from '../../shared/utils/logger.js';
import { groupsIgnoreParaEvolution, syncFullHistoryPara } from './politica.js';

// El cliente de Evolution API. Es lo unico que sabe hablar con WhatsApp, y
// vive detras de HTTP a proposito: Evolution corre en su propio contenedor,
// escuchando solo en 127.0.0.1. Nunca se expone a internet — con la apikey en
// la cabecera, cualquiera que llegue a el manda mensajes por vuestro numero.
//
// Si algun dia se cambia de motor (a la API oficial de Meta, por ejemplo),
// este fichero es lo unico que hay que reescribir.

const BASE = (process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.EVOLUTION_API_KEY || '';
// El prefijo de las instancias. Cada usuario del CRM tiene la suya: `crm-u7`.
//
// Antes esto era EL nombre de la unica instancia que habia, y por eso el CRM
// entero compartia un solo WhatsApp: quien lo enlazaba dejaba sus
// conversaciones a la vista de todos los demas usuarios.
//
// El nombre lleva dentro el id del usuario a proposito: asi no hace falta una
// tabla nueva ni una migracion para saber de quien es cada sesion, y la columna
// `instancia` que ya existia en wa_conversaciones sirve tal cual.
export const PREFIJO = process.env.EVOLUTION_INSTANCIA || 'crm';

// Si esta puesta, cada sesion creada avisara AQUI en vez de al webhook global
// del contenedor. Es lo que permite que pruebas y produccion compartan Evolution
// sin mezclarse.
const WEBHOOK_PROPIO = process.env.EVOLUTION_WEBHOOK_URL || '';

/** La instancia de WhatsApp de una persona. */
export const instanciaDe = (userId) => `${PREFIJO}-u${parseInt(userId, 10)}`;

/** Al reves: de que usuario es esta instancia. Devuelve null si no encaja. */
export function usuarioDeInstancia(instancia) {
  const m = /-u(\d+)$/.exec(String(instancia || ''));
  return m ? parseInt(m[1], 10) : null;
}

// Se conserva para lo que todavia no distingue por usuario. Nada que sirva
// conversaciones debe usarlo.
export const INSTANCIA = PREFIJO;

export const configurado = () => Boolean(BASE && API_KEY);

async function pedir(ruta, { metodo = 'GET', cuerpo = null, esperaMs = 15000 } = {}) {
  if (!configurado()) {
    // Este texto puede acabar en pantalla, asi que no nombra variables. El
    // detalle de cual falta ya se registra en el arranque y en /conexion.
    return { ok: false, error: 'WhatsApp no esta disponible en este entorno' };
  }
  try {
    const r = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', apikey: API_KEY },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(esperaMs),
    });
    const texto = await r.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = { raw: texto }; }
    if (!r.ok) {
      logger.error({ ruta, status: r.status, datos }, 'Evolution: respuesta con error');
      return { ok: false, error: `HTTP_${r.status}`, datos };
    }
    return { ok: true, datos };
  } catch (err) {
    logger.error({ ruta, err: err.message }, 'Evolution: no responde');
    return { ok: false, error: 'SIN_RESPUESTA', detalle: err.message };
  }
}

/**
 * Crea la sesion y devuelve el QR. Se escanea UNA vez desde el movil del
 * numero que se vaya a usar, y la sesion queda guardada en el contenedor.
 */
export async function crearInstancia(nombre = INSTANCIA, modo = 'rapido') {
  return pedir('/instance/create', {
    metodo: 'POST',
    cuerpo: {
      instanceName: nombre,
      // Cuanto historial traer: 'cero' | 'rapido' | 'todo'. Va aqui y no en
      // otra llamada porque hay que saberlo ANTES de abrir el socket.
      modo,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: true,
      // Los grupos: lo decide `politica.js`, no esta linea.
      //
      // Aqui iba `true` fijo «para no darle a Meta motivos de suspender el
      // numero», y no servia de nada: entraban igual. El puente de Baileys no
      // implementa el flag, `guardarAjustes` lo apagaba solo, y el propio CRM
      // los aceptaba en `recibir()`. Ahora se le pide al proveedor lo MISMO que
      // aplica el CRM, y la garantia esta en el CRM. Es la #74.
      groupsIgnore: groupsIgnoreParaEvolution(),
      rejectCall: false,
      // «Siempre en linea» y «marcar como leido» automaticos son justo el tipo
      // de comportamiento que no hace una persona. Se dejan apagados.
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      // Cuanto historial pide el socket, DERIVADO del modo (#73).
      //
      // Iba `false` fijo mientras la pantalla ofrecia tres opciones. El campo
      // `modo` de arriba solo lo entiende el puente de Baileys: el Evolution
      // del VPS lo ignora y lee ESTE, asi que alli «el ultimo mes» y «todo el
      // historial» hacian lo mismo que «empezar de cero». No llegaba nada que
      // recortar. El recorte a 30 dias lo aplica ahora el CRM al recibir.
      syncFullHistory: syncFullHistoryPara(modo),
      // A donde avisa Evolution cuando entra un mensaje de ESTA sesion.
      //
      // Sin esto se usa el webhook global del contenedor, que apunta a un solo
      // sitio. Con pruebas y produccion contra el mismo Evolution, eso hacia
      // que los mensajes de una sesion de pruebas aterrizaran en la base de
      // PRODUCCION: conversaciones apareciendo de la nada que nadie sabria de
      // donde salieron. Cada instancia avisa a quien la creo.
      ...(WEBHOOK_PROPIO ? { webhook: { url: WEBHOOK_PROPIO, byEvents: false,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] } } : {}),
    },
    esperaMs: 30000,
  });
}

/** El QR de una sesion ya creada pero sin emparejar. */
export const qr = (nombre = INSTANCIA) => pedir(`/instance/connect/${nombre}`);

/** ¿Esta emparejada y conectada? */
export const estado = (nombre = INSTANCIA) => pedir(`/instance/connectionState/${nombre}`);

/**
 * Manda un texto. `numero` va sin signos: 34600111222.
 *
 * Devuelve el key.id de WhatsApp, que es lo que luego permite casar el acuse
 * de entrega con el mensaje guardado.
 */
export async function enviarTexto(numero, texto, nombre = INSTANCIA, cita = null) {
  const r = await pedir(`/message/sendText/${nombre}`, {
    metodo: 'POST',
    // `quoted` es el identificador del mensaje al que se responde. Al otro lado
    // sale con la cita encima, como en WhatsApp.
    // La cita va como OBJETO, no como el identificador suelto.
    //
    // Aqui iba `quoted: citarWaId` —una cadena— y Evolution hace por dentro
    // `quoted.key.fromMe`: con un texto revienta con «Cannot read properties of
    // undefined (reading 'fromMe')» y contesta 400. O sea que **responder a un
    // mensaje fallaba siempre en produccion**, y reintentar volvia a fallar.
    // El error venia de dentro de Evolution, asi que en nuestro registro solo
    // se veia «HTTP_400 · no se pudo enviar».
    //
    // Hacen falta el jid de la conversacion y si el mensaje citado era nuestro;
    // los dos estan en `wa_mensajes` y los pasa quien llama.
    cuerpo: {
      number: numero,
      text: texto,
      ...(cita?.waId ? {
        quoted: {
          key: { id: cita.waId, remoteJid: cita.jid, fromMe: Boolean(cita.mio) },
          message: { conversation: cita.texto || '' },
        },
      } : {}),
    },
    esperaMs: 20000,
  });
  if (!r.ok) return r;
  return { ok: true, waId: r.datos?.key?.id || null, datos: r.datos };
}

/**
 * Manda una nota de voz. Sale en WhatsApp como nota de voz de verdad —con su
 * onda y su boton de reproducir—, no como un fichero adjunto: eso lo decide el
 * endpoint, no el formato.
 *
 * `audioBase64` va SIN el prefijo `data:audio/ogg;base64,`. Con el prefijo,
 * Evolution contesta 400.
 */
export async function enviarAudio(numero, audioBase64, nombre = INSTANCIA) {
  const r = await pedir(`/message/sendWhatsAppAudio/${nombre}`, {
    metodo: 'POST',
    // NO se manda `seconds`.
    //
    // Se mandaba la duracion medida en el navegador con `Date.now()`, para que
    // WhatsApp no la sacara del webm de Chrome —que no la lleva en la cabecera—.
    // El razonamiento estaba bien y la consecuencia era mala: esa medida cuenta
    // desde antes de que el grabador arranque de verdad, asi que nunca coincide
    // con el audio. Y una duracion que no cuadra deja la nota MUDA: al darle a
    // reproducir sale «Este audio ya no esta disponible».
    //
    // Comprobado mandando el mismo audio con la duracion buena y con una
    // inventada: con la buena suena, con la inventada no.
    //
    // Quien convierte —Evolution, o el puente en local— ya tiene el ogg
    // delante, y ahi la duracion si esta. Que la ponga quien puede medirla.
    cuerpo: { number: numero, audio: audioBase64, encoding: true },
    esperaMs: 60000,
  });
  if (!r.ok) return r;
  return { ok: true, waId: r.datos?.key?.id || null, datos: r.datos };
}

/** Imagen, video o documento. `tipo`: image | video | document. */
export async function enviarMedia(numero, { tipo, base64, nombreArchivo, mimetype, pie }, nombre = INSTANCIA) {
  const r = await pedir(`/message/sendMedia/${nombre}`, {
    metodo: 'POST',
    cuerpo: {
      number: numero,
      mediatype: tipo,
      mimetype,
      media: base64,
      fileName: nombreArchivo,
      caption: pie || undefined,
    },
    esperaMs: 60000,
  });
  if (!r.ok) return r;
  return { ok: true, waId: r.datos?.key?.id || null, datos: r.datos };
}

/**
 * Descarga un adjunto que nos han mandado. WhatsApp no da una URL publica: los
 * ficheros van cifrados y hay que pedirselos a Evolution, que los descifra.
 *
 * Devuelve { base64, mimetype, fileName, mediaType }.
 */
export async function bajarMedia(mensajeKey, nombre = INSTANCIA) {
  const r = await pedir(`/chat/getBase64FromMediaMessage/${nombre}`, {
    metodo: 'POST',
    cuerpo: { message: { key: mensajeKey }, convertToMp4: false },
    esperaMs: 60000,
  });
  if (!r.ok) return r;
  return { ok: true, ...(r.datos || {}) };
}

/** Marcar como leido, para que al otro lado le salga el doble tic azul. */
export const marcarLeido = (mensajeKey, nombre = INSTANCIA) =>
  pedir(`/chat/markMessageAsRead/${nombre}`, { metodo: 'POST', cuerpo: { readMessages: [mensajeKey] } });

/** «Escribiendo…» / «grabando audio…», para que no parezca un robot. */
export const presencia = (numero, estado, nombre = INSTANCIA) =>
  pedir(`/chat/sendPresence/${nombre}`, {
    metodo: 'POST',
    cuerpo: { number: numero, presence: estado, delay: 1200 },
  });

/**
 * ¿Existe este numero en WhatsApp, y cual es su direccion buena?
 *
 * Devuelve { existe, jid }. `existe: null` significa que no se pudo comprobar
 * —sesion caida, por ejemplo—, que no es lo mismo que «no existe».
 */
export async function comprobarNumero(numero, nombre = INSTANCIA) {
  const r = await pedir(`/chat/whatsappNumbers/${nombre}`, {
    metodo: 'POST',
    cuerpo: { numbers: [String(numero).replace(/[^0-9]/g, '')] },
    esperaMs: 15000,
  });
  if (!r.ok) return { existe: null, jid: null };
  const uno = Array.isArray(r.datos) ? r.datos[0] : r.datos;
  return { existe: uno?.exists ?? null, jid: uno?.jid || null };
}


/**
 * La agenda de esa sesion: como tienes guardado a cada uno.
 *
 * Iba a `/agenda`, que **solo existe en el puente de Baileys** que se usa en
 * local: en el Evolution de verdad devuelve 404. Lo caza Diego en la tarea #63.
 * El endpoint real es `/chat/findContacts/<instancia>`.
 */
export async function agenda(nombre = INSTANCIA) {
  const r = await pedir(`/chat/findContacts/${nombre}`, {
    metodo: 'POST',
    cuerpo: {},
    esperaMs: 15000,
  });
  if (!r.ok) return [];
  // Evolution devuelve la lista pelada; el puente la envuelve en `contactos`.
  const filas = Array.isArray(r.datos) ? r.datos : (r.datos?.contactos || []);
  return filas
    .map((c) => ({
      jid: c?.remoteJid || c?.id || c?.jid || null,
      // Ojo con `pushName`, que significa dos cosas distintas segun la tabla:
      // en un mensaje es como se llama esa persona a si misma, pero en la ficha
      // de contacto Evolution mete ahi el nombre de TU agenda —guarda
      // `contact.name || contact.verifiedName || el numero`—. Que es justo el
      // que se quiere: como tu la tienes apuntada, no como se anuncia ella.
      nombre: c?.name || c?.nombre || c?.pushName || null,
    }))
    .filter((c) => c.jid && c.nombre);
}

/**
 * Los ajustes de una sesion tal como los tiene Evolution.
 *
 * Devuelve null si no se pudieron leer, que NO es lo mismo que «no hay
 * ninguno»: la diferencia importa en guardarAjustes().
 */
export async function ajustes(nombre = INSTANCIA) {
  const r = await pedir(`/settings/find/${nombre}`, { esperaMs: 10000 });
  return r.ok ? (r.datos || {}) : null;
}

/**
 * Cambia SOLO lo que se le pasa, dejando el resto como estaba.
 *
 * `/settings/set` no parchea: reemplaza el bloque entero, y lo que no vaya en
 * el cuerpo se queda vacio. Mandar `{ rejectCall: true }` a secas apagaria
 * `syncFullHistory` —con lo que la siguiente vinculacion entraria sin
 * historial— y borraria el token de voz si algun dia se pone.
 *
 * Por eso se lee antes y se manda todo junto. Y si la lectura falla no se
 * escribe nada: guardar a ciegas seria justamente arrasar esos ajustes.
 */
export async function guardarAjustes(nombre = INSTANCIA, cambios = {}) {
  const actuales = await ajustes(nombre);
  if (actuales === null) {
    return { ok: false, error: 'No se pudieron leer los ajustes de la sesion' };
  }
  const r = await pedir(`/settings/set/${nombre}`, {
    metodo: 'POST',
    cuerpo: {
      rejectCall: actuales.rejectCall ?? false,
      msgCall: actuales.msgCall ?? '',
      // Los dos `??` de estas lineas eran una puerta trasera.
      //
      // Cuando Evolution no devuelve un campo —y no siempre los devuelve
      // todos—, el valor de reserva pasa a ser el que se escribe. Con
      // `groupsIgnore ?? false`, tocar el interruptor de «responder a
      // llamadas» ENCENDIA los grupos; con `syncFullHistory ?? true`, dejaba
      // la sesion pidiendo el historial entero en la siguiente vinculacion.
      // Dos efectos que nadie pidio, disparados desde una pantalla que habla
      // de otra cosa, y sin rastro en ningun registro.
      //
      // Ahora la reserva es lo que el CRM decide, no lo que caiga.
      groupsIgnore: actuales.groupsIgnore ?? groupsIgnoreParaEvolution(),
      alwaysOnline: actuales.alwaysOnline ?? false,
      readMessages: actuales.readMessages ?? false,
      readStatus: actuales.readStatus ?? false,
      // Y aqui `false`: pedir el historial entero es caro y solo se decide al
      // enlazar. Si el campo no viene, lo seguro es no pedirlo.
      syncFullHistory: actuales.syncFullHistory ?? false,
      ...cambios,
    },
    esperaMs: 15000,
  });
  return r.ok ? { ok: true, datos: r.datos } : { ok: false, error: r.error };
}

/** Que numero esta conectado ahora mismo. */
export const instancias = () => pedir('/instance/fetchInstances');

/** Cerrar la sesion: el numero deja de estar vinculado al CRM. */
export const cerrarSesion = (nombre = INSTANCIA) =>
  pedir(`/instance/logout/${nombre}`, { metodo: 'DELETE', esperaMs: 30000 });

/**
 * Edita un mensaje ya enviado. WhatsApp deja 15 minutos.
 *
 * Lo pide la tarea #75: «se siguen enviando y no permite corregir desde la app».
 * Hasta ahora, un error de dedo en un mensaje a un prospecto se quedaba ahi para
 * siempre — y la unica salida era mandar otro pidiendo perdon.
 *
 * SOBRE EL RIESGO DE INVENTARSE UN ENDPOINT, que es lo que paso en la #63:
 *
 * Alli el CRM le pedia a Evolution dos direcciones que no existen en la version
 * que corre (2.3.7) y las pedia EN BUCLE: 136 errores en diez minutos, tapando
 * los errores de verdad. Lo que fallo no fue intentarlo, fue seguir intentandolo.
 *
 * Aqui se intenta una vez. Si esta Evolution no lo trae, se apunta y no se
 * vuelve a preguntar en toda la vida del proceso: `puedeEditar()` pasa a false,
 * la pantalla deja de ofrecer el boton y no se escribe ni un error mas.
 */
let editarNoExiste = false;

/** ¿Merece la pena ofrecer «editar»? Falso en cuanto se sabe que no existe. */
export const puedeEditar = () => !editarNoExiste;

export async function editarTexto(numero, { waId, jid, mio = true }, texto, nombre = INSTANCIA) {
  if (editarNoExiste) return { ok: false, error: 'NO_SOPORTADO' };

  const r = await pedir(`/chat/updateMessage/${nombre}`, {
    metodo: 'POST',
    cuerpo: {
      number: numero,
      text: texto,
      // La clave del mensaje que se corrige, igual que en la cita: Evolution
      // necesita el objeto entero, no el identificador suelto.
      key: { id: waId, remoteJid: jid, fromMe: Boolean(mio) },
    },
    esperaMs: 20000,
  });

  // 404 significa que esta version no lo trae. No es un fallo pasajero y
  // reintentarlo no lo va a arreglar: se apaga y se dice UNA vez.
  if (!r.ok && r.error === 'HTTP_404') {
    editarNoExiste = true;
    logger.warn(
      { ruta: `/chat/updateMessage/${nombre}` },
      'Evolution no soporta editar mensajes en esta version — se deja de ofrecer'
    );
    return { ok: false, error: 'NO_SOPORTADO' };
  }
  return r;
}

/** Para las pruebas: volver a empezar sin reiniciar el proceso. */
export const _reiniciarEdicion = () => { editarNoExiste = false; };
