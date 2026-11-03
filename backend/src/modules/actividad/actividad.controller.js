import { z } from 'zod';
import * as model from './actividad.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';

const FECHA = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Tiene que ser una fecha');

const listarSchema = z.object({
  limit: z.coerce.number().int().min(1).max(model.LIMITE_MAXIMO).optional(),
  // El cursor: el `fecha` del último evento de la página anterior.
  before: FECHA.optional(),
  // Desde cuándo. Por defecto, el inicio de hoy (hora de Madrid).
  desde: FECHA.optional(),
  // Una lista separada por comas: lead_creado,venta_creada,estado_cambiado,contacto
  tipos: z.string().optional(),
});

/** Los campos de fecha y hora que tiene un instante en una zona. */
function camposEn(instante, zona) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante).map((x) => [x.type, Number(x.value)]));
  return p;
}

/** Cuánto va la zona por delante de UTC en ese instante, en milisegundos. */
function desfaseDe(instante, zona) {
  const c = camposEn(instante, zona);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * El inicio de hoy en la zona de la aplicación, como instante UTC en ISO.
 * Medianoche de Madrid = 22:00 UTC en verano y 23:00 UTC en invierno.
 */
export function inicioDeHoy(ahora = new Date(), zona = process.env.APP_TIMEZONE || 'Europe/Madrid') {
  const c = camposEn(ahora, zona);
  const medianocheComoUtc = Date.UTC(c.year, c.month - 1, c.day);
  // Dos pasadas: el desfase puede ser distinto a las 00:00 que a la hora de ahora (cambio de hora).
  let instante = medianocheComoUtc - desfaseDe(new Date(medianocheComoUtc), zona);
  instante = medianocheComoUtc - desfaseDe(new Date(instante), zona);
  return new Date(instante).toISOString();
}

/**
 * GET /api/actividad — «qué ha pasado hoy» (#13).
 *
 * Cualquiera con sesión, cada uno con lo suyo: una gestora ve sus prospectos y
 * lo que ella hizo; admin y super admin, todo lo de sus campus. El recorte lo
 * pone el servidor con la sesión, no la URL.
 */
export async function listar(req, res, next) {
  try {
    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { limit, before, desde, tipos } = parsed.data;
    let tiposPedidos = null;
    if (tipos) {
      tiposPedidos = tipos.split(',').map((t) => t.trim()).filter(Boolean);
      const malos = tiposPedidos.filter((t) => !model.TIPOS.includes(t));
      if (malos.length) throw new AppError(`Tipo de actividad desconocido: ${malos.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    const rol = req.user?.role;
    const jefe = ['admin', 'superadmin', 'soporte'].includes(rol);
    const data = await model.actividadReciente({
      ...(await proyectosDelAmbito(req)),
      asesoraId: jefe ? null : (req.user?.userId || -1),
      desde: desde || inicioDeHoy(),
      antes: before || null,
      limite: limit,
      tipos: tiposPedidos,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
