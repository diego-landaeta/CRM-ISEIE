import * as model from './whatsapp.model.js';
import { createSchema, updateSchema } from './whatsapp.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

function proyecto(req) {
  const p = req.query.projectId || req.body?.projectId;
  const n = p ? parseInt(p) : null;
  if (!n) throw new AppError('projectId requerido', 400, 'MISSING_PROJECT');
  return n;
}

const esAdmin = (req) => ['admin', 'superadmin', 'soporte'].includes(req.user.role);

// GET /api/whatsapp/templates?projectId=N
export async function listTemplates(req, res, next) {
  try {
    res.json({ success: true, data: await model.listTemplates({
      projectId: proyecto(req), userId: req.user.userId,
    })});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/templates
export async function createTemplate(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    const { projectId, label, body, ambito } = parsed.data;
    // Una compartida la ve todo el equipo, asi que la crea quien manda. Las
    // personales, cualquiera: son suyas.
    if (ambito === 'compartida' && !esAdmin(req)) {
      throw new AppError('Solo un administrador crea plantillas compartidas', 403, 'FORBIDDEN');
    }
    const row = await model.createTemplate({
      projectId, label, body, ambito,
      ownerId: req.user.userId, createdBy: req.user.userId,
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) { next(err); }
}

// Quien puede tocar esta plantilla: la suya siempre; las compartidas, solo admin.
async function permitida(req, id) {
  const t = await model.getTemplate(id);
  if (!t) throw new AppError('Plantilla no encontrada', 404, 'NOT_FOUND');
  const propia = t.ambito === 'personal' && t.owner_id === req.user.userId;
  if (!propia && !esAdmin(req)) throw new AppError('No puedes tocar esta plantilla', 403, 'FORBIDDEN');
  return t;
}

// PATCH /api/whatsapp/templates/:id
export async function updateTemplate(req, res, next) {
  try {
    await permitida(req, parseInt(req.params.id));
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await model.updateTemplate(parseInt(req.params.id), parsed.data) });
  } catch (err) { next(err); }
}

// DELETE /api/whatsapp/templates/:id
export async function deleteTemplate(req, res, next) {
  try {
    await permitida(req, parseInt(req.params.id));
    await model.deleteTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /api/whatsapp/cola?projectId=N&responsableId=&estado=&productoId=&sinContactar=
export async function cola(req, res, next) {
  try {
    // Una gestora ve SU cola, ignorando lo que pida por query. Un admin puede
    // mirar la de quien quiera, o la de todos si no pide a nadie.
    const responsableId = req.user.role === 'gestor'
      ? req.user.userId
      : (req.query.responsableId ? parseInt(req.query.responsableId) : null);

    res.json({ success: true, data: await model.cola({
      projectId: proyecto(req),
      responsableId,
      estado: req.query.estado || null,
      productoId: req.query.productoId ? parseInt(req.query.productoId) : null,
      soloSinContactar: req.query.sinContactar === '1' || req.query.sinContactar === 'true',
      limite: Math.min(300, parseInt(req.query.limite) || 100),
    })});
  } catch (err) { next(err); }
}

// ── El gestor de salas ───────────────────────────────────────────────────────
//
// Vive en el servidor que tiene Docker y lo llaman los dos CRMs. El testigo
// NUNCA sale de aqui: si viajara al navegador, cualquiera con la consola
// abierta podria encender, apagar y entrar en la sala de quien quisiera.
//
// La clave lleva delante de que CRM viene, porque los dos tienen un usuario 14
// y no son la misma persona.
const SALAS = (process.env.WHATSAPP_SALAS_URL || '').replace(/\/+$/, '');
const SALAS_TOKEN = process.env.WHATSAPP_SALAS_TOKEN || '';
const CRM = process.env.WHATSAPP_CRM || 'crm';
const clave = (userId) => `${CRM}-${userId}`;

async function pedirSalas(ruta, metodo = 'GET') {
  if (!SALAS || !SALAS_TOKEN) return null;
  try {
    const r = await fetch(`${SALAS}${ruta}`, {
      method: metodo,
      headers: { 'x-salas-token': SALAS_TOKEN },
      signal: AbortSignal.timeout(20000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// GET /api/whatsapp/equipo?projectId=N  — el panel del admin.
export async function equipo(req, res, next) {
  try {
    if (!esAdmin(req)) throw new AppError('Solo un administrador ve el equipo', 403, 'FORBIDDEN');
    const gente = await model.equipo(proyecto(req));
    const salas = (await pedirSalas('/salas'))?.salas || [];
    const porClave = new Map(salas.map((s) => [s.clave, s]));

    res.json({ success: true, data: {
      // Si no hay gestor de salas configurado se dice, en vez de pintar a todo
      // el mundo como «sin vincular», que seria mentir.
      configurado: Boolean(SALAS && SALAS_TOKEN),
      gente: gente.map((u) => {
        const s = porClave.get(clave(u.id));
        return {
          id: u.id, nombre: u.nombre, email: u.email, role: u.role,
          disponible: u.disponible, ultimoAcceso: u.last_login_at,
          // «creada» significa que ya tiene sala; si ademas esta encendida, hay
          // alguien dentro o la ha usado hace poco.
          creada: Boolean(s), encendida: Boolean(s?.encendida), desde: s?.desde || null,
        };
      }),
    }});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/equipo/:userId/abrir  — enciende su sala y da la direccion.
export async function abrirSala(req, res, next) {
  try {
    if (!esAdmin(req)) throw new AppError('Solo un administrador entra en la sala de otra persona', 403, 'FORBIDDEN');
    const userId = parseInt(req.params.userId);
    if (!userId) throw new AppError('userId invalido', 400, 'BAD_REQUEST');
    if (!SALAS || !SALAS_TOKEN) throw new AppError('No hay gestor de salas configurado en el servidor', 503, 'NO_SALAS');

    const r = await pedirSalas(`/sala?clave=${clave(userId)}`, 'POST');
    if (!r || r.ranura === undefined) throw new AppError('El gestor de salas no ha podido abrirla', 502, 'SALAS_ERROR');

    res.json({ success: true, data: {
      userId,
      ranura: r.ranura,
      nueva: Boolean(r.nueva),
      url: await direccionSala(req, r.ranura, true),
    }});
  } catch (err) { next(err); }
}

// POST /api/whatsapp/equipo/:userId/latido — «sigo mirando, no la apagues».
export async function latido(req, res, next) {
  try {
    const userId = req.user.role === 'gestor' ? req.user.userId : parseInt(req.params.userId);
    await pedirSalas(`/latido?clave=${clave(userId)}`, 'POST');
    res.json({ success: true, data: { ok: true } });
  } catch (err) { next(err); }
}

// La direccion completa de una sala, con la sesion ya dentro.
async function direccionSala(req, ranura, mandaAqui) {
  const base = (process.env.WHATSAPP_NEKO_BASE || '').replace(/\/+$/, '');
  const raiz = ranura === null || ranura === undefined
    ? base                       // la sala unica de las pruebas
    : `${base.replace(/\/wa$/, '')}/wa/s${ranura}`;
  const cl = mandaAqui
    ? (process.env.WHATSAPP_NEKO_ADMIN_PASSWORD || process.env.WHATSAPP_NEKO_USER_PASSWORD || '')
    : (process.env.WHATSAPP_NEKO_USER_PASSWORD || '');
  const p = new URLSearchParams({
    usr: await model.nombreDe(req.user.userId),
    embed: '1', show_side: '0', mute_chat: '1',
  });
  if (cl) p.set('pwd', cl);
  return `${raiz}/?${p.toString()}`;
}

// GET /api/whatsapp/sala?userId=  — donde vive el WhatsApp Web de esta persona.
//
// La direccion base sale de WHATSAPP_NEKO_BASE, en el .env del servidor: asi se
// cambia sin reconstruir el frontal. Cada gestora tiene su propia sala, que es
// lo que permite varias sesiones a la vez sin que se pisen, y que un admin
// pueda entrar en la de cualquiera.
//
// La contraseña de la sala la pone el SERVIDOR y viaja ya dentro de la
// direccion. Es deliberado: quien llega aqui ya ha pasado por el login del CRM,
// y encontrarse un segundo usuario y contraseña para «entrar otra vez» es la
// forma mas rapida de que una gestora abandone la herramienta. El navegador
// remoto no es un sitio aparte al que haya que acceder: es una pieza de esta
// pantalla.
//
// La clave de admin —la unica que permite quitarle el mando a otro— no se le
// entrega jamas a una gestora: se elige aqui segun el rol, no en el frontal.
export async function sala(req, res, next) {
  try {
    const base = (process.env.WHATSAPP_NEKO_BASE || '').replace(/\/+$/, '');
    // Una gestora solo la suya. Un admin puede pedir la de quien quiera.
    const userId = req.user.role === 'gestor'
      ? req.user.userId
      : (req.query.userId ? parseInt(req.query.userId) : req.user.userId);

    if (!base) {
      return res.json({ success: true, data: {
        configurada: false,
        motivo: 'Falta WHATSAPP_NEKO_BASE en el servidor: no hay navegador remoto todavia.',
      }});
    }

    const mandaAqui = esAdmin(req);
    const clave = mandaAqui
      ? (process.env.WHATSAPP_NEKO_ADMIN_PASSWORD || process.env.WHATSAPP_NEKO_USER_PASSWORD || '')
      : (process.env.WHATSAPP_NEKO_USER_PASSWORD || '');

    // embed=1 quita la barra y el menu de Neko: dentro del CRM solo debe verse
    // el WhatsApp. show_side y mute_chat apagan su chat interno, que aqui no
    // pinta nada y solo confunde.
    const p = new URLSearchParams({
      // El nombre es el de QUIEN ENTRA, no el de la sala: si un admin se mete
      // en la sala de una gestora, ella tiene que ver quien esta con ella.
      usr: await model.nombreDe(req.user.userId),
      embed: '1',
      show_side: '0',
      mute_chat: '1',
    });
    if (clave) p.set('pwd', clave);

    res.json({ success: true, data: {
      configurada: true,
      userId,
      mandaAqui,
      url: `${base}/?${p.toString()}`,
    }});
  } catch (err) { next(err); }
}
