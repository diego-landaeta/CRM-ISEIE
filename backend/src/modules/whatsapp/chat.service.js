import * as model from './chat.model.js';
import * as evolution from './evolution.client.js';
import * as media from './media.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

// EL FRENO DE ESCRIBIR A DESCONOCIDOS. Apagado por defecto — decision de Diego,
// 21/08/2026. El razonamiento entero esta abajo, donde se usa.
//
// Antes esto se llamaba WA_EXIGIR_CONSENTIMIENTO y venia encendido. Se cambia
// el nombre a proposito: la variable vieja significaba lo contrario (true =
// frenar), asi que dejarla habria bastado para que un .env olvidado volviera a
// bloquear justo lo que se decidio permitir. Si alguien la trae puesta, el
// servidor lo avisa al arrancar en vez de obedecerla en silencio.
const BLOQUEAR_DESCONOCIDOS = process.env.WA_BLOQUEO_DESCONOCIDOS === 'true';

if (process.env.WA_EXIGIR_CONSENTIMIENTO !== undefined) {
  logger.warn(
    'WhatsApp: WA_EXIGIR_CONSENTIMIENTO ya no se usa y se ignora. El freno ahora '
    + 'es WA_BLOQUEO_DESCONOCIDOS y viene apagado. Quita la vieja del .env.',
  );
}

/**
 * Cuando entro el ultimo mensaje de cada sesion.
 *
 * La pantalla pregunta cada cuatro segundos si sigue llegando historial, y eso
 * se contestaba contando la tabla entera de mensajes: con 380.000 filas y diez
 * pantallas abiertas eran dos escaneos completos por segundo para pintar un
 * «sincronizando…».
 *
 * Quien sabe si esta entrando algo es el webhook, que es por donde entra. Se
 * apunta aqui al vuelo y la pantalla lo lee de memoria, sin tocar la base.
 *
 * Vive en memoria a proposito: si el servidor se reinicia, lo peor que pasa es
 * que durante unos segundos diga «ya esta» en vez de «entrando», y el primer
 * mensaje que llegue lo corrige. No merece una tabla.
 */
const pulso = new Map();   // instancia -> milisegundos del ultimo mensaje

export const ultimoLatido = (instancia) => pulso.get(instancia) || null;

// Los frenos. Esto es lo que de verdad protege el numero.
//
// Lo que hace que WhatsApp suspenda una linea no es tanto detectar el cliente
// como que la gente la bloquee y la reporte. Por eso aqui no hay trucos para
// esconderse: hay limites de ritmo y una negativa a escribir a quien no lo
// pidio. Es menos vistoso y funciona mucho mejor.

// Ritmo humano. Una persona no manda 40 mensajes en un minuto, y un numero
// nuevo que lo hace el primer dia es la señal mas clara que existe.
const TOPE_POR_MINUTO = Number(process.env.WA_TOPE_MINUTO || 6);
const TOPE_POR_HORA = Number(process.env.WA_TOPE_HORA || 60);
const TOPE_POR_DIA = Number(process.env.WA_TOPE_DIA || 300);

// Espera entre mensajes seguidos, para que no salgan todos de golpe.
const PAUSA_MS = Number(process.env.WA_PAUSA_MS || 1500);

// El freno de «solo a quien lo pidio». Encendido salvo que se apague a mano.
//
// Se apaga para probar: al probar se escribe al numero de uno mismo, que ni es
// prospecto ni ha escrito nunca, asi que el freno salta con razon y no deja
// hacer nada. En produccion va encendido y no se toca.
const EXIGIR_CONSENTIMIENTO = process.env.WA_EXIGIR_CONSENTIMIENTO !== 'false';
if (!EXIGIR_CONSENTIMIENTO) {
  logger.warn(
    'WhatsApp: FRENO DE CONSENTIMIENTO APAGADO (WA_EXIGIR_CONSENTIMIENTO=false). '
    + 'Se puede escribir a cualquiera. Esto es para probar: en produccion no puede quedarse asi.'
  );
}
let ultimoEnvio = 0;

async function limites(instancia) {
  const [min, hora, dia] = await Promise.all([
    model.salientesRecientes(instancia, 1),
    model.salientesRecientes(instancia, 60),
    model.salientesRecientes(instancia, 60 * 24),
  ]);
  if (min >= TOPE_POR_MINUTO) return `Vas muy rapido: ${min} mensajes en un minuto. Espera un poco.`;
  if (hora >= TOPE_POR_HORA) return `Llevas ${hora} mensajes esta hora. Se para aqui para no arriesgar el numero.`;
  if (dia >= TOPE_POR_DIA) return `Llevas ${dia} mensajes hoy. Se retoma mañana.`;
  return null;
}

