import { query } from '../../shared/config/db.js';

/*
  Convocatorias y ofrecimientos (#86).

  La convocatoria es la campaña —CETLAT, y las que vengan—; el ofrecimiento es
  lo que le pasó a UNA persona con ella. El descuento y las dos fechas viven en
  el ofrecimiento, no en la campaña: «son aleatorias porque el proceso de venta
  decide cuánto dar».

  «Si compró» NO se guarda: se deduce de sus ventas posteriores al
  ofrecimiento. Un dato copiado que hay que mantener a mano acaba
  contradiciendo al original.
*/

// Compró después de que se le ofreciera. Sin contar mensualidades: pagar la
// cuota de algo que ya tenía no es haber comprado por la beca.
const COMPRO = `EXISTS (
  SELECT 1 FROM conversions cv
   WHERE cv.lead_id = o.lead_id
     AND cv.es_mensualidad IS NOT TRUE
     AND cv.fecha_conversion >= o.ofrecida_at::date)`;

const COLS = `id, project_id, nombre, descripcion, activa,
              tope_nueva, tope_habilitada, nota_interna, created_at, updated_at`;

export async function listar(projectId, { incluirInactivas = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLS},
            (SELECT count(*)::int FROM convocatoria_ofrecimientos o
              WHERE o.convocatoria_id = convocatorias.id) AS ofrecimientos
       FROM convocatorias
      WHERE project_id = $1 ${incluirInactivas ? '' : 'AND activa = true'}
      ORDER BY activa DESC, nombre`,
    [projectId]
  );
  return rows;
}

export async function porId(id) {
  const { rows } = await query(`SELECT ${COLS} FROM convocatorias WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function crear(projectId, d) {
  const { rows } = await query(
    `INSERT INTO convocatorias (project_id, nombre, descripcion, tope_nueva, tope_habilitada, nota_interna)
     VALUES ($1, $2, $3, COALESCE($4, 40), COALESCE($5, 70), $6)
     RETURNING ${COLS}`,
    [projectId, d.nombre, d.descripcion || null, d.tope_nueva, d.tope_habilitada, d.nota_interna || null]
  );
  return rows[0];
}

export async function editar(id, projectId, d) {
  const { rows } = await query(
    `UPDATE convocatorias
        SET nombre = COALESCE($3, nombre),
            descripcion = COALESCE($4, descripcion),
            activa = COALESCE($5, activa),
            tope_nueva = COALESCE($6, tope_nueva),
            tope_habilitada = COALESCE($7, tope_habilitada),
            nota_interna = COALESCE($8, nota_interna),
            updated_at = NOW()
      WHERE id = $1 AND project_id = $2
      RETURNING ${COLS}`,
    [id, projectId, d.nombre ?? null, d.descripcion ?? null, d.activa ?? null,
      d.tope_nueva ?? null, d.tope_habilitada ?? null, d.nota_interna ?? null]
  );
  return rows[0] || null;
}

// ── OFRECIMIENTOS ───────────────────────────────────────────────────────────

const COLS_OFR = `o.id, o.convocatoria_id, o.lead_id, o.project_id, o.ofrecida_at,
                  o.ofrecida_por, o.canal, o.fecha_limite, o.fecha_resultado,
                  o.solicitud_llenada, o.solicitud_at, o.descuento, o.resultado,
                  o.nota, o.created_at, o.updated_at`;

export async function ofrecer(convocatoriaId, d) {
  const { rows } = await query(
    `INSERT INTO convocatoria_ofrecimientos
       (convocatoria_id, lead_id, project_id, ofrecida_por, canal, fecha_limite, fecha_resultado, nota)
     SELECT $1, l.id, l.project_id, $3, $4, $5::date, $6::date, $7
       FROM leads l WHERE l.id = $2 AND l.deleted_at IS NULL
     ON CONFLICT (convocatoria_id, lead_id) DO NOTHING
     RETURNING ${COLS_OFR.replace(/o\./g, '')}`,
    [convocatoriaId, d.leadId, d.ofrecidaPor || null, d.canal || null,
      d.fecha_limite || null, d.fecha_resultado || null, d.nota || null]
  );
  return rows[0] || null;
}

export async function actualizarOfrecimiento(id, d) {
  const { rows } = await query(
    `UPDATE convocatoria_ofrecimientos
        SET solicitud_llenada = COALESCE($2, solicitud_llenada),
            -- La fecha de la solicitud se pone sola la primera vez que se dice
            -- que sí: si hubiera que teclearla, no la pondría nadie.
            solicitud_at = CASE WHEN $2 IS TRUE AND solicitud_at IS NULL THEN NOW()
                                ELSE solicitud_at END,
            descuento = COALESCE($3, descuento),
            resultado = COALESCE($4, resultado),
            fecha_limite = COALESCE($5::date, fecha_limite),
            fecha_resultado = COALESCE($6::date, fecha_resultado),
            nota = COALESCE($7, nota),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLS_OFR.replace(/o\./g, '')}`,
    [id, d.solicitud_llenada ?? null, d.descuento ?? null, d.resultado ?? null,
      d.fecha_limite ?? null, d.fecha_resultado ?? null, d.nota ?? null]
  );
  return rows[0] || null;
}

/** Las convocatorias de una persona, para su ficha. */
export async function ofrecimientosDeLead(leadId) {
  const { rows } = await query(
    `SELECT ${COLS_OFR}, c.nombre AS convocatoria, c.tope_nueva, c.tope_habilitada,
            u.nombre AS ofrecida_por_nombre,
            ${COMPRO} AS compro,
            (o.fecha_resultado IS NOT NULL AND o.fecha_resultado <= CURRENT_DATE
             AND o.resultado = 'pendiente') AS debe_respuesta
       FROM convocatoria_ofrecimientos o
       JOIN convocatorias c ON c.id = o.convocatoria_id
       LEFT JOIN users u ON u.id = o.ofrecida_por
      WHERE o.lead_id = $1
      ORDER BY o.ofrecida_at DESC`,
    [leadId]
  );
  return rows;
}

/**
 * A quién hay que contestarle hoy.
 *
 * Ofrecer una beca, decir «te contesto el 24» y no contestar es peor que no
 * haberla ofrecido. Esto es lo que alimenta ese aviso.
 */
export async function pendientesDeRespuesta({ projectIds, asesoraId }) {
  const par = [];
  let i = 1;
  const pProj = Array.isArray(projectIds) && projectIds.length
    ? `AND o.project_id = ANY($${i++}::int[])` : '';
  if (pProj) par.push(projectIds.map(Number));
  const pAses = asesoraId ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId) par.push(asesoraId);

  const { rows } = await query(
    `SELECT ${COLS_OFR}, c.nombre AS convocatoria, l.nombre AS lead_nombre,
            u.nombre AS gestora,
            (CURRENT_DATE - o.fecha_resultado) AS dias_de_retraso
       FROM convocatoria_ofrecimientos o
       JOIN convocatorias c ON c.id = o.convocatoria_id
       JOIN leads l ON l.id = o.lead_id
       LEFT JOIN users u ON u.id = l.responsable_id
      WHERE l.deleted_at IS NULL
        AND o.resultado = 'pendiente'
        AND o.fecha_resultado IS NOT NULL
        AND o.fecha_resultado <= CURRENT_DATE
        ${pProj} ${pAses}
      ORDER BY o.fecha_resultado, o.id`,
    par
  );
  return rows.map((r) => ({ ...r, dias_de_retraso: Number(r.dias_de_retraso) }));
}

