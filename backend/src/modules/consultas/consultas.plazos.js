/*
  CONSULTAS DE ALUMNOS · FASE 4 (#190): recordatorios y avisos de fuera de plazo.

  Decisión 4 («¿qué pasa si el tutor no responde a tiempo?»): recordatorio al
  tutor y aviso a administración; la reasignación es manual, desde el panel
  (ya existe desde la #188).

    · CERCA DEL PLAZO: la consulta abierta lleva esperando las tres cuartas
      partes del plazo (cuando el semáforo pasa a ámbar). Al tutor, un correo
      y un aviso en la campana. Una vez por espera.
    · FUERA DE PLAZO: se pasó. A administración (los super admin y los admin
      de ese campus), un aviso en la campana. Una vez por espera. También las
      que no tienen tutor.
    · CARGA DESACTUALIZADA (decisión 9): el tutor lleva más de una semana sin
      tocar «Mi carga de trabajo». Correo y campana, y no se repite hasta que
      pase otra semana.

  «Una vez por espera»: si el alumno vuelve a escribir, la espera empieza de
  nuevo (`espera_desde`) y se vuelve a avisar.

  Los correos al tutor respetan el freno (NO_ESCRIBIR_A_TUTORES, Diego 15/09):
  con él puesto no sale ninguno (se apunta en el registro). La campana no es un
  correo: esa sí llega.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import {
  correo, parrafo, boton, nota, enlace, esc,
} from '../../shared/services/email-plantilla.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { PLAZO_HORAS } from './consultas.model.js';
import { DIAS_CARGA } from './consultas.carga.js';

/** Qué parte del plazo tiene que pasar para recordárselo al tutor: la del ámbar del semáforo. */
export const PARTE_DEL_PLAZO = 0.75;

const ESPERA = 'COALESCE(c.espera_desde, c.entrada_at)';

const horasTexto = (h) => (h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} días`);

async function apuntarEvento(consultaId, tipo, detalle) {
  await query('INSERT INTO consulta_eventos (consulta_id, tipo, user_id, detalle) VALUES ($1, $2, NULL, $3)',
    [consultaId, tipo, detalle]);
}

/** Las abiertas, con tutor, que ya pasaron la parte del plazo y no se le han recordado en esta espera. */
async function cercaDelPlazo(ahora, projectIds) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.tutor_id, c.alumno_nombre, c.curso_nombre, ${ESPERA} AS espera,
            pr.nombre AS campus, pr.logo_url, pr.emoji, u.nombre AS tutor_nombre, u.email AS tutor_email,
            EXTRACT(EPOCH FROM ($1::timestamptz - ${ESPERA})) / 3600.0 AS horas
       FROM consultas c
       JOIN projects pr ON pr.id = c.project_id
       JOIN users u ON u.id = c.tutor_id
      WHERE c.estado = 'abierta' AND c.tutor_id IS NOT NULL
        AND ${ESPERA} <= $1::timestamptz - make_interval(secs => $2::float8 * 3600)
        AND (c.recordatorio_plazo_at IS NULL OR c.recordatorio_plazo_at < ${ESPERA})
        AND ($3::int[] IS NULL OR c.project_id = ANY($3::int[]))
      ORDER BY ${ESPERA}`,
    [ahora, PLAZO_HORAS * PARTE_DEL_PLAZO, projectIds]);
  return rows;
}

/** Las abiertas que ya se pasaron del plazo y no se han avisado en esta espera (con tutor o sin él). */
async function fueraDelPlazo(ahora, projectIds) {
  const { rows } = await query(
    `SELECT c.id, c.project_id, c.tutor_id, c.alumno_nombre, ${ESPERA} AS espera,
            pr.nombre AS campus, u.nombre AS tutor_nombre,
            EXTRACT(EPOCH FROM ($1::timestamptz - ${ESPERA})) / 3600.0 AS horas
       FROM consultas c
       JOIN projects pr ON pr.id = c.project_id
       LEFT JOIN users u ON u.id = c.tutor_id
      WHERE c.estado = 'abierta'
        AND ${ESPERA} <= $1::timestamptz - make_interval(secs => $2::float8 * 3600)
        AND (c.aviso_fuera_plazo_at IS NULL OR c.aviso_fuera_plazo_at < ${ESPERA})
        AND ($3::int[] IS NULL OR c.project_id = ANY($3::int[]))
      ORDER BY ${ESPERA}`,
    [ahora, PLAZO_HORAS, projectIds]);
  return rows;
}

/** Administración de un campus: los super admin y los admin con ese campus. */
export async function administracionDelCampus(projectId) {
  const { rows } = await query(
    `SELECT u.id FROM users u WHERE u.active AND u.role = 'superadmin'
     UNION
     SELECT u.id FROM users u
       JOIN user_projects up ON up.user_id = u.id AND up.active AND up.project_id = $1
      WHERE u.active AND u.role = 'admin'`, [projectId]);
  return rows.map((r) => Number(r.id));
}