/**
 * Las cuatro comprobaciones que van ANTES de llamar a WhatsApp. Una vez sale,
 * ya no se recoge.
 */
async function permitirEnvio(conversacionId) {
  const conv = await model.porId(conversacionId);
  if (!conv) throw new AppError('Conversacion no encontrada', 404, 'NOT_FOUND');

  // 1. Quien pidio que no le escribieran, no recibe nada. Ni con plantilla, ni
  //    «solo una ultima vez». Es la regla que evita los reportes.
  if (conv.no_escribir) {
    throw new AppError('Esta persona pidio que no se le escriba', 409, 'NO_ESCRIBIR');
  }

  // 2. Escribir a quien no pidio informacion es lo que acaba en bloqueos. Si
  //    el numero no esta atado a ningun lead y nunca nos ha escrito, no salio
  //    de un formulario nuestro.
  // NO VOLVER A BLOQUEAR ESTO. Decision de Diego, 21/08/2026.
  //
  // Aqui habia un freno que impedia el primer mensaje a un numero que no fuera
  // prospecto y que nunca hubiera escrito. Parecia proteger la linea y hacia lo
  // contrario: ese numero puede ser un antiguo alumno, una madre preguntando
  // por su hijo, o un prospecto de otra gestora que aun no esta en el CRM.
  //
  // Y cuando el CRM se negaba, la gestora no dejaba de escribir: escribia desde
  // su movil. O sea que el mensaje salia igual, pero SIN registro, SIN plantilla
  // y SIN los topes de ritmo. El freno no evitaba nada; solo sacaba el trabajo
  // fuera del CRM, que es donde no se puede vigilar.
  //
  // Escribir a quien no pidio informacion sigue siendo lo que hace que reporten
  // un numero, asi que no desaparece: queda apuntado en el registro. El freno
  // ahora es saberlo, no impedirlo. Si hiciera falta volver a frenar, se
  // enciende con WA_BLOQUEO_DESCONOCIDOS=true sin tocar el codigo — pero eso se
  // habla antes con Diego.
  const yaHablamos = (await model.mensajes(conversacionId, 1)).length > 0;
  const desconocido = !conv.lead_id && !yaHablamos;
  if (desconocido) {
    if (BLOQUEAR_DESCONOCIDOS) {
      throw new AppError(
        'Ese numero no esta en el CRM y nunca ha escrito.',
        409, 'SIN_CONSENTIMIENTO',
      );
    }
    logger.warn({ conversacionId, instancia: conv.instancia, telefono: conv.telefono },
      'WhatsApp: primer mensaje a un numero que no es prospecto y nunca escribio');
  }

  // 3. Ritmo.
  const frenado = await limites(conv.instancia);
  if (frenado) throw new AppError(frenado, 429, 'DEMASIADO_RAPIDO');

  if (!evolution.configurado()) {
    throw new AppError('WhatsApp no esta configurado en el servidor', 503, 'SIN_EVOLUTION');
  }

  // 4. Pausa entre envios seguidos, para no soltarlos en rafaga.
  const desde = Date.now() - ultimoEnvio;
  if (desde < PAUSA_MS) await new Promise((r) => setTimeout(r, PAUSA_MS - desde));
  ultimoEnvio = Date.now();

  return conv;
}

const numeroDe = (conv) => String(conv.jid).split('@')[0];

/** Manda un texto. */
export async function enviar({ conversacionId, texto, usuarioId, citarWaId = null }) {
  const conv = await permitirEnvio(conversacionId);

  // «Escribiendo…» antes de soltar el mensaje. No es adorno: un numero que
  // contesta al instante y sin escribir parece exactamente lo que es.
  await evolution.presencia(numeroDe(conv), 'composing', conv.instancia).catch(() => {});

  const r = await evolution.enviarTexto(numeroDe(conv), texto, conv.instancia, citarWaId);
  const fila = await model.guardarMensaje({
    conversacionId, waId: r.waId, direccion: 'saliente', tipo: 'texto',
    texto, estado: r.ok ? 'enviado' : 'fallido', enviadoPor: usuarioId, ts: new Date(),
    // Se guarda tambien de nuestro lado: si no, la cita solo se veria en el
    // movil del otro y aqui el mensaje saldria suelto.
    respondeA: citarWaId || null,
  });
  if (!r.ok) {
    logger.error({ conversacionId, error: r.error }, 'WhatsApp: no se pudo enviar');
    throw new AppError('WhatsApp no acepto el mensaje. Queda anotado como fallido.', 502, 'ENVIO_FALLIDO');
  }
  return fila;
}

/**
 * Manda un adjunto. Si es audio sale como NOTA DE VOZ —con su onda y su boton
 * de reproducir—, que es como trabajan las gestoras; mandarlo como fichero
 * adjunto seria inutil.
 */
