import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import * as P from '../../shared/services/email-plantilla.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import {
  bloqueadosActivo, cuentasDeBrevo, listarBloqueados, desbloquearEnBrevo, motivoLegible,
} from '../../shared/services/brevo-bloqueados.service.js';

/**
 * Quién del equipo tiene el correo bloqueado en Brevo (migración 290).
 *
 * Caso real (ISEIE, 17/11/2026): una gestora pasó tres semanas sin un solo
 * aviso del CRM porque Brevo bloqueó su dirección tras un rebote duro. El CRM
 * seguía «enviando» y Brevo seguía tirándolo.
 *
 * `revisar()` (cada 6 h, `jobs/brevoBloqueadosScheduler.js`) cruza la lista de
 * bloqueados de cada cuenta de Brevo con los usuarios ACTIVOS y, la primera vez
 * que ve a alguien bloqueado, avisa a los superadmins y a los admins de sus
 * campus: campana y correo. UNA vez por persona y bloqueo: si se desbloquea y
 * Brevo la vuelve a bloquear, es otro bloqueo (otra fecha) y otro aviso.
 */

const ZONA = () => process.env.APP_TIMEZONE || 'Europe/Madrid';
export const fechaBloqueo = (d) => (d
  ? new Date(d).toLocaleDateString('es-ES', { timeZone: ZONA(), day: 'numeric', month: 'long', year: 'numeric' })
  : 'fecha desconocida');

let hayTabla = null;
async function tablaLista() {
  if (hayTabla) return true;
  try {
    const { rows } = await query("SELECT to_regclass('public.brevo_bloqueos') IS NOT NULL AS hay");
    hayTabla = rows[0]?.hay === true;
  } catch { hayTabla = false; }
  if (!hayTabla) logger.warn('Brevo bloqueados: falta la migración 290');
  return hayTabla;
}

/** Para las pruebas. */
export const _olvidarTabla = () => { hayTabla = null; };

/** Una huella por bloqueo: la misma dirección bloqueada otro día es otro bloqueo. */
const huellaDe = (email, b) => `${email}|${b.desde ? b.desde.toISOString() : (b.codigo || 'sin-fecha')}`;

/** Las de todas las cuentas, por dirección; si está en varias, manda la fecha más antigua. */
function juntar(porEmail, etiqueta, lista) {
  for (const b of lista) {
    const ya = porEmail.get(b.email);
    if (!ya) { porEmail.set(b.email, { ...b, cuentas: [etiqueta] }); continue; }
    if (!ya.cuentas.includes(etiqueta)) ya.cuentas.push(etiqueta);
    if (b.desde && (!ya.desde || b.desde < ya.desde)) Object.assign(ya, { desde: b.desde, codigo: b.codigo, mensaje: b.mensaje });
  }
}