async function recordarAlTutor(c, enviar) {
  const horas = Number(c.horas);
  const quedan = Math.max(0, PLAZO_HORAS - horas);
  await notifyUsers({
    targetUserIds: [Number(c.tutor_id)],
    type: 'consulta_cerca_del_plazo',
    title: `${c.alumno_nombre || 'Un alumno'} espera respuesta`,
    message: `${c.campus} · lleva ${horasTexto(horas)}; quedan ${horasTexto(quedan)} para el plazo de ${PLAZO_HORAS} h`,
    link_path: `/consultas/${c.id}`,
    metadata: { consulta_id: c.id, project_id: c.project_id },
  });
  let correoEnviado = false;
  if (NO_ESCRIBIR_A_TUTORES) {
    logger.info({ consultaId: c.id, tutorId: c.tutor_id }, 'consultas: recordatorio de plazo sin enviar por correo (freno de correos a tutores)');
  } else if (c.tutor_email) {
    const { htmlContent, textContent } = correo({
      proyecto: { nombre: c.campus, logo_url: c.logo_url, emoji: c.emoji },
      titulo: 'Una consulta se acerca al plazo',
      saludo: c.tutor_nombre || null,
      resumen: `${c.alumno_nombre || 'Un alumno'} lleva ${horasTexto(horas)} esperando respuesta`,
      bloques: [
        parrafo(`<strong>${esc(c.alumno_nombre || 'Un alumno')}</strong>${c.curso_nombre ? ` (${esc(c.curso_nombre)})` : ''} lleva <strong>${horasTexto(horas)}</strong> esperando tu respuesta. El plazo es de ${PLAZO_HORAS} h.`),
        boton({ texto: 'Responder en el CRM', url: enlace(`consultas/${c.id}`) }),
        nota('Responde desde el CRM: así queda medido el tiempo de respuesta.'),
      ],
    });
    const r = await enviar({
      to: c.tutor_email, subject: `[${c.campus}] Una consulta se acerca al plazo`, htmlContent, textContent,
      tags: ['consultas', 'tutor', 'plazo'], projectId: c.project_id,
      clave: `consultas-plazo-${c.id}-${new Date(c.espera).toISOString()}`,
    }).catch((err) => ({ sent: false, error: err.message }));
    correoEnviado = Boolean(r?.sent);
  }
  await query('UPDATE consultas SET recordatorio_plazo_at = NOW() WHERE id = $1', [c.id]);
  await apuntarEvento(c.id, 'recordatorio_plazo', { horas: Math.round(horas * 10) / 10, correo: correoEnviado });
}

async function avisarAAdministracion(c) {
  const horas = Number(c.horas);
  const destinatarios = await administracionDelCampus(c.project_id);
  // Sin nadie, nada: una lista vacía en la campana se entendería como «para todos».
  if (destinatarios.length) {
    await notifyUsers({
      targetUserIds: destinatarios,
      type: 'consulta_fuera_de_plazo',
      title: `Consulta fuera de plazo: ${c.alumno_nombre || 'un alumno'}`,
      message: `${c.campus} · ${c.tutor_nombre ? `Tutor: ${c.tutor_nombre}` : 'Sin tutor'} · lleva ${horasTexto(horas)} sin respuesta (plazo ${PLAZO_HORAS} h). Puedes reasignarla.`,
      link_path: `/consultas/${c.id}`,
      metadata: { consulta_id: c.id, project_id: c.project_id, tutor_id: c.tutor_id },
    });
  }
  await query('UPDATE consultas SET aviso_fuera_plazo_at = NOW() WHERE id = $1', [c.id]);
  await apuntarEvento(c.id, 'fuera_de_plazo', { horas: Math.round(horas * 10) / 10, avisados: destinatarios.length });
}

/** Una vuelta: recordatorios a los tutores y avisos a administración. `projectIds`: solo esos campus (null = todos). */
export async function revisarPlazos({ ahora = new Date(), enviar = sendEmail, projectIds = null } = {}) {
  const r = { recordatorios: 0, fueraDePlazo: 0, errores: 0 };
  for (const c of await cercaDelPlazo(ahora, projectIds)) {
    try { await recordarAlTutor(c, enviar); r.recordatorios += 1; } catch (err) {
      r.errores += 1;
      logger.warn({ consultaId: c.id, err: err.message }, 'consultas: el recordatorio de plazo ha fallado');
    }
  }
  for (const c of await fueraDelPlazo(ahora, projectIds)) {
    try { await avisarAAdministracion(c); r.fueraDePlazo += 1; } catch (err) {
      r.errores += 1;
      logger.warn({ consultaId: c.id, err: err.message }, 'consultas: el aviso de fuera de plazo ha fallado');
    }
  }
  return r;
}

/**
 * Tutores con la carga desactualizada (o sin indicar) a los que no se les ha
 * recordado en la última semana. Solo los que atienden algún campus.
 */