/**
 * EL EMBUDO (#86). Lo que Diego pidió medir, en este orden:
 *
 *   a cuántos se les ofreció → cuántos llenaron la solicitud
 *     → cuánto descuento se les dio → cuántos compraron
 *
 * `sin_saber` no es un cero disfrazado: son los ofrecimientos donde nadie ha
 * dicho todavía si llenó la solicitud. Contarlos como «no la llenó» haría que
 * el embudo pareciera peor de lo que es, y esconde el trabajo que falta.
 */
export async function embudo({ convocatoriaId, projectIds, from, to }) {
  const par = [];
  let i = 1;
  const pConv = convocatoriaId ? `AND o.convocatoria_id = $${i++}` : '';
  if (convocatoriaId) par.push(Number(convocatoriaId));
  const pProj = Array.isArray(projectIds) && projectIds.length
    ? `AND o.project_id = ANY($${i++}::int[])` : '';
  if (pProj) par.push(projectIds.map(Number));
  const pFrom = from ? `AND o.ofrecida_at::date >= $${i++}::date` : '';
  if (from) par.push(from);
  const pTo = to ? `AND o.ofrecida_at::date <= $${i++}::date` : '';
  if (to) par.push(to);

  const { rows } = await query(
    `SELECT count(*)::int AS ofrecidas,
            count(*) FILTER (WHERE o.solicitud_llenada IS TRUE)::int  AS llenaron,
            count(*) FILTER (WHERE o.solicitud_llenada IS FALSE)::int AS no_llenaron,
            count(*) FILTER (WHERE o.solicitud_llenada IS NULL)::int  AS sin_saber,
            count(*) FILTER (WHERE o.descuento IS NOT NULL)::int      AS con_descuento,
            ROUND(AVG(o.descuento) FILTER (WHERE o.descuento IS NOT NULL), 1) AS descuento_medio,
            MAX(o.descuento) AS descuento_maximo,
            count(*) FILTER (WHERE ${COMPRO})::int                    AS compraron,
            count(*) FILTER (WHERE o.resultado = 'pendiente'
                             AND o.fecha_resultado IS NOT NULL
                             AND o.fecha_resultado <= CURRENT_DATE)::int AS deben_respuesta
       FROM convocatoria_ofrecimientos o
      WHERE 1=1 ${pConv} ${pProj} ${pFrom} ${pTo}`,
    par
  );
  const r = rows[0];
  const pct = (n) => (r.ofrecidas > 0 ? Math.round((Number(n) * 1000) / r.ofrecidas) / 10 : 0);
  return {
    ofrecidas: Number(r.ofrecidas),
    llenaron: Number(r.llenaron),
    no_llenaron: Number(r.no_llenaron),
    sin_saber: Number(r.sin_saber),
    con_descuento: Number(r.con_descuento),
    descuento_medio: r.descuento_medio == null ? null : Number(r.descuento_medio),
    descuento_maximo: r.descuento_maximo == null ? null : Number(r.descuento_maximo),
    compraron: Number(r.compraron),
    deben_respuesta: Number(r.deben_respuesta),
    pct_llenaron: pct(r.llenaron),
    pct_compraron: pct(r.compraron),
    // De los que llenaron la solicitud, cuántos compraron. Es la cifra que dice
    // si la beca cierra ventas o solo entretiene.
    pct_compraron_de_los_que_llenaron: Number(r.llenaron) > 0
      ? Math.round((Number(r.compraron) * 1000) / Number(r.llenaron)) / 10 : 0,
  };
}
