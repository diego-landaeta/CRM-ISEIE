import { query } from '../../shared/config/db.js';

/**
 * Lo que hace falta de una persona para escribirle: a quién, de qué marca y por
 * qué formación preguntó. La marca sale del CAMPUS (logo y color), que es lo que
 * la persona reconoce: preguntó en la web de ISEIH, no en «el CRM».
 */
export async function datosDelLead(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.status, l.project_id, l.responsable_id, l.deleted_at,
            p.nombre AS proyecto, p.logo_url, p.theme_color, COALESCE(p.es_prueba, false) AS es_prueba,
            pr.nombre AS producto
       FROM leads l
       JOIN projects p ON p.id = l.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
      WHERE l.id = $1`,
    [leadId]);
  return rows[0] || null;
}

/**
 * La fila del envío. Si la persona ya tiene una, NO entra otra: lo impide la
 * base (UNIQUE lead_id) y aquí se devuelve null para que quien llama lo sepa.
 */
export async function crearEnvio({ leadId, projectId, gestoraId, disparador, estado, token, email, pedidoPor }) {
  const { rows } = await query(
    `INSERT INTO feedback_envios (lead_id, project_id, gestora_id, disparador, estado, token, email, pedido_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (lead_id) DO NOTHING
     RETURNING *`,
    [leadId, projectId, gestoraId, disparador, estado, token, email, pedidoPor]);
  return rows[0] || null;
}

export async function marcarEnvio(id, { estado, enviado = false, nota = null }) {
  const { rows } = await query(
    `UPDATE feedback_envios
        SET estado = $2,
            enviado_at = CASE WHEN $3 THEN NOW() ELSE enviado_at END,
            nota_envio = $4,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, estado, enviado, nota]);
  return rows[0] || null;
}

export async function porLead(leadId) {
  const { rows } = await query('SELECT * FROM feedback_envios WHERE lead_id = $1', [leadId]);
  return rows[0] || null;
}

/** La encuesta, desde el enlace del correo: con la marca para pintarla. */
export async function porToken(token) {
  const { rows } = await query(
    `SELECT f.*, l.nombre AS lead_nombre, p.nombre AS proyecto, p.logo_url, p.theme_color,
            pr.nombre AS producto
       FROM feedback_envios f
       JOIN leads l ON l.id = f.lead_id
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
      WHERE f.token = $1`,
    [token]);
  return rows[0] || null;
}

/**
 * La respuesta. Solo entra la PRIMERA: quien abre el enlace dos veces y contesta
 * otra cosa no reescribe lo que dijo, que es lo que ya vio su gestora.
 */
export async function guardarRespuesta(id, { motivo, comentario }) {
  const { rows } = await query(
    `UPDATE feedback_envios
        SET motivo = $2, comentario = $3, respondido_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND respondido_at IS NULL
      RETURNING *`,
    [id, motivo, comentario]);
  return rows[0] || null;
}

/**
 * A quién le toca el correo del 7.º día.
 *
 * Entró hace entre 7 y 10 días —no «hace 7 o más»: si el servidor estuvo parado
 * un día se recupera, pero encender esto no escribe de golpe a toda la base
 * antigua—, no ha comprado, no ha dicho que no, tiene correo y no se le ha
 * preguntado nunca. Los campus de pruebas no entran.
 */
export async function candidatosDelDia7({ tope = 300 } = {}) {
  const { rows } = await query(
    `SELECT l.id
       FROM leads l
       JOIN projects p ON p.id = l.project_id AND NOT COALESCE(p.es_prueba, false)
      WHERE l.deleted_at IS NULL
        AND l.status NOT IN ('convertido', 'no_interesado')
        AND NULLIF(TRIM(l.email), '') IS NOT NULL
        AND COALESCE(l.fecha_solicitud, l.created_at)::date
              BETWEEN CURRENT_DATE - 10 AND CURRENT_DATE - 7
        AND NOT EXISTS (SELECT 1 FROM feedback_envios f WHERE f.lead_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM conversions c WHERE c.lead_id = l.id)
      ORDER BY l.id
      LIMIT $1`,
    [tope]);
  return rows.map((r) => r.id);
}

/**
 * El recorte del panel y de su lista, en un solo sitio: si los números y la
 * lista de detrás se filtraran distinto, el «12» de arriba abriría 14 nombres.
 *
 *   · campus    : los que lleguen (un campus o los de una empresa); sin ninguno,
 *                 todos menos los de pruebas.
 *   · gestora   : una gestora solo ve lo suyo; un admin puede elegir una.
 *   · deUsuario : un admin que no es superadmin, solo sus campus.
 *   · fechas    : por el día en que SALIÓ el correo.
 */
function recorte({ projectIds, gestoraId, deUsuario, desde, hasta }, par) {
  const trozos = [];
  if (Array.isArray(projectIds) && projectIds.length) {
    par.push(projectIds.map(Number));
    trozos.push(`AND f.project_id = ANY($${par.length}::int[])`);
  } else {
    trozos.push('AND f.project_id NOT IN (SELECT id FROM projects WHERE COALESCE(es_prueba, false))');
  }
  if (gestoraId) {
    par.push(Number(gestoraId));
    trozos.push(`AND f.gestora_id = $${par.length}`);
  }
  if (deUsuario) {
    par.push(Number(deUsuario));
    trozos.push(`AND EXISTS (SELECT 1 FROM user_projects up
                              WHERE up.user_id = $${par.length} AND up.project_id = f.project_id AND up.active)`);
  }
  if (desde) {
    par.push(desde);
    trozos.push(`AND COALESCE(f.enviado_at, f.created_at)::date >= $${par.length}::date`);
  }
  if (hasta) {
    par.push(hasta);
    trozos.push(`AND COALESCE(f.enviado_at, f.created_at)::date <= $${par.length}::date`);
  }
  return trozos.join('\n        ');
}