async function cargasPorRecordar(ahora, tutorIds) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.nombre, u.email,
            (SELECT MAX(tc2.created_at) FROM tutor_carga tc2 WHERE tc2.tutor_id = u.id) AS ultima
       FROM users u
       JOIN tutor_campus tc ON tc.tutor_id = u.id AND tc.estado = 'activa'
       -- Solo campus que leen consultas: a quien no usa Consultas no se le pide la carga.
       JOIN project_integrations pi ON pi.project_id = tc.project_id AND pi.provider = 'moodle'
        AND pi.active AND COALESCE((pi.config_public->>'consultas')::boolean, false)
       LEFT JOIN tutor_carga_recordatorios r ON r.tutor_id = u.id
      WHERE u.active
        AND NOT EXISTS (SELECT 1 FROM tutor_carga c WHERE c.tutor_id = u.id
                          AND c.created_at > $1::timestamptz - make_interval(days => $2::int))
        AND (r.ultimo_at IS NULL OR r.ultimo_at <= $1::timestamptz - make_interval(days => $2::int))
        AND ($3::int[] IS NULL OR u.id = ANY($3::int[]))`,
    [ahora, DIAS_CARGA, tutorIds]);
  return rows;
}

/**
 * Con qué marca le escribe el CRM a un tutor fuera de una consulta concreta
 * (resumen semanal, carga): la del campus si atiende consultas en uno solo; si
 * son varios, la del CRM —o la del único campus, en un CRM de una sola marca
 * como ISEIE—. Es el criterio de «Tu semana» de las gestoras (`cabeceraPara`
 * en jobs/correosDelEquipo.js): con varios, poner uno sería decir que es de ese.
 *
 * QA de Diego, 22/10, punto 9: «todo correo con la plantilla y la marca del campus».
 * Devuelve `{ proyecto, projectId, campus }` para `correo()` y `sendEmail()`.
 */
export async function marcaDelTutor(tutorId) {
  let { rows } = await query(
    `SELECT DISTINCT p.id, p.nombre, p.slug, p.logo_url, p.emoji
       FROM tutor_campus tc
       JOIN projects p ON p.id = tc.project_id
       JOIN project_integrations pi ON pi.project_id = p.id AND pi.provider = 'moodle'
        AND pi.active AND COALESCE((pi.config_public->>'consultas')::boolean, false)
      WHERE tc.tutor_id = $1 AND tc.estado = 'activa'`, [tutorId]);
  if (rows.length !== 1) {
    ({ rows } = await query(
      `SELECT id, nombre, slug, logo_url, emoji FROM projects
        WHERE active AND NOT COALESCE(es_prueba, false)`));
    if (rows.length !== 1) return { proyecto: {}, projectId: null, campus: null };
  }
  const p = rows[0];
  return {
    proyecto: { nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji },
    projectId: Number(p.id),
    campus: p.nombre,
  };
}

/** `tutorIds`: solo esos tutores (null = todos). */
export async function recordarCargas({ ahora = new Date(), enviar = sendEmail, tutorIds = null } = {}) {
  const r = { recordatorios: 0, correos: 0, frenados: 0 };
  for (const t of await cargasPorRecordar(ahora, tutorIds)) {
    const texto = t.ultima
      ? `Hace más de ${DIAS_CARGA} días que no la actualizas.`
      : 'Aún no la has indicado.';
    await notifyUsers({
      targetUserIds: [Number(t.id)],
      type: 'carga_desactualizada',
      title: 'Actualiza tu carga de trabajo',
      message: `${texto} Cuenta en qué estás y elige el nivel.`,
      link_path: '/consultas/carga',
      metadata: { tutor_id: Number(t.id) },
    });
    if (NO_ESCRIBIR_A_TUTORES) {
      r.frenados += 1;
      logger.info({ tutorId: t.id }, 'consultas: recordatorio de carga sin enviar por correo (freno de correos a tutores)');
    } else if (t.email) {
      const marca = await marcaDelTutor(t.id);
      const { htmlContent, textContent } = correo({
        proyecto: marca.proyecto,
        titulo: 'Actualiza tu carga de trabajo',
        saludo: t.nombre || null,
        resumen: texto,
        bloques: [
          parrafo(`${texto} Administración la mira antes de asignarte más alumnos o campus.`),
          boton({ texto: 'Actualizar mi carga', url: enlace('consultas/carga') }),
        ],
      });
      const e = await enviar({
        to: t.email, subject: `[${marca.campus || 'CRM'}] Actualiza tu carga de trabajo`, htmlContent, textContent,
        tags: ['consultas', 'tutor', 'carga'], projectId: marca.projectId, clave: `consultas-carga-${t.id}-${ahora.toISOString().slice(0, 10)}`,
      }).catch((err) => ({ sent: false, error: err.message }));
      if (e?.sent) r.correos += 1;
    }
    await query(
      `INSERT INTO tutor_carga_recordatorios (tutor_id, ultimo_at) VALUES ($1, $2)
       ON CONFLICT (tutor_id) DO UPDATE SET ultimo_at = EXCLUDED.ultimo_at`, [t.id, ahora]);
    r.recordatorios += 1;
  }
  return r;
}
