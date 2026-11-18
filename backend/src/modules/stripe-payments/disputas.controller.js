import { z } from 'zod';
import { proyectosDelAmbito, campusDeTodos } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as model from './disputas.model.js';
import * as service from './disputas.service.js';

/*
  Disputas de Stripe (#396). Solo lectura: la respuesta se da en Stripe.

  Quien: `stripe.edit` (admin, super admin y soporte de serie: «llevar las
  disputas» ya era suyo). Que: lo de sus campus. El ambito sale de
  `proyectosDelAmbito`, el mismo de Pagos Stripe: `?issuerId=` (una empresa),
  `?projectId=` (un campus) o nada (todos los suyos). Un admin de CEDIA no ve
  las de ICTESS ni cambiando la URL; super admin y soporte, todas.
*/

const filtros = z.object({
  estado: z.enum(['abiertas', 'cerradas', 'todas']).default('abiertas'),
  dias: z.coerce.number().int().min(1).max(60).default(7),
});

/** El mismo ambito que la lista de Pagos Stripe: sin pedir nada, todos los campus de quien mira. */
async function ambito(req) {
  const a = await proyectosDelAmbito(req);
  if (!a.projectId && !a.projectIds) return { projectId: null, projectIds: await campusDeTodos(req) };
  return a;
}

export async function listar(req, res, next) {
  try {
    const f = filtros.safeParse(req.query);
    if (!f.success) throw new AppError('Filtro no valido', 400, 'VALIDATION_ERROR');
    const { estado, dias } = f.data;
    const a = await ambito(req);
    const abiertas = await model.listar({ ...a, estado: 'abiertas' });
    const filas = estado === 'abiertas' ? abiertas : await model.listar({ ...a, estado });
    const conEnlace = (d) => ({ ...d, stripe_url: service.enlaceEnStripe(d.dispute_id, d.livemode) });
    const sondeo = await model.estadoDelSondeo(a.projectId ? [a.projectId] : a.projectIds);
    res.json({
      success: true,
      data: {
        disputas: filas.map(conEnlace),
        resumen: service.resumir(abiertas, { dias }),
        sondeo,
      },
    });
  } catch (e) { next(e); }
}

/** Traerlas ahora de UNA cuenta (la del campus), sin esperar a la vuelta del sondeo. */
export async function sincronizar(req, res, next) {
  try {
    const pid = Number(req.body?.projectId || req.query?.projectId);
    if (!pid) throw new AppError('projectId requerido', 400, 'BAD_REQUEST');
    const r = await service.sincronizar(pid);
    res.json({ success: true, data: r });
  } catch (e) { next(e); }
}
