import * as model from './asignacion.model.js';
import * as service from './asignacion.service.js';
import {
  crearConfigSchema, cambiarConfigSchema, pruebaSchema, listarDecisionesSchema, entradaSchema, motivoDelFallo, prepararEntrada,
} from './asignacion.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { tieneRol } from '../../shared/utils/roles.js';
import { campusDeLaPersona } from '../../shared/utils/ambito.js';

/*
  QUIÉN PUEDE. La configuración, la misma gente que el webhook de transferencias
  (permisos `webhooks_salientes.*`: admin y super admin). Un admin, la de sus
  campus o la de una empresa en la que está entera; la de todas, solo el super
  admin. La ENTRADA no lleva sesión: entra con la clave de su configuración.
*/

const esSuperadmin = (req) => tieneRol(req.user, 'superadmin');
const misCampus = async (req) => (esSuperadmin(req) ? null : campusDeLaPersona(req.user?.userId));
const prohibido = (msg) => new AppError(msg, 403, 'FORBIDDEN');

function idDe(valor, que = 'id') {
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(`${que} inválido`, 400, 'INVALID_ID');
  return id;
}

function validar(schema, datos) {
  const r = schema.safeParse(datos ?? {});
  if (!r.success) throw new AppError(motivoDelFallo(r.error.errors[0]), 400, 'VALIDATION_ERROR');
  return r.data;
}

async function comprobarAmbito(req, { ambito, issuer_id, project_id }) {
  if (ambito === 'todas' && !esSuperadmin(req)) throw prohibido('Una configuración de todas las empresas solo la puede tocar un super admin.');
  if (ambito === 'empresa' && !(await model.existeEmpresa(issuer_id))) throw new AppError('Esa empresa no existe', 400, 'VALIDATION_ERROR');
  if (ambito === 'campus' && !(await model.campus(project_id))) throw new AppError('Ese campus no existe', 400, 'VALIDATION_ERROR');
  const mios = await misCampus(req);
  if (!mios) return;
  if (ambito === 'campus' && !mios.includes(Number(project_id))) throw prohibido('Ese campus no es tuyo: solo puedes usar los campus en los que estás.');
  if (ambito === 'empresa') {
    const suyos = await model.campusDeLaEmpresa(issuer_id);
    if (!suyos.length || !suyos.every((id) => mios.includes(id))) throw prohibido('Para la de toda la empresa tienes que estar en todos sus campus.');
  }
}

async function laConfig(req, id) {
  const c = await model.porId(id);
  if (!c) throw new AppError('Esa configuración no existe', 404, 'NOT_FOUND');
  await comprobarAmbito(req, c);
  return c;
}

/** Lo que ve la pantalla: los destinos y la clave, solo su cola. */
function publico(c) {
  if (!c) return c;
  return {
    id: c.id, nombre: c.nombre, activo: c.activo, ambito: c.ambito,
    issuer_id: c.issuer_id, empresa: c.empresa || null, project_id: c.project_id, proyecto: c.proyecto || null,
    ventana_min: c.ventana_min,
    escenario1: { tipo: c.destino1_tipo, cola: c.destino1_cola },
    escenario2: { tipo: c.destino2_tipo, cola: c.destino2_cola },
    clave_cola: c.clave_cola,
    created_at: c.created_at, updated_at: c.updated_at,
    ultima_decision_at: c.ultima_decision_at || null,
    fallidos_30_dias: Number(c.fallidos_30_dias || 0),
  };
}

/** GET /api/asignacion */
export async function listar(req, res, next) {
  try {
    const mios = await misCampus(req);
    if (mios && !mios.length) return res.json({ success: true, data: [] });
    res.json({ success: true, data: (await model.listar({ misCampus: mios })).map(publico) });
  } catch (err) { next(err); }
}