/** Superadmins y admins de alguno de sus campus. */
async function quienesAvisar(userId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nombre, u.email FROM users u
      WHERE u.active AND u.id <> $1
        AND (u.role = 'superadmin'
         OR (u.role = 'admin' AND EXISTS (
               SELECT 1 FROM user_projects mio
                 JOIN user_projects suyo ON suyo.project_id = mio.project_id AND suyo.active
                WHERE mio.user_id = $1 AND mio.active AND suyo.user_id = u.id)))
      ORDER BY u.id`,
    [userId]
  );
  return rows;
}

function correo({ admin, persona, bloqueo }) {
  const motivo = motivoLegible(bloqueo.codigo, bloqueo.mensaje);
  const desde = fechaBloqueo(bloqueo.desde);
  return P.correo({
    proyecto: { nombre: 'ISEIE', slug: 'iseie' },
    titulo: 'Brevo no entrega los correos de una persona del equipo',
    saludo: admin.nombre || null,
    resumen: `${persona.nombre} no recibe ningún aviso del CRM desde el ${desde}`,
    bloques: [
      P.parrafo(`Brevo tiene bloqueada la dirección de <strong>${P.esc(persona.nombre)}</strong> desde el <strong>${P.esc(desde)}</strong>. Desde entonces no le llega NINGÚN correo del CRM: ni los prospectos asignados ni los resúmenes.`),
      P.nota(`<strong>${P.esc(persona.email)}</strong><br>Motivo: ${P.esc(motivo)}`),
      P.parrafo('Comprueba que el buzón existe y recibe correo. Después, desde su ficha en Usuarios, pulsa «Desbloquear en Brevo». Si el buzón sigue sin existir, Brevo lo volverá a bloquear con el siguiente envío.'),
      P.boton({ texto: 'Abrir Usuarios', url: P.enlace('/configuracion') }),
    ],
    apagar: { texto: 'Este aviso se manda una sola vez por persona y bloqueo.' },
  });
}

async function avisar(persona, bloqueo, filaId) {
  const admins = await quienesAvisar(persona.id);
  if (!admins.length) return 0;
  const motivo = motivoLegible(bloqueo.codigo, bloqueo.mensaje);
  const desde = fechaBloqueo(bloqueo.desde);

  await notifyUsers({
    targetUserIds: admins.map((a) => a.id),
    type: 'brevo_bloqueado',
    title: `Brevo bloquea el correo de ${persona.nombre}`,
    message: `Desde el ${desde}: ${motivo}. No le llega ningún aviso del CRM.`,
    link_path: '/configuracion',
    metadata: { user_id: persona.id, bloqueo_id: filaId, codigo: bloqueo.codigo },
  });

  for (const admin of admins) {
    // A quien también está bloqueado no se le escribe: le basta la campana.
    if (!admin.email || bloqueo.bloqueadas?.has(String(admin.email).toLowerCase())) continue;
    await sendEmail({
      to: admin.email,
      subject: `Brevo bloquea el correo de ${persona.nombre}`,
      ...correo({ admin, persona, bloqueo }),
      tags: ['aviso', 'brevo-bloqueado'],
      cuenta: 'crm',
      clave: `brevo-bloqueado-${filaId}-${admin.id}`,
    }).catch((err) => logger.warn({ err: err.message }, 'Brevo bloqueados: no salió el correo al admin'));
  }
  return admins.length;
}

/** Una vuelta de la tarea. Apagada, no pregunta nada a Brevo. */
export async function revisar() {
  if (!bloqueadosActivo()) return { apagado: true };
  if (!(await tablaLista())) return { sinMigracion: true };

  const cuentas = await cuentasDeBrevo();
  if (!cuentas.length) return { sinCuentas: true };

  const porEmail = new Map();
  let completas = true;
  for (const c of cuentas) {
    try {
      juntar(porEmail, c.etiqueta, await listarBloqueados(c.apiKey));
    } catch (err) {
      completas = false;
      logger.warn({ err: err.message, cuenta: c.etiqueta }, 'Brevo bloqueados: no se pudo leer la lista de una cuenta');
    }
  }
  const bloqueadas = new Set(porEmail.keys());

  const { rows: equipo } = await query(
    "SELECT id, nombre, email FROM users WHERE active = true AND COALESCE(email, '') <> '' ORDER BY id");

  const abiertas = [];
  let nuevos = 0;
  for (const persona of equipo) {
    const email = String(persona.email).trim().toLowerCase();
    const bloqueo = porEmail.get(email);
    if (!bloqueo) continue;
    const { rows } = await query(
      `INSERT INTO brevo_bloqueos (user_id, email, huella, codigo, motivo, bloqueado_desde, cuentas)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, huella) DO UPDATE
          SET visto_at = NOW(), codigo = EXCLUDED.codigo, motivo = EXCLUDED.motivo,
              cuentas = EXCLUDED.cuentas, resuelto_at = NULL
       RETURNING id, avisado_at`,
      [persona.id, email, huellaDe(email, bloqueo), bloqueo.codigo,
        motivoLegible(bloqueo.codigo, bloqueo.mensaje), bloqueo.desde, bloqueo.cuentas]
    );
    const fila = rows[0];
    abiertas.push(fila.id);
    if (fila.avisado_at) continue;
    await avisar(persona, { ...bloqueo, bloqueadas }, fila.id);
    await query('UPDATE brevo_bloqueos SET avisado_at = NOW() WHERE id = $1', [fila.id]);
    nuevos++;
  }

  // Lo que ya no está en Brevo (desbloqueado desde su panel, correo cambiado,
  // persona dada de baja) se cierra. Solo con TODAS las listas leídas: con una
  // a medias, cerrar sería decir que alguien está bien sin saberlo.
  let cerrados = 0;
  if (completas) {
    const r = await query(
      `UPDATE brevo_bloqueos SET resuelto_at = NOW()
        WHERE resuelto_at IS NULL AND NOT (id = ANY($1::int[]))`,
      [abiertas]
    );
    cerrados = r.rowCount || 0;
  }

  const resumen = { cuentas: cuentas.length, bloqueadas: bloqueadas.size, equipo: abiertas.length, nuevos, cerrados, completas };
  if (nuevos || cerrados) logger.info(resumen, 'Brevo bloqueados: revisión hecha');
  return resumen;
}

/**
 * Los bloqueos abiertos de la gente que se ve en Usuarios. `campus` = null para
 * quien ve a todo el equipo; si no, solo los de esos campus.
 */
export async function abiertos({ campus = null } = {}) {
  if (!(await tablaLista())) return [];
  const { rows } = await query(
    `SELECT b.id, b.user_id, b.codigo, b.motivo, b.bloqueado_desde, b.detectado_at
       FROM brevo_bloqueos b
       JOIN users u ON u.id = b.user_id AND lower(u.email) = b.email
      WHERE b.resuelto_at IS NULL
        AND ($1::int[] IS NULL OR EXISTS (
              SELECT 1 FROM user_projects up
               WHERE up.user_id = b.user_id AND up.active AND up.project_id = ANY($1::int[])))
      ORDER BY b.user_id, b.bloqueado_desde NULLS LAST`,
    [campus]
  );
  return rows;
}

/**
 * «Desbloquear en Brevo»: saca su dirección de la lista de cada cuenta donde
 * estaba y cierra el bloqueo. Si el buzón sigue sin existir, Brevo la volverá a
 * bloquear con el siguiente envío (y la tarea avisará otra vez: otro bloqueo).
 */
export async function desbloquear({ userId, porQuien }) {
  if (!bloqueadosActivo()) {
    throw new AppError('La vigilancia de bloqueos de Brevo está apagada (BREVO_BLOQUEADOS_ACTIVO)', 409, 'BREVO_BLOQUEADOS_APAGADO');
  }
  if (!(await tablaLista())) throw new AppError('Falta la migración 290', 409, 'FALTA_MIGRACION');

  const { rows } = await query(
    `SELECT b.id, b.email, b.cuentas FROM brevo_bloqueos b
       JOIN users u ON u.id = b.user_id AND lower(u.email) = b.email
      WHERE b.user_id = $1 AND b.resuelto_at IS NULL`,
    [userId]
  );
  if (!rows.length) throw new AppError('Brevo no tiene bloqueado su correo', 404, 'SIN_BLOQUEO');

  const email = rows[0].email;
  const etiquetas = new Set(rows.flatMap((r) => r.cuentas || []));
  const cuentas = await cuentasDeBrevo();
  // Las cuentas donde estaba; si ninguna cuadra (una clave cambiada), todas.
  const donde = cuentas.filter((c) => etiquetas.has(c.etiqueta));
  const fallos = [];
  for (const c of (donde.length ? donde : cuentas)) {
    const r = await desbloquearEnBrevo(c.apiKey, email);
    if (!r.ok) fallos.push(`${c.etiqueta}: ${r.estado}`);
  }
  if (fallos.length) {
    logger.warn({ userId, fallos }, 'Brevo bloqueados: el desbloqueo falló en alguna cuenta');
    throw new AppError(`Brevo no lo desbloqueó (${fallos.join(', ')})`, 502, 'BREVO_DESBLOQUEO_FALLIDO');
  }

  await query(
    `UPDATE brevo_bloqueos SET resuelto_at = NOW(), desbloqueado_por = $2
      WHERE user_id = $1 AND resuelto_at IS NULL`,
    [userId, porQuien || null]
  );
  logger.info({ userId, porQuien }, 'Brevo bloqueados: desbloqueado');
  return { desbloqueado: true, cuentas: (donde.length ? donde : cuentas).length };
}

export const _internos = { juntar, huellaDe, quienesAvisar, correo };
