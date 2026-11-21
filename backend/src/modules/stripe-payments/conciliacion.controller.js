import { z } from 'zod';
import { proyectosDelAmbito, campusDeTodos, comoLista } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as model from './conciliacion.model.js';
import * as service from './conciliacion.service.js';
import { cargoSuyo } from './stripe-payments.controller.js';

/*
  Finanzas › Conciliación › Cargos de Stripe (CRM#906).

  Quién: `stripe.edit`, la misma clave que «Asociar» en Pagos Stripe (admin,
  super admin y soporte de serie), cada uno en sus campus (#717/#721). Crear la
  venta va con la misma clave: «Asociar» ya apunta cobros en ventas, y esto es
  ese mismo paso con una venta nueva. Sin clave nueva en el catálogo.
*/

const MES = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mes con formato AAAA-MM');
const filtros = z.object({ mes: MES.optional().or(z.literal('')) });

/** El mismo ámbito que Pagos Stripe y Disputas: sin pedir nada, todos los campus de quien mira. */
async function campusDelAmbito(req) {
  const a = await proyectosDelAmbito(req);
  return comoLista(a.projectId, a.projectIds) || await campusDeTodos(req);
}

const suma = (filas) => Math.round(filas.reduce((s, f) => s + Number(f.importe || 0), 0) * 100) / 100;

export async function listar(req, res, next) {
  try {
    const f = filtros.safeParse(req.query);
    if (!f.success) throw new AppError(f.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const mes = f.data.mes || null;
    const ids = await campusDelAmbito(req);
    const [cargos, meses] = await Promise.all([model.conciliar(ids, mes), model.porMes(ids)]);
    const de = (s) => cargos.filter((c) => c.sugerencia === s);
    const seguros = cargos.filter((c) => c.seguro);
    res.json({
      success: true,
      data: {
        cargos,
        meses,
        resumen: {
          cargos: cargos.length, importe: suma(cargos),
          seguros: seguros.length, importeSeguros: suma(seguros),
          conCobro: de('enlazar').length, conVenta: de('apuntar').length, sinVenta: de('crear').length,
        },
      },
    });
  } catch (e) { next(e); }
}

/** Productos y vendedoras de UN campus, para «Crear la venta» (con `projectAccess`). */
export async function opciones(req, res, next) {
  try {
    res.json({ success: true, data: await model.opcionesDeVenta(req.projectId) });
  } catch (e) { next(e); }
}

const seguros = z.object({ projectId: z.coerce.number().int().positive(), mes: MES.optional().nullable() });

/** «Enlazar todos los seguros», de UN campus (con `projectAccess`) y un mes. */
export async function enlazarSeguros(req, res, next) {
  try {
    const p = seguros.safeParse(req.body || {});
    if (!p.success) throw new AppError(p.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const r = await service.enlazarSeguros(req.projectId, p.data.mes || null, req.user?.userId ?? null);
    res.json({ success: true, data: r });
  } catch (e) { next(e); }
}

const nuevaVenta = z.object({
  productoId: z.coerce.number().int().positive('Elige el programa'),
  vendedoraId: z.coerce.number().int().positive('Elige la vendedora'),
  importeTotal: z.coerce.number().positive().optional(),
  leadId: z.coerce.number().int().positive().optional().nullable(),
  nombre: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().max(200).optional().nullable(),
  forzar: z.boolean().optional(),
});

/** «Crear la venta» con el alumno y el importe del cargo. */
export async function crearVenta(req, res, next) {
  try {
    const p = nuevaVenta.safeParse(req.body || {});
    if (!p.success) throw new AppError(p.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const cargo = await cargoSuyo(req);
    const r = await service.crearVentaDelCargo(cargo, p.data, req.user);
    res.status(201).json({ success: true, data: r });
  } catch (e) { next(e); }
}
