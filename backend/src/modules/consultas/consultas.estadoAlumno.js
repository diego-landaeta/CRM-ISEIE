/*
  SUSPENSIONES Y REACTIVACIONES DE MOODLE (gemela de MultiCRM #531, plugin local_crm 1.13.0).

  Cuando un alumno no paga, Make lo suspende en Moodle (la cuenta o la matrícula de un
  curso). El plugin avisa al CRM de cada cambio de «suspendido», lo haga quien lo haga, con
  `evento: 'estado_alumno'` por la misma ruta y la misma firma que los mensajes
  (consultas.avisos.js, `recibirAviso`). Aquí:

    1. se busca la ficha del alumno por su correo (`leadDelAlumno`);
    2. se deduce el motivo con lo que el CRM sabe de sus cobros (`deducirMotivo`): Moodle no
       lo dice;
    3. se apunta UNA vez (`cambio_id` único por campus: el plugin puede mandarlo dos veces);
    4. solo si es nuevo, campana a su gestora (o, sin gestora, a administración del campus).

  Va detrás de SUSPENSIONES_MOODLE_EN_PRODUCCION (soloEnPruebas.js): apagado, el aviso se
  contesta con un 400 antes de llegar aquí.

  EL MOTIVO, con el criterio que aprobó Diego en CRM#1047 (orden y plazos): está todo en
  `motivoDe`, que no toca la base, para cambiarlo sin tocar lo demás. Se guarda el que se
  dedujo en el momento: si después cambian los cobros, el historial no se reescribe.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { administracionDelCampus } from './consultas.plazos.js';

/** Días hacia atrás en los que un cobro fallido de Stripe cuenta como motivo. */
export const DIAS_COBRO_FALLIDO = 45;
/** Días hacia atrás en los que un cobro cuenta como «pagó el …» al reactivar. */
export const DIAS_PAGO_RECIENTE = 15;

export const TIPO_SUSPENDIDO = 'moodle_alumno_suspendido';
export const TIPO_REACTIVADO = 'moodle_alumno_reactivado';

// ─── La ficha del alumno ──────────────────────────────────────────────────────

/**
 * La ficha del CRM del alumno por su correo, como los demás avisos del campus (Certifex,
 * `leadPorCorreo`), pero dentro de ESTE campus: la que está en él o tiene una venta en él.
 * Si hay varias, primero la que tiene la venta en el campus y después la más reciente.
 */
export async function leadDelAlumno(projectId, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const { rows } = await query(
    `SELECT l.id, l.responsable_id, l.nombre
       FROM leads l
      WHERE l.deleted_at IS NULL AND lower(btrim(l.email)) = $2
        AND (l.project_id = $1 OR EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = l.id AND c.project_id = $1))
      ORDER BY EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = l.id AND c.project_id = $1) DESC,
               (l.project_id = $1) DESC, l.id DESC
      LIMIT 1`,
    [projectId, e]);
  const r = rows[0];
  return r ? { id: Number(r.id), responsableId: r.responsable_id ? Number(r.responsable_id) : null, nombre: r.nombre } : null;
}

// ─── El motivo ────────────────────────────────────────────────────────────────

/**
 * Lo que el CRM sabe de los cobros de ese alumno en ese campus, hasta el momento del cambio.
 * Fechas como texto dd/mm/aaaa (de la base, sin líos de zona horaria).
 */
