import { query, getClient } from '../../shared/config/db.js';

/*
  Monitask (#236) · el SQL. Migración 296.

  `ambito` es la lista de empresas (invoice_issuers) de quien pide, o null para el
  superadmin (todas): la misma regla que las facturas de colaboradores (#202).
  Una persona de Monitask está en el ámbito si su colaborador factura a una de esas
  empresas o si su usuario del CRM trabaja en un campus de una de ellas.
*/

const EN_AMBITO = (p, alias = 'mp') => `(
  ${p}::int[] IS NULL
  OR EXISTS (SELECT 1 FROM colaborador_empresas ce
              WHERE ce.colaborador_id = ${alias}.colaborador_id AND ce.issuer_id = ANY(${p}::int[]))
  OR EXISTS (SELECT 1 FROM user_projects up JOIN projects pr ON pr.id = up.project_id
              WHERE up.user_id = ${alias}.user_id AND up.active = true AND pr.sociedad_emisora_id = ANY(${p}::int[]))
)`;

// ─── La conexión (una fila) ─────────────────────────────────────────────────

export async function conexion() {
  const { rows } = await query(
    `SELECT c.*, u.nombre AS conectada_por_nombre,
            to_char(c.cubierto_desde, 'YYYY-MM-DD') AS cubierto_desde_txt,
            to_char(c.ultima_nocturna, 'YYYY-MM-DD') AS ultima_nocturna_txt
       FROM monitask_conexion c
       LEFT JOIN users u ON u.id = c.conectada_por
      WHERE c.id = 1`
  );
  return rows[0] || null;
}

/** La aplicación OAuth. El secreto solo se cambia si viene; el margen, igual. */
export async function guardarApp({ clientId, secreto, margenPct, userId }) {
  const { rows } = await query(
    `INSERT INTO monitask_conexion (id, client_id, secreto_cifrado, secreto_iv, secreto_tag, secreto_cola, margen_pct, updated_by)
     VALUES (1, $1, $2, $3, $4, $5, COALESCE($6::numeric, 10), $7)
     ON CONFLICT (id) DO UPDATE SET
       client_id       = COALESCE(EXCLUDED.client_id, monitask_conexion.client_id),
       secreto_cifrado = COALESCE($2, monitask_conexion.secreto_cifrado),
       secreto_iv      = COALESCE($3, monitask_conexion.secreto_iv),
       secreto_tag     = COALESCE($4, monitask_conexion.secreto_tag),
       secreto_cola    = COALESCE($5, monitask_conexion.secreto_cola),
       margen_pct      = COALESCE($6::numeric, monitask_conexion.margen_pct),
       updated_by      = $7,
       updated_at      = NOW()
     RETURNING id`,
    [clientId ?? null, secreto?.encrypted ?? null, secreto?.iv ?? null, secreto?.authTag ?? null,
      secreto?.cola ?? null, margenPct ?? null, userId ?? null]
  );
  return rows[0];
}

/** Cambiar de aplicación invalida los tokens de la anterior. */
export async function borrarTokens() {
  await query(
    `UPDATE monitask_conexion
        SET access_cifrado = NULL, access_iv = NULL, access_tag = NULL, access_caduca_at = NULL,
            refresh_cifrado = NULL, refresh_iv = NULL, refresh_tag = NULL,
            conectada_at = NULL, conectada_por = NULL, updated_at = NOW()
      WHERE id = 1`
  );
}

/** Todo: la aplicación y los tokens. Lo ya traído (personas, días) se queda. */
export async function borrarTodo() {
  await query(`DELETE FROM monitask_conexion WHERE id = 1`);
}

export async function guardarEstadoOAuth({ stateHash, verifier, caducaAt, userId }) {
  await query(
    `UPDATE monitask_conexion
        SET oauth_state_hash = $1, oauth_verifier_cifrado = $2, oauth_verifier_iv = $3,
            oauth_verifier_tag = $4, oauth_caduca_at = $5, oauth_iniciado_por = $6
      WHERE id = 1`,
    [stateHash, verifier.encrypted, verifier.iv, verifier.authTag, caducaAt, userId]
  );
}

/**
 * El «Conectar» en curso con esa huella de `state`, y se borra en el mismo paso:
 * vale una sola vez. null si no hay ninguno con esa huella.
 */
