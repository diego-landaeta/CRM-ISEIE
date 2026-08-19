import * as model from './chat.model.js';
import * as servicio from './chat.service.js';
import * as evolution from './evolution.client.js';
import * as media from './media.service.js';
import * as firma from './media.firma.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

const esAdmin = (req) => ['admin', 'superadmin', 'soporte'].includes(req.user.role);

/**
 * La sesion de WhatsApp de quien esta pidiendo. Una por usuario del CRM.
 *
 * Este es el eje del modulo entero: cada persona enlaza SU numero y solo ve sus
 * conversaciones. Antes habia una unica instancia compartida, asi que cualquier
 * usuario leia los chats privados de quien la hubiera enlazado.
 */
const miInstancia = (req) => evolution.instanciaDe(req.user.userId);

/**
 * Trae una conversacion comprobando que es de quien la pide.
 *
 * Sin esto bastaba con teclear otro numero en la direccion para leer —o peor,
 * escribir en— la conversacion de un companero. Se contesta «no encontrada» y
 * no «no tienes permiso» a proposito: lo segundo confirma que ese chat existe.
 */
async function miConversacion(req, id) {
  if (!Number.isInteger(id)) throw new AppError('Conversacion no encontrada', 404, 'NOT_FOUND');
  const conv = await model.porId(id);
  if (!conv || conv.instancia !== miInstancia(req)) {
    throw new AppError('Conversacion no encontrada', 404, 'NOT_FOUND');
  }
  return conv;
}

// GET /api/whatsapp/chats?projectId=N
export async function chats(req, res, next) {
  try {
    res.json({ success: true, data: await model.listar({
      instancia: miInstancia(req),
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
      limite: parseInt(req.query.limite) || 50,
    })});
  } catch (err) { next(err); }
}

// GET /api/whatsapp/chats/:id
export async function chat(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const conv = await miConversacion(req, id);
    const crudos = await model.mensajes(id, parseInt(req.query.limite) || 100);
    // Cada adjunto viaja con su permiso firmado: el navegador pide el fichero
    // sin cabeceras y aun asi solo funciona durante media hora. La direccion la
    // arma el frontend, que es quien sabe bajo que prefijo esta montado.
    const msgs = crudos.map((m) => ({
      ...m,
      media_firma: m.media_url ? firma.firma(m.id) : null,
    }));
    // Marca leido tambien EN WhatsApp: al otro lado le sale el doble tic azul.
    await servicio.marcarLeida(id).catch(() => {});
    res.json({ success: true, data: { conversacion: conv, mensajes: msgs } });
  } catch (err) { next(err); }
}

