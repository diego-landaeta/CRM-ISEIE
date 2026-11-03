import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { tieneRol } from '../../shared/utils/roles.js';
import { proyectosDelAmbito, veTodoElCrm, campusDeLaPersona, comoLista } from '../../shared/utils/ambito.js';
import { saveLocal, getLocal } from '../../shared/services/localStorage.service.js';
import { tutoresQueRecibenConsultas, campusDelTutor } from '../tutores/tutor.campus.js';
import * as model from './consultas.model.js';
import * as servicio from './consultas.service.js';
import * as alumnos from './consultas.alumnos.js';
import * as carga from './consultas.carga.js';
import * as metricas from './consultas.metricas.js';
import {
  responderSchema, reasignarSchema, tokenTutorSchema, listarSchema,
  escribirSchema, cargaSchema, metricasSchema,
} from './consultas.validation.js';

/*
  Quién ve qué (#188):
    · el tutor, sus consultas: «un tutor no ve las consultas de otro»;
    · administración (admin de esos campus, superadmin, soporte), el panel:
      todas las de su ámbito, con filtros y reasignación.

  Desde #423, «administración» es quien tiene `consultas.view` (el panel) y el
  tutor, quien tiene `consultas.atender`; cada ruta pide el suyo
  (consultas.routes.js). Aquí queda el ALCANCE: qué consulta es de quién y qué
  campus entran (superadmin y soporte, todos; el resto, los suyos).
*/

function valida(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

/** Que pueda ver esta consulta: su tutor, o administración de ese campus. */
async function exigirVer(req, c) {
  if (!c) throw new AppError('Consulta no encontrada', 404, 'NOT_FOUND');
  if (c.tutor_id === req.user.userId) return 'tutor';
  // alcance #423: administración (`consultas.view`), en sus campus.
  if (await tienePermiso(req, 'consultas.view')) {
    if (veTodoElCrm(req.user)) return 'admin';
    if ((await campusDeLaPersona(req.user.userId)).includes(Number(c.project_id))) return 'admin';
  }
  // Como si no existiera: no se confirma que ese id es una consulta de otro.
  throw new AppError('Consulta no encontrada', 404, 'NOT_FOUND');
}

// GET /api/consultas/mias?estado=  — la bandeja del tutor
export async function mias(req, res, next) {
  try {
    const f = valida(listarSchema, req.query);
    res.json({ success: true, data: {
      consultas: await model.listar({ tutorId: req.user.userId, estado: f.estado, buscar: f.buscar }),
      plazoHoras: model.PLAZO_HORAS,
    } });
  } catch (err) { next(err); }
}

// GET /api/consultas?projectId=&issuerId=&estado=&sinTutor=&buscar=  — el panel
export async function panel(req, res, next) {
  try {
    const f = valida(listarSchema, req.query);
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    res.json({ success: true, data: {
      consultas: await model.listar({
        projectIds: comoLista(projectId, projectIds), estado: f.estado, sinTutor: Boolean(f.sinTutor), buscar: f.buscar,
      }),
      plazoHoras: model.PLAZO_HORAS,
    } });
  } catch (err) { next(err); }
}

// GET /api/consultas/:id
export async function ver(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const quien = await exigirVer(req, await model.cabecera(id));
    // La primera lectura la marca su tutor al abrirla, no administración.
    if (quien === 'tutor') await model.marcarLeida(id, req.user.userId);
    res.json({ success: true, data: { ...(await model.detalle(id)), plazoHoras: model.PLAZO_HORAS, puedes: quien } });
  } catch (err) { next(err); }
}

// POST /api/consultas/:id/responder  (multipart: texto + adjuntos[])
export async function responder(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const c = await model.cabecera(id);
    const quien = await exigirVer(req, c);
    if (quien !== 'tutor') throw new AppError('Responde su tutor. Si tiene que hacerlo otro, reasígnala.', 403, 'FORBIDDEN');
    const { texto } = valida(responderSchema, req.body);
    const r = await servicio.responder(id, req.user.userId, texto, req.files || [], { guardarArchivo: saveLocal });
    res.json({ success: true, data: { ...r, consulta: await model.detalle(id) } });
  } catch (err) { next(err); }
}

// POST /api/consultas/mensajes/:mensajeId/reintentar
export async function reintentar(req, res, next) {
  try {
    const mensajeId = parseInt(req.params.mensajeId);
    const { rows } = await query(
      'SELECT consulta_id FROM consulta_mensajes WHERE id = $1', [mensajeId]);
    if (!rows[0]) throw new AppError('Mensaje no encontrado', 404, 'NOT_FOUND');
    await exigirVer(req, await model.cabecera(rows[0].consulta_id));
    const r = await servicio.reintentar(mensajeId);
    if (!r) throw new AppError('Ese mensaje ya llegó al campus', 409, 'YA_ENVIADO');
    res.json({ success: true, data: { ...r, consulta: await model.detalle(rows[0].consulta_id) } });
  } catch (err) { next(err); }
}

// POST /api/consultas/:id/cerrar
export async function cerrar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    await exigirVer(req, await model.cabecera(id));
    await model.cerrar(id, req.user.userId);
    res.json({ success: true, data: await model.detalle(id) });
  } catch (err) { next(err); }
}

