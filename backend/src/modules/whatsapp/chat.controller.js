import * as model from './chat.model.js';
import * as servicio from './chat.service.js';
import * as politica from './politica.js';
import * as evolution from './evolution.client.js';
import * as media from './media.service.js';
import * as firma from './media.firma.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import { respuestaLlamadaSchema } from './whatsapp.validation.js';
import { porQueNoPuede } from './roles.js';

import { TOPE_WHATSAPP_BYTES } from '../../shared/middleware/upload.js';

const esAdmin = (req) => ['admin', 'superadmin', 'soporte'].includes(req.user.role);

// Version del aviso que se acepta al enlazar. Se sube al cambiar el TEXTO, no
// al mover un boton: sirve para saber que leyo cada persona el dia que haga
// falta demostrarlo.
const VERSION_AVISO = 1;

/**
 * De quien es la sesion sobre la que se esta trabajando.
 *
 * Cada persona tiene la suya —una instancia por usuario del CRM— y por defecto
 * se trabaja sobre la propia. Quien manda puede ademas trabajar sobre la de
 * otra persona pasando `usuarioId`:
 *
 *   · superadmin: cualquiera.
 *   · admin:      solo quien comparta proyecto con el. Un administrador de una
 *                 marca no tiene por que leer los mensajes de la gestora de
 *                 otra; eso no es supervision, es curiosear.
 *   · el resto:   su propia sesion y punto. Si mandan un `usuarioId` que no es
 *                 el suyo, se rechaza — no se ignora en silencio, porque
 *                 ignorarlo esconde un intento que conviene ver.
 *
 * El recorte vive AQUI y no en cada endpoint: asi lo que se anada manana nace
 * con el candado puesto en vez de heredarlo si alguien se acuerda.
 */
async function usuarioObjetivo(req) {
  const propio = req.user.userId;

  // Lo PRIMERO: si quien pregunta no puede tener WhatsApp, no lo tiene ni el
  // suyo. Antes se devolvia la sesion propia antes de comprobar nada, asi que
  // un tutor entraba a la suya aunque no saliera en ninguna lista.
  //
  // Se mira el rol del testigo de sesion y no la base: es lo que hace el resto
  // del CRM, y consultar en cada peticion seria una consulta mas cada tres
  // segundos con el chat abierto. La contrapartida es que un cambio de rol
  // tarda en aplicarse lo que dure el testigo —quince minutos— y eso vale para
  // quitar el acceso, no para darlo: quien lo gana entra en cuanto renueve.
  const suyo = porQueNoPuede({ role: req.user.role, active: true });
  if (suyo) throw new AppError(suyo, 403, 'SIN_WHATSAPP');

  const pedido = parseInt(req.query?.usuarioId ?? req.body?.usuarioId ?? '', 10);
  if (!Number.isInteger(pedido) || pedido === propio) return propio;

  if (!['admin', 'superadmin'].includes(req.user.role)) {
    throw new AppError('Solo puedes trabajar con tu propio WhatsApp', 403, 'SOLO_EL_TUYO');
  }

  const { rows } = await query(
    `SELECT u.id, u.nombre, u.active, u.role, u.gestor_colaboraciones,
            EXISTS (
              SELECT 1 FROM user_projects a
              JOIN user_projects b ON b.project_id = a.project_id AND b.active
              WHERE a.user_id = $1 AND a.active AND b.user_id = $2
            ) AS comparten
       FROM users u WHERE u.id = $2`, [propio, pedido]);
  const u = rows[0];
  if (!u || !u.active) throw new AppError('Esa persona no existe o esta desactivada', 404, 'NO_EXISTE');
  if (req.user.role !== 'superadmin' && !u.comparten) {
    throw new AppError('Esa persona no esta en tus proyectos', 403, 'FUERA_DE_TUS_PROYECTOS');
  }
  // Y el candado del rol, AQUI tambien. Que la lista lo diga no basta: sin esto,
  // quien acertara el `usuarioId` de un tutor trabajaria sobre su sesion aunque
  // la pantalla no se la enseñara. La regla vive en `roles.js`, una sola vez.
  const noPuede = porQueNoPuede(u);
  if (noPuede) throw new AppError(noPuede, 403, 'SIN_WHATSAPP');

  // Queda escrito que ha entrado a mirar. AQUI, cuando ya se sabe que puede: un
  // intento rechazado no es una mirada, y apuntarlo antes dejaria en el registro
  // «entro a ver a Fulana» de alguien a quien se le nego el paso.
  //
  // Puede hacerlo, y hace falta: para ayudar a una gestora y para supervisar.
  // Pero son sus conversaciones con clientes, y algunas seran personales — que
  // se pueda mirar sin dejar rastro es lo que convierte esto en vigilancia.
  //
  // No se espera al resultado: apuntarlo no puede retrasar la pantalla, y si
  // falla ya se avisa por dentro. Una cada media hora por pareja, que esto se
  // llama en cada vuelta del chat.
  model.apuntarMirada?.({ quienMira: propio, aQuien: pedido, ip: req.ip })
    ?.catch(() => { /* ya se registra dentro */ });

  return pedido;
}