/**
 * Las cifras del panel: enviados, respondidos y todo su desglose.
 *
 * «Enviados» son los que SALIERON (estado enviado). Los parados por el freno,
 * los que esperan revisión y los que no tenían correo se cuentan aparte: si
 * sumaran como enviados, el porcentaje de respuesta mentiría a la baja.
 */
export async function panel(filtros) {
  const par = [];
  const DONDE = recorte(filtros, par);
  const base = `FROM feedback_envios f
       LEFT JOIN users u ON u.id = f.gestora_id
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE true
        ${DONDE}`;

  const [totales, porMotivo, porDisparador, porCampus, porGestora, porMes] = await Promise.all([
    query(
      `SELECT count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos,
              count(*) FILTER (WHERE f.estado = 'revision')::int AS en_revision,
              count(*) FILTER (WHERE f.estado = 'bloqueado')::int AS bloqueados,
              count(*) FILTER (WHERE f.estado = 'sin_correo')::int AS sin_correo,
              count(*) FILTER (WHERE f.estado = 'fallido')::int AS fallidos
         ${base}`, par),
    query(
      `SELECT f.motivo AS clave, count(*)::int AS n
         ${base}
          AND f.respondido_at IS NOT NULL
        GROUP BY f.motivo
        ORDER BY n DESC`, par),
    query(
      `SELECT f.disparador AS clave,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
        GROUP BY f.disparador
        ORDER BY enviados DESC`, par),
    query(
      `SELECT f.project_id, p.nombre,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
        GROUP BY f.project_id, p.nombre
        ORDER BY enviados DESC, p.nombre`, par),
    query(
      `SELECT f.gestora_id, COALESCE(u.nombre, 'Sin gestora') AS nombre,
              count(*) FILTER (WHERE f.estado = 'enviado')::int AS enviados,
              count(*) FILTER (WHERE f.estado = 'enviado' AND f.respondido_at IS NOT NULL)::int AS respondidos,
              -- El único motivo que depende de nosotros, a la vista junto a su nombre.
              count(*) FILTER (WHERE f.motivo = 'sin_respuesta')::int AS no_le_contestaron
         ${base}
        GROUP BY f.gestora_id, u.nombre
        ORDER BY enviados DESC, nombre`, par),
    query(
      `SELECT to_char(date_trunc('month', f.enviado_at), 'YYYY-MM') AS mes,
              count(*)::int AS enviados,
              count(*) FILTER (WHERE f.respondido_at IS NOT NULL)::int AS respondidos
         ${base}
          AND f.estado = 'enviado'
        GROUP BY 1
        ORDER BY 1`, par),
  ]);

  return {
    totales: totales.rows[0],
    porMotivo: porMotivo.rows,
    porDisparador: porDisparador.rows,
    porCampus: porCampus.rows,
    porGestora: porGestora.rows,
    porMes: porMes.rows,
  };
}

/**
 * Las personas que hay detrás de un número del panel.
 *
 *   que: enviados | respondidos | revision | bloqueados | sin_correo | fallidos
 *   y, si se abre desde un desglose: motivo, disparador, campus o gestora.
 */
export async function lista(filtros, { que = 'enviados', motivo = null, disparador = null, limite = 500 } = {}) {
  const par = [];
  const DONDE = recorte(filtros, par);
  const QUE = {
    enviados: `AND f.estado = 'enviado'`,
    respondidos: `AND f.estado = 'enviado' AND f.respondido_at IS NOT NULL`,
    revision: `AND f.estado = 'revision'`,
    bloqueados: `AND f.estado = 'bloqueado'`,
    sin_correo: `AND f.estado = 'sin_correo'`,
    fallidos: `AND f.estado = 'fallido'`,
  }[que] || `AND f.estado = 'enviado'`;
  let extra = '';
  if (motivo) { par.push(motivo); extra += ` AND f.motivo = $${par.length}`; }
  if (disparador) { par.push(disparador); extra += ` AND f.disparador = $${par.length}`; }
  par.push(Math.min(Number(limite) || 500, 2000));
  const { rows } = await query(
    `SELECT f.id, f.lead_id, l.nombre AS lead_nombre, f.email, f.project_id, p.nombre AS proyecto,
            u.nombre AS gestora, f.disparador, f.estado, f.enviado_at, f.respondido_at,
            f.motivo, f.comentario, f.nota_envio, f.created_at
       FROM feedback_envios f
       JOIN leads l ON l.id = f.lead_id
       LEFT JOIN users u ON u.id = f.gestora_id
       LEFT JOIN projects p ON p.id = f.project_id
      WHERE true
        ${DONDE}
        ${QUE} ${extra}
      ORDER BY COALESCE(f.respondido_at, f.enviado_at, f.created_at) DESC
      LIMIT $${par.length}`, par);
  return rows;
}
