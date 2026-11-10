import { query, getClient } from '../../shared/config/db.js';

/*
  Los tickets de soporte (#38).

  LA FORMA QUE SE DEVUELVE ES LA QUE YA ESPERA LA PANTALLA

  El frontal lleva escrito el tipo `Ticket` desde que se hizo la pantalla, con
  su nota: «la forma de los datos esta diseñada para migrar sin tocar la UI».
  Asi que el modelo traduce aqui —`titulo` a `title`, `estado` a `status`— en
  vez de obligar a cambiar tres componentes. La traduccion vive en UN sitio.
*/

/** Una fila de la base, con la forma que espera la pantalla. */
function comoLoEsperaLaPantalla(r) {
  if (!r) return null;
  return {
    id: String(r.id),
    kind: r.kind,
    severity: r.severity,
    status: r.estado,
    title: r.titulo,
    description: r.descripcion || '',
    steps: r.pasos || '',
    expected: r.esperado || '',
    actual: r.observado || '',
    whyItMatters: r.por_que_importa || '',
    url: r.url || '',
    projectId: r.project_id,
    projectName: r.proyecto_nombre || null,
    autor: r.autor_nombre || null,
    autorId: r.abierto_por,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // Los dos instantes, para que la pantalla pueda restar sin que el servidor
    // le mande una duracion que se queda vieja.
    primeraRespuestaAt: r.primera_respuesta_at,
    cerradoAt: r.cerrado_at,
    comments: [],
    attachments: [],
  };
}

const SELECT = `
  SELECT t.*, u.nombre AS autor_nombre, p.nombre AS proyecto_nombre
    FROM tickets t
    LEFT JOIN users u ON u.id = t.abierto_por
    LEFT JOIN projects p ON p.id = t.project_id`;

export async function crear({
  abiertoPor, projectId, kind, severity, title, description,
  steps, expected, actual, whyItMatters, url,
}) {
  const { rows } = await query(
    `INSERT INTO tickets (abierto_por, project_id, kind, severity, titulo,
                          descripcion, pasos, esperado, observado, por_que_importa, url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [abiertoPor, projectId, kind, severity, title, description,
      steps, expected, actual, whyItMatters, url]
  );
  return porId(rows[0].id);
}

export async function porId(id) {
  const { rows } = await query(`${SELECT} WHERE t.id = $1`, [id]);
  return comoLoEsperaLaPantalla(rows[0]);
}

/**
 * El listado.
 *
 * `soloDe` recorta por autor. Lo decide el controlador segun el rol: quien no
 * administra ve los SUYOS. Un ticket puede llevar dentro una captura con datos
 * de un cliente, asi que no es una lista para todo el mundo.
 */
export async function listar({ estado, kind, projectId, alcance = null, page = 1, limit = 50 }) {
  const cond = [];
  const params = [];
  let i = 1;
  if (estado) { cond.push(`t.estado = $${i++}`); params.push(estado); }
  if (kind) { cond.push(`t.kind = $${i++}`); params.push(kind); }
  if (projectId) { cond.push(`t.project_id = $${i++}`); params.push(projectId); }
  // El alcance de quien pregunta: los tickets que abrio el y los de sus campus.
  // Una lista de campus vacia deja solo los suyos; sin alcance (`null`), todos.
  if (alcance) {
    cond.push(`(t.abierto_por = $${i++} OR t.project_id = ANY($${i++}::int[]))`);
    params.push(alcance.userId, (alcance.projectIds || []).map(Number));
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';

  const { rows: cnt } = await query(
    `SELECT COUNT(*)::int AS n FROM tickets t ${where}`, params);

  const offset = (page - 1) * limit;
  const { rows } = await query(
    `${SELECT} ${where} ORDER BY t.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset]
  );
  return {
    tickets: rows.map(comoLoEsperaLaPantalla),
    total: cnt[0].n,
    page,
    limit,
    totalPages: Math.ceil(cnt[0].n / limit),
  };
}

export async function mensajesDe(ticketId, { incluirInternas = true } = {}) {
  const { rows } = await query(
    `SELECT m.id, m.cuerpo AS body, m.interna, m.created_at AS "createdAt",
            m.autor_id AS "autorId", u.nombre AS autor
       FROM ticket_mensajes m
       LEFT JOIN users u ON u.id = m.autor_id
      WHERE m.ticket_id = $1 ${incluirInternas ? '' : 'AND NOT m.interna'}
      ORDER BY m.created_at`, [ticketId]);
  return rows;
}

export async function adjuntosDe(ticketId) {
  const { rows } = await query(
    `SELECT id, nombre AS name, mime, bytes AS size, created_at AS "createdAt"
       FROM ticket_adjuntos WHERE ticket_id = $1 ORDER BY id`, [ticketId]);
  return rows;
}

/**
 * Añade un mensaje y, si es la PRIMERA respuesta de alguien que no abrio el
 * ticket, deja apuntado cuando fue.
 *
 * Va en una transaccion porque son dos escrituras que tienen que cuadrar: si
 * se guardara el mensaje y fallara el sello, el tiempo de respuesta se
 * calcularia sobre el mensaje siguiente y saldria mas alto que la realidad.
 */