// POST /api/whatsapp/chats/:id/enviar  { texto }
export async function enviar(req, res, next) {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new AppError('El mensaje esta vacio', 400, 'VACIO');
    if (texto.length > 4000) throw new AppError('El mensaje es demasiado largo', 400, 'MUY_LARGO');
    const conv = await miConversacion(req, parseInt(req.params.id));
    const fila = await servicio.enviar({
      conversacionId: conv.id, texto, usuarioId: req.user.userId,
    });
    res.status(201).json({ success: true, data: fila });
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/chats  { leadId } o { telefono }
 *
 * Abrir un chat nuevo. Se parte de un PROSPECTO, no de un numero suelto a
 * mano: quien esta en la base dejo su telefono en un formulario nuestro, y esa
 * es la diferencia entre escribir a alguien que lo pidio y escribir en frio,
 * que es lo que hace que suspendan el numero.
 */
export async function abrirChat(req, res, next) {
  try {
    const { leadId, telefono } = req.body || {};
    let tel = telefono;
    if (leadId) {
      const l = await model.leadPorId(parseInt(leadId));
      if (!l) throw new AppError('Prospecto no encontrado', 404, 'NOT_FOUND');
      if (!l.telefono) throw new AppError('Ese prospecto no tiene telefono', 400, 'SIN_TELEFONO');
      tel = l.telefono;
    }
    if (!tel) throw new AppError('Hace falta un prospecto o un telefono', 400, 'FALTA_DESTINO');

    const digitos = String(tel).replace(/[^0-9]/g, '');
    if (digitos.length < 9) throw new AppError('Ese telefono no es valido', 400, 'TELEFONO_INVALIDO');

    const conv = await model.conversacionDe({
      instancia: miInstancia(req),
      jid: `${digitos}@s.whatsapp.net`,
      nombrePush: null,
    });
    res.status(201).json({ success: true, data: conv });
  } catch (err) { next(err); }
}

// POST /api/whatsapp/chats/:id/adjunto  (multipart: archivo, pie)
export async function adjunto(req, res, next) {
  try {
    if (!req.file) throw new AppError('No llego ningun archivo', 400, 'SIN_ARCHIVO');
    const conv = await miConversacion(req, parseInt(req.params.id));
    const fila = await servicio.enviarAdjunto({
      conversacionId: conv.id,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      nombreArchivo: req.file.originalname,
      pie: req.body?.pie || null,
      usuarioId: req.user.userId,
    });
    res.status(201).json({ success: true, data: fila });
  } catch (err) { next(err); }
}

// GET /api/whatsapp/media/:mensajeId — sirve el adjunto ya descargado.
//
// Va por endpoint con sesion y no por carpeta publica: son conversaciones de
// clientes, y una carpeta servida por Nginx la lee cualquiera que adivine la
// ruta.
export async function verMedia(req, res, next) {
  try {
    const id = parseInt(req.params.mensajeId);
    // Sin token: lo pide el navegador desde un <img> o un <audio>, que no
    // pueden mandar cabeceras. Lo que autoriza es la firma de la direccion.
    //
    // Y la firma solo la puede acunar el servidor, al abrir un hilo del que ya
    // se ha comprobado que es tuyo: nadie recibe nunca la direccion firmada de
    // un adjunto ajeno, aunque acierte el numero del mensaje.
    if (!firma.valida(id, req.query.c, req.query.f)) {
      throw new AppError('Enlace caducado o invalido', 403, 'FIRMA_INVALIDA');
    }
    const m = await model.mensajeConAdjunto(id);
    if (!m) throw new AppError('Adjunto no encontrado', 404, 'NOT_FOUND');
    const { buffer } = await media.leer(m.media_url);
    res.setHeader('Content-Type', m.media_mime || 'application/octet-stream');
    // inline: las notas de voz y las fotos se ven en el chat, no se descargan.
    res.setHeader('Content-Disposition', `inline; filename="${(m.nombre_archivo || 'archivo').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(buffer);
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/mensajes/:id/descargar — trae un adjunto que no se bajo.
 *
 * Del historial viejo no se descarga todo: seria mas de una hora de cola para
 * pintar stickers de hace anos. Lo que se deja fuera no se pierde — sale como
 * «descargar» en el chat y se pide cuando de verdad hace falta.
 */
export async function descargarAdjunto(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (!Number.isInteger(id)) throw new AppError('Mensaje no encontrado', 404, 'NOT_FOUND');
    const m = await model.mensajePorId(id);
    // Se comprueba que ese mensaje es de una conversacion tuya, igual que al
    // abrir el hilo: si no, valdria con acertar el numero.
    if (!m || m.instancia !== miInstancia(req)) {
      throw new AppError('Mensaje no encontrado', 404, 'NOT_FOUND');
    }
    if (m.media_url) return res.json({ success: true, data: { yaEstaba: true } });
    if (!m.wa_id) throw new AppError('Ese mensaje no se puede recuperar', 409, 'SIN_ID');

    // Se baja AQUI MISMO y se contesta con lo que haya pasado de verdad.
    //
    // Al principio se metia en la cola y se contestaba «en camino». Era mentira
    // a medias: si WhatsApp ya no tiene el fichero —o el servicio ya no guarda
    // ese mensaje en memoria, que es lo que hace falta para descifrarlo— no
    // pasaba nada y el boton se quedaba ahi para siempre invitando a pulsarlo.
    // Es un archivo y lo ha pedido una persona que lo esta mirando: se espera.
    const a = await media.bajarYGuardar({
      key: { remoteJid: m.jid, fromMe: m.direccion === 'saliente', id: m.wa_id },
      message: null,
      instancia: m.instancia,
    });
    if (!a) {
      throw new AppError(
        'Este archivo ya no se puede recuperar. WhatsApp solo los guarda un tiempo, y de las conversaciones viejas suelen haber caducado.',
        410, 'ARCHIVO_CADUCADO'
      );
    }
    await model.guardarAdjunto(m.id, a);
    res.json({ success: true, data: { descargado: true, tipo: a.tipo } });
  } catch (err) { next(err); }
}

// POST /api/whatsapp/chats/:id/no-escribir  { motivo }
export async function noEscribir(req, res, next) {
  try {
    const conv = await miConversacion(req, parseInt(req.params.id));
    await model.noEscribir(conv.id, req.body?.motivo);
    res.json({ success: true });
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/sincronizacion — ¿sigue entrando historial?
 *
 * Al emparejar, WhatsApp manda miles de mensajes durante varios minutos. Sin
 * esto la pantalla no sabe si sigue trabajando o se quedo parada, que es
 * exactamente lo que no se podia distinguir.
 */
export async function sincronizacion(req, res, next) {
  try {
    const instancia = miInstancia(req);
    const d = await model.actividad(instancia);
    res.json({ success: true, data: {
      conversaciones: d.conversaciones,
      mensajes: d.mensajes,
      // Si entro algo en el ultimo medio minuto, sigue llegando.
      entrando: d.hace_segundos !== null && d.hace_segundos < 30,
      haceSegundos: d.hace_segundos,
      adjuntosPendientes: media.pendientes(instancia),
    }});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/reintentar-archivos — vuelve a pedir los que faltan.
export async function reintentarArchivos(req, res, next) {
  try {
    // Son los archivos de TU sesion: no hace falta ser administrador para
    // volver a pedir lo tuyo.
    const n = await media.reencolarPendientes(miInstancia(req));
    res.json({ success: true, data: { reencolados: n } });
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/desconectar — desvincula el numero.
 *
 * Se puede hacer desde el movil (Dispositivos vinculados), pero quien administra
 * el CRM no siempre tiene ese telefono delante. Sin esto habia que pedirle a
 * alguien que lo hiciera por su cuenta.
 */
export async function desconectar(req, res, next) {
  try {
    // Cada uno desvincula el suyo. Un administrador no necesita poder tirar la
    // sesion de otro desde aqui: eso es el WhatsApp personal de esa persona.
    const r = await evolution.cerrarSesion(miInstancia(req));
    if (!r.ok) throw new AppError('No se pudo cerrar la sesion en WhatsApp', 502, 'SIN_CERRAR');
    res.json({ success: true, data: { cerrada: true } });
  } catch (err) { next(err); }
}

// GET /api/whatsapp/conexion — ¿esta emparejado el numero?
export async function conexion(req, res, next) {
  try {
    if (!evolution.configurado()) {
      return res.json({ success: true, data: { configurado: false, motivo: 'Falta EVOLUTION_URL o EVOLUTION_API_KEY' } });
    }
    const instancia = miInstancia(req);
    const [est, inst] = await Promise.all([evolution.estado(instancia), evolution.instancias()]);
    const lista = Array.isArray(inst.datos) ? inst.datos : (inst.datos?.instances || []);
    // La MIA por nombre, y punto. Antes caia a `lista[0]` cuando no la
    // encontraba, y con varias sesiones eso es ensenar el numero de otro.
    const mia = lista.find((i) => (i?.name || i?.instance?.instanceName) === instancia) || null;
    const crudo = est.datos?.instance?.state || est.datos?.state || null;
    res.json({ success: true, data: {
      configurado: true,
      instancia,
      // El numero con el que se emparejo. Sin esto una gestora no sabe desde
      // que linea esta escribiendo, que es justo lo que se pregunta al entrar.
      numero: mia?.ownerJid?.split('@')[0] || mia?.number || mia?.owner || null,
      nombre: mia?.profileName || mia?.profileName || null,
      conectado: crudo === 'open',
      estado: crudo,
    }});
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/emparejar — devuelve el QR para escanear una vez.
 *
 * Se reintenta antes de darse por vencido. WhatsApp tarda unos segundos en
 * mandar el primer codigo despues de abrir el socket, y en ese hueco la
 * respuesta era un error rojo en pantalla aunque no hubiera nada roto: bastaba
 * con volver a pedirlo. Quien empareja no tiene por que saber eso.
 */
export async function emparejar(req, res, next) {
  try {
    // Sin recorte por rol: cada persona enlaza SU numero. Solo puede tocar el
    // suyo, porque la instancia sale de su sesion y no de nada que ella mande.
    const instancia = miInstancia(req);
    // Cuanto historial quiere quien enlaza. Si manda cualquier otra cosa, lo
    // rapido: es lo que deja la pantalla usable en segundos.
    const modo = ['cero', 'rapido', 'todo'].includes(req.body?.modo) ? req.body.modo : 'rapido';

    let r = null;
    let ultimo = '';
    for (let intento = 1; intento <= 3; intento++) {
      // La primera vez se intenta crear; despues se pide el codigo de la que ya
      // existe, que es la forma que entiende una instancia ya creada.
      r = intento === 1 ? await evolution.crearInstancia(instancia, modo) : await evolution.qr(instancia);
      if (!r.ok) r = await evolution.qr(instancia);
      const d = r.datos || {};
      if (r.ok && (d.qrcode?.base64 || d.base64 || d.instance?.status === 'open')) break;
      ultimo = r.error || 'sin codigo todavia';
      if (intento < 3) await new Promise((espera) => setTimeout(espera, 2500));
    }

    if (!r?.ok) {
      logger.warn({ error: ultimo, instancia }, 'WhatsApp: no se pudo obtener el codigo QR');
      throw new AppError(
        'WhatsApp no ha dado el codigo. Vuelve a pulsar en unos segundos; si sigue igual, el servicio de WhatsApp del servidor esta caido.',
        502, 'SIN_QR'
      );
    }
    const d = r.datos || {};
    res.json({ success: true, data: {
      qr: d.qrcode?.base64 || d.base64 || null,
      estado: d.instance?.status || null,
    }});
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/webhook — lo llama Evolution, NO el navegador.
 *
 * Va sin verifyToken a proposito: quien llama es el contenedor, no un usuario.
 * Se protege con un secreto compartido y porque Evolution solo escucha en
 * 127.0.0.1. Siempre responde 200: si contestara error, Evolution reintentaria
 * en bucle.
 */
export async function webhook(req, res) {
  try {
    // El secreto es OBLIGATORIO en produccion, no «si esta puesto».
    //
    // Tal como estaba, olvidarse de la variable dejaba la puerta abierta: esta
    // ruta va antes del verifyToken —la llama el contenedor, no un navegador—
    // asi que cualquiera que supiera la direccion podia meter mensajes
    // inventados en la conversacion de una gestora, o marcarlos como enviados.
    // Es el mismo agujero que ya tuvimos con el webhook de Stripe.
    const secreto = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (!secreto) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('WhatsApp: falta EVOLUTION_WEBHOOK_SECRET — se rechaza el webhook');
        return res.status(503).json({ success: false, error: 'Webhook sin configurar' });
      }
      logger.warn('WhatsApp: webhook SIN secreto (solo aceptable fuera de produccion)');
    }
    if (secreto && req.get('x-webhook-secret') !== secreto) {
      logger.warn({ ip: req.ip }, 'WhatsApp: webhook con secreto incorrecto');
      return res.status(401).json({ success: false });
    }
    const r = await servicio.recibir(req.body);
    return res.json({ success: true, data: r });
  } catch (err) {
    logger.error({ err: err.message }, 'WhatsApp: fallo procesando el webhook');
    // Antes se contestaba 200 pasara lo que pasara, «para que no reintente en
    // bucle». Pero eso significaba que si la base tenia un mal momento, el
    // mensaje se perdia PARA SIEMPRE y nadie se enteraba.
    //
    // Ahora se distingue: un fallo de base o de red SI merece reintento —el
    // que llama espera y lo vuelve a mandar—; un mensaje que no sabemos leer,
    // no, porque reintentarlo daria el mismo resultado eternamente.
    const merecePenaReintentar = /ECONNREFUSED|ETIMEDOUT|terminating connection|too many clients|Connection terminated/i
      .test(err.message || '');
    return res.status(merecePenaReintentar ? 503 : 200)
      .json({ success: false, error: err.message });
  }
}