export async function tomarEstadoOAuth(stateHash) {
  const { rows } = await query(
    `UPDATE monitask_conexion c
        SET oauth_state_hash = NULL, oauth_verifier_cifrado = NULL, oauth_verifier_iv = NULL,
            oauth_verifier_tag = NULL, oauth_caduca_at = NULL, oauth_iniciado_por = NULL
       FROM (SELECT oauth_verifier_cifrado, oauth_verifier_iv, oauth_verifier_tag, oauth_caduca_at, oauth_iniciado_por
               FROM monitask_conexion WHERE id = 1 AND oauth_state_hash = $1 FOR UPDATE) o
      WHERE c.id = 1
      RETURNING o.*`,
    [stateHash]
  );
  return rows[0] || null;
}

/** Los tokens nuevos. Sin refresh nuevo, se queda el que había. */
export async function guardarTokens({ access, caducaAt, refresh, conectadaPor = null, nuevaConexion = false }) {
  await query(
    `UPDATE monitask_conexion
        SET access_cifrado = $1, access_iv = $2, access_tag = $3, access_caduca_at = $4,
            refresh_cifrado = COALESCE($5, refresh_cifrado),
            refresh_iv      = COALESCE($6, refresh_iv),
            refresh_tag     = COALESCE($7, refresh_tag),
            conectada_at    = CASE WHEN $9::boolean THEN NOW() ELSE conectada_at END,
            conectada_por   = CASE WHEN $9::boolean THEN $8::int ELSE conectada_por END,
            ultimo_error = NULL, ultimo_error_at = NULL,
            updated_at = NOW()
      WHERE id = 1`,
    [access.encrypted, access.iv, access.authTag, caducaAt,
      refresh?.encrypted ?? null, refresh?.iv ?? null, refresh?.authTag ?? null, conectadaPor, !!nuevaConexion]
  );
}

export async function apuntarError(mensaje) {
  await query(
    `UPDATE monitask_conexion SET ultimo_error = $1, ultimo_error_at = NOW() WHERE id = 1`,
    [String(mensaje || '').slice(0, 1000)]
  );
}

/**
 * Apunta la vuelta. Con `cubierto` (una vuelta sin fallos), además, desde qué día
 * hay datos: los avisos de la campana solo miran meses enteros que estén cubiertos.
 */
export async function apuntarSincronizacion(resultado, { nocturna = null, cubierto = null } = {}) {
  await query(
    `UPDATE monitask_conexion
        SET ultima_sync_at = NOW(), ultima_sync_resultado = $1::jsonb,
            ultima_nocturna = COALESCE($2::date, ultima_nocturna),
            cubierto_desde = CASE WHEN $3::date IS NULL THEN cubierto_desde
                                  ELSE LEAST(COALESCE(cubierto_desde, $3::date), $3::date) END
      WHERE id = 1`,
    [JSON.stringify(resultado || {}), nocturna, cubierto]
  );
}

// ─── Personas ───────────────────────────────────────────────────────────────

export async function guardarPersona({ id, nombre, correo }) {
  await query(
    `INSERT INTO monitask_personas (monitask_id, nombre, correo, vista_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (monitask_id) DO UPDATE
       SET nombre = EXCLUDED.nombre, correo = EXCLUDED.correo, vista_at = NOW()`,
    [id, nombre, correo]
  );
}

/**
 * Empareja por correo a las que nadie ha emparejado todavía: primero con la ficha
 * de colaborador (#202) y, si no, con un usuario del CRM (y por él, con su ficha de
 * colaborador si la tiene). Lo hecho a mano —también «no es nadie»— no se toca.
 * Devuelve cuántas se han emparejado.
 */