export async function hechosDeCobro({ projectId, leadId, email, fecha }) {
  const correo = String(email || '').trim().toLowerCase() || null;
  const { rows } = await query(
    `WITH ventas AS (
       SELECT c.id, c.importe_total, c.fecha_compromiso_pago,
              COALESCE((SELECT SUM(cp.importe) FROM conversion_payments cp WHERE cp.conversion_id = c.id), 0) AS cobrado
         FROM conversions c
        WHERE $2::int IS NOT NULL AND c.lead_id = $2 AND c.project_id = $1
     ),
     fallido AS (
       SELECT sp.stripe_created_at, sp.amount, sp.currency
         FROM stripe_payments sp
        WHERE sp.project_id = $1
          AND sp.status IN ('failed', 'requires_payment_method', 'uncollectible')
          AND (sp.lead_id = $2 OR ($3::text IS NOT NULL AND lower(sp.customer_email) = $3))
          AND sp.stripe_created_at BETWEEN $4::timestamptz - make_interval(days => $5::int) AND $4::timestamptz + INTERVAL '1 day'
        ORDER BY sp.stripe_created_at DESC LIMIT 1
     ),
     vencidas AS (
       SELECT count(*)::int AS cuantas, MIN(ci.fecha_vencimiento) AS desde
         FROM conversion_installments ci JOIN ventas v ON v.id = ci.conversion_id
        WHERE ci.fecha_cobro IS NULL AND ci.fecha_vencimiento < ($4::timestamptz AT TIME ZONE 'Europe/Madrid')::date
     ),
     pendiente AS (
       SELECT count(*)::int AS cuantas, MIN(v.fecha_compromiso_pago) AS desde
         FROM ventas v
        WHERE v.importe_total - v.cobrado > 0.005
          AND NOT EXISTS (SELECT 1 FROM conversion_installments ci WHERE ci.conversion_id = v.id)
          AND (v.fecha_compromiso_pago IS NULL OR v.fecha_compromiso_pago < ($4::timestamptz AT TIME ZONE 'Europe/Madrid')::date)
     ),
     cobro AS (
       SELECT MAX(f) AS fecha FROM (
         SELECT cp.fecha::timestamptz AS f FROM conversion_payments cp JOIN ventas v ON v.id = cp.conversion_id
          WHERE COALESCE(cp.notas, '') NOT ILIKE 'Backfill%'
         UNION ALL
         SELECT sp.stripe_created_at FROM stripe_payments sp
          WHERE sp.project_id = $1 AND sp.status = 'succeeded'
            AND (sp.lead_id = $2 OR ($3::text IS NOT NULL AND lower(sp.customer_email) = $3))
       ) x
        WHERE f BETWEEN $4::timestamptz - make_interval(days => $6::int) AND $4::timestamptz + INTERVAL '1 day'
     )
     SELECT to_char((SELECT stripe_created_at FROM fallido) AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS fallido_fecha,
            (SELECT amount FROM fallido) AS fallido_importe,
            (SELECT upper(currency) FROM fallido) AS fallido_moneda,
            (SELECT cuantas FROM vencidas) AS vencidas,
            to_char((SELECT desde FROM vencidas), 'DD/MM/YYYY') AS vencidas_desde,
            (SELECT cuantas FROM pendiente) AS pendientes,
            to_char((SELECT desde FROM pendiente), 'DD/MM/YYYY') AS pendiente_desde,
            to_char((SELECT fecha FROM cobro) AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY') AS cobro_fecha`,
    [projectId, leadId ?? null, correo, fecha, DIAS_COBRO_FALLIDO, DIAS_PAGO_RECIENTE]);
  const r = rows[0] || {};
  return {
    cobroFallido: r.fallido_fecha
      ? { fecha: r.fallido_fecha, importe: r.fallido_importe === null ? null : Number(r.fallido_importe), moneda: r.fallido_moneda || null }
      : null,
    cuotasVencidas: r.vencidas > 0 ? { cuantas: Number(r.vencidas), desde: r.vencidas_desde } : null,
    ventaPendiente: r.pendientes > 0 ? { cuantas: Number(r.pendientes), desde: r.pendiente_desde || null } : null,
    ultimoCobro: r.cobro_fecha ? { fecha: r.cobro_fecha } : null,
  };
}

const importe = (n, moneda) => (n === null || n === undefined ? ''
  : ` (${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${moneda ? ` ${moneda}` : ''})`);

