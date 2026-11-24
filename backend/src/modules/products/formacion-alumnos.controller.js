import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { alcanceComercial } from '../../shared/utils/roles.js';
import * as Alumnos from './formacion-alumnos.service.js';

/**
 * Formaciones · alumnos activos (CRM-ISEIE#767, gemela de CRM#1113).
 *
 * El campus lo fija `projectAccess` (solo los de quien pide). Dentro, el alcance
 * por persona es el de Ventas: la gestora ve solo sus ventas, la líder de
 * equipo las de su equipo, admin y soporte todas (`alcanceComercial`).
 */

// GET /api/products/:id/formacion/alumnos?projectId=
export async function alumnosDeFormacion(req, res, next) {
  try {
    const alcance = await alcanceComercial(req.user);
    res.json({ success: true, data: await Alumnos.alumnosDeFormacion(Number(req.params.id), req.projectId, { alcance }) });
  } catch (err) { next(err); }
}

// GET /api/products/formaciones/alumnos?projectId=  (las cifras de cada formación del campus)
export async function resumenDelCampus(req, res, next) {
  try {
    const alcance = await alcanceComercial(req.user);
    res.json({ success: true, data: await Alumnos.resumenDelCampus(req.projectId, { alcance }) });
  } catch (err) { next(err); }
}

const meses = z.union([z.coerce.number().int().min(1, 'Como mínimo, 1 mes').max(120, 'Como mucho, 120 meses'), z.null()]).optional();
const reglaSchema = z.object({ curso: meses, diplomado: meses, master: meses });

// PUT /api/products/formaciones/acceso  { projectId, curso, diplomado, master }  (meses; null = la de serie)
export async function guardarReglaDeAcceso(req, res, next) {
  try {
    const r = reglaSchema.safeParse({ curso: req.body?.curso, diplomado: req.body?.diplomado, master: req.body?.master });
    if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
    const regla = await Alumnos.guardarReglaDeAcceso(req.projectId, r.data, { userId: req.user?.userId, ip: req.ip });
    res.json({ success: true, data: regla });
  } catch (err) { next(err); }
}