export async function emparejarPorCorreo() {
  const { rowCount } = await query(
    `WITH candidatas AS (
       SELECT mp.monitask_id,
              (SELECT c.id FROM colaboradores c WHERE lower(c.email) = mp.correo
                ORDER BY c.activo DESC, c.id DESC LIMIT 1) AS col_por_correo,
              (SELECT u.id FROM users u WHERE lower(u.email) = mp.correo
                ORDER BY u.active DESC, u.id DESC LIMIT 1) AS usuario
         FROM monitask_personas mp
        WHERE mp.emparejado IS NULL AND mp.correo IS NOT NULL
     ), resueltas AS (
       SELECT ca.monitask_id,
              COALESCE(ca.col_por_correo,
                       (SELECT c.id FROM colaboradores c WHERE c.user_id = ca.usuario
                         ORDER BY c.activo DESC, c.id DESC LIMIT 1)) AS colaborador_id,
              COALESCE(ca.usuario,
                       (SELECT c.user_id FROM colaboradores c WHERE c.id = ca.col_por_correo)) AS user_id
         FROM candidatas ca
     )
     UPDATE monitask_personas mp
        SET colaborador_id = r.colaborador_id, user_id = r.user_id,
            emparejado = 'correo', emparejado_at = NOW(), emparejado_por = NULL
       FROM resueltas r
      WHERE mp.monitask_id = r.monitask_id
        AND (r.colaborador_id IS NOT NULL OR r.user_id IS NOT NULL)`
  );
  return rowCount;
}

/** Emparejar a mano. Con `ninguno`, «no es nadie del CRM». Sin nada, vuelve a «sin emparejar». */
export async function emparejarAMano(monitaskId, { colaboradorId, userId, ninguno, por }) {
  const sinNada = !ninguno && !colaboradorId && !userId;
  const { rows } = await query(
    `UPDATE monitask_personas
        SET colaborador_id = $2, user_id = $3,
            emparejado = $4, emparejado_por = $5, emparejado_at = CASE WHEN $6::boolean THEN NULL ELSE NOW() END
      WHERE monitask_id = $1
      RETURNING monitask_id`,
    [monitaskId, ninguno ? null : (colaboradorId || null), ninguno ? null : (userId || null),
      ninguno ? 'ninguno' : (sinNada ? null : 'manual'), sinNada ? null : (por ?? null), sinNada]
  );
  return rows[0] || null;
}