const instanciaObjetivo = async (req) => evolution.instanciaDe(await usuarioObjetivo(req));

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
  if (!conv || conv.instancia !== await instanciaObjetivo(req)) {
    throw new AppError('Conversacion no encontrada', 404, 'NOT_FOUND');
  }
  return conv;
}

// GET /api/whatsapp/chats?projectId=N
export async function chats(req, res, next) {
  try {
    res.json({ success: true, data: await model.listar({
      instancia: await instanciaObjetivo(req),
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
      limite: parseInt(req.query.limite) || 50,
      // Buscar en la base y no en el navegador: con el tope de 50, filtrar lo
      // ya cargado dejaba fuera cualquier seguimiento de hace semanas.
      busca: req.query.busca || null,
      // La «etiqueta»: el estado del prospecto (#72).
      estado: req.query.estado || null,
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
      // Quien esta escribiendo: de momento, nadie.
      //
      // Evolution no deja preguntarlo —solo mandar la presencia propia— y el
      // endpoint que se usaba era del puente de Baileys: en produccion daba 404
      // cada cinco segundos por cada chat abierto, 136 en diez minutos. Eso
      // enterraba los errores de verdad (tarea #63).
      //
      // Se deja el campo en la respuesta para que la pantalla no cambie: cuando
      // se encienda el evento `presence.update` del webhook volvera a llenarse
      // sin tocar el frontal.
      const escribiendo = null;

    // Marca leido tambien EN WhatsApp: al otro lado le sale el doble tic azul.
    // Se le pasa lo que ya sabemos, para que no haga nada si no hay sin leer.
    await servicio.marcarLeida(id, conv.no_leidos).catch(() => {});
    res.json({ success: true, data: { conversacion: conv, mensajes: msgs, escribiendo } });
  } catch (err) { next(err); }
}

// POST /api/whatsapp/chats/:id/enviar  { texto }
export async function enviar(req, res, next) {
  try {
    const texto = String(req.body?.texto || '').trim();
    if (!texto) throw new AppError('El mensaje esta vacio', 400, 'VACIO');
    if (texto.length > 4000) throw new AppError('El mensaje es demasiado largo', 400, 'MUY_LARGO');
    const conv = await miConversacion(req, parseInt(req.params.id));
    // A que mensaje se responde. Se comprueba que es de ESTA conversacion: sin
    // eso se podria citar el mensaje de otra persona en un chat ajeno.
    let citarWaId = null;
    if (req.body?.citarId) {
      const original = await model.mensajePorId(parseInt(req.body.citarId));
      if (original && original.jid === conv.jid) citarWaId = original.wa_id;
    }
    const fila = await servicio.enviar({
      conversacionId: conv.id, texto, usuarioId: req.user.userId, citarWaId,
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

    const instancia = await instanciaObjetivo(req);

    // Se le pregunta a WhatsApp cual es la direccion buena de ese numero.
    //
    // Tecleando a mano es facil colar el cero de tronco nacional —«0412...» en
    // Venezuela, «06...» en Italia— y con el delante WhatsApp no conoce a
    // nadie: se abria una conversacion muerta contra un numero con ese cero
    // metido en medio, y al escribir salia un error que no explicaba nada.
    //
    // Se pregunta en vez de adivinar. Ir anadiendo reglas pais por pais es una
    // carrera que no se gana: quien sabe si ese numero existe es WhatsApp.
    let jid = `${digitos}@s.whatsapp.net`;
    const { existe, jid: jidBueno } = await evolution.comprobarNumero(digitos, instancia);
    if (existe === false) {
      throw new AppError(
        `No hay ninguna cuenta de WhatsApp con el numero ${digitos}. Revisa el prefijo del pais: si tu pais usa un 0 delante al marcar dentro, ese 0 no va.`,
        404, 'NO_ESTA_EN_WHATSAPP'
      );
    }
    // Con `existe: null` no se pudo comprobar —sesion caida—: se sigue con lo
    // tecleado en vez de bloquear, porque no saber no es lo mismo que no estar.
    if (jidBueno) jid = jidBueno;

    const conv = await model.conversacionDe({
      instancia,
      jid,
      // El nombre, de TU agenda y no del perfil de esa persona.
      //
      // Aqui iba `null`, asi que la conversacion nacia sin nombre y se quedaba
      // con el primero que llegara — que es el `pushName`, o sea como se llama
      // esa persona en WhatsApp. Si la tienes guardada como «Diego fontanero» y
      // ella se puso «Dieguis», veias «Dieguis»: y el nombre con el que TU la
      // tienes agendada es el unico que te dice quien es.
      //
      // Solo al ABRIR un chat nuevo, que es raro. El resto del tiempo los
      // nombres se ponen al dia en bloque cada cuarto de hora.
      nombrePush: await nombreEnLaAgenda(instancia, jid).catch(() => null),
    });
    res.status(201).json({ success: true, data: conv });
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/chats/:id/ficha — el prospecto de esta conversacion.
 *
 * Lo justo para el popup del chat: quien es, en que estado esta, de quien es y
 * sus ultimas anotaciones. El resto se ve en la ficha completa.
 *
 * OJO CON EL PERMISO, que aqui es facil equivocarse. No se usa el guardia de
 * Prospectos —`exigirQueSeaSuyo`— porque comprueba que el prospecto sea de QUIEN
 * PREGUNTA, y cuando un administrador esta mirando el WhatsApp de una gestora el
 * prospecto es de ella: la ficha saldria vacia justo en el caso que hay que
 * cubrir. El guardia bueno es el del propio chat: si puedes leer la
 * conversacion, puedes ver de quien es. Lo pide asi la tarea #64.
 *
 * Una conversacion sin prospecto NO es un error: hay muchas, de gente que
 * escribe y todavia no esta en el CRM. Se contesta con el telefono para que la
 * pantalla ofrezca crearlo ya relleno.
 */
export async function ficha(req, res, next) {
  try {
    const conv = await miConversacion(req, parseInt(req.params.id));
    const prospecto = await model.fichaDeConversacion(conv.id);
    if (!prospecto) {
      return res.json({
        success: true,
        data: {
          prospecto: null,
          telefono: conv.telefono,
          nombre: conv.nombre_push || null,
          esGrupo: Boolean(conv.es_grupo),
        },
      });
    }
    const interacciones = await model.ultimasInteracciones(prospecto.id).catch(() => []);
    res.json({ success: true, data: { prospecto, interacciones, telefono: conv.telefono } });
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
      // La duracion medida al grabar, para las notas de voz.
      segundos: parseInt(req.body?.segundos, 10) || null,
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
    if (!m || m.instancia !== await instanciaObjetivo(req)) {
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
 * POST /api/whatsapp/chats/:id/llamada — apunta que se ha llamado.
 *
 * Llamar no se puede hacer desde aqui: WhatsApp no deja: no hay canal de audio
 * por esta via. Lo que hace el boton es abrir la llamada en el movil de la
 * gestora, y lo que hace el CRM es apuntar que se intento.
 *
 * Sin esto, la mitad de las llamadas seguirian sin aparecer en el historial:
 * quedan las que entran —esas si las cuenta WhatsApp— y se pierden todas las
 * que salen, que suelen ser las que importan para saber si se atendio a alguien.
 *
 * El identificador lleva el minuto dentro a proposito. Pulsar dos veces porque
 * no dio tono, o que la pantalla mande el aviso otra vez, no son dos llamadas:
 * el indice unico de `wa_id` los junta en una sola.
 */
export async function registrarLlamada(req, res, next) {
  try {
    const conv = await miConversacion(req, parseInt(req.params.id));
    const minuto = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const fila = await model.guardarMensaje({
      conversacionId: conv.id,
      waId: `try:${conv.id}:${minuto}`,
      direccion: 'saliente',
      tipo: 'llamada',
      texto: 'intento',
      mediaMime: 'audio',
      enviadoPor: req.user.userId,
      ts: new Date(),
    });

    // Y en la ficha del prospecto. Solo si el mensaje entro: `fila` vacia
    // significa que ya se habia apuntado este minuto —doble clic porque no dio
    // tono— y no son dos llamadas.
    if (fila && conv.lead_id) {
      try {
        await model.apuntarInteraccion({
          leadId: conv.lead_id,
          nota: 'Llamada desde el movil (marcada desde el CRM)',
          userId: req.user.userId,
          fecha: fila.ts,
        });
      } catch (err) {
        // Que no quede en la ficha no puede impedir llamar: el trabajo es hablar
        // con la persona.
        logger.warn({ conv: conv.id, err: err.message }, 'WhatsApp: llamada no apuntada en la ficha');
      }
    }
    res.json({ success: true, data: { telefono: conv.telefono } });
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/sonando — ¿te estan llamando ahora mismo?
 *
 * Lo consulta TODO el CRM, no solo la pantalla de WhatsApp: la gracia es
 * enterarse estando en Prospectos o en Facturacion, que es donde se pierde una
 * llamada porque el movil esta en el bolso.
 *
 * Por eso no toca la base. Ni una consulta: el nombre y el telefono ya se
 * buscaron una vez cuando entro el aviso, y aqui solo se lee un Map. Con diez
 * gestoras y una vuelta cada pocos segundos, cualquier consulta aqui se
 * multiplica por todas las pestañas abiertas del dia.
 *
 * Y es SIEMPRE la sesion de uno mismo, nunca la de otro: un administrador que
 * esta mirando el WhatsApp de una gestora no tiene por que saltar cuando a ella
 * la llaman, ni interrumpir lo que este haciendo.
 */
export async function sonando(req, res, next) {
  try {
    const instancia = evolution.instanciaDe(req.user.userId);
    const l = servicio.llamadaSonando(instancia);
    res.json({
      success: true,
      data: {
        sonando: l
          ? {
              id: l.id,
              telefono: l.telefono,
              nombre: l.nombre,
              conversacionId: l.conversacionId,
              esVideo: l.esVideo,
              esGrupo: l.esGrupo,
              // Cuanto lleva sonando, para que la pantalla cuente los segundos
              // sin depender de que el reloj del navegador vaya igual que el
              // del servidor.
              segundos: Math.round((Date.now() - l.desde) / 1000),
            }
          : null,
        // Si esta sesion nunca ha dado señales, la pantalla espacia las
        // vueltas: no tiene sentido preguntar cada tres segundos por un
        // WhatsApp que no esta enlazado, y la mayoria del CRM no lo tiene.
        enlazada: await servicio.tieneSesion(instancia),
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/respuesta-llamada — que se contesta a quien llama.
 *
 * Va por sesion, no global: no todas la quieren. Una gestora que si coge el
 * telefono no debe rechazar automaticamente a nadie.
 */
export async function respuestaLlamada(req, res, next) {
  try {
    const instancia = await instanciaObjetivo(req);
    const a = await evolution.ajustes(instancia);
    if (a === null) {
      // Que no se puedan leer no es un error de la pantalla: es que la sesion
      // no esta levantada. Se dice y se ensena apagada, no se rompe.
      return res.json({ success: true, data: { activa: false, texto: '', disponible: false } });
    }
    res.json({
      success: true,
      data: { activa: Boolean(a.rejectCall), texto: a.msgCall || '', disponible: true },
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/whatsapp/respuesta-llamada — cambiarla.
 *
 * Rechaza la llamada y contesta con un texto. Es lo unico que se puede hacer:
 * por esta via WhatsApp no da canal de audio, asi que coger la llamada desde el
 * CRM no existe. Al menos quien llama recibe una respuesta en vez de silencio.
 */
export async function guardarRespuestaLlamada(req, res, next) {
  try {
    // safeParse y no parse: un ZodError suelto no lleva statusCode, asi que el
    // manejador lo toma por fallo interno y contesta «error del sistema» — que
    // es justo lo contrario de lo que pasa, porque el usuario SI puede
    // arreglarlo. Es el patron que ya usan los demas modulos.
    const v = respuestaLlamadaSchema.safeParse(req.body || {});
    if (!v.success) {
      throw new AppError(v.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    }
    const datos = v.data;
    const instancia = await instanciaObjetivo(req);
    const r = await evolution.guardarAjustes(instancia, {
      rejectCall: datos.activa,
      // Al apagarla se vacia el texto: dejarlo puesto haria que Evolution
      // siguiera contestando aunque la casilla se vea desmarcada.
      msgCall: datos.activa ? datos.texto : '',
    });
    // 409 y no 502: que la sesion no este levantada no es una averia del
    // servidor, es un estado que la gestora puede resolver enlazando. Con 5xx
    // el manejador tapa el motivo con «error del sistema» y no se entera de
    // que lo que falta es conectar su WhatsApp.
    if (!r.ok) {
      throw new AppError(
        'Tu WhatsApp no esta conectado ahora mismo, asi que esto no se puede cambiar. Enlazalo y vuelve a intentarlo.',
        409, 'WHATSAPP_DESCONECTADO',
      );
    }
    logger.info({ instancia, activa: datos.activa }, 'WhatsApp: respuesta a llamadas cambiada');
    res.json({ success: true, data: { activa: datos.activa, texto: datos.activa ? datos.texto : '' } });
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/sincronizacion — ¿sigue entrando historial?
 *
 * Al emparejar, WhatsApp manda miles de mensajes durante varios minutos. Sin
 * esto la pantalla no sabe si sigue trabajando o se quedo parada, que es
 * exactamente lo que no se podia distinguir.
 */
// Los recuentos, guardados un rato.
//
// Contar 380.000 mensajes cada cuatro segundos por pantalla abierta es tirar la
// maquina para pintar un numero que ademas nadie mira al detalle: es un
// indicador de avance, no una cuenta contable. Se guarda el resultado un rato y
// todas las pestanas de esa persona comparten el mismo.
//
// El plazo se adapta: mientras entra historial se refresca a menudo, porque ahi
// el numero SI cambia y es lo unico que dice que la cosa avanza. Cuando ya no
// entra nada, cada medio minuto sobra.
const recuentos = new Map();   // instancia -> { hasta, datos }

async function recuentoDe(instancia, entrando) {
  const guardado = recuentos.get(instancia);
  if (guardado && guardado.hasta > Date.now()) return guardado.datos;
  const datos = await model.actividad(instancia);
  recuentos.set(instancia, { hasta: Date.now() + (entrando ? 3000 : 30000), datos });
  return datos;
}

export async function sincronizacion(req, res, next) {
  try {
    const instancia = await instanciaObjetivo(req);

    // Quien sabe si sigue entrando historial es el webhook, que es por donde
    // entra. Se pregunta a la memoria, no a la base: contestarlo contando la
    // tabla entera costaba un escaneo de 380.000 filas cada cuatro segundos por
    // cada pantalla abierta.
    // «Sigue entrando» se mide con el latido del HISTORIAL, no con el general:
    // ese se actualiza con cada mensaje normal y dejaba el aviso de
    // «Sincronizando…» puesto mientras la gestora chateaba.
    const latido = servicio.ultimoDelHistorial(instancia);
    const haceSegundos = latido ? Math.round((Date.now() - latido) / 1000) : null;
    const entrando = haceSegundos !== null && haceSegundos < 30;

    const d = await recuentoDe(instancia, entrando);
    res.json({ success: true, data: {
      conversaciones: d.conversaciones,
      mensajes: d.mensajes,
      entrando,
      // Si el servidor acaba de arrancar no hay latido en memoria; entonces vale
      // lo que sepa la base, que para eso ya se ha consultado.
      haceSegundos: haceSegundos ?? d.hace_segundos,
      adjuntosPendientes: media.pendientes(instancia),
      // Cuanto lleva del historial, de 0 a 100. Es el numero REAL que manda
      // Baileys en cada tanda; WhatsApp no dice cuantos mensajes va a mandar en
      // total, asi que calcularlo por nuestra cuenta seria inventarselo.
      //
      // Puede venir null —si quien manda los avisos no lo incluye, o si lleva
      // dos minutos sin moverse— y entonces la pantalla enseña los contadores
      // de siempre. Una barra parada en el 40 % es peor que no tener barra.
      progreso: servicio.progresoDe(instancia),
    }});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/reintentar-archivos — vuelve a pedir los que faltan.
export async function reintentarArchivos(req, res, next) {
  try {
    // Son los archivos de TU sesion: no hace falta ser administrador para
    // volver a pedir lo tuyo.
    const n = await media.reencolarPendientes(await instanciaObjetivo(req));
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
    const instancia = await instanciaObjetivo(req);
    const r = await evolution.cerrarSesion(instancia);
    if (!r.ok) throw new AppError('No se pudo cerrar la sesion en WhatsApp', 502, 'SIN_CERRAR');

    // Y lo guardado en el CRM, solo si se pide.
    //
    // Nunca por defecto: son conversaciones con clientes y borrarlas de mas es
    // irreversible. Pero tampoco se puede no ofrecerlo — desvincular y volver a
    // enlazar «desde cero» devolvia los chats de siempre, porque «cero» era
    // cero para WhatsApp y no para la base.
    let borradas = null;
    if (req.body?.borrarConversaciones === true) {
      const { conversaciones, archivos } = await model.borrarConversaciones(instancia);
      // Los ficheros tambien: si no, quedan adjuntos de conversaciones que ya
      // no existen ocupando disco y sin forma de llegar a ellos.
      const { deleteLocal } = await import('../../shared/services/localStorage.service.js');
      let ficheros = 0;
      for (const ruta of archivos) {
        try { await deleteLocal(ruta); ficheros++; } catch { /* ya no estaba */ }
      }
      borradas = { conversaciones, ficheros };
      logger.info({ instancia, ...borradas }, 'WhatsApp: conversaciones borradas al desvincular');
    }
    res.json({ success: true, data: { cerrada: true, borradas } });
  } catch (err) { next(err); }
}

// Cuando se refrescaron por ultima vez los nombres de cada sesion.
const nombresRefrescados = new Map();
const CADA_CUANTO_NOMBRES = 15 * 60 * 1000;

/**
 * Como tienes guardada a esa persona en TU agenda.
 *
 * Devuelve null si no esta —un numero suelto que nunca guardaste— y entonces
 * vale lo que WhatsApp diga de ella.
 */
async function nombreEnLaAgenda(instancia, jid) {
  const contactos = await evolution.agenda(instancia);
  const numero = String(jid).split('@')[0];
  const suyo = (contactos || []).find((c) => {
    if (!c?.jid || !c?.nombre) return false;
    // Por numero y no por jid entero: la agenda puede traerlo con `@lid` o con
    // `@s.whatsapp.net` segun de donde venga, y es la misma persona.
    return String(c.jid).split('@')[0] === numero;
  });
  return suyo?.nombre ? String(suyo.nombre) : null;
}

async function refrescarNombresSiToca(instancia) {
  const ultima = nombresRefrescados.get(instancia) || 0;
  if (Date.now() - ultima < CADA_CUANTO_NOMBRES) return;
  nombresRefrescados.set(instancia, Date.now());
  const contactos = await evolution.agenda(instancia);
  const pares = (contactos || [])
    .filter((c) => c?.jid && c?.nombre)
    .map((c) => ({ jid: c.jid, nombre: String(c.nombre) }));
  const puestos = await model.refrescarNombres(instancia, pares);
  if (puestos) {
    logger.info({ instancia, puestos, deLaAgenda: pares.length }, 'WhatsApp: nombres puestos al dia');
  }
}

// GET /api/whatsapp/conexion — ¿esta emparejado el numero?
export async function conexion(req, res, next) {
  try {
    if (!evolution.configurado()) {
      // Los nombres de las variables van al REGISTRO, no a la pantalla.
      //
      // Aqui ponia «Falta EVOLUTION_URL o EVOLUTION_API_KEY». No era falso,
      // pero le hablaba al programador delante de la gestora: dos nombres de
      // variables de entorno de los que ella no sabe nada y con los que no
      // puede hacer nada. Lo unico que entendia es que algo estaba roto.
      //
      // Y en pruebas no es que este roto: es que ahi no hay WhatsApp montado.
      // Decirlo cambia por completo lo que entiende quien lo lee.
      logger.warn('WhatsApp sin configurar: faltan EVOLUTION_URL o EVOLUTION_API_KEY');
      return res.json({ success: true, data: {
        configurado: false,
        topeAdjuntoBytes: TOPE_WHATSAPP_BYTES,
        grupos: politica.seAceptanGrupos(),
        motivo: process.env.NODE_ENV === 'production'
          ? 'WhatsApp no esta disponible ahora mismo. Avisa a quien lleva el CRM.'
          : 'WhatsApp todavia no esta disponible en este entorno de pruebas. En produccion funciona con normalidad.',
      }});
    }
    const instancia = await instanciaObjetivo(req);
    const [est, inst] = await Promise.all([evolution.estado(instancia), evolution.instancias()]);
    const lista = Array.isArray(inst.datos) ? inst.datos : (inst.datos?.instances || []);
    // La MIA por nombre, y punto. Antes caia a `lista[0]` cuando no la
    // encontraba, y con varias sesiones eso es ensenar el numero de otro.
    const mia = lista.find((i) => (i?.name || i?.instance?.instanceName) === instancia) || null;
    const crudo = est.datos?.instance?.state || est.datos?.state || null;

    // Aprovechando que aqui se sabe quien eres, se quita tu nombre de las
    // conversaciones de otros. Es barato —una consulta que casi siempre no
    // toca nada— y arregla lo que quedo mal antes del cerrojo.
    const miNumero = mia?.ownerJid?.split('@')[0] || mia?.number || null;
    if (crudo === 'open' && mia?.profileName) {
      const limpiadas = await model.limpiarNombrePropio(instancia, mia.profileName, miNumero)
        .catch(() => 0);
      if (limpiadas) {
        logger.info({ instancia, limpiadas }, 'WhatsApp: quitado el nombre propio de conversaciones ajenas');
      }
      // Y se ponen al dia los nombres desde la agenda de WhatsApp, que es la
      // fuente buena: tus contactos y los nombres REALES de los grupos.
      //
      // De vez en cuando, no en cada consulta: la pantalla pregunta por la
      // conexion cada treinta segundos y traerse la agenda entera cada vez
      // seria absurdo. Un cuarto de hora basta — los nombres no cambian tanto.
      await refrescarNombresSiToca(instancia).catch(() => {});
    }
    res.json({ success: true, data: {
      configurado: true,
      instancia,
      // El numero con el que se emparejo. Sin esto una gestora no sabe desde
      // que linea esta escribiendo, que es justo lo que se pregunta al entrar.
      numero: mia?.ownerJid?.split('@')[0] || mia?.number || mia?.owner || null,
      nombre: mia?.profileName || mia?.profileName || null,
      conectado: crudo === 'open',
      estado: crudo,
      // El tope real de un adjunto, dicho por quien lo sabe (#77).
      //
      // `TOPE_WHATSAPP_BYTES` se importaba aqui y no se usaba en ninguna linea,
      // asi que la pantalla nunca recibia este campo y caia siempre a su
      // constante escrita a mano — que es exactamente el numero desincronizado
      // que se queria eliminar. Un import muerto no da error y no se ve.
      topeAdjuntoBytes: TOPE_WHATSAPP_BYTES,
      // Si este WhatsApp deja corregir mensajes (#75).
      //
      // `evolution.puedeEditar()` existia desde el primer dia y no lo llamaba
      // NADIE: se apagaba la funcion por dentro tras un 404 y la pantalla
      // seguia ofreciendo el boton en todos los mensajes. La gestora lo pulsaba
      // una y otra vez y siempre fallaba igual — que es exactamente lo que se
      // queria evitar apagandola.
      puedeCorregir: evolution.puedeEditar(),
      // Si entran los grupos o no. La pantalla lo dice al buscar sin resultados
      // y hasta ahora lo afirmaba a ciegas: «los grupos no se muestran» era
      // falso, porque si se muestran (#74).
      grupos: politica.seAceptanGrupos(),
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
    // Quien no manda solo puede enlazar el suyo: usuarioObjetivo lo impone. Un
    // administrador si puede enlazar el de una gestora —tenerla al lado con su
    // movil y hacerlo desde aqui es mas rapido que explicarselo por telefono—.
    const instancia = await instanciaObjetivo(req);
    // Cuanto historial quiere quien enlaza. Si manda cualquier otra cosa, lo
    // rapido: es lo que deja la pantalla usable en segundos.
    const modo = politica.MODOS.includes(req.body?.modo) ? req.body.modo : 'rapido';
    // Se apunta para poder recortar lo que llegue (#73). El socket ya viene
    // pidiendo todo el historial en «rapido» —si no, no habria nada que
    // recortar—, asi que los 30 dias los aplica el CRM al recibir.
    politica.apuntarModo(instancia, modo);

    // El aviso se acepta ANTES de que salga el codigo, y queda escrito.
    //
    // Sin esto la casilla de la pantalla no vale nada: bastaria con llamar al
    // endpoint a mano. Y hace falta guardarlo porque el numero es de una
    // persona — si WhatsApp se lo bloquea, tiene que poder verse que se le
    // advirtio, cuando, y con que texto.
    if (req.body?.enterado !== true) {
      throw new AppError(
        'Hay que leer y aceptar el aviso antes de enlazar un numero',
        400, 'FALTA_CONSENTIMIENTO'
      );
    }
    const objetivo = await usuarioObjetivo(req);
    const apuntado = await model.apuntarConsentimiento({
      userId: objetivo,
      aceptadoPor: req.user.userId,
      instancia,
      versionAviso: VERSION_AVISO,
      ip: req.ip,
      navegador: req.get('user-agent'),
    });
    if (!apuntado) {
      logger.warn({ instancia }, 'WhatsApp: falta la migracion 129, el consentimiento no queda registrado');
    }

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
    // El secreto puede llegar de dos formas, y hacen falta las dos.
    //
    // Lo natural es la cabecera. Pero el webhook GLOBAL de Evolution —el que se
    // configura por variable de entorno, que es como esta montado— no permite
    // mandar cabeceras propias: solo una direccion. Asi que se acepta tambien
    // como parte de la direccion, que es lo unico que ese modo deja controlar.
    //
    // No es peor: esa llamada va del contenedor al CRM por la red interna de la
    // maquina, no sale a internet. Y sigue siendo obligatorio.
    const secreto = process.env.EVOLUTION_WEBHOOK_SECRET;
    const recibido = req.get('x-webhook-secret') || req.query?.s || '';
    if (!secreto) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('WhatsApp: falta EVOLUTION_WEBHOOK_SECRET — se rechaza el webhook');
        return res.status(503).json({ success: false, error: 'Webhook sin configurar' });
      }
      logger.warn('WhatsApp: webhook SIN secreto (solo aceptable fuera de produccion)');
    }
    if (secreto && recibido !== secreto) {
      logger.warn({ ip: req.ip }, 'WhatsApp: webhook con secreto incorrecto');
      return res.status(401).json({ success: false });
    }
    const r = await servicio.recibir(req.body);
    // Cada mensaje deja rastro de en que acabo.
    //
    // Antes no se registraba nada: buscando por que no llegaba un audio no
    // habia forma de saber si el aviso ni siquiera llego, si se descarto por
    // algo, o si se guardo y el fallo estaba en la pantalla. Se registra el
    // TIPO y el resultado, nunca el contenido: son conversaciones de clientes.
    if (r?.ignorado) {
      logger.info({ instancia: req.body?.instance, motivo: r.ignorado }, 'WhatsApp: aviso descartado');
    } else if (r?.duplicado) {
      logger.debug({ instancia: req.body?.instance, tipo: r.tipo }, 'WhatsApp: mensaje repetido');
    } else if (r?.guardado) {
      logger.info({
        instancia: req.body?.instance, tipo: r.tipo,
        conversacion: r.conversacionId, adjuntoEnCola: r.enCola,
      }, 'WhatsApp: mensaje guardado');
    }
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

/**
 * GET /api/whatsapp/usuarios — de quien puedo ver el WhatsApp.
 *
 * Devuelve la lista con la que se pinta el selector del panel. Para quien no
 * manda es siempre una sola persona: ella misma. Asi la pantalla no tiene que
 * saber de roles — pregunta y pinta lo que le devuelvan.
 */
export async function usuarios(req, res, next) {
  try {
    const yo = req.user.userId;
    const soloMio = !['admin', 'superadmin'].includes(req.user.role);

    const { rows } = await query(
      soloMio
        ? `SELECT id, nombre, email, role, active, gestor_colaboraciones
             FROM users WHERE id = $1`
        : (req.user.role === 'superadmin'
            // NO se filtra por rol aqui.
            //
            // Antes la consulta llevaba `role IN (...)` y quien no estaba en esa
            // lista simplemente NO APARECIA — hoy, los tutores. Nadie sabia por
            // que, y no salir es la peor forma de negar algo: parece un fallo.
            // Ahora salen todos y cada uno dice si puede tener WhatsApp y, si no,
            // por que. Quien decide es `roles.js`, en un solo sitio.
            ? `SELECT id, nombre, email, role, active, gestor_colaboraciones
                 FROM users
                WHERE active
                ORDER BY (id = $1) DESC, nombre`
            // EXISTS y no DISTINCT con dos JOIN.
            //
            // Tal como estaba, Postgres rechazaba la consulta entera: «for
            // SELECT DISTINCT, ORDER BY expressions must appear in select
            // list», porque `(u.id = $1)` no esta en la lista de campos. O sea
            // que CUALQUIER admin que abriera el selector de sesion recibia un
            // 500. Un superadmin no lo veia nunca, porque va por la rama de
            // arriba — por eso podia estar roto sin que nadie se enterara.
            //
            // Con EXISTS no hacen falta ni el DISTINCT ni la deduplicacion: se
            // pregunta si comparte algun proyecto y se para en el primero.
            : `SELECT u.id, u.nombre, u.email, u.role, u.active, u.gestor_colaboraciones
                 FROM users u
                WHERE u.active
                  AND EXISTS (
                    SELECT 1 FROM user_projects b
                      JOIN user_projects a ON a.project_id = b.project_id
                                          AND a.active AND a.user_id = $1
                     WHERE b.user_id = u.id AND b.active
                  )
                ORDER BY (u.id = $1) DESC, u.nombre`),
      [yo]);

    // El estado de cada sesion se pregunta UNA vez a Evolution y se reparte:
    // preguntar una por una son diez llamadas para pintar un desplegable.
    let porInstancia = new Map();
    if (evolution.configurado()) {
      try {
        const inst = await evolution.instancias();
        const lista = Array.isArray(inst.datos) ? inst.datos : (inst.datos?.instances || []);
        porInstancia = new Map(lista.map((i) => [
          i?.name || i?.instance?.instanceName,
          {
            conectado: (i?.connectionStatus || i?.instance?.status) === 'open',
            numero: i?.ownerJid?.split('@')[0] || i?.number || null,
          },
        ]));
      } catch (err) {
        logger.warn({ err: err.message }, 'WhatsApp: no se pudo leer el estado de las sesiones');
      }
    }

    res.json({ success: true, data: rows.map((u) => {
      const instancia = evolution.instanciaDe(u.id);
      const est = porInstancia.get(instancia) || {};
      // Se dice quien NO puede y por que, en vez de esconderlo. La pantalla lo
      // enseña apagado con su motivo, que es lo que pide la tarea #68.
      const motivo = porQueNoPuede(u);
      return {
        id: u.id, nombre: u.nombre, email: u.email, role: u.role,
        soyYo: u.id === yo,
        conectado: Boolean(est.conectado),
        numero: est.numero || null,
        puede: motivo === null,
        motivo,
      };
    })});
  } catch (err) { next(err); }
}

/**
 * GET /api/whatsapp/sin-leer — lo que ha entrado y nadie ha leido.
 *
 * Para avisar de un mensaje nuevo desde cualquier pantalla. Hasta ahora el CRM
 * no avisaba de NADA: cuando entraba un WhatsApp no habia sonido, ni aviso, ni
 * cambio en el titulo de la pestaña. La gestora solo se enteraba si tenia el
 * chat abierto y estaba mirando.
 *
 * Mismo molde que `sonando`, que es lo que ya avisa de las llamadas: se
 * pregunta cada pocos segundos desde el layout, y devuelve `enlazada` para que
 * quien no tenga WhatsApp espacie las vueltas en vez de preguntar en balde toda
 * la jornada.
 */
export async function sinLeer(req, res, next) {
  try {
    const instancia = await instanciaObjetivo(req);
    const [datos, enlazada] = await Promise.all([
      model.sinLeer(instancia),
      servicio.tieneSesion(instancia),
    ]);
    res.json({ success: true, data: { ...datos, enlazada } });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/whatsapp/mensajes/:id — corrige un mensaje ya enviado (#75).
 *
 * «Se siguen enviando y no permite corregir desde la app». Hasta ahora un error
 * de dedo en un mensaje a un prospecto se quedaba ahi para siempre, y la unica
 * salida era mandar otro pidiendo perdon.
 *
 * Pasa por `miConversacion`, asi que nadie puede corregir un mensaje de la
 * conversacion de otra persona: contesta «no encontrada», que no confirma
 * siquiera que exista.
 */
export async function editarMensaje(req, res, next) {
  try {
    const texto = String(req.body?.texto ?? '').trim();
    if (!texto) throw new AppError('El mensaje no puede quedar vacio', 400, 'TEXTO_VACIO');
    if (texto.length > 4096) throw new AppError('Ese texto es demasiado largo', 400, 'TEXTO_LARGO');

    const conversacionId = parseInt(req.body?.conversacionId, 10);
    const conv = await miConversacion(req, conversacionId);
    const fila = await servicio.editarMensaje({
      mensajeId: parseInt(req.params.id, 10),
      conversacion: conv,
      texto,
      instancia: await instanciaObjetivo(req),
    });
    res.json({ success: true, data: fila });
  } catch (err) { next(err); }
}
