import { query, getClient } from '../../shared/config/db.js';

/**
 * Un cambio y su línea del historial, juntos o ninguno (#199): si fallara la
 * del historial, el cambio no se queda hecho a medias. `fn` recibe la conexión
 * y la pasa a cada consulta (`db`).
 */
export async function conTransaccion(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* la conexión ya se cerró */ }
    throw err;
  } finally {
    client.release();
  }
}

/** La consulta, en la conexión de la transacción si la hay. */
const consulta = (db, sql, params) => (db ? db.query(sql, params) : query(sql, params));
import { comoLista, SIN_PRUEBAS } from '../../shared/utils/ambito.js';

/**
 * Un campus, una empresa entera o «Todos» (#199: «por empresa y con "Todos los
 * proyectos", como el resto del CRM»). El mismo helper que Ventas y Reportes;
 * «Todos» sin los proyectos de pruebas.
 */
function alcance(projectId, projectIds, params) {
  const lista = comoLista(projectId, projectIds);
  if (!lista) return SIN_PRUEBAS('m.project_id');
  params.push(lista);
  return `m.project_id = ANY($${params.length}::int[])`;
}

/** El curso de una matrícula: el del formulario (campo propio desde la #198) o, si no viene, el de su venta. */
const CURSO = "COALESCE(m.curso_solicitado, m.datos_admision->>'curso_solicitado', c.producto_contratado)";
/** El día de llegada, en hora de Madrid. */
const DIA_DE_LLEGADA = "(COALESCE(m.webhook_received_at, m.created_at) AT TIME ZONE 'Europe/Madrid')::date";

/**
 * Las columnas de la matrícula para la LISTA: todas menos `datos_admision`.
 *
 * Es el envío entero tal cual llegó (#198), con las imágenes en texto (megas por
 * solicitud): con `m.*` la lista lo traía de la base en cada fila para tirarlo
 * después (en el contrato va solo en la ficha). Se leen del catálogo una vez, así
 * que una columna nueva sale sola. Sin respuesta del catálogo, `m.*` como antes.
 */
