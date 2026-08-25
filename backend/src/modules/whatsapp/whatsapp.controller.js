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
/**
 * Convierte «esa tabla no existe» en algo que se entienda.
 *
 * Leer sin la migracion 122 devuelve lista vacia y ya esta. Pero escribir SI
 * tiene que decir algo: con un 500 la pantalla pone «error del sistema» y quien
 * intenta guardar una plantilla no sabe si es culpa suya, si se ha perdido el
 * texto, ni a quien preguntar.
 *
 * 409 y no 5xx a proposito: el manejador tapa los 5xx con un mensaje generico,
 * y este mensaje concreto es justo lo unico util que se puede decir.
 */
function siFaltaLaTabla(err) {
  if (err?.code === '42P01') {
    return new AppError(
      'Las plantillas todavia no estan disponibles: falta un paso de instalacion en el servidor. Avisa a quien lleve el CRM.',
      409, 'FALTA_MIGRACION',
    );
  }
  return err;
}

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
  } catch (err) { next(siFaltaLaTabla(err)); }
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
  } catch (err) { next(siFaltaLaTabla(err)); }
}

// DELETE /api/whatsapp/templates/:id
export async function deleteTemplate(req, res, next) {
  try {
    await permitida(req, parseInt(req.params.id));
    await model.deleteTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(siFaltaLaTabla(err)); }
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

// Encender una sala tarda ~20 s y el gestor espera hasta 45 a que conteste,
// asi que la espera de aqui tiene que ser mayor o el CRM se rendiria antes de
// tiempo y diria que fallo algo que en realidad estaba arrancando bien.
// Aqui vivian el gestor de salas y el panel del equipo: pedirSalas, equipo,
// abrirSala, latido, direccionSala y sala.
//
// Eran del metodo viejo —cada gestora trabajando en un navegador remoto—, que
// se retiro: el servicio de salas esta parado y sus contenedores borrados. Las
// rutas /sala y /equipo se quitaron con el, asi que estas funciones llevaban
// dias sin que nadie pudiera llamarlas.
//
// Se borran en vez de dejarlas ahi. Codigo al que no se puede llegar solo sirve
// para que alguien lo lea y crea que hace algo — y una de ellas ademas enseñaba
// un aviso nombrando WHATSAPP_NEKO_BASE, que es justo lo que no tiene que leer
// una gestora.
//
// Lo que vuelva del panel del equipo se rehara sobre el chat nuevo, que ya
// guarda las conversaciones: sera leerlas, no meterse en la sesion de nadie.