// GET /api/consultas/:id/tutores  — a quién se puede reasignar
export async function tutoresPosibles(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const c = await model.cabecera(id);
    if ((await exigirVer(req, c)) !== 'admin') throw new AppError('Reasigna administración', 403, 'FORBIDDEN');
    res.json({ success: true, data: await tutoresQueRecibenConsultas(c.project_id) });
  } catch (err) { next(err); }
}

// POST /api/consultas/:id/reasignar  { tutorId }
export async function reasignar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const c = await model.cabecera(id);
    if ((await exigirVer(req, c)) !== 'admin') throw new AppError('Reasigna administración', 403, 'FORBIDDEN');
    const { tutorId } = valida(reasignarSchema, req.body);
    const posibles = await tutoresQueRecibenConsultas(c.project_id);
    if (!posibles.some((t) => t.id === tutorId)) {
      throw new AppError('Ese tutor no puede recibir consultas de este campus: no está matriculado en él o está «No disponible».', 400, 'TUTOR_NO_VALE');
    }
    await model.reasignar(id, tutorId, req.user.userId);
    res.json({ success: true, data: await model.detalle(id) });
  } catch (err) { next(err); }
}

// POST /api/consultas/leer-ahora?projectId=  — no esperar a la vuelta de 5 minutos
export async function leerAhora(req, res, next) {
  try {
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    const ids = comoLista(projectId, projectIds);
    const campus = (await servicio.campusConConsultas()).filter((c) => !ids || ids.includes(c.projectId));
    const resultados = [];
    for (const c of campus) resultados.push(await servicio.leerCampus(c.projectId, { desde: c.desde }));
    res.json({ success: true, data: resultados });
  } catch (err) { next(err); }
}

// GET /api/consultas/adjuntos/:id  — el archivo, para el tutor o administración
export async function adjunto(req, res, next) {
  try {
    const a = await model.adjuntoPorId(parseInt(req.params.id));
    await exigirVer(req, a && { id: a.consulta_id, tutor_id: a.tutor_id, project_id: a.project_id });
    // `getLocal` da { buffer, size }: se manda el buffer, no el objeto (si no, sale un JSON).
    const { buffer } = await getLocal(a.storage_key);
    res.setHeader('Content-Type', a.tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.send(buffer);
  } catch (err) { next(err); }
}

// GET /api/adjunto-consulta/:token  — PÚBLICO: el enlace que recibe el alumno
export async function adjuntoPublico(req, res, next) {
  try {
    const token = String(req.params.token || '');
    if (!/^[a-f0-9]{48}$/.test(token)) throw new AppError('Enlace no válido', 404, 'NOT_FOUND');
    const a = await model.adjuntoPorToken(token);
    if (!a) throw new AppError('Este enlace ha caducado o no existe. Pide a tu tutor que te lo vuelva a enviar.', 404, 'NOT_FOUND');
    // `getLocal` da { buffer, size }: se manda el buffer, no el objeto (si no, sale un JSON).
    const { buffer } = await getLocal(a.storage_key);
    res.setHeader('Content-Type', a.tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.nombre)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buffer);
  } catch (err) { next(err); }
}

// ─── El token del tutor en cada campus (para responder en su nombre) ────────

// Quién entra lo pide la ruta (`consultas.gestionar` o `tutores.gestionar`).
async function exigirGestionDelTutor(req, tutorId) {
  const suyos = await campusDelTutor(tutorId);
  if (veTodoElCrm(req.user)) return suyos;
  // Solo los campus que comparten: el admin de una empresa no ve ni toca el
  // token del tutor en los campus de otra.
  const mios = await campusDeLaPersona(req.user.userId);
  const comunes = suyos.filter((c) => mios.includes(c.project_id));
  if (!comunes.length) throw new AppError('Tutor no encontrado', 404, 'NOT_FOUND');
  return comunes;
}

// GET /api/consultas/tutores/:tutorId/tokens
export async function tokensDelTutor(req, res, next) {
  try {
    const tutorId = parseInt(req.params.tutorId);
    const campus = await exigirGestionDelTutor(req, tutorId);
    const { rows } = await query(
      'SELECT project_id, (token_cifrado IS NOT NULL) AS tiene FROM tutor_campus WHERE tutor_id = $1', [tutorId]);
    const tiene = new Map(rows.map((r) => [Number(r.project_id), r.tiene]));
    res.json({ success: true, data: campus.map((c) => ({
      project_id: c.project_id, campus: c.campus, estado: c.estado, tiene_token: Boolean(tiene.get(c.project_id)),
    })) });
  } catch (err) { next(err); }
}

