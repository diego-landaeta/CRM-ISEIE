import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { ambitoDe } from '../facturas-colaborador/facturas-colaborador.service.js';
import { monitaskActivo } from './interruptor.js';
import * as servicio from './monitask.service.js';
import {
  guardarAppSchema, desconectarSchema, sincronizarSchema, actividadSchema, diasSchema,
  cotejoSchema, idSchema, emparejarSchema, callbackSchema,
} from './monitask.validation.js';

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

// GET /api/monitask/estado — la tarjeta de Integraciones y la cabecera de Actividad.
export async function estado(_req, res, next) {
  try {
    res.json({ success: true, data: await servicio.estado() });
  } catch (err) { next(err); }
}

// PUT /api/monitask/conexion — el Client ID, el secreto (cifrado) y el margen.
export async function guardarApp(req, res, next) {
  try {
    const b = validar(guardarAppSchema, req.body || {});
    const data = await servicio.guardarApp(
      { clientId: b.client_id, clientSecret: b.client_secret || null, margenPct: b.margen_pct ?? null },
      req.user.userId,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// DELETE /api/monitask/conexion?todo=1 — sin `todo`, solo los tokens (desconectar).
export async function desconectar(req, res, next) {
  try {
    const q = validar(desconectarSchema, req.query || {});
    const data = await servicio.desconectar({ todo: q.todo === '1' || q.todo === 'true' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /api/monitask/conexion/autorizar — la dirección de Monitask a la que ir.
export async function autorizar(req, res, next) {
  try {
    res.json({ success: true, data: await servicio.iniciarConexion(req.user.userId) });
  } catch (err) { next(err); }
}

// POST /api/monitask/sincronizar — en segundo plano; la tarjeta pregunta por /estado.
export async function sincronizar(req, res, next) {
  try {
    const b = validar(sincronizarSchema, req.body || {});
    const rango = b.desde && b.hasta ? { desde: b.desde, hasta: b.hasta } : servicio.ultimosDias(servicio.diasNocturnos());
    // Que esté conectado se comprueba antes de responder: si no, el botón diría «en marcha» y nada.
    await servicio.tokenVigente();
    servicio.sincronizarEnSegundoPlano(rango);
    res.status(202).json({ success: true, data: { en_marcha: true, ...rango } });
  } catch (err) { next(err); }
}

// GET /api/monitask/personas — para emparejar a mano.
export async function personas(_req, res, next) {
  try {
    res.json({ success: true, data: await servicio.personas() });
  } catch (err) { next(err); }
}

// PATCH /api/monitask/personas/:id
export async function emparejar(req, res, next) {
  try {
    const { id } = validar(idSchema, req.params);
    const b = validar(emparejarSchema, req.body || {});
    await servicio.emparejar(id, { colaboradorId: b.colaborador_id || null, userId: b.user_id || null, ninguno: !!b.ninguno }, req.user.userId);
    res.json({ success: true, data: await servicio.personas() });
  } catch (err) { next(err); }
}

// GET /api/monitask/actividad?desde&hasta&persona&proyecto
export async function actividad(req, res, next) {
  try {
    const q = validar(actividadSchema, req.query || {});
    const data = await servicio.actividad({
      desde: q.desde, hasta: q.hasta, ambito: await ambitoDe(req.user),
      monitaskId: q.persona || null, proyecto: q.proyecto || null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/monitask/actividad/:id/dias?desde&hasta
export async function dias(req, res, next) {
  try {
    const { id } = validar(idSchema, req.params);
    const q = validar(diasSchema, req.query || {});
    const data = await servicio.diasDePersona({ monitaskId: id, desde: q.desde, hasta: q.hasta, ambito: await ambitoDe(req.user) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/monitask/cotejo?mes=2026-10
export async function cotejo(req, res, next) {
  try {
    const { mes } = validar(cotejoSchema, req.query || {});
    const data = await servicio.cotejo({ periodo: `${mes}-01`, ambito: await ambitoDe(req.user) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * GET /api/monitask/oauth/callback — la vuelta de Monitask. Sin sesión del CRM (es
 * el navegador volviendo de Monitask): la llave es el `state` de un solo uso que
 * se dio al pulsar «Conectar». Siempre termina en Integraciones con el resultado.
 */
export async function vueltaOAuth(req, res) {
  if (!monitaskActivo()) return res.status(404).json({ success: false, error: 'No encontrado', code: 'NOT_FOUND' });
  let r;
  try {
    const q = callbackSchema.safeParse(req.query || {});
    r = q.success ? await servicio.completarConexion(q.data) : { ok: false, motivo: 'estado_no_valido' };
  } catch (err) {
    logger.warn({ err: err.message }, 'Monitask: la vuelta del OAuth falló');
    r = { ok: false, motivo: 'error' };
  }
  if (r.ok) {
    // La primera carga: el último mes, que es lo que Monitask suele guardar.
    try {
      servicio.sincronizarEnSegundoPlano(servicio.ultimosDias(31));
    } catch { /* ya había una en marcha */ }
  }
  res.redirect(302, servicio.urlDeVuelta(r.ok ? 'conectado' : 'error', r.ok ? null : r.motivo));
}