export async function existeColaborador(id) {
  const { rows } = await query(`SELECT user_id FROM colaboradores WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function existeUsuario(id) {
  const { rows } = await query(`SELECT id FROM users WHERE id = $1`, [id]);
  return rows.length > 0;
}

/** Las personas de Monitask, con quién están emparejadas. Para «Emparejar». */
export async function listarPersonas() {
  const { rows } = await query(
    `SELECT mp.monitask_id, mp.nombre, mp.correo, mp.emparejado, mp.emparejado_at, mp.vista_at,
            mp.colaborador_id, c.nombre AS colaborador_nombre, c.email AS colaborador_correo,
            mp.user_id, u.nombre AS usuario_nombre, u.email AS usuario_correo,
            ep.nombre AS emparejado_por_nombre,
            (SELECT MAX(d.dia) FROM monitask_dias d WHERE d.monitask_id = mp.monitask_id) AS ultimo_dia
       FROM monitask_personas mp
       LEFT JOIN colaboradores c ON c.id = mp.colaborador_id
       LEFT JOIN users u ON u.id = mp.user_id
       LEFT JOIN users ep ON ep.id = mp.emparejado_por
      ORDER BY (mp.emparejado IS NULL) DESC, mp.nombre`
  );
  return rows;
}

/** A quién se puede emparejar: las fichas de colaborador y los usuarios activos. */
export async function candidatos() {
  const [col, usu] = await Promise.all([
    query(`SELECT id, nombre, email, activo, user_id FROM colaboradores ORDER BY activo DESC, nombre`),
    query(`SELECT id, nombre, email, role FROM users WHERE active = true ORDER BY nombre`),
  ]);
  return { colaboradores: col.rows, usuarios: usu.rows };
}

// ─── Los días ───────────────────────────────────────────────────────────────

/**
 * Sustituye los días de [desde, hasta] de una persona por los que se acaban de
 * traer: volver a sincronizar no suma dos veces, y un día que Monitask ya no
 * tiene (una entrada borrada) desaparece también aquí.
 */
export async function guardarDias(monitaskId, desde, hasta, dias) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM monitask_dias WHERE monitask_id = $1 AND dia BETWEEN $2::date AND $3::date`,
      [monitaskId, desde, hasta]
    );
    for (const [dia, r] of Object.entries(dias)) {
      await client.query(
        `INSERT INTO monitask_dias (monitask_id, dia, segundos, segundos_activos, actividad_pct, entradas, proyectos, tareas)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
        [monitaskId, dia, r.segundos, r.segundosActivos, r.actividadPct, r.entradas,
          JSON.stringify(r.proyectos || []), JSON.stringify(r.tareas || [])]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── «Qué se está haciendo» ─────────────────────────────────────────────────

/**
 * Por persona, entre dos días: horas, horas activas y % de actividad, y sus
 * proyectos. `proyecto` filtra a quien ha trabajado en un proyecto que se llame así.
 */
export async function actividadPorPersona({ desde, hasta, ambito, monitaskId = null, proyecto = null }) {
  const filtroProyecto = proyecto ? `%${String(proyecto).replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
  const { rows } = await query(
    `SELECT mp.monitask_id, mp.nombre, mp.correo,
            mp.colaborador_id, c.nombre AS colaborador_nombre,
            mp.user_id, u.nombre AS usuario_nombre,
            COALESCE(SUM(d.segundos), 0)::int AS segundos,
            SUM(d.segundos_activos)::int AS segundos_activos,
            COALESCE(SUM(d.segundos) FILTER (WHERE d.segundos_activos IS NOT NULL), 0)::int AS segundos_medidos,
            COUNT(d.dia) FILTER (WHERE d.segundos > 0)::int AS dias
       FROM monitask_personas mp
       LEFT JOIN monitask_dias d ON d.monitask_id = mp.monitask_id AND d.dia BETWEEN $1::date AND $2::date
       LEFT JOIN colaboradores c ON c.id = mp.colaborador_id
       LEFT JOIN users u ON u.id = mp.user_id
      WHERE ${EN_AMBITO('$3')}
        AND ($4::bigint IS NULL OR mp.monitask_id = $4)
        AND ($5::text IS NULL OR EXISTS (
              SELECT 1 FROM monitask_dias d2, jsonb_array_elements(d2.proyectos) p
               WHERE d2.monitask_id = mp.monitask_id AND d2.dia BETWEEN $1::date AND $2::date
                 AND p->>'nombre' ILIKE $5))
        AND COALESCE(mp.emparejado, '') <> 'ninguno'
      GROUP BY mp.monitask_id, c.nombre, u.nombre
      ORDER BY segundos DESC, mp.nombre`,
    [desde, hasta, ambito, monitaskId, filtroProyecto]
  );
  return rows;
}

/** Los proyectos (y tareas) de unas personas entre dos días, sumados. */
export async function proyectosDe({ ids, desde, hasta }) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT d.monitask_id, p->>'nombre' AS nombre, SUM((p->>'segundos')::int)::int AS segundos
       FROM monitask_dias d, jsonb_array_elements(d.proyectos) p
      WHERE d.monitask_id = ANY($1::bigint[]) AND d.dia BETWEEN $2::date AND $3::date
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC`,
    [ids, desde, hasta]
  );
  return rows;
}

export async function diasDe({ monitaskId, desde, hasta }) {
  const { rows } = await query(
    `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, segundos, segundos_activos, actividad_pct, entradas, proyectos, tareas
       FROM monitask_dias
      WHERE monitask_id = $1 AND dia BETWEEN $2::date AND $3::date
      ORDER BY dia`,
    [monitaskId, desde, hasta]
  );
  return rows;
}

/** ¿Esta persona está en el ámbito de quien pide? */
export async function personaEnAmbito(monitaskId, ambito) {
  const { rows } = await query(
    `SELECT mp.monitask_id, mp.nombre FROM monitask_personas mp
      WHERE mp.monitask_id = $1 AND ${EN_AMBITO('$2')}`,
    [monitaskId, ambito]
  );
  return rows[0] || null;
}

// ─── El cotejo con las facturas (#202) ──────────────────────────────────────

/**
 * Los colaboradores del ámbito que ese mes tienen factura o persona de Monitask,
 * con sus facturas del mes (todas las vivas: el total de horas cuenta las de todas
 * las empresas, aunque solo se enseñen las del ámbito) y sus horas de Monitask.
 */
export async function datosDelCotejo({ periodo, ambito, colaboradorId = null }) {
  const colaboradores = (await query(
    `SELECT c.id, c.nombre, c.email,
            EXISTS (SELECT 1 FROM monitask_personas mp WHERE mp.colaborador_id = c.id) AS con_monitask
       FROM colaboradores c
      WHERE ($2::int IS NULL OR c.id = $2)
        AND ($3::int[] IS NULL OR EXISTS (SELECT 1 FROM colaborador_empresas ce
                                           WHERE ce.colaborador_id = c.id AND ce.issuer_id = ANY($3::int[])))
        AND (EXISTS (SELECT 1 FROM monitask_personas mp WHERE mp.colaborador_id = c.id)
             OR EXISTS (SELECT 1 FROM facturas_colaborador f
                         WHERE f.colaborador_id = c.id AND f.periodo = $1::date AND f.anulada_at IS NULL
                           AND f.subida_at IS NOT NULL))
      ORDER BY c.nombre`,
    [periodo, colaboradorId, ambito]
  )).rows;
  const ids = colaboradores.map((c) => c.id);
  if (!ids.length) return { colaboradores: [], facturas: [], horas: [] };

  const [facturas, horas] = await Promise.all([
    query(
      `SELECT f.id, f.colaborador_id, f.issuer_id, ii.razon_social AS empresa,
              f.horas, f.subida_at, f.pagada_at, f.numero_factura, f.numero_recepcion,
              ce.modalidad,
              ($3::int[] IS NULL OR f.issuer_id = ANY($3::int[])) AS en_ambito
         FROM facturas_colaborador f
         JOIN invoice_issuers ii ON ii.id = f.issuer_id
         LEFT JOIN colaborador_empresas ce ON ce.colaborador_id = f.colaborador_id AND ce.issuer_id = f.issuer_id
        WHERE f.colaborador_id = ANY($1::int[]) AND f.periodo = $2::date
          AND f.anulada_at IS NULL AND f.subida_at IS NOT NULL
        ORDER BY f.colaborador_id, ii.razon_social`,
      [ids, periodo, ambito]
    ),
    query(
      `SELECT mp.colaborador_id,
              COALESCE(SUM(d.segundos), 0)::int AS segundos,
              SUM(d.segundos_activos)::int AS segundos_activos,
              COALESCE(SUM(d.segundos) FILTER (WHERE d.segundos_activos IS NOT NULL), 0)::int AS segundos_medidos,
              COUNT(DISTINCT d.dia) FILTER (WHERE d.segundos > 0)::int AS dias
         FROM monitask_personas mp
         JOIN monitask_dias d ON d.monitask_id = mp.monitask_id
        WHERE mp.colaborador_id = ANY($1::int[])
          AND d.dia >= $2::date AND d.dia < ($2::date + interval '1 month')
        GROUP BY mp.colaborador_id`,
      [ids, periodo]
    ),
  ]);
  return { colaboradores, facturas: facturas.rows, horas: horas.rows };
}

/** Las facturas sin pagar de meses cerrados que pueden necesitar aviso (aún sin avisar). */
export async function facturasParaAvisar({ desdePeriodo, hastaPeriodo }) {
  const { rows } = await query(
    `SELECT DISTINCT f.colaborador_id, to_char(f.periodo, 'YYYY-MM-DD') AS periodo
       FROM facturas_colaborador f
      WHERE f.anulada_at IS NULL AND f.subida_at IS NOT NULL AND f.pagada_at IS NULL
        AND f.horas IS NOT NULL
        AND f.periodo BETWEEN $1::date AND $2::date
        AND NOT EXISTS (SELECT 1 FROM monitask_avisos a WHERE a.factura_id = f.id)
        AND EXISTS (SELECT 1 FROM monitask_personas mp WHERE mp.colaborador_id = f.colaborador_id)`,
    [desdePeriodo, hastaPeriodo]
  );
  return rows;
}

/** Apunta el aviso. false si ya estaba (otra vuelta se adelantó). */
export async function apuntarAviso({ facturaId, horasFacturadas, horasMonitask, diferenciaPct }) {
  const { rowCount } = await query(
    `INSERT INTO monitask_avisos (factura_id, horas_facturadas, horas_monitask, diferencia_pct)
     VALUES ($1, $2, $3, $4) ON CONFLICT (factura_id) DO NOTHING`,
    [facturaId, horasFacturadas, horasMonitask, diferenciaPct]
  );
  return rowCount > 0;
}
