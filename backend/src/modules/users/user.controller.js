import * as userService from './user.service.js';
import * as userModel from './user.model.js';
import { createUserSchema, updateUserSchema, listUsersSchema, adminSetPasswordSchema, activityLogSchema } from './user.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { mimeToExt, extToMime } from '../../shared/utils/mime.js';
import crypto from 'crypto';
import { tienePermiso } from '../../shared/middleware/permissions.js';

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

// «Actividad» (`/activity`). Super admin y soporte ven todo el registro; un
// admin, lo suyo y lo de quien comparte con él algún campus (#245, el mismo
// criterio que `proyectosDelAmbito`). Se decide por el token, no por la pantalla.
export async function activityLog(req, res, next) {
  try {
    const parsed = activityLogSchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const { userId, action, search, limit, offset } = parsed.data;
    const ambito = veTodoElCrm(req.user)
      ? null
      : { userId: req.user.userId, projectIds: await campusDeLaPersona(req.user.userId) };
    const result = await userModel.listActivityLog({
      userId: userId ?? null,
      action: action || null,
      search: search || null,
      limit,
      offset,
      ambito,
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
    // La empresa entera (#220), solo el super admin. Crear y editar usuarios
    // sigue como estaba —esto no lo amplia ni lo recorta—, pero dar una empresa
    // es dar los campus que se creen mañana, y eso no lo decide un admin, ni
    // para otro ni para si mismo. Se mira el rol del token, no la pantalla.
    if (parsed.data.empresaIds?.length && !(await tienePermiso(req, 'users.empresas'))) {
      throw new AppError('Solo un superadmin puede dar una empresa entera', 403, 'FORBIDDEN');
    }
    // Dar de alta con un rol es darle ese rol: nadie da lo que no tiene (QA de Diego, punto 7).
    const { exigirQueNoDeMasDeLoQueTiene } = await import('../permissions/permissions.editar.js');
    await exigirQueNoDeMasDeLoQueTiene(req.user, null, { role: parsed.data.role, roles_extra: parsed.data.roles_extra || [] });
    const user = await userService.create(parsed.data, { porUserId: req.user?.userId ?? null });
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
    // El correo de otro, solo el super admin (#248). Un admin que lo mande se
    // lleva un 403 aunque la pantalla no se lo ofrezca: no basta con ocultarlo.
    const { email, reenviarEnlace, ...resto } = parsed.data;
    if (email !== undefined && !(await tienePermiso(req, 'users.empresas'))) {
      throw new AppError('Solo un superadmin puede cambiar el correo de otro usuario', 403, 'FORBIDDEN');
    }
    // Las empresas enteras (#220), lo mismo: solo el super admin, y también
    // para quitarlas (una lista vacía).
    if (resto.empresaIds !== undefined && !(await tienePermiso(req, 'users.empresas'))) {
      throw new AppError('Solo un superadmin puede dar o quitar una empresa entera', 403, 'FORBIDDEN');
    }

    // Como estaba ANTES, para saber si pierde el acceso a WhatsApp.
    const antes = await userService.getById(id).catch(() => null);
    // El rol, los roles de más y «se dedica a colaboraciones» deciden lo que
    // puede hacer: si CAMBIAN, con las mismas reglas que sus permisos en la
    // ficha (#423). Antes, admin y soporte se los cambiaban a cualquiera, sin
    // mirar campus. La pantalla manda el rol siempre: lo que cuenta es que cambie.
    const mismaLista = (a, b) => [...(a || [])].sort().join() === [...(b || [])].sort().join();
    const cambiaQuienEs = antes && (
      (resto.role !== undefined && resto.role !== antes.role)
      || (resto.roles_extra !== undefined && !mismaLista(resto.roles_extra, antes.roles_extra))
      || (resto.gestor_colaboraciones !== undefined && resto.gestor_colaboraciones !== !!antes.gestor_colaboraciones));
    if (cambiaQuienEs) {
      if (!(await tienePermiso(req, 'users.excepciones'))) {
        throw new AppError('Cambiar el rol de alguien es «Permisos de cada persona»', 403, 'FORBIDDEN');
      }
      const { exigirQuePuedaTocarA, exigirQueNoDeMasDeLoQueTiene } = await import('../permissions/permissions.editar.js');
      await exigirQuePuedaTocarA(req.user, id);
      // Y nada de lo que gane puede faltarle a quien lo cambia (QA, punto 7).
      await exigirQueNoDeMasDeLoQueTiene(req.user, id, { role: resto.role, roles_extra: resto.roles_extra });
    }
    // El correo va primero: si choca con el de otro (409), no se guarda nada a medias.
    const correo = email !== undefined
      ? await userService.cambiarCorreo(id, email, {
        reenviarEnlace: reenviarEnlace === true, porUserId: req.user.userId, ip: req.ip,
        // El rol con el que se va a guardar, para el freno de tutores (#262).
        rolFinal: resto.role ?? null,
      })
      : null;
    const user = Object.keys(resto).length
      ? await userService.update(id, resto, { porUserId: req.user?.userId ?? null })
      : await userService.getById(id);

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

    // Sus permisos se recuerdan medio minuto (también «Usar su WhatsApp», que el
    // chat pregunta cada tres segundos). Se olvidan aquí para que el cambio se
    // note al momento. OJO: quitarle WhatsApp NO desvincula el número; eso solo
    // pasa cuando deja de PODER tenerlo, que es el bloque de arriba.
    (await import('../permissions/permissions.service.js')).olvidarPermisos(id);

    res.json({ success: true, data: correo ? { ...user, correo } : user });
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
    // El super admin, a cualquiera. El admin, solo a un TUTOR de sus campus (Diego,
    // 09/10, #246: «sí, y admin»). A nadie más: ni a una gestora ni a otro admin.
    // Quién puede: la ruta pide «Contraseña de otros» (#423). A quién: el
    // superadmin, a cualquiera; el resto, solo a tutores de sus campus.
    if (req.user?.role !== 'superadmin') {
      const destino = await userModel.findById(id);
      if (!destino || destino.role !== 'tutor') {
        throw new AppError('Un admin solo puede cambiar la contraseña de un tutor', 403, 'FORBIDDEN');
      }
      const { campusDeLaPersona } = await import('../../shared/utils/ambito.js');
      const { tieneAlgunCampus } = await import('../tutores/tutor.model.js');
      if (!(await tieneAlgunCampus(id, await campusDeLaPersona(req.user.userId)))) {
        throw new AppError('Tutor no encontrado', 404, 'NOT_FOUND');
      }
    }
    const parsed = adminSetPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    await userService.setPassword(id, parsed.data.password, { porUserId: req.user.userId, ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// GET /api/users/:id/aviso-correo — antes de cambiar el correo de alguien, si
// recibe prospectos por Make (#248). Solo super admin, como el cambio.
export async function avisoCorreo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    res.json({ success: true, data: await userService.avisoCambioCorreo(id) });
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
  { aviso: 'resumen_del_dia', titulo: 'Resumen del día (dirección)',
    detalle: 'Cada tarde, por empresa: prospectos, ventas, cobrado y cada gestora. Solo administración.' },
  { aviso: 'plan_de_manana', titulo: 'Tu día y lo de mañana',
    detalle: 'Cada noche: lo que hiciste hoy, tu cola de mañana, tus recordatorios y cómo va tu mes.' },
  { aviso: 'semana_gestora', titulo: 'Tu semana',
    detalle: 'Los lunes: tus números de la semana, contra la anterior y la media del equipo, y tu puesto.' },
  { aviso: 'reporte_semanal', titulo: 'Reporte semanal (dirección)',
    detalle: 'Los lunes, por empresa: la semana contra la anterior y el ranking. Solo administración.' },
  // Tablero de tareas (#210, fase 3). Los nombres, en tasks.emails.js.
  { aviso: 'tarea_asignada', titulo: 'Tarea asignada',
    detalle: 'Cuando alguien te asigna una tarea del tablero.' },
  { aviso: 'tareas_del_dia', titulo: 'Tus tareas de hoy',
    detalle: 'Cada mañana, si tienes tareas que vencen hoy o ya vencidas.' },
  { aviso: 'tarea_devuelta', titulo: 'Tarea devuelta',
    detalle: 'Cuando revisan una tarea tuya y la devuelven, con lo que falta.' },
  { aviso: 'tarea_cerrada', titulo: 'Tarea aprobada',
    detalle: 'Cuando aprueban una tarea tuya y pasa a «Hecha».' },
  { aviso: 'tarea_comentario', titulo: 'Comentario en tu tarea',
    detalle: 'Cuando alguien comenta en una tarea que tienes asignada.' },
  { aviso: 'tarea_supervisor', titulo: 'Tarea que supervisas',
    detalle: 'Cuando te ponen de supervisor de una tarea y cuando está lista para revisar.' },
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