export async function responder(ticketId, autorId, cuerpo, interna = false) {
  // Un cliente DEDICADO: con `query` (pool.query) cada llamada puede salir por
  // otra conexion, y entonces BEGIN, las escrituras y COMMIT no son la misma
  // transaccion y no hay atomicidad. Mismo patron que el reparto de leads.
  const c = await getClient();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(
      `INSERT INTO ticket_mensajes (ticket_id, autor_id, cuerpo, interna)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [ticketId, autorId, cuerpo, interna]
    );
    // Una nota interna no cuenta como respuesta: no la ve quien pregunto.
    if (!interna) {
      await c.query(
        `UPDATE tickets
            SET primera_respuesta_at = COALESCE(primera_respuesta_at, NOW())
          WHERE id = $1 AND abierto_por IS DISTINCT FROM $2`,
        [ticketId, autorId]
      );
    }
    await c.query('UPDATE tickets SET updated_at = NOW() WHERE id = $1', [ticketId]);
    await c.query('COMMIT');
    return rows[0].id;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export async function cambiarEstado(id, estado) {
  // El `::text` no es adorno: `$2` se usa como valor de una columna VARCHAR y
  // dentro de un IN, y sin el cast Postgres no deduce un tipo unico — responde
  // «inconsistent types deduced for parameter $2» y el UPDATE no escribe nada.
  // Con la respuesta ignorada, el ticket se quedaba abierto en silencio.
  const { rows } = await query(
    `UPDATE tickets
        SET estado = $2::text,
            cerrado_at = CASE
              WHEN $2::text IN ('resolved','closed') THEN COALESCE(cerrado_at, NOW())
              -- Se BORRA al reabrir: un ticket reabierto que conserva su fecha
              -- de cierre cuenta como resuelto en los tiempos mientras sigue
              -- abierto, y el numero deja de describir nada.
              ELSE NULL
            END,
            updated_at = NOW()
      WHERE id = $1 RETURNING id`, [id, estado]);
  return rows.length ? porId(id) : null;
}

export async function guardarAdjunto({ ticketId, mensajeId, nombre, clave, mime, bytes, subidoPor }) {
  const { rows } = await query(
    `INSERT INTO ticket_adjuntos (ticket_id, mensaje_id, nombre, clave, mime, bytes, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, nombre AS name, mime, bytes AS size`,
    [ticketId, mensajeId, nombre, clave, mime, bytes, subidoPor]
  );
  return rows[0];
}

/** Las claves en disco de los adjuntos de un ticket, para borrarlas con el. */
export async function clavesDeAdjuntos(ticketId) {
  const { rows } = await query('SELECT clave FROM ticket_adjuntos WHERE ticket_id = $1', [ticketId]);
  return rows.map((r) => r.clave);
}

export async function adjuntoPorId(id) {
  const { rows } = await query(
    `SELECT a.*, t.abierto_por, t.project_id AS ticket_project_id FROM ticket_adjuntos a
       JOIN tickets t ON t.id = a.ticket_id
      WHERE a.id = $1`, [id]);
  return rows[0] || null;
}

/**
 * A quien avisar de un ticket nuevo: quien ve todo el CRM (superadmin y
 * soporte) y los admins con ese campus. Sin campus, solo los primeros: un admin
 * de campus no ve un ticket ajeno sin proyecto (ver `alcanza` del controlador).
 */
export async function destinatariosDelAviso(projectId) {
  const { rows } = await query(
    `SELECT u.id FROM users u
      WHERE u.active = true
        AND (u.role IN ('superadmin', 'soporte')
             OR (u.role = 'admin' AND $1::int IS NOT NULL AND EXISTS (
                   SELECT 1 FROM user_projects up
                    WHERE up.user_id = u.id AND up.project_id = $1::int AND up.active = true)))
      ORDER BY u.id`,
    [projectId ?? null]);
  return rows.map((r) => r.id);
}

/** ¿Existe ese proyecto? Para que una clave foranea rota no salga como un 500. */
export async function proyectoExiste(id) {
  const { rowCount } = await query('SELECT 1 FROM projects WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Cuanto se tarda en responder y en cerrar (#38, ultima subfase).
 *
 * Se calcula RESTANDO los instantes, no leyendo una duracion guardada: una
 * duracion se queda vieja en cuanto alguien corrige una fecha.
 *
 * Y se usa la MEDIANA, no la media: un ticket olvidado tres semanas mueve la
 * media lo bastante como para que el numero deje de describir el dia a dia.
 */
export async function tiempos({ projectId = null, projectIds = null } = {}) {
  const params = [];
  const cond = [];
  if (projectId) { params.push(projectId); cond.push(`project_id = $${params.length}`); }
  // Un admin mide solo sus campus: la lista recorta aunque no pida ninguno.
  if (projectIds) { params.push(projectIds.map(Number)); cond.push(`project_id = ANY($${params.length}::int[])`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE estado IN ('open','in_review'))::int AS abiertos,
       COUNT(*) FILTER (WHERE primera_respuesta_at IS NULL
                          AND estado IN ('open','in_review'))::int AS sin_responder,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (primera_respuesta_at - created_at))
       ) FILTER (WHERE primera_respuesta_at IS NOT NULL) AS mediana_respuesta_seg,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (cerrado_at - created_at))
       ) FILTER (WHERE cerrado_at IS NOT NULL) AS mediana_cierre_seg
     FROM tickets ${where}`, params);
  const r = rows[0];
  return {
    total: r.total,
    abiertos: r.abiertos,
    sinResponder: r.sin_responder,
    medianaRespuestaSeg: r.mediana_respuesta_seg === null ? null : Math.round(Number(r.mediana_respuesta_seg)),
    medianaCierreSeg: r.mediana_cierre_seg === null ? null : Math.round(Number(r.mediana_cierre_seg)),
  };
}

/**
 * Borrar un ticket.
 *
 * Los mensajes y adjuntos caen en cascada por la migracion, pero los ficheros
 * del disco NO: quien llama pide antes `clavesDeAdjuntos` y los borra despues.
 * (`documentOrphanScheduler` barra otro directorio —los PDF de documentos— y
 * no los recoge: sin esto se quedaban huerfanos para siempre.)
 */
export async function borrar(id) {
  const { rowCount } = await query('DELETE FROM tickets WHERE id = $1', [id]);
  return rowCount > 0;
}
