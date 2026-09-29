import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as service from './novedades.service.js';

// GET /api/novedades — todas las versiones, la actual primero. Cualquiera con sesión.
export async function listar(_req, res, next) {
  try { res.json({ success: true, data: service.listar() }); } catch (e) { next(e); }
}

// GET /api/novedades/:version/pdf
export async function pdf(req, res, next) {
  try {
    const { nombre, buffer } = await service.pdf(req.params.version);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buffer);
  } catch (e) { next(e); }
}

// GET /api/novedades/:version/envios — a quién y cuándo se mandó.
export async function envios(req, res, next) {
  try { res.json({ success: true, data: await service.envios(req.params.version) }); } catch (e) { next(e); }
}

const enviarSchema = z.object({
  alcance: z.enum(['prueba', 'equipo']),
  correo: z.string().email().max(255).optional().nullable(),
});

// POST /api/novedades/:version/enviar — «mándamelo a mí» o «al equipo».
export async function enviar(req, res, next) {
  try {
    const parsed = enviarSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError('Datos no válidos', 400, 'VALIDATION_ERROR');
    const r = await service.enviar(req.params.version, { ...parsed.data, userId: req.user.userId });
    res.json({ success: true, data: r });
  } catch (e) { next(e); }
}