export async function enviarAdjunto({ conversacionId, buffer, mimetype, nombreArchivo, pie, usuarioId }) {
  const conv = await permitirEnvio(conversacionId);
  const numero = numeroDe(conv);
  const base64 = buffer.toString('base64');
  const esAudio = /^audio\//.test(mimetype || '');

  await evolution.presencia(numero, esAudio ? 'recording' : 'composing', conv.instancia).catch(() => {});

  const r = esAudio
    ? await evolution.enviarAudio(numero, base64, conv.instancia)
    : await evolution.enviarMedia(numero, {
        tipo: /^image\//.test(mimetype) ? 'image' : /^video\//.test(mimetype) ? 'video' : 'document',
        base64, nombreArchivo, mimetype, pie,
      }, conv.instancia);

  // Se guarda una copia nuestra: WhatsApp no deja recuperar despues lo que se
  // mando, y sin esto el chat del CRM enseñaria un hueco.
  let guardado = null;
  try {
    const ext = (nombreArchivo || '').split('.').pop() || 'bin';
    const ruta = `whatsapp/${conv.instancia}/env-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
    const { saveLocal } = await import('../../shared/services/localStorage.service.js');
    await saveLocal(ruta, buffer);
    guardado = ruta;
  } catch (err) {
    logger.warn({ err: err.message }, 'WhatsApp: no se pudo guardar copia del adjunto enviado');
  }

  const fila = await model.guardarMensaje({
    conversacionId, waId: r.waId,
    direccion: 'saliente',
    tipo: esAudio ? 'audio' : /^image\//.test(mimetype) ? 'imagen' : /^video\//.test(mimetype) ? 'video' : 'documento',
    texto: pie || null,
    mediaUrl: guardado, mediaMime: mimetype,
    nombreArchivo,
    estado: r.ok ? 'enviado' : 'fallido', enviadoPor: usuarioId, ts: new Date(),
  });
  if (!r.ok) throw new AppError('WhatsApp no acepto el adjunto. Queda anotado como fallido.', 502, 'ENVIO_FALLIDO');
  return fila;
}

/**
 * Lo que llega por el webhook de Evolution.
 *
 * Se traga los errores a proposito y siempre contesta 200: si el CRM devuelve
 * un fallo, Evolution reintenta, y un webhook reintentandose en bucle es peor
 * que perder un mensaje. La barrera de wa_id evita los duplicados igualmente.
 */
export async function recibir(cuerpo) {
  const evento = String(cuerpo?.event || cuerpo?.type || '');

  // Acuses de entrega y lectura: es lo que pinta el doble tic.
  if (/messages[._]update/i.test(evento)) return acuse(cuerpo);
  if (evento && !/messages[._]upsert/i.test(evento)) return { ignorado: evento };

  const datos = cuerpo?.data || cuerpo;
  const key = datos?.key;
  if (!key?.remoteJid) return { ignorado: 'sin remoteJid' };

  // Personas y grupos, si. Canales, listas de difusion y estados, no: esos son
  // emisiones de una via a las que no se puede contestar, y solo ensucian la
  // lista.
  const destino = String(key.remoteJid);
  const esGrupo = destino.endsWith('@g.us');
  // `@lid` es el direccionamiento nuevo de WhatsApp: identifica a una PERSONA
  // sin revelar su telefono. Se aceptaba solo `@s.whatsapp.net`, asi que esos
  // mensajes se descartaban junto con los canales. El puente intenta
  // traducirlo a su numero antes de mandarlo; cuando no puede, llega asi y
  // vale mas guardarlo con un nombre raro que perderlo.
  const esPersona = destino.endsWith('@s.whatsapp.net') || destino.endsWith('@lid');
  if (!esGrupo && !esPersona) {
    return { ignorado: `ni persona ni grupo (${destino.split('@')[1] || destino})` };
  }
  // «0@s.whatsapp.net» y similares: WhatsApp cuela identificadores basura que
  // aparecian en la lista como una conversacion mas.
  const digitos = destino.split('@')[0].replace(/[^0-9]/g, '');
  if (digitos.length < 8) return { ignorado: `identificador invalido (${digitos})` };

  // Ruido del protocolo: acuses, claves de cifrado, reacciones, encuestas,
  // llamadas... Si se dejan pasar, crean conversaciones vacias en la lista.
  if (media.esRuido(datos?.message)) {
    return { ignorado: `ruido de protocolo (${Object.keys(datos?.message || {}).join(',') || 'vacio'})` };
  }

  // La instancia dice DE QUIEN es esta conversacion. Antes, si no venia, se
  // caia al nombre generico y el mensaje acababa en una sesion de nadie: nadie
  // lo veria nunca y encima ensuciaria la base. Mejor decirlo y no guardarlo.
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;
  if (!instancia) {
    logger.warn({ jid: key.remoteJid }, 'WhatsApp: aviso sin instancia, no se sabe de quien es');
    return { ignorado: 'sin instancia' };
  }
  const conv = await model.conversacionDe({
    instancia, jid: key.remoteJid,
    nombrePush: datos?.pushName,
    avatarUrl: datos?.avatar || null,
  });

  const m = datos?.message || {};
  const { tipo } = media.tipoDeMensaje(m);
  if (tipo === 'otro') {
    logger.warn(
      { instancia, claves: Object.keys(m).join(','), jid: destino.split('@')[0] },
      'WhatsApp: tipo de mensaje que no se sabe leer — se guarda igual, pero revisar'
    );
  }

  // El adjunto NO se baja aqui. Se apunta en la cola y se descarga despues.
  //
  // Bajarlo dentro del webhook parecia lo natural y resulto ser el fallo mas
  // caro de la sesion: al emparejar llegan miles de mensajes, y por cada uno el
  // CRM le pedia el fichero de vuelta al mismo servicio que se los estaba
  // mandando. Miles de peticiones cruzadas en los dos sentidos a la vez: se
  // saturo la cola de conexiones y se perdieron 2.463 mensajes con «fetch
  // failed». El webhook tiene que contestar rapido y soltar.
  const fila = await model.guardarMensaje({
    conversacionId: conv.id,
    waId: key.id,
    direccion: key.fromMe ? 'saliente' : 'entrante',
    tipo,
    texto: media.textoDe(m),
    mediaMime: m.audioMessage?.mimetype || m.imageMessage?.mimetype
      || m.videoMessage?.mimetype || m.documentMessage?.mimetype || null,
    nombreArchivo: m.documentMessage?.fileName || null,
    // A que mensaje responde, si responde a alguno. Lo manda el puente.
    respondeA: datos?.respondeA || null,
    // messageTimestamp viene en segundos.
    ts: datos?.messageTimestamp ? new Date(Number(datos.messageTimestamp) * 1000) : new Date(),
  });

  // Lo de AHORA se baja delante de todo; lo viejo del historial, con criterio.
  //
  // Antes entraba todo por igual y en orden de llegada: una foto recien enviada
  // se ponia detras de los 17.893 adjuntos del historial y tardaba mas de una
  // hora en verse. En el chat salia «no se pudo descargar», que ademas era
  // mentira: no habia fallado, es que no le habia llegado el turno.
  // Aunque el mensaje resulte duplicado, ha entrado: cuenta como señal de vida.
  pulso.set(instancia, Date.now());

  const esHistorial = Boolean(cuerpo?.historial);
  let enCola = false;
  if (fila && tipo !== 'texto' && tipo !== 'otro') {
    if (media.mereceDescarga({ tipo, ts: fila.ts, esHistorial })) {
      media.encolar({ mensajeId: fila.id, key, message: m, instancia }, !esHistorial);
      enCola = true;
    }
  }

  return { conversacionId: conv.id, guardado: Boolean(fila), duplicado: !fila, tipo, enCola };
}

/** messages.update: WhatsApp dice que un mensaje nuestro llego o se leyo. */
async function acuse(cuerpo) {
  const datos = cuerpo?.data || cuerpo;
  const waId = datos?.key?.id;
  if (!waId) return { ignorado: 'acuse sin id' };
  const bruto = String(datos?.status || datos?.update?.status || '').toUpperCase();
  const estado = /READ/.test(bruto) ? 'leido'
    : /DELIVER/.test(bruto) ? 'entregado'
    : /ERROR|FAIL/.test(bruto) ? 'fallido'
    : null;
  if (!estado) return { ignorado: `estado ${bruto}` };
  await model.actualizarEstado(waId, estado);
  return { waId, estado };
}

/** Marca leidos los entrantes de una conversacion, tambien en WhatsApp. */
export async function marcarLeida(conversacionId, noLeidos = null) {
  // Si no hay nada sin leer, no hay nada que marcar.
  //
  // La pantalla vuelve a pedir el hilo cada cinco segundos, y esto se hacia en
  // cada vuelta: tres consultas y una llamada a WhatsApp para no cambiar nada.
  // Con diez pantallas abiertas eran seis consultas y dos llamadas por segundo
  // de puro trabajo tirado.
  if (noLeidos === 0) return;
  await model.marcarLeida(conversacionId);
  const conv = await model.porId(conversacionId);
  const ultimo = (await model.ultimoEntranteSinLeer(conversacionId));
  if (conv && ultimo?.wa_id && evolution.configurado()) {
    await evolution.marcarLeido(
      { remoteJid: conv.jid, fromMe: false, id: ultimo.wa_id }, conv.instancia
    ).catch(() => {});
  }
}