/**
 * EL MOTIVO, a partir de los hechos. Sin base: cambiar el criterio es cambiar esto.
 *
 * Al suspender, lo primero que encaje:
 *   · cobro_fallido     un cobro de Stripe fallido en los últimos DIAS_COBRO_FALLIDO días;
 *   · cuota_vencida     una cuota de sus ventas en el campus vencida y sin cobrar;
 *   · pendiente_vencido una venta sin cuotas con dinero pendiente (y su fecha de pago pasada);
 *   · sin_motivo        nada de lo anterior.
 * Al reactivar: «pago» («Pagó el …») si hay un cobro en los últimos DIAS_PAGO_RECIENTE días; si no,
 * «reactivado» («Sin cobro reciente en el CRM»).
 */
export function motivoDe(hechos, { suspendido }) {
  const h = hechos || {};
  if (!suspendido) {
    if (h.ultimoCobro) return { motivo: 'pago', texto: `Pagó el ${h.ultimoCobro.fecha}` };
    return { motivo: 'reactivado', texto: 'Sin cobro reciente en el CRM' };
  }
  if (h.cobroFallido) {
    return { motivo: 'cobro_fallido', texto: `Cobro fallido en Stripe el ${h.cobroFallido.fecha}${importe(h.cobroFallido.importe, h.cobroFallido.moneda)}` };
  }
  if (h.cuotasVencidas) {
    const n = h.cuotasVencidas.cuantas;
    return { motivo: 'cuota_vencida', texto: `${n === 1 ? 'Cuota vencida' : `${n} cuotas vencidas`} sin pagar desde el ${h.cuotasVencidas.desde}` };
  }
  if (h.ventaPendiente) {
    return {
      motivo: 'pendiente_vencido',
      texto: h.ventaPendiente.desde ? `Venta con pago pendiente desde el ${h.ventaPendiente.desde}` : 'Venta con pago pendiente',
    };
  }
  return { motivo: 'sin_motivo', texto: 'Sin motivo conocido en el CRM' };
}

/** Hechos + motivo. Si la lectura falla, el aviso se apunta igual, sin motivo. */
export async function deducirMotivo(datos) {
  try {
    return motivoDe(await hechosDeCobro(datos), { suspendido: datos.suspendido });
  } catch (err) {
    logger.warn({ err: err.message, projectId: datos.projectId }, 'moodle/estado: no se ha podido deducir el motivo');
    return datos.suspendido
      ? { motivo: 'sin_motivo', texto: 'Sin motivo conocido en el CRM' }
      : { motivo: 'reactivado', texto: 'Sin cobro reciente en el CRM' };
  }
}

// ─── Recibir el aviso ─────────────────────────────────────────────────────────

/**
 * Un aviso `estado_alumno` ya validado (`estadoAlumnoSchema`). Devuelve
 * { resultado: 'apuntado' | 'repetido', id, leadId, motivo }.
 */