let columnasDeLaLista = null;
async function columnasSinElEnvio() {
  if (columnasDeLaLista) return columnasDeLaLista;
  const { rows } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1 AND column_name <> 'datos_admision'
      ORDER BY ordinal_position`, ['matriculas']);
  if (!rows.length) return 'm.*';
  columnasDeLaLista = rows.map((r) => `m."${r.column_name}"`).join(', ');
  return columnasDeLaLista;
}

export async function findAll({ projectId, projectIds = null, estado, search, campusId, curso, desde, hasta, page = 1, limit = 50 }) {
  const params = [];
  const conditions = [alcance(projectId, projectIds, params)];
  let idx = params.length + 1;
  if (estado) { conditions.push(`m.estado = $${idx++}`); params.push(estado); }
  // Los filtros de Diego (#199): curso, campus y fechas. El campus se suma al
  // ámbito, así que uno que no es tuyo no devuelve nada.
  if (campusId) { conditions.push(`m.project_id = $${idx++}`); params.push(campusId); }
  if (curso) { conditions.push(`${CURSO} = $${idx++}`); params.push(curso); }
  if (desde) { conditions.push(`${DIA_DE_LLEGADA} >= $${idx++}::date`); params.push(desde); }
  if (hasta) { conditions.push(`${DIA_DE_LLEGADA} <= $${idx++}::date`); params.push(hasta); }
  // Recortado, igual que en leads: un espacio pegado al nombre vaciaba la lista.
  // Y `%`, `_` y `\` se buscan tal cual (revisión de la #250).
  const termino = typeof search === 'string' ? search.trim() : '';
  if (termino) {
    // La misma persona que enseña la lista: la del prospecto o, si aún no está
    // vinculada, la del formulario (si no, buscarla daba «Ninguna matrícula»).
    // Y también lo que escribió en el formulario (#198): unida a su prospecto por
    // el teléfono, puede haber puesto otro correo, y por ese se la busca.
    conditions.push(`(COALESCE(l.nombre, m.nombre, m.datos_admision->>'nombre') ILIKE $${idx}
      OR COALESCE(l.email, m.email, m.datos_admision->>'email') ILIKE $${idx}
      OR m.nombre ILIKE $${idx} OR m.email ILIKE $${idx}
      OR m.dni ILIKE $${idx} OR m.datos_admision->>'documento' ILIKE $${idx})`);
    params.push(`%${termino.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
    idx++;
  }
  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (page - 1) * limit;
  const { rows: cnt } = await query(
    `SELECT COUNT(*) FROM matriculas m LEFT JOIN leads l ON l.id = m.lead_id LEFT JOIN conversions c ON c.id = m.conversion_id ${where}`, params);
  const total = parseInt(cnt[0].count);
  const columnas = await columnasSinElEnvio();
  const { rows } = await query(
    `SELECT ${columnas},
            -- La persona: la del prospecto y, si aún no está vinculada, la del
            -- formulario (contrato de la #198: persona { nombre, email, telefono }).
            COALESCE(l.nombre, m.nombre, m.datos_admision->>'nombre') as lead_nombre,
            COALESCE(l.email, m.email, m.datos_admision->>'email') as lead_email,
            COALESCE(l.telefono, m.telefono, m.datos_admision->>'telefono') as lead_telefono,
            c.importe_total, c.producto_contratado, u.nombre as validated_by_nombre,
            -- Las columnas de Diego (#199): curso, campus y fecha de llegada.
            ${CURSO} as curso,
            p.nombre as campus_nombre,
            COALESCE(m.webhook_received_at, m.created_at) as recibida_at
     FROM matriculas m
     LEFT JOIN leads l ON l.id = m.lead_id
     LEFT JOIN conversions c ON c.id = m.conversion_id
     LEFT JOIN users u ON u.id = m.validated_by
     LEFT JOIN projects p ON p.id = m.project_id
     ${where}
     -- Primero lo que pide acción (Solicitud y Datos validados) y después por
     -- fecha de llegada (#199, ideas de Diego del 01/10).
     ORDER BY CASE WHEN m.estado IN ('solicitud_admision', 'datos_validados') THEN 0 ELSE 1 END,
              COALESCE(m.webhook_received_at, m.created_at) DESC, m.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );
  return { matriculas: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findById(id) {
  // La ficha (#199): lo de la lista, más la gestora del prospecto y quién validó.
  const { rows } = await query(
    `SELECT m.*,
            COALESCE(l.nombre, m.nombre, m.datos_admision->>'nombre') as lead_nombre,
            COALESCE(l.email, m.email, m.datos_admision->>'email') as lead_email,
            COALESCE(l.telefono, m.telefono, m.datos_admision->>'telefono') as lead_telefono,
            c.importe_total, c.producto_contratado, u.nombre as validated_by_nombre,
            ${CURSO} as curso,
            p.nombre as campus_nombre,
            COALESCE(m.webhook_received_at, m.created_at) as recibida_at,
            g.id as gestora_id, g.nombre as gestora_nombre
     FROM matriculas m
     LEFT JOIN leads l ON l.id = m.lead_id
     LEFT JOIN conversions c ON c.id = m.conversion_id
     LEFT JOIN users u ON u.id = m.validated_by
     LEFT JOIN projects p ON p.id = m.project_id
     LEFT JOIN users g ON g.id = l.responsable_id
     WHERE m.id = $1`, [id]);
  return rows[0] || null;
}

export async function findByConversion(conversionId) {
  const { rows } = await query(`SELECT * FROM matriculas WHERE conversion_id = $1`, [conversionId]);
  return rows[0] || null;
}

export async function create(data) {
  // La matrícula y la primera línea de su historial, juntas (conTransaccion).
  return conTransaccion((db) => crearConHistorial(data, db));
}

async function crearConHistorial(data, db) {
  const dedupe = data.dedupe_key || data.dni || null;
  const { rows } = await consulta(db,
    `INSERT INTO matriculas (project_id, conversion_id, lead_id, dni, titulo, notas, datos_admision, source, dedupe_key, estado, webhook_received_at,
                             nombre, email, telefono, documento_tipo, fecha_nacimiento, direccion, pais, estudios, curso_solicitado, envio_huella)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
    [data.project_id, data.conversion_id || null, data.lead_id || null,
     data.dni || null, data.titulo || null, data.notas || null,
     data.datos_admision ? JSON.stringify(data.datos_admision) : null,
     data.source || 'manual', dedupe,
     data.estado || (data.source === 'webhook' ? 'solicitud_admision' : 'pendiente'),
     data.source === 'webhook' ? new Date() : null,
     // Los datos de la persona en campos propios (#198, migración 213).
     data.nombre || null, data.email || null, data.telefono || null, data.documento_tipo || null,
     data.fecha_nacimiento || null, data.direccion || null, data.pais || null, data.estudios || null,
     data.curso_solicitado || null, data.envio_huella || null]
  );
  // El historial empieza aquí: llegó por un formulario (el webhook de admisión o
  // los formularios del CRM, que crean la matrícula por esta misma función) o se
  // creó a mano.
  if (rows[0]) {
    await registrarEvento({
      matriculaId: rows[0].id,
      evento: ['webhook', 'form'].includes(data.source) ? 'recibida' : 'creada',
      userId: data.user_id || null,
      db,
    });
  }
  return rows[0];
}

