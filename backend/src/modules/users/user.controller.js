import * as userService from './user.service.js';
import * as userModel from './user.model.js';
import { createUserSchema, updateUserSchema, listUsersSchema, adminSetPasswordSchema } from './user.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { mimeToExt, extToMime } from '../../shared/utils/mime.js';
import crypto from 'crypto';

export async function list(req, res, next) {
  try {
    const parsed = listUsersSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await userService.list(parsed.data);
    res.json({
      success: true,
      data: result.users,
      pagination: { total: result.total, page: result.page, limit: result.limit, totalPages: result.totalPages },
    });
  } catch (err) { next(err); }
}

export async function activityLog(req, res, next) {
  try {
    const { userId, action, search } = req.query;
    const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const result = await userModel.listActivityLog({
      userId: userId ? parseInt(userId) : null,
      action: action || null,
      search: search || null,
      limit,
      offset,
    });
    res.json({ success: true, data: result.items, pagination: { total: result.total, limit, offset } });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const user = await userService.getById(id);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const user = await userService.create(parsed.data);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    // Como estaba ANTES, para saber si pierde el acceso a WhatsApp.
    const antes = await userService.getById(id).catch(() => null);
    const user = await userService.update(id, parsed.data);

    // Si el cambio de rol le quita WhatsApp, se le desvincula el numero — pero
    // sus conversaciones se quedan. El numero es suyo y no puede seguir
    // enlazado a un CRM que ya no usa; las conversaciones con prospectos son de
    // la empresa. Es el punto 3 de la tarea #68.
    //
    // No se espera al resultado ni se deja que rompa nada: cambiar un rol no
    // puede fallar porque WhatsApp no conteste.
    const wa = await import('../whatsapp/roles.js');
    if (antes && wa.puedeTenerWhatsapp(antes) && !wa.puedeTenerWhatsapp(user)) {
      wa.alPerderAcceso(id, `cambio de rol: ${antes.role} -> ${user.role}`).catch(() => {});
    }

    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function deactivate(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await userService.deactivate(id);

    // Una baja tambien quita el acceso, y por el mismo motivo: quien ya no
    // trabaja aqui no debe seguir con su numero enlazado.
    const wa = await import('../whatsapp/roles.js');
    wa.alPerderAcceso(id, 'baja del usuario').catch(() => {});

    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function reactivate(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await userService.reactivate(id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// Reset de contraseña de otro usuario (solo superadmin).
export async function setPassword(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (req.user?.role !== 'superadmin') {
      throw new AppError('Solo un superadmin puede cambiar la contraseña de otro usuario', 403, 'FORBIDDEN');
    }
    const parsed = adminSetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    await userService.setPassword(id, parsed.data.password);
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ===== AVATAR =====

export async function uploadAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (!req.file) throw new AppError('Imagen requerida (campo file)', 400, 'FILE_REQUIRED');

    // Permiso: solo el propio usuario o superadmin
    if (req.user.userId !== id && req.user.role !== 'superadmin') {
      throw new AppError('Solo puedes editar tu propio avatar', 403, 'FORBIDDEN');
    }

    const user = await userModel.findById(id);
    if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');

    if (user.avatar_key) {
      try { await deleteLocal(user.avatar_key); } catch {}
    }

    const ext = mimeToExt(req.file.mimetype);
    const key = `avatars/user-${id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);

    const avatarUrl = `/api/users/${id}/avatar?v=${Date.now()}`;
    const updated = await userModel.update(id, { avatar_url: avatarUrl, avatar_key: key });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function getAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const user = await userModel.findById(id);
    if (!user?.avatar_key) return res.status(404).end();

    const ext = user.avatar_key.split('.').pop();
    const { buffer, size } = await getLocal(user.avatar_key);
    res.setHeader('Content-Type', extToMime(ext));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', size);
    res.end(buffer);
  } catch (err) { next(err); }
}

export async function deleteAvatar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    if (req.user.userId !== id && req.user.role !== 'superadmin') {
      throw new AppError('Solo puedes editar tu propio avatar', 403, 'FORBIDDEN');
    }
    const user = await userModel.findById(id);
    if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
    if (user.avatar_key) {
      try { await deleteLocal(user.avatar_key); } catch {}
    }
    const updated = await userModel.update(id, { avatar_url: null, avatar_key: null });
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

/**
 * GET /api/users/mis-avisos — que avisos por correo tengo encendidos.
 * PATCH /api/users/mis-avisos — encender o apagar uno.
 *
 * Cuarta subfase de la tarea #28. Cada persona gestiona LOS SUYOS: no hace falta
 * ser admin, y nadie puede tocar los de otro — el usuario sale del testigo de
 * sesion, no del cuerpo de la peticion.
 *
 * En la base se guarda solo lo APAGADO. Aqui se devuelve al reves —encendido si
 * o no— porque es como se pregunta y como se pinta la casilla.
 */
const AVISOS = [
  { aviso: 'lead_sin_tocar', titulo: 'Prospecto sin contactar',
    detalle: 'Cuando te asignan uno y pasa media hora sin que lo toques.' },
  { aviso: 'resumen_del_dia', titulo: 'Resumen del dia',
    detalle: 'Al cerrar la jornada: que ha entrado, que has hecho y que queda.' },
  { aviso: 'plan_de_manana', titulo: 'Plan de mañana',
    detalle: 'Por la noche, lo que te espera al dia siguiente.' },
  { aviso: 'reporte_semanal', titulo: 'Reporte semanal',
    detalle: 'Los lunes: como fue la semana comparada con la anterior. Solo administracion.' },
];

export async function misAvisos(req, res, next) {
  try {
    const { query } = await import('../../shared/config/db.js');
    const { rows } = await query(
      'SELECT aviso FROM avisos_apagados WHERE user_id = $1', [req.user.userId]);
    const apagados = new Set(rows.map((r) => r.aviso));
    res.json({
      success: true,
      data: AVISOS.map((a) => ({ ...a, encendido: !apagados.has(a.aviso) })),
    });
  } catch (err) { next(err); }
}

export async function cambiarMiAviso(req, res, next) {
  try {
    const { aviso, encendido } = req.body || {};
    if (!AVISOS.some((a) => a.aviso === aviso)) {
      throw new AppError('Ese aviso no existe', 400, 'AVISO_DESCONOCIDO');
    }
    const { query } = await import('../../shared/config/db.js');
    if (encendido) {
      await query('DELETE FROM avisos_apagados WHERE user_id = $1 AND aviso = $2',
        [req.user.userId, aviso]);
    } else {
      await query(
        `INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, $2)
         ON CONFLICT (user_id, aviso) DO NOTHING`,
        [req.user.userId, aviso]);
    }
    res.json({ success: true, data: { aviso, encendido: Boolean(encendido) } });
  } catch (err) { next(err); }
}