/** POST /api/asignacion: crea la configuración y enseña UNA vez la clave de la entrada. */
export async function crear(req, res, next) {
  try {
    const d = validar(crearConfigSchema, req.body);
    const ambito = d.ambito === 'todas' ? { ambito: 'todas', issuer_id: null, project_id: null }
      : d.ambito === 'empresa' ? { ambito: 'empresa', issuer_id: d.issuer_id || null, project_id: null }
        : { ambito: 'campus', issuer_id: null, project_id: d.project_id || null };
    if (ambito.ambito === 'empresa' && !ambito.issuer_id) throw new AppError('Elige la empresa', 400, 'VALIDATION_ERROR');
    if (ambito.ambito === 'campus' && !ambito.project_id) throw new AppError('Elige el campus', 400, 'VALIDATION_ERROR');
    await comprobarAmbito(req, ambito);
    const clave = service.generarClave();
    let id;
    try {
      id = await model.crear({
        nombre: d.nombre, activo: d.activo, ventana_min: d.ventana_min, ...ambito,
        ...service.cifrarDestino(1, d.escenario1), ...service.cifrarDestino(2, d.escenario2),
        clave_hash: service.huella(clave), clave_cola: clave.slice(-6),
        creado_por: req.user.userId, actualizado_por: req.user.userId,
      });
    } catch (err) {
      if (err.code === '23505') throw new AppError('Ese campus, empresa o «todas» ya tiene su configuración: edítala', 409, 'YA_EXISTE');
      throw err;
    }
    res.status(201).json({ success: true, data: { ...publico(await model.porId(id)), clave } });
  } catch (err) { next(err); }
}

/** PATCH /api/asignacion/:id */
export async function cambiar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await laConfig(req, id);
    const d = validar(cambiarConfigSchema, req.body);
    const c = await model.cambiar(id, {
      nombre: d.nombre, activo: d.activo, ventana_min: d.ventana_min,
      ...(d.escenario1 ? service.cifrarDestino(1, d.escenario1) : {}),
      ...(d.escenario2 ? service.cifrarDestino(2, d.escenario2) : {}),
      actualizado_por: req.user.userId,
    });
    res.json({ success: true, data: publico(c) });
  } catch (err) { next(err); }
}

/** POST /api/asignacion/:id/clave: una clave nueva (la vieja deja de valer). */
export async function nuevaClave(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await laConfig(req, id);
    const clave = service.generarClave();
    const c = await model.cambiar(id, { clave_hash: service.huella(clave), clave_cola: clave.slice(-6), actualizado_por: req.user.userId });
    res.json({ success: true, data: { ...publico(c), clave } });
  } catch (err) { next(err); }
}

/** DELETE /api/asignacion/:id */
export async function borrar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await laConfig(req, id);
    await model.borrar(id);
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
}

/** POST /api/asignacion/:id/prueba { escenario } */
export async function prueba(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await laConfig(req, id);
    const { escenario } = validar(pruebaSchema, req.body);
    const config = await model.conDestinos(id);
    const r = await service.enviarPrueba(config, escenario);
    res.json({ success: true, data: { estado: r?.estado, error: r?.error || null, http_status: r?.http_status || null, respuesta: r?.respuesta || null } });
  } catch (err) { next(err); }
}

/** GET /api/asignacion/decisiones */
export async function decisiones(req, res, next) {
  try {
    const q = validar(listarDecisionesSchema, req.query);
    const mios = await misCampus(req);
    if (mios && !mios.length) return res.json({ success: true, data: [] });
    const filas = await model.listarDecisiones({
      misCampus: mios, destinoId: q.destino_id, projectId: q.project_id, escenario: q.escenario, estado: q.estado, limit: q.limit,
    });
    res.json({ success: true, data: filas });
  } catch (err) { next(err); }
}

/** POST /api/asignacion/decisiones/:id/reenviar */
export async function reenviar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const dec = await model.decisionPorId(id);
    if (!dec) throw new AppError('Esa decisión no existe', 404, 'NOT_FOUND');
    const mios = await misCampus(req);
    if (mios && !mios.includes(Number(dec.project_id))) throw prohibido('Esa decisión es de un campus que no es tuyo');
    const r = await service.reenviar(id);
    res.json({ success: true, data: { estado: r?.estado, error: r?.error || null } });
  } catch (err) { next(err); }
}

/**
 * POST /api/asignacion/entrada — la llama la entrada de Make, con la clave de su
 * configuración (Authorization: Bearer … o X-API-Key). Contesta enseguida a qué
 * escenario va y con qué gestora; el envío va por detrás.
 */
export async function entrada(req, res, next) {
  try {
    let clave = req.headers['x-api-key'];
    if (!clave && req.headers.authorization?.startsWith('Bearer ')) clave = req.headers.authorization.slice(7).trim();
    if (!clave) throw new AppError('Falta la clave de la entrada (Authorization: Bearer … o X-API-Key)', 401, 'API_KEY_REQUIRED');
    const config = await model.porClave(service.huella(clave));
    if (!config) throw new AppError('Clave de la entrada no válida', 401, 'API_KEY_INVALID');
    // Acepta también el JSON tal cual lo saca Make (`full_name`, `phone_complete`…), con o sin uid.
    const datos = validar(entradaSchema, prepararEntrada(req.body));
    const r = await service.decidir(config, datos);
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
