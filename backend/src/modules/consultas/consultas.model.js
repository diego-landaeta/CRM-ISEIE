/*
  CONSULTAS DE ALUMNOS · FASE 2 (#188): lo que se guarda.

  Una consulta es la conversación de un alumno con su tutor sobre un campus. Se
  abre con el primer mensaje del alumno, pasa a «respondida» cuando contesta el
  tutor y se cierra a mano. Si el alumno vuelve a escribir, se reabre (y si
  estaba respondida, vuelve a «abierta»: el alumno espera otra vez).

  Cada paso deja su hora en la consulta y una fila en `consulta_eventos`:
  entrada, asignación, primera lectura, primera respuesta, cierre y reapertura.
  Es lo que pide la #188 y lo que medirá la fase 3.
*/
import { query, getClient } from '../../shared/config/db.js';

/** Lo que se pide al campus: el plazo de primera respuesta, en horas (decisión 1). */
export const PLAZO_HORAS = Number(process.env.CONSULTAS_PLAZO_HORAS || 24);

export async function enTransaccion(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function evento(db, consultaId, tipo, { userId = null, detalle = null } = {}) {
  await db.query(
    'INSERT INTO consulta_eventos (consulta_id, tipo, user_id, detalle) VALUES ($1, $2, $3, $4)',
    [consultaId, tipo, userId, detalle ? JSON.stringify(detalle) : null]
  );
}

/** ¿Ya está este mensaje del campus? (el mismo mensaje dos veces no se duplica) */
export async function existeMensajeExterno(projectId, externoId) {
  const { rows } = await query(
    'SELECT 1 FROM consulta_mensajes WHERE project_id = $1 AND externo_id = $2', [projectId, externoId]);
  return rows.length > 0;
}

/** El último mensaje del campus que ya está guardado de una conversación: desde ahí se sigue leyendo. */
export async function ultimoDeLaConversacion(projectId, conversacionId) {
  const { rows } = await query(
    `SELECT MAX(m.escrito_at) AS hasta
       FROM consulta_mensajes m
       JOIN consultas c ON c.id = m.consulta_id
      WHERE c.project_id = $1 AND (c.conversacion_externa_id = $2 OR $2 = ANY(c.conversaciones_extra))
        AND m.externo_id IS NOT NULL`,
    [projectId, conversacionId]
  );
  return rows[0]?.hasta || null;
}

/**
 * Mete un mensaje del ALUMNO. Abre la consulta si no hay ninguna, la reabre si
 * estaba cerrada y la devuelve a «abierta» si estaba respondida.
 *
 * `elegirTutor()` solo se llama si hay que asignar: consulta nueva, o una que se
 * reabre con su tutor ya fuera (no disponible, sin matrícula).
 *
 * Devuelve `{ duplicado }` o `{ consulta, nueva, reabierta }`.
 */
export async function guardarMensajeDelAlumno({
  projectId, conversacionId, alumno, curso = null, texto, externoId, escritoAt, origen = 'moodle',
}, elegirTutor) {
  return enTransaccion(async (db) => {
    if (externoId != null) {
      const ya = await db.query(
        'SELECT 1 FROM consulta_mensajes WHERE project_id = $1 AND externo_id = $2', [projectId, externoId]);
      if (ya.rows.length) return { duplicado: true };
    }
    const fecha = escritoAt || new Date();
    const previa = await db.query(
      `SELECT * FROM consultas
        WHERE project_id = $1 AND alumno_moodle_id = $2
          AND (conversacion_externa_id = $3 OR $3 = ANY(conversaciones_extra)
               OR ($3::bigint IS NULL AND conversacion_externa_id IS NULL))
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [projectId, alumno.moodleId, conversacionId]
    );
    let c = previa.rows[0];
    let nueva = false;
    let reabierta = false;

    if (!c) {
      const tutorId = await elegirTutor();
      const r = await db.query(
        `INSERT INTO consultas (project_id, issuer_id, alumno_moodle_id, alumno_nombre, alumno_email,
                                curso_moodle_id, curso_nombre, tutor_id, estado, origen,
                                conversacion_externa_id, entrada_at, asignada_at, espera_desde)
         SELECT $1, p.sociedad_emisora_id, $2, $3, $4, $5, $6, $7, 'abierta', $8, $9, $10,
                CASE WHEN $7::int IS NULL THEN NULL ELSE NOW() END, $10
           FROM projects p WHERE p.id = $1
         RETURNING *`,
        [projectId, alumno.moodleId, alumno.nombre || null, alumno.email || null,
         curso?.moodleId || null, curso?.nombre || null, tutorId, origen, conversacionId, fecha]
      );
      c = r.rows[0];
      nueva = true;
      await evento(db, c.id, 'entrada', { detalle: { origen } });
      if (tutorId) await evento(db, c.id, 'asignada', { detalle: { tutor_id: tutorId, automatica: true } });
    } else {
      const cambios = [];
      const valores = [c.id];
      const valor = (v) => { valores.push(v); return `$${valores.length}`; };
      if (c.estado === 'cerrada') {
        reabierta = true;
        const f = valor(fecha);
        cambios.push(`estado = 'abierta'`, `reabierta_at = ${f}`, `espera_desde = ${f}`, 'cerrada_at = NULL');
      } else if (c.estado === 'respondida') {
        cambios.push(`estado = 'abierta'`, `espera_desde = ${valor(fecha)}`);
      }
      // Datos del alumno que no se tenían (el correo llega aparte).
      if (!c.alumno_email && alumno.email) cambios.push(`alumno_email = ${valor(alumno.email)}`);
      if (cambios.length) {
        const r = await db.query(
          `UPDATE consultas SET ${cambios.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, valores);
        c = r.rows[0];
      }
      if (reabierta) await evento(db, c.id, 'reabierta');
      // Al reabrir, si su tutor ya no puede (no disponible, sin matrícula), a otro.
      if (reabierta || !c.tutor_id) {
        const tutorId = await elegirTutor(c.tutor_id);
        if (tutorId && tutorId !== c.tutor_id) {
          const r = await db.query(
            'UPDATE consultas SET tutor_id = $2, asignada_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
            [c.id, tutorId]);
          await evento(db, c.id, c.tutor_id ? 'reasignada' : 'asignada',
            { detalle: { de: c.tutor_id, a: tutorId, automatica: true } });
          c = r.rows[0];
        }
      }
    }

    await db.query(
      `INSERT INTO consulta_mensajes (consulta_id, project_id, autor, texto, externo_id, escrito_at)
       VALUES ($1, $2, 'alumno', $3, $4, $5)`,
      [c.id, projectId, texto, externoId ?? null, fecha]
    );
    return { consulta: c, nueva, reabierta };
  });
}