// PUT /api/consultas/tutores/:tutorId/token  { projectId, token }
export async function guardarToken(req, res, next) {
  try {
    const tutorId = parseInt(req.params.tutorId);
    const campus = await exigirGestionDelTutor(req, tutorId);
    const { projectId, token } = valida(tokenTutorSchema, req.body);
    if (!campus.some((c) => c.project_id === projectId)) throw new AppError('Ese campus no es del tutor', 400, 'VALIDATION_ERROR');
    const r = await servicio.guardarTokenDelTutor(tutorId, projectId, token || null);
    if (r === false) {
      throw new AppError('Primero hay que comprobar su matrícula en ese campus («Comprobar en los campus»).', 409, 'SIN_MATRICULA');
    }
    res.json({ success: true, data: { project_id: projectId, tiene_token: Boolean(token) } });
  } catch (err) { next(err); }
}

// ─── Fase 3 (#189): alumnos sin mensajes, carga de trabajo y métricas ───────

/** Lo que pide la petición: lo suyo (tutor) o todo el ámbito (administración, con ?todas=1). */
async function quienYAmbito(req) {
  const todas = ['1', 'true'].includes(String(req.query.todas || ''));
  if (todas) {
    if (!(await tienePermiso(req, 'consultas.view'))) throw new AppError('Solo administración ve las de todos', 403, 'FORBIDDEN');
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    return { todas: true, projectIds: comoLista(projectId, projectIds) };
  }
  // alcance #423: lo suyo solo existe para quien es tutor (el superadmin no tiene «lo suyo»).
  if (!(await tienePermiso(req, 'consultas.atender')) || !tieneRol(req.user, 'tutor')) {
    throw new AppError('Esto es de cada tutor: pide las de todos', 403, 'FORBIDDEN');
  }
  return { todas: false, tutorId: req.user.userId };
}

// GET /api/consultas/alumnos-sin-mensajes[?todas=1]
export async function alumnosSinMensajes(req, res, next) {
  try {
    const q = await quienYAmbito(req);
    res.json({ success: true, data: {
      alumnos: await alumnos.sinMensajes(q.todas ? { projectIds: q.projectIds } : { tutorId: q.tutorId }),
      diasAmbar: alumnos.DIAS_AMBAR, diasRojo: alumnos.DIAS_ROJO,
    } });
  } catch (err) { next(err); }
}

// POST /api/consultas/alumnos/:id/escribir  { texto }
export async function escribirAlAlumno(req, res, next) {
  try {
    const fila = await alumnos.filaDeAlumno(parseInt(req.params.id));
    // Escribe su tutor; a otro se le contesta como si no existiera.
    if (!fila || fila.tutor_id !== req.user.userId) throw new AppError('Alumno no encontrado', 404, 'NOT_FOUND');
    const { texto } = valida(escribirSchema, req.body);
    res.json({ success: true, data: await alumnos.escribirAlAlumno(fila, req.user.userId, texto) });
  } catch (err) { next(err); }
}

// GET /api/consultas/carga  — «Mi carga de trabajo»
// alcance #423: la carga es de un tutor; quien no lo es no tiene «la suya».
const exigirSerTutor = (req) => {
  if (!tieneRol(req.user, 'tutor')) throw new AppError('La carga es de cada tutor', 403, 'FORBIDDEN');
};

export async function miCarga(req, res, next) {
  try {
    exigirSerTutor(req);
    res.json({ success: true, data: await carga.cargaDe(req.user.userId) });
  } catch (err) { next(err); }
}

// POST /api/consultas/carga  { nivel, texto }
export async function guardarMiCarga(req, res, next) {
  try {
    exigirSerTutor(req);
    const d = valida(cargaSchema, req.body);
    res.json({ success: true, data: await carga.guardarCarga(req.user.userId, d, req.user.userId) });
  } catch (err) { next(err); }
}

// GET /api/consultas/tutores-panel  — administración
export async function panelDeTutores(req, res, next) {
  try {
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    const ids = comoLista(projectId, projectIds);
    res.json({ success: true, data: {
      tutores: await carga.panelDeTutores(ids),
      campusSinTutor: await carga.campusSinTutor(ids),
      diasPlazoCarga: carga.DIAS_CARGA,
    } });
  } catch (err) { next(err); }
}

// POST /api/consultas/sincronizar-alumnos  — administración: no esperar a la vuelta diaria
export async function sincronizarAlumnosAhora(req, res, next) {
  try {
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    const ids = comoLista(projectId, projectIds);
    const campus = (await servicio.campusConConsultas()).filter((c) => !ids || ids.includes(c.projectId));
    const r = [];
    for (const c of campus) r.push(await alumnos.sincronizarAlumnos(c.projectId));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// GET /api/consultas/metricas?desde=&hasta=[&todas=1&tutorId=]
export async function verMetricas(req, res, next) {
  try {
    const q = await quienYAmbito(req);
    const f = valida(metricasSchema, req.query);
    res.json({ success: true, data: await metricas.metricas(q.todas
      ? { projectIds: q.projectIds, tutorId: f.tutorId || null, desde: f.desde, hasta: f.hasta, ranking: true }
      : { tutorId: q.tutorId, desde: f.desde, hasta: f.hasta }) });
  } catch (err) { next(err); }
}

// GET /api/consultas/campus-sin-tutor  — el aviso de administración
export async function campusSinTutor(req, res, next) {
  try {
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    res.json({ success: true, data: await carga.campusSinTutor(comoLista(projectId, projectIds)) });
  } catch (err) { next(err); }
}