/**
 * Una línea del historial de una matrícula (#199). No se borra ni se edita.
 * `evento`: 'recibida', 'creada', 'estado' o 'documento'.
 */
export async function registrarEvento({ matriculaId, evento, estado = null, motivo = null, documento = null, reemplazo = false, userId = null, db = null }) {
  await consulta(db,
    `INSERT INTO matriculas_eventos (matricula_id, evento, estado, motivo, documento, reemplazo, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [matriculaId, evento, estado, motivo, documento, reemplazo, userId]);
}

/** El historial de una matrícula, del más antiguo al más reciente, con el nombre de quien lo hizo. */
export async function historial(matriculaId) {
  const { rows } = await query(
    `SELECT e.evento, e.estado, e.motivo, e.documento, e.reemplazo, e.creado_at, u.nombre AS usuario
       FROM matriculas_eventos e
       LEFT JOIN users u ON u.id = e.user_id
      WHERE e.matricula_id = $1
      ORDER BY e.creado_at, e.id`, [matriculaId]);
  return rows;
}

export async function findByDedupe(projectId, dedupeKey) {
  if (!dedupeKey) return null;
  const { rows } = await query(`SELECT * FROM matriculas WHERE project_id = $1 AND dedupe_key = $2`, [projectId, dedupeKey]);
  return rows[0] || null;
}

export async function update(id, fields, db = null) {
  const allowed = ['dni', 'titulo', 'notas', 'dni_doc_url', 'dni_doc_key', 'titulo_doc_url', 'titulo_doc_key', 'firma_url', 'firma_key',
    // El DNI por detrás y la foto (#199, migración 212).
    'dni_dorso_url', 'dni_dorso_key', 'foto_url', 'foto_key'];
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(fields[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await consulta(db, `UPDATE matriculas SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function setEstado(id, estado, userId, motivo = null, db = null) {
  const { rows } = await consulta(db,
    `UPDATE matriculas
       SET estado = $1, motivo_rechazo = $2,
           validated_by = $3, validated_at = NOW(), updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [estado, estado === 'rechazada' ? motivo : null, userId, id]
  );
  return rows[0];
}

export async function remove(id) {
  await query(`DELETE FROM matriculas WHERE id = $1`, [id]);
}

/** Los cursos que hay en el ámbito, para el filtro «Curso» de la pantalla (#199). */
export async function getCursos({ projectId, projectIds = null }) {
  const params = [];
  const where = alcance(projectId, projectIds, params);
  const { rows } = await query(
    `SELECT DISTINCT ${CURSO} AS curso
       FROM matriculas m LEFT JOIN conversions c ON c.id = m.conversion_id
      WHERE ${where} AND ${CURSO} IS NOT NULL
      ORDER BY 1`, params);
  return rows.map((r) => r.curso);
}

/**
 * Los campus entre los que se puede filtrar (#199): los del ámbito. Con «Todos»
 * del CRM entero, sin los de pruebas, que la lista no enseña: elegir uno daba
 * siempre vacío.
 */
export async function getCampus({ projectId, projectIds = null }) {
  const lista = comoLista(projectId, projectIds);
  const { rows } = lista
    ? await query('SELECT id, nombre FROM projects WHERE id = ANY($1::int[]) ORDER BY nombre', [lista])
    : await query('SELECT id, nombre FROM projects WHERE NOT COALESCE(es_prueba, false) ORDER BY nombre');
  return rows;
}

export async function getStats({ projectId, projectIds = null, campusId = null }) {
  const params = [];
  let where = alcance(projectId, projectIds, params);
  // Con un campus filtrado, las cifras de ese campus (si no, no cuadraban con la lista).
  if (campusId) { params.push(campusId); where += ` AND m.project_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE estado = 'solicitud_admision') as solicitudes,
       COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes,
       COUNT(*) FILTER (WHERE estado = 'validada') as validadas,
       COUNT(*) FILTER (WHERE estado = 'rechazada') as rechazadas
     FROM matriculas m WHERE ${where}`, params);
  return rows[0];
}