export async function procesarEstadoAlumno(projectId, aviso) {
  const { estado, alumno, curso } = aviso;
  const enCurso = estado.ambito === 'curso';
  const fecha = new Date(estado.fecha * 1000);
  const email = alumno.email ? String(alumno.email).trim().toLowerCase() : null;

  // Repetido: ni se busca la ficha ni se deduce nada (el plugin puede mandarlo dos veces).
  const ya = await query('SELECT id FROM moodle_estado_alumno WHERE project_id = $1 AND cambio_id = $2',
    [projectId, estado.cambio_id]);
  if (ya.rows[0]) return { resultado: 'repetido', id: Number(ya.rows[0].id) };

  const lead = await leadDelAlumno(projectId, email);
  const { motivo, texto } = await deducirMotivo({
    projectId, leadId: lead?.id ?? null, email, fecha: fecha.toISOString(), suspendido: estado.suspendido,
  });

  const { rows } = await query(
    `INSERT INTO moodle_estado_alumno
       (project_id, lead_id, moodle_user_id, alumno_nombre, alumno_email, ambito, curso_moodle_id, curso_nombre,
        suspendido, fecha, via, cambio_id, motivo, motivo_texto)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (project_id, cambio_id) DO NOTHING
     RETURNING id`,
    [projectId, lead?.id ?? null, alumno.id, alumno.nombre ? String(alumno.nombre).slice(0, 255) : null, email,
      estado.ambito, enCurso ? (curso?.id ?? null) : null, enCurso && curso?.nombre ? String(curso.nombre).slice(0, 255) : null,
      estado.suspendido, fecha, estado.via ?? null, estado.cambio_id, motivo, texto.slice(0, 300)]);
  // Dos avisos iguales a la vez: el segundo no inserta y no avisa.
  if (!rows[0]) return { resultado: 'repetido' };
  const id = Number(rows[0].id);
  logger.info({ projectId, id, leadId: lead?.id ?? null, suspendido: estado.suspendido, ambito: estado.ambito, motivo },
    'moodle/estado: suspensión o reactivación del alumno');

  await avisarDelCambio({
    projectId, id, lead, alumno, curso: enCurso ? curso : null, suspendido: estado.suspendido, texto,
  });
  return { resultado: 'apuntado', id, leadId: lead?.id ?? null, motivo };
}

/**
 * El título de la campana, sin género (QA del 25/11/2026: «María Alumna: suspendido»
 * decía en masculino a todas). Lo que se suspende o se reactiva es la cuenta del campus
 * o la matrícula de un curso: se dice eso, que concuerda siempre.
 *   «María Alumna: cuenta suspendida en Moodle» · «…: matrícula reactivada en Moodle»
 * Sin nombre, la frase sola: «Cuenta suspendida en Moodle».
 */
export function tituloDelCambio({ quien, suspendido, enCurso }) {
  const que = `${enCurso ? 'matrícula' : 'cuenta'} ${suspendido ? 'suspendida' : 'reactivada'} en Moodle`;
  const nombre = String(quien || '').trim();
  return nombre ? `${nombre}: ${que}` : que.charAt(0).toUpperCase() + que.slice(1);
}

/**
 * La campana: a la gestora del alumno; sin ficha o sin gestora, a administración del
 * campus (sus admins y los super admin), que es quien puede mirar qué ha pasado.
 */
async function avisarDelCambio({ projectId, id, lead, alumno, curso, suspendido, texto }) {
  try {
    let para = lead?.responsableId ? [lead.responsableId] : [];
    if (para.length) {
      const { rows } = await query('SELECT id FROM users WHERE id = $1 AND active', [para[0]]);
      if (!rows[0]) para = [];
    }
    if (!para.length) para = await administracionDelCampus(projectId);
    if (!para.length) return;
    const { rows: [campus] } = await query('SELECT nombre FROM projects WHERE id = $1', [projectId]);
    const quien = lead?.nombre || alumno.nombre || null;
    const donde = curso ? `${curso.nombre || `curso ${curso.id}`} · ${campus?.nombre || ''}` : (campus?.nombre || '');
    await notifyUsers({
      targetUserIds: para,
      type: suspendido ? TIPO_SUSPENDIDO : TIPO_REACTIVADO,
      title: tituloDelCambio({ quien, suspendido, enCurso: !!curso }),
      message: `${donde}${donde ? ' · ' : ''}${texto}${lead ? '' : ' · sin ficha en el CRM con su correo'}`,
      link_path: lead ? `/clients/${lead.id}` : null,
      metadata: { project_id: projectId, lead_id: lead?.id ?? null, estado_id: id, moodle_user_id: alumno.id },
    });
  } catch (err) {
    logger.warn({ err: err.message, projectId, id }, 'moodle/estado: no se ha podido avisar a la gestora');
  }
}
