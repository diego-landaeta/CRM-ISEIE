import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito, campusDeTodos, campusParaRecortar, comoLista } from '../../shared/utils/ambito.js';
import { alcanceComercial } from '../../shared/utils/roles.js';
import * as service from './conciliacion.service.js';
import { listarSchema, enlazarSchema, segurasSchema } from './conciliacion.validation.js';

/*
  Finanzas › Conciliación › Facturas y cobros (CRM#905).

  Quién: `facturas.gestionar` («Anular y abonar… asociar a una venta»; admin y
  super admin de serie). Es trabajo de administración: quien trabaja con un
  alcance comercial (una gestora, las suyas; una líder, las de su equipo) no
  concilia, aunque tenga el permiso por excepción. Dónde: sus campus, como en
  Pagos Stripe y Disputas: `?projectId=` (un campus), `?issuerId=` (una
  empresa) o nada (todos los suyos). Un admin no ve ni enlaza lo de otra
  empresa cambiando la URL.
*/

function datos(schema, valor) {
  const r = schema.safeParse(valor || {});
  if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos no válidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

async function soloAdministracion(req) {
  if (await alcanceComercial(req.user)) {
    throw new AppError('La conciliación de facturas y cobros es de administración.', 403, 'FORBIDDEN');
  }
}

/** Los campus de la pantalla: los pedidos, dentro de los suyos. */
async function campusPedidos(req) {
  const a = await proyectosDelAmbito(req);
  return comoLista(a.projectId, a.projectIds) || await campusDeTodos(req);
}

export async function listar(req, res, next) {
  try {
    await soloAdministracion(req);
    const f = datos(listarSchema, req.query);
    const data = await service.listar({ campus: await campusPedidos(req), mes: f.mes, dias: f.dias });
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

export async function enlazar(req, res, next) {
  try {
    await soloAdministracion(req);
    const b = datos(enlazarSchema, req.body);
    const hecha = await service.enlazar({
      ...b, campus: await campusParaRecortar(req), userId: req.user?.userId, ip: req.ip,
    });
    res.json({ success: true, data: hecha });
  } catch (e) { next(e); }
}

export async function enlazarSeguras(req, res, next) {
  try {
    await soloAdministracion(req);
    const b = datos(segurasSchema, req.body);
    const data = await service.enlazarSeguras({
      ...b, campus: await campusPedidos(req), userId: req.user?.userId, ip: req.ip,
    });
    res.json({ success: true, data });
  } catch (e) { next(e); }
}