/**
 * Una respuesta del tutor que se escribió en el CAMPUS (no en el CRM): cuenta
 * igual para la primera respuesta. Si no hay consulta, no se abre ninguna: un
 * tutor que escribe primero no es una consulta (eso es la fase 3).
 */
export async function guardarRespuestaDesdeElCampus({ projectId, conversacionId, alumnoMoodleId, tutorId, texto, externoId, escritoAt }) {
  return enTransaccion(async (db) => {
    const ya = await db.query(
      'SELECT 1 FROM consulta_mensajes WHERE project_id = $1 AND externo_id = $2', [projectId, externoId]);
    if (ya.rows.length) return { duplicado: true };
    const { rows } = await db.query(
      `SELECT * FROM consultas WHERE project_id = $1 AND alumno_moodle_id = $2
          AND (conversacion_externa_id = $3 OR $3 = ANY(conversaciones_extra))
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [projectId, alumnoMoodleId, conversacionId]
    );
    const c = rows[0];
    if (!c) return { sinConsulta: true };
    await db.query(
      `INSERT INTO consulta_mensajes (consulta_id, project_id, autor, autor_user_id, texto, externo_id, escrito_at, enviado_campus_at)
       VALUES ($1, $2, 'tutor', $3, $4, $5, $6, $6)`,
      [c.id, projectId, tutorId, texto, externoId, escritoAt]
    );
    await marcarRespondida(db, c, tutorId, escritoAt, { desde: 'campus' });
    return { consulta: c };
  });
}

async function marcarRespondida(db, c, tutorId, cuando, detalle) {
  if (c.estado !== 'abierta') return;
  await db.query(
    `UPDATE consultas
        SET estado = 'respondida', espera_desde = NULL,
            primera_respuesta_at = COALESCE(primera_respuesta_at, $2), updated_at = NOW()
      WHERE id = $1`,
    [c.id, cuando]
  );
  await evento(db, c.id, 'respondida', { userId: tutorId, detalle });
}

/** Una respuesta escrita en el CRM. Se guarda ya; el envío al campus va aparte. */
export async function guardarRespuestaDelCrm(consultaId, tutorId, texto) {
  return enTransaccion(async (db) => {
    const { rows } = await db.query('SELECT * FROM consultas WHERE id = $1 FOR UPDATE', [consultaId]);
    const c = rows[0];
    if (!c) return null;
    const m = await db.query(
      `INSERT INTO consulta_mensajes (consulta_id, project_id, autor, autor_user_id, texto, escrito_at)
       VALUES ($1, $2, 'tutor', $3, $4, NOW()) RETURNING *`,
      [c.id, c.project_id, tutorId, texto]
    );
    await marcarRespondida(db, c, tutorId, new Date(), { desde: 'crm' });
    return { consulta: c, mensaje: m.rows[0] };
  });
}

export async function apuntarEnvio(mensajeId, { externoId = null, error = null, conversacionId = null }, db = null) {
  const hacer = async (q) => {
    if (externoId != null) {
      // Si la lectura del campus ya ha guardado este mismo mensaje (entre el
      // envío y este apunte), esa copia sobra: el mensaje es este.
      await q.query(
        `DELETE FROM consulta_mensajes
          WHERE externo_id = $2 AND id <> $1
            AND project_id = (SELECT project_id FROM consulta_mensajes WHERE id = $1)`, [mensajeId, externoId]);
    }
    const { rows } = await q.query(
      `UPDATE consulta_mensajes
          SET externo_id = COALESCE($2, externo_id),
              enviado_campus_at = CASE WHEN $2::bigint IS NULL THEN enviado_campus_at ELSE NOW() END,
              error_envio = $3, intentos = intentos + 1
        WHERE id = $1 RETURNING consulta_id`,
      [mensajeId, externoId, error]
    );
    // La conversación de Moodle donde ha ido (tras reasignar, la del tutor nuevo).
    if (conversacionId != null && rows[0]) {
      await q.query(
        `UPDATE consultas
            SET conversacion_externa_id = COALESCE(conversacion_externa_id, $2),
                conversaciones_extra = CASE
                  WHEN conversacion_externa_id IS NULL OR conversacion_externa_id = $2 OR $2 = ANY(conversaciones_extra)
                  THEN conversaciones_extra ELSE array_append(conversaciones_extra, $2) END
          WHERE id = $1`, [rows[0].consulta_id, conversacionId]);
    }
  };
  if (db) return hacer(db);
  return enTransaccion(hacer);
}

export async function guardarAdjunto(mensajeId, { nombre, tipo, tamano, storageKey, token, expiraAt }) {
  const { rows } = await query(
    `INSERT INTO consulta_adjuntos (mensaje_id, nombre, tipo, tamano, storage_key, token_descarga, expira_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, nombre, tipo, tamano, token_descarga, expira_at`,
    [mensajeId, nombre, tipo, tamano, storageKey, token, expiraAt]
  );
  return rows[0];
}

export async function adjuntoPorToken(token) {
  const { rows } = await query(
    'SELECT * FROM consulta_adjuntos WHERE token_descarga = $1 AND expira_at > NOW()', [token]);
  return rows[0] || null;
}

export async function adjuntoPorId(id) {
  const { rows } = await query(
    `SELECT a.*, c.id AS consulta_id, c.tutor_id, c.project_id
       FROM consulta_adjuntos a
       JOIN consulta_mensajes m ON m.id = a.mensaje_id
       JOIN consultas c ON c.id = m.consulta_id
      WHERE a.id = $1`, [id]);
  return rows[0] || null;
}

export async function marcarLeida(consultaId, userId) {
  const { rows } = await query(
    `UPDATE consultas SET primera_lectura_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND primera_lectura_at IS NULL AND tutor_id = $2 RETURNING id`,
    [consultaId, userId]
  );
  if (rows.length) await evento({ query }, consultaId, 'leida', { userId });
}

export async function cerrar(consultaId, userId) {
  const { rows } = await query(
    `UPDATE consultas SET estado = 'cerrada', cerrada_at = NOW(), espera_desde = NULL, updated_at = NOW()
      WHERE id = $1 AND estado <> 'cerrada' RETURNING id`, [consultaId]);
  if (rows.length) await evento({ query }, consultaId, 'cerrada', { userId });
  return rows.length > 0;
}

export async function reasignar(consultaId, tutorId, porQuien) {
  const { rows } = await query(
    `UPDATE consultas c SET tutor_id = $2, asignada_at = NOW(), primera_lectura_at = NULL, updated_at = NOW()
       FROM (SELECT tutor_id AS antes FROM consultas WHERE id = $1) a
      WHERE c.id = $1 RETURNING a.antes`,
    [consultaId, tutorId]
  );
  if (rows.length) {
    await evento({ query }, consultaId, 'reasignada', { userId: porQuien, detalle: { de: rows[0].antes, a: tutorId } });
  }
  return rows.length > 0;
}

/** Cuántas abiertas tiene cada tutor (para el reparto: al que menos). */
export async function abiertasPorTutor(tutorIds) {
  if (!tutorIds.length) return new Map();
  const { rows } = await query(
    `SELECT tutor_id, COUNT(*)::int AS n, MAX(asignada_at) AS ultima
       FROM consultas WHERE tutor_id = ANY($1::int[]) AND estado <> 'cerrada'
      GROUP BY tutor_id`, [tutorIds]);
  return new Map(rows.map((r) => [Number(r.tutor_id), { n: r.n, ultima: r.ultima }]));
}

const COLUMNAS_LISTA = `
  c.id, c.project_id, p.nombre AS campus, c.issuer_id, COALESCE(ii.alias, ii.razon_social) AS empresa,
  c.alumno_nombre, c.alumno_email, c.curso_nombre, c.tutor_id, u.nombre AS tutor, c.estado, c.origen,
  c.entrada_at, c.asignada_at, c.primera_lectura_at, c.primera_respuesta_at, c.cerrada_at, c.reabierta_at,
  c.espera_desde,
  (SELECT LEFT(m.texto, 160) FROM consulta_mensajes m WHERE m.consulta_id = c.id ORDER BY m.escrito_at DESC, m.id DESC LIMIT 1) AS ultimo_mensaje,
  (SELECT COUNT(*)::int FROM consulta_mensajes m WHERE m.consulta_id = c.id AND m.autor = 'tutor'
                                                   AND m.enviado_campus_at IS NULL) AS sin_enviar`;

/**
 * La lista: la bandeja de un tutor (`tutorId`) o el panel de administración
 * (`projectIds`, filtros). Las abiertas primero y, dentro, por antigüedad: la
 * que más lleva esperando, arriba. Después las respondidas y las cerradas, las más
 * recientes arriba: antes iban también de la más antigua a la más nueva y, pasado el
 * tope, las que no salían eran justo las últimas.
 *
 * Cada fila lleva `total`: cuántas encajan con el filtro aunque pasen del tope, para que
 * la pantalla diga cuántas no se ven en vez de callárselo.
 */
export async function listar({ tutorId = null, projectIds = null, estado = null, sinTutor = false, buscar = null, limite = 200 } = {}) {
  const where = [];
  const p = [];
  if (tutorId) { p.push(tutorId); where.push(`c.tutor_id = $${p.length}`); }
  if (projectIds) { p.push(projectIds); where.push(`c.project_id = ANY($${p.length}::int[])`); }
  if (estado === 'pendientes') where.push(`c.estado = 'abierta'`);
  else if (estado) { p.push(estado); where.push(`c.estado = $${p.length}`); }
  if (sinTutor) where.push('c.tutor_id IS NULL');
  if (buscar) {
    p.push(`%${buscar}%`);
    // Sin acentos (#591): «maria» encuentra «María». Necesita la 235.
    where.push(`(unaccent(COALESCE(c.alumno_nombre, '')) ILIKE unaccent($${p.length}) OR c.alumno_email ILIKE $${p.length} OR unaccent(COALESCE(c.curso_nombre, '')) ILIKE unaccent($${p.length}))`);
  }
  p.push(Math.min(Number(limite) || 200, 500));
  const { rows } = await query(
    `SELECT ${COLUMNAS_LISTA}, COUNT(*) OVER ()::int AS total
       FROM consultas c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN invoice_issuers ii ON ii.id = c.issuer_id
       LEFT JOIN users u ON u.id = c.tutor_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (c.estado = 'abierta') DESC, (c.estado = 'respondida') DESC,
               CASE WHEN c.estado = 'abierta' THEN COALESCE(c.espera_desde, c.entrada_at) END ASC,
               COALESCE(c.espera_desde, c.entrada_at) DESC, c.id DESC
      LIMIT $${p.length}`,
    p
  );
  return rows;
}

export async function detalle(id) {
  const { rows } = await query(
    `SELECT ${COLUMNAS_LISTA}, c.conversacion_externa_id, c.alumno_moodle_id
       FROM consultas c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN invoice_issuers ii ON ii.id = c.issuer_id
       LEFT JOIN users u ON u.id = c.tutor_id
      WHERE c.id = $1`, [id]);
  const c = rows[0];
  if (!c) return null;
  const [mensajes, adjuntos, eventos] = await Promise.all([
    query(
      `SELECT m.id, m.autor, m.autor_user_id, u.nombre AS autor_nombre, m.texto, m.escrito_at,
              m.enviado_campus_at, m.error_envio, (m.externo_id IS NOT NULL) AS en_el_campus
         FROM consulta_mensajes m LEFT JOIN users u ON u.id = m.autor_user_id
        WHERE m.consulta_id = $1 ORDER BY m.escrito_at, m.id`, [id]),
    query(
      `SELECT a.id, a.mensaje_id, a.nombre, a.tipo, a.tamano
         FROM consulta_adjuntos a JOIN consulta_mensajes m ON m.id = a.mensaje_id
        WHERE m.consulta_id = $1 ORDER BY a.id`, [id]),
    query(
      `SELECT e.tipo, e.at, e.detalle, u.nombre AS quien
         FROM consulta_eventos e LEFT JOIN users u ON u.id = e.user_id
        WHERE e.consulta_id = $1 ORDER BY e.at, e.id`, [id]),
  ]);
  const porMensaje = new Map();
  for (const a of adjuntos.rows) {
    if (!porMensaje.has(a.mensaje_id)) porMensaje.set(a.mensaje_id, []);
    porMensaje.get(a.mensaje_id).push(a);
  }
  return {
    ...c,
    mensajes: mensajes.rows.map((m) => ({ ...m, adjuntos: porMensaje.get(m.id) || [] })),
    eventos: eventos.rows,
  };
}

/** Lo justo para decidir permisos: de quién es y de qué campus. */
export async function cabecera(id) {
  const { rows } = await query(
    'SELECT id, project_id, tutor_id, estado, alumno_moodle_id, conversacion_externa_id FROM consultas WHERE id = $1', [id]);
  return rows[0] || null;
}
