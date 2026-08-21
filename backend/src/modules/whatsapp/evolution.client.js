import { logger } from '../../shared/utils/logger.js';

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
    return { ok: false, error: 'Falta EVOLUTION_URL o EVOLUTION_API_KEY en el servidor' };
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
      // No entrar en grupos: este numero es para escribir a prospectos, y cada
      // interaccion rara suma para que lo suspendan.
      groupsIgnore: true,
      rejectCall: false,
      // «Siempre en linea» y «marcar como leido» automaticos son justo el tipo
      // de comportamiento que no hace una persona. Se dejan apagados.
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
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
export async function enviarTexto(numero, texto, nombre = INSTANCIA) {
  const r = await pedir(`/message/sendText/${nombre}`, {
    metodo: 'POST',
    cuerpo: { number: numero, text: texto },
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

/** Que numero esta conectado ahora mismo. */
export const instancias = () => pedir('/instance/fetchInstances');

/** Cerrar la sesion: el numero deja de estar vinculado al CRM. */
export const cerrarSesion = (nombre = INSTANCIA) =>
  pedir(`/instance/logout/${nombre}`, { metodo: 'DELETE', esperaMs: 30000 });
