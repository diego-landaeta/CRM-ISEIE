import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { alcanceComercial } from '../../shared/utils/roles.js';
import { nombreCortoDeEmpresa } from '../../shared/services/marca.service.js';
import * as service from './informe-mensual.service.js';
import * as model from './informe-mensual.model.js';
import { leerConfig } from './informe-mensual.config.js';
import { firmaValida } from './informe-mensual.enlace.js';
import { informeSchema, zipSchema, descargaSchema } from './informe-mensual.validation.js';

function validar(schema, datos) {
  const r = schema.safeParse(datos ?? {});
  if (!r.success) throw new AppError(r.error.errors[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

function fallo(err, res, next) {
  if (res.headersSent) { res.destroy(err); return; }
  next(err);
}

/**
 * Los campus que entran, SIEMPRE dentro de los de quien pide (#245):
 *   · sin empresa: los suyos (super admin y soporte, todos: null);
 *   · con empresa: los de esa empresa que sean suyos; ninguno es un 403.
 * Nunca una lista vacía: [-1] no casa con nada (vacía sería «todos»).
 */
export async function campusQueEntran(req, issuerId) {
  const mios = veTodoElCrm(req.user) ? null : await campusDeLaPersona(req.user?.userId);
  if (!issuerId) return mios ? (mios.length ? mios : [-1]) : null;
  const deLaEmpresa = await model.campusDeLaEmpresa(issuerId);
  if (!mios) return deLaEmpresa.length ? deLaEmpresa : [-1];
  const quedan = deLaEmpresa.filter((id) => mios.includes(id));
  if (!quedan.length) throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  return quedan;
}

/** Lo que el CRM dice del envío automático: si sale y cuándo. Sin direcciones. */
function envio() {
  const cfg = leerConfig();
  const h = String(Math.floor(cfg.minuto / 60)).padStart(2, '0');
  const m = String(cfg.minuto % 60).padStart(2, '0');
  return {
    activo: cfg.activo,
    dia: cfg.dia,
    hora: `${h}:${m}`,
    con_destinatarios: cfg.para.length > 0 || cfg.administracion.length > 0,
  };
}

function descarga(res, tipo, nombre, buffer) {
  const limpio = nombre.replace(/["\\\r\n]/g, '');
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition',
    `attachment; filename="${limpio.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(limpio)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
}

/** Quien lleva un equipo ve el informe de su equipo (alcance, no puerta). */
async function informeDe(req, { periodo, issuerId }) {
  const projectIds = await campusQueEntran(req, issuerId);
  const alcance = await alcanceComercial(req.user);
  return service.informeDelMes({ periodo, projectIds, asesoraIds: alcance });
}

// GET /api/informe-mensual?periodo=2026-10&issuerId=1
export async function informe(req, res, next) {
  try {
    const q = validar(informeSchema, req.query);
    const data = await informeDe(req, q);
    res.json({ success: true, data: { ...data, envio: envio() } });
  } catch (err) {
    fallo(err, res, next);
  }
}

// GET /api/informe-mensual/excel?periodo=2026-10&issuerId=1
export async function excel(req, res, next) {
  try {
    const q = validar(informeSchema, req.query);
    const empresa = q.issuerId ? nombreCortoDeEmpresa(await service.empresaOError(q.issuerId)) : null;
    const buffer = await service.excelDelInforme(await informeDe(req, q), { empresa });
    descarga(res, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      `informe-ventas_${q.periodo}${empresa ? `_${empresa}` : ''}.xlsx`, buffer);
  } catch (err) {
    fallo(err, res, next);
  }
}

// GET /api/informe-mensual/zip?periodo=2026-10&issuerId=1
// Las facturas de la empresa: quien lleva un equipo no lo baja, igual que no
// corrige ni abona facturas (Diego, 09/11).
export async function zip(req, res, next) {
  try {
    const q = validar(zipSchema, req.query);
    const alcance = await alcanceComercial(req.user);
    if (alcance && alcance.length > 1) {
      throw new AppError('El ZIP de facturas de la empresa es de administración; tú tienes el informe de tu equipo.', 403, 'FORBIDDEN');
    }
    const empresa = await service.empresaOError(q.issuerId);
    const campus = await campusQueEntran(req, q.issuerId);
    const z = await service.zipDelMes({ periodo: q.periodo, empresa, projectIds: veTodoElCrm(req.user) ? null : campus });
    descarga(res, 'application/zip', z.nombre, z.buffer);
  } catch (err) {
    fallo(err, res, next);
  }
}

// GET /api/informe-mensual/descarga/:issuerId/:periodo?exp=&sig= — el enlace
// del correo, sin sesión: la firma es la llave. Con el envío apagado, 404.
export async function descargarConEnlace(req, res, next) {
  try {
    if (!leerConfig().activo) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    const p = descargaSchema.safeParse({ ...req.query, ...req.params });
    if (!p.success || !firmaValida(p.data.issuerId, p.data.periodo, p.data.exp, p.data.sig)) {
      throw new AppError('El enlace no vale o ha caducado', 403, 'FORBIDDEN');
    }
    const empresa = await service.empresaOError(p.data.issuerId);
    const z = await service.zipDelMes({ periodo: p.data.periodo, empresa });
    logger.info({ issuerId: empresa.id, periodo: p.data.periodo, ip: req.ip }, 'Informe mensual: descarga con enlace');
    descarga(res, 'application/zip', z.nombre, z.buffer);
  } catch (err) {
    fallo(err, res, next);
  }
}
