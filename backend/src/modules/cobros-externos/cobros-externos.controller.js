import { AppError } from '../../shared/utils/AppError.js';
import { listaDelAmbito, campusDeTodos, exigirCampusSuyo } from '../../shared/utils/ambito.js';
import { paypalActivo, santanderActivo } from './interruptores.js';
import * as paypal from './paypal.service.js';
import * as paypalModel from './paypal.model.js';
import * as extractos from './extracto.service.js';
import * as extractoModel from './extracto.model.js';
import {
  sincronizarSchema, enlazarSchema, listarPaypalSchema, listarMovimientosSchema, idSchema,
  EXTENSIONES_EXTRACTO,
} from './cobros-externos.validation.js';

const ERRORES = {
  NOT_FOUND: [404, 'No encontrado'],
  YA_ENLAZADO: [409, 'Ese cobro ya está registrado en una venta'],
  NO_COBRADO: [400, 'Ese cobro no está completado en PayPal: no se registra'],
  OTRA_MONEDA: [400, 'Ese cobro no es en euros: hay que apuntarlo a mano con su conversión'],
  VENTA_DE_OTRO_CAMPUS: [400, 'La venta no es del mismo campus que el cobro'],
  OCUPADO: [409, 'Lo está registrando otra persona o el sondeo ahora mismo; vuelve a probar en un momento'],
};

function lanzar(error) {
  const [status, msg] = ERRORES[error] || [400, error];
  throw new AppError(msg, status, error);
}

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

async function campusPedidos(req) {
  return (await listaDelAmbito(req)) || await campusDeTodos(req);
}

// GET /api/cobros-externos/estado — qué está encendido. Sin datos de nadie.
export async function estado(_req, res) {
  res.json({ success: true, data: { paypal: paypalActivo(), santander: santanderActivo() } });
}

// ─── PayPal ─────────────────────────────────────────────────────────────────

export async function listarPaypal(req, res, next) {
  try {
    const f = validar(listarPaypalSchema, req.query);
    const r = await paypalModel.listar({ projectIds: await campusPedidos(req), ...f });
    res.json({
      success: true, data: r.rows,
      pagination: { total: r.total, page: r.page, limit: r.limit, totalPages: Math.ceil(r.total / r.limit) },
    });
  } catch (err) { next(err); }
}

export async function sincronizarPaypal(req, res, next) {
  try {
    validar(sincronizarSchema, req.body);
    const r = await paypal.sincronizar(req.projectId, { reintentar: true });
    if (r.sinCredenciales) throw new AppError('Este campus no tiene PayPal conectado (Integraciones).', 400, 'PAYPAL_SIN_CREDENCIALES');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function enlazarPaypal(req, res, next) {
  try {
    const id = validar(idSchema, req.params.id);
    const { conversionId } = validar(enlazarSchema, req.body);
    const fila = await paypalModel.getById(id);
    if (!fila) lanzar('NOT_FOUND');
    await exigirCampusSuyo(req, fila.project_id);
    const r = await paypal.enlazarAMano(id, conversionId, req.user.userId);
    if (r.error) lanzar(r.error);
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// ─── Banco ──────────────────────────────────────────────────────────────────

export async function listarMovimientos(req, res, next) {
  try {
    const f = validar(listarMovimientosSchema, req.query);
    const r = await extractoModel.listarMovimientos({ projectIds: await campusPedidos(req), ...f });
    res.json({
      success: true, data: r.rows, porEstado: r.porEstado,
      pagination: { total: r.total, page: r.page, limit: r.limit, totalPages: Math.ceil(r.total / r.limit) },
    });
  } catch (err) { next(err); }
}

export async function listarExtractos(req, res, next) {
  try {
    res.json({ success: true, data: await extractoModel.listarExtractos(await campusPedidos(req)) });
  } catch (err) { next(err); }
}

export async function subirExtracto(req, res, next) {
  try {
    if (!req.file?.buffer?.length) throw new AppError('Falta el fichero del extracto', 400, 'FALTA_FICHERO');
    if (!EXTENSIONES_EXTRACTO.test(req.file.originalname || '')) {
      throw new AppError('Sube el extracto en Norma 43 (.n43, .txt, .aeb) o en CSV.', 400, 'FORMATO_NO_VALIDO');
    }
    let r;
    try {
      r = await extractos.importarExtracto({
        projectId: req.projectId, buffer: req.file.buffer, nombre: req.file.originalname, userId: req.user.userId,
      });
    } catch (e) {
      if (e.code === 'YA_SUBIDO') throw new AppError(e.message, 409, 'EXTRACTO_YA_SUBIDO');
      if (!e.statusCode && !e.code) throw new AppError(`No se ha podido leer el extracto: ${e.message}`, 400, 'EXTRACTO_ILEGIBLE');
      throw e;
    }
    res.status(201).json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function confirmarMovimiento(req, res, next) {
  try {
    const id = validar(idSchema, req.params.id);
    const { conversionId } = validar(enlazarSchema, req.body);
    const mov = await extractoModel.getMovimiento(id);
    if (!mov) lanzar('NOT_FOUND');
    await exigirCampusSuyo(req, mov.project_id);
    const r = await extractos.confirmar(id, conversionId, req.user.userId);
    if (r.error) lanzar(r.error);
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function descartarMovimiento(req, res, next) {
  try {
    const id = validar(idSchema, req.params.id);
    const mov = await extractoModel.getMovimiento(id);
    if (!mov) lanzar('NOT_FOUND');
    await exigirCampusSuyo(req, mov.project_id);
    if (!(await extractoModel.descartar(id, req.user.userId))) lanzar('YA_ENLAZADO');
    res.json({ success: true, data: { descartado: true } });
  } catch (err) { next(err); }
}

// ─── Webhook de PayPal (público, firmado) ──────────────────────────────────

export async function webhookPaypal(req, res, next) {
  try {
    const r = await paypal.procesarWebhook(Number(req.params.projectId), { cabeceras: req.headers, cuerpo: req.rawBody });
    res.status(r.status).json(r.body);
  } catch (err) { next(err); }
}
