import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as Baja from './baja-alumno.service.js';
import { CLAVES_BAJA, MOTIVOS_BAJA } from './baja-alumno.motivos.js';

/**
 * La baja del alumno en la venta (sobre CRM#1113 / CRM-ISEIE#767).
 *
 * Quién toca qué venta lo decide `ventaPorId` (conversion.acceso.js): su campus
 * y, la gestora, solo las suyas. Verla pide `conversions.view`; darla, cambiarla
 * o deshacerla, `conversions.baja_alumno` (ver conversion.routes.js).
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const fechaValida = (s) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export const bajaSchema = z.object({
  fecha: z.string({ required_error: 'Falta la fecha de baja' }).refine(fechaValida, 'La fecha de baja no es válida (AAAA-MM-DD)'),
  motivo: z.enum(CLAVES_BAJA, { errorMap: () => ({ message: `Motivo no válido: ${CLAVES_BAJA.join(', ')}` }) }),
  nota: z.string().trim().max(1000, 'La nota, como mucho, 1000 caracteres').optional().nullable()
    .transform((v) => (v ? v : null)),
}).superRefine((d, ctx) => {
  if (d.motivo === 'otro' && !d.nota) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['nota'], message: 'Con «Otro», escribe el motivo en la nota' });
});

const deshacerSchema = z.object({
  nota: z.string().trim().max(1000).optional().nullable().transform((v) => (v ? v : null)),
});

const idDe = (req) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
  return id;
};

// GET /api/conversions/:id/baja
export async function get(req, res, next) {
  try {
    const data = await Baja.leerBaja(idDe(req));
    res.json({ success: true, data: { ...data, motivos: MOTIVOS_BAJA } });
  } catch (err) { next(err); }
}

// PUT /api/conversions/:id/baja  { fecha, motivo, nota }
export async function set(req, res, next) {
  try {
    const id = idDe(req);
    const r = bajaSchema.safeParse(req.body || {});
    if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
    const data = await Baja.darDeBaja(id, r.data, { userId: req.user?.userId });
    res.json({ success: true, data: { ...data, motivos: MOTIVOS_BAJA } });
  } catch (err) { next(err); }
}

// DELETE /api/conversions/:id/baja  { nota? }  (deshacer)
export async function remove(req, res, next) {
  try {
    const id = idDe(req);
    const r = deshacerSchema.safeParse(req.body || {});
    if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
    const data = await Baja.deshacerBaja(id, { userId: req.user?.userId, nota: r.data.nota });
    res.json({ success: true, data: { ...data, motivos: MOTIVOS_BAJA } });
  } catch (err) { next(err); }
}
