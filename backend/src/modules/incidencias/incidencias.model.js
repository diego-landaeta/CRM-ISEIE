import { query } from '../../shared/config/db.js';

/*
  Las incidencias (#253).

  La forma que se devuelve es la de la pantalla (camelCase). La traduccion
  vive en UN sitio, como en Soporte (`soporte.model.js`).

  EL ALCANCE LLEGA YA DECIDIDO. Lo calcula `incidencias.service.js` y aqui
  solo se traduce a SQL:

    null                                  todas (superadmin y soporte)
    { tipo: 'campus', userId, projectIds, sociedadIds }
                                          las de sus campus y empresas, y las
                                          que causo, detecto o apunto el
    { tipo: 'propias', userId }           las que causo, detecto o apunto
*/

function comoLaPantalla(r) {
  if (!r) return null;
  return {
    id: r.id,
    ocurrioAt: r.ocurrio_at,
    crm: r.crm,
    projectId: r.project_id,
    projectName: r.proyecto_nombre || null,
    sociedadId: r.sociedad_id,
    sociedadName: r.sociedad_nombre || null,
    tipos: r.tipos || [],
    causadaPor: r.causada_por,
    causadaPorNombre: r.causada_nombre || null,
    detectadaPor: r.detectada_por,
    detectadaPorNombre: r.detectada_nombre || null,
    entidadTipo: r.entidad_tipo,
    entidadId: r.entidad_id,
    // Los rellena `ponerDestinos`, según quién mira.
    entidadVentaId: null,
    entidadNombre: null,
    quePaso: r.que_paso,
    impacto: r.impacto || '',
    comoSeArreglo: r.como_se_arreglo || '',
    arregladaPor: r.arreglada_por,
    arregladaPorNombre: r.arreglada_nombre || null,
    arregladaAt: r.arreglada_at,
    gravedad: r.gravedad,
    estado: r.estado,
    creadaPor: r.creada_por,
    creadaPorNombre: r.creada_nombre || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    adjuntos: [],
  };
}

const SELECT = `
  SELECT i.*,
         p.nombre  AS proyecto_nombre,
         s.razon_social AS sociedad_nombre,
         uc.nombre AS causada_nombre,
         ud.nombre AS detectada_nombre,
         ua.nombre AS arreglada_nombre,
         ucr.nombre AS creada_nombre
    FROM incidencias i
    LEFT JOIN projects p         ON p.id = i.project_id
    LEFT JOIN invoice_issuers s  ON s.id = i.sociedad_id
    LEFT JOIN users uc           ON uc.id = i.causada_por
    LEFT JOIN users ud           ON ud.id = i.detectada_por
    LEFT JOIN users ua           ON ua.id = i.arreglada_por
    LEFT JOIN users ucr          ON ucr.id = i.creada_por`;

/** Columna de la base de cada campo de la pantalla. Solo estos se escriben. */
const COLUMNAS = {
  ocurrioAt: 'ocurrio_at',
  crm: 'crm',
  projectId: 'project_id',
  sociedadId: 'sociedad_id',
  tipos: 'tipos',
  causadaPor: 'causada_por',
  detectadaPor: 'detectada_por',
  entidadTipo: 'entidad_tipo',
  entidadId: 'entidad_id',
  quePaso: 'que_paso',
  impacto: 'impacto',
  comoSeArreglo: 'como_se_arreglo',
  arregladaPor: 'arreglada_por',
  arregladaAt: 'arreglada_at',
  gravedad: 'gravedad',
  estado: 'estado',
};

/**
 * Las condiciones del alcance y de los filtros, con sus parametros.
 * `inicio` es el primer `$n` libre.
 */
function donde({ alcance = null, estado, tipo, causadaPor, projectId, issuerId, meses } = {}, inicio = 1) {
  const cond = [];
  const params = [];
  let i = inicio;
  const p = (v) => { params.push(v); return `$${i++}`; };

  if (alcance?.tipo === 'propias') {
    // La gestora: las que causó o apuntó. Las que solo detectó, no: las causó
    // otra, y verlas es señalarla (`incidencias.service.js · alcanceDe`).
    const yo = p(alcance.userId);
    cond.push(`(i.causada_por = ${yo} OR i.creada_por = ${yo})`);
  } else if (alcance?.tipo === 'campus') {
    const yo = p(alcance.userId);
    const campus = p((alcance.projectIds || []).map(Number));
    const empresas = p((alcance.sociedadIds || []).map(Number));
    // Las sin campus, no: solo superadmin y soporte, y quien está en ella (PR #612).
    cond.push(`(i.project_id = ANY(${campus}::int[]) OR i.sociedad_id = ANY(${empresas}::int[])
               OR i.causada_por = ${yo} OR i.detectada_por = ${yo} OR i.creada_por = ${yo})`);
  }

  if (estado) cond.push(`i.estado = ${p(estado)}`);
  if (tipo) cond.push(`${p(tipo)} = ANY(i.tipos)`);
  if (causadaPor) cond.push(`i.causada_por = ${p(causadaPor)}`);
  if (projectId) cond.push(`i.project_id = ${p(projectId)}`);
  // Una empresa son la apuntada a la empresa y las de cualquiera de sus campus.
  if (issuerId) {
    const e = p(issuerId);
    cond.push(`(i.sociedad_id = ${e}
               OR i.project_id IN (SELECT id FROM projects WHERE sociedad_emisora_id = ${e}))`);
  }
  // Los últimos `meses` meses contando el actual, desde el día 1 en hora de
  // Madrid (en verano es +02:00: no se puede fijar el desfase a mano).
  if (meses) {
    cond.push(`i.ocurrio_at >= (date_trunc('month', NOW() AT TIME ZONE 'Europe/Madrid')
                                - make_interval(months => ${p(meses - 1)})) AT TIME ZONE 'Europe/Madrid'`);
  }

  return { where: cond.length ? `WHERE ${cond.join(' AND ')}` : '', params, siguiente: i };
}

const CERRADAS = ['resolved', 'closed'];

export async function crear(entrada, creadaPor) {
  // Apuntada ya resuelta y sin «cuándo se arregló»: la de ahora, como al cerrarla.
  const datos = { ...entrada };
  if (CERRADAS.includes(datos.estado) && datos.arregladaAt === undefined) datos.arregladaAt = new Date().toISOString();
  const campos = Object.keys(COLUMNAS).filter((k) => datos[k] !== undefined);
  const cols = [...campos.map((k) => COLUMNAS[k]), 'creada_por'];
  const vals = [...campos.map((k) => datos[k]), creadaPor];
  const { rows } = await query(
    `INSERT INTO incidencias (${cols.join(', ')})
     VALUES (${vals.map((_, n) => `$${n + 1}`).join(', ')}) RETURNING id`, vals);
  return porId(rows[0].id);
}

export async function porId(id) {
  const { rows } = await query(`${SELECT} WHERE i.id = $1`, [id]);
  return comoLaPantalla(rows[0]);
}

/**
 * Cambia solo lo que llega. Al cerrar sin fecha de arreglo (al pasar a
 * resuelta o cerrada), se pone la de ahora: «cómo se arregló, por quién y cuándo» no puede quedarse sin cuándo
 * en una incidencia resuelta. Al reabrir NO se borra: el arreglo sigue
 * siendo lo que se intentó, y quien reabre decide si cambia.
 */
export async function editar(id, entrada) {
  // Campus O empresa: si llega uno con valor, el otro se vacía. Si no, un PATCH
  // con solo la empresa dejaba también el campus de antes y no se sabía de cuál era.
  const datos = { ...entrada };
  if (datos.projectId && datos.sociedadId === undefined) datos.sociedadId = null;
  if (datos.sociedadId && datos.projectId === undefined) datos.projectId = null;
  const campos = Object.keys(COLUMNAS).filter((k) => datos[k] !== undefined);
  const sets = campos.map((k, n) => `${COLUMNAS[k]} = $${n + 2}`);
  // Solo cuando PASA a resuelta o cerrada (en el SET, `estado` es el de antes):
  // si ya lo estaba y se borró la fecha a mano, guardar otra cosa no la vuelve a poner.
  if (CERRADAS.includes(datos.estado) && datos.arregladaAt === undefined) {
    sets.push(`arreglada_at = CASE WHEN estado IN ('resolved', 'closed') THEN arreglada_at
                                   ELSE COALESCE(arreglada_at, NOW()) END`);
  }
  sets.push('updated_at = NOW()');
  const { rowCount } = await query(
    `UPDATE incidencias SET ${sets.join(', ')} WHERE id = $1`,
    [id, ...campos.map((k) => datos[k])]);
  return rowCount ? porId(id) : null;
}

export async function listar({ page = 1, limit = 50, ...filtros } = {}) {
  const { where, params, siguiente } = donde(filtros);
  const { rows: cnt } = await query(`SELECT COUNT(*)::int AS n FROM incidencias i ${where}`, params);
  const { rows } = await query(
    `${SELECT} ${where} ORDER BY i.ocurrio_at DESC, i.id DESC
     LIMIT $${siguiente} OFFSET $${siguiente + 1}`,
    [...params, limit, (page - 1) * limit]);
  return {
    incidencias: rows.map(comoLaPantalla),
    total: cnt[0].n,
    page,
    limit,
    totalPages: Math.ceil(cnt[0].n / limit),
  };
}

/**
 * Las cifras: por persona, por tipo y por mes, para decidir formación.
 *
 * Con los MISMOS filtros y el mismo alcance que la lista, para que cuadren:
 * la suma de «por persona» y la de «por mes» es el total de incidencias.
 * «Por tipo» suma más cuando alguna tiene dos tipos (capa 8 + fallo del CRM),
 * y eso se dice en la pantalla en vez de esconderlo.
 *
 * Los meses, en hora de Madrid: una incidencia del 31 a las 23:30 es de ese mes.
 */
export async function metricas(filtros = {}) {
  const { where, params } = donde(filtros);

  const { rows: total } = await query(`SELECT COUNT(*)::int AS n FROM incidencias i ${where}`, params);

  const { rows: porPersona } = await query(
    `SELECT i.causada_por AS "userId", u.nombre,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE 'capa8' = ANY(i.tipos))::int     AS capa8,
            COUNT(*) FILTER (WHERE 'fallo_crm' = ANY(i.tipos))::int AS fallo_crm,
            COUNT(*) FILTER (WHERE 'dato_mal' = ANY(i.tipos))::int  AS dato_mal,
            COUNT(*) FILTER (WHERE 'externo' = ANY(i.tipos))::int   AS externo
       FROM incidencias i
       LEFT JOIN users u ON u.id = i.causada_por
       ${where}
      GROUP BY i.causada_por, u.nombre
      ORDER BY total DESC, u.nombre NULLS LAST`, params);

  const { rows: porTipo } = await query(
    `SELECT t.tipo, COUNT(*)::int AS total
       FROM incidencias i CROSS JOIN LATERAL unnest(i.tipos) AS t(tipo)
       ${where}
      GROUP BY t.tipo ORDER BY total DESC, t.tipo`, params);

  const { rows: porMes } = await query(
    `SELECT to_char(date_trunc('month', i.ocurrio_at AT TIME ZONE 'Europe/Madrid'), 'YYYY-MM') AS mes,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE 'capa8' = ANY(i.tipos))::int     AS capa8,
            COUNT(*) FILTER (WHERE 'fallo_crm' = ANY(i.tipos))::int AS fallo_crm,
            COUNT(*) FILTER (WHERE 'dato_mal' = ANY(i.tipos))::int  AS dato_mal,
            COUNT(*) FILTER (WHERE 'externo' = ANY(i.tipos))::int   AS externo
       FROM incidencias i
       ${where}
      GROUP BY 1 ORDER BY 1`, params);

  return { total: total[0].n, porPersona, porTipo, porMes };
}

export async function adjuntosDe(incidenciaId) {
  const { rows } = await query(
    `SELECT id, nombre AS name, mime, bytes AS size, created_at AS "createdAt"
       FROM incidencia_adjuntos WHERE incidencia_id = $1 ORDER BY id`, [incidenciaId]);
  return rows;
}

export async function guardarAdjunto({ incidenciaId, nombre, clave, mime, bytes, subidoPor }) {
  const { rows } = await query(
    `INSERT INTO incidencia_adjuntos (incidencia_id, nombre, clave, mime, bytes, subido_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, nombre AS name, mime, bytes AS size`,
    [incidenciaId, nombre, clave, mime, bytes, subidoPor]);
  return rows[0];
}

export async function adjuntoPorId(id) {
  const { rows } = await query(
    'SELECT * FROM incidencia_adjuntos WHERE id = $1', [id]);
  return rows[0] || null;
}

/** Las empresas de unos campus: las que ve entera un admin de alguno de ellos. */
export async function sociedadesDeLosCampus(projectIds) {
  if (!projectIds?.length) return [];
  const { rows } = await query(
    `SELECT DISTINCT sociedad_emisora_id AS id FROM projects
      WHERE id = ANY($1::int[]) AND sociedad_emisora_id IS NOT NULL ORDER BY 1`,
    [projectIds.map(Number)]);
  return rows.map((r) => Number(r.id));
}

/**
 * ¿Se puede poner a esta persona? Activa y, con `projectIds`, con alguno de
 * esos campus (o uno mismo). Es la misma regla que la lista de `personas`.
 */
export async function personaQueVale(userId, projectIds, yo) {
  const { rowCount } = await query(
    `SELECT 1 FROM users u
      WHERE u.id = $1 AND u.active
        AND ($2::int[] IS NULL OR u.id = $3 OR EXISTS (
              SELECT 1 FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true AND up.project_id = ANY($2::int[])))`,
    [userId, projectIds ? projectIds.map(Number) : null, yo]);
  return rowCount > 0;
}

/**
 * A dónde lleva «sobre qué» cuando es una factura o un usuario, que no tienen
 * ficha propia. Lo mismo que el buscador (Ctrl K, #591): la factura abre SU
 * VENTA, y el usuario, la pestaña Usuarios con su nombre en el buscador.
 *
 * Solo si es de los campus de quien mira (`projectIds`; null = todo el CRM):
 * con el id de cualquier usuario se sabría el nombre de alguien de otra
 * empresa. Fuera de su alcance se queda en null y el enlace va a la pantalla.
 * El nombre, además, solo con `conNombres` (quien puede abrir Usuarios).
 */
export async function ponerDestinos(incidencias, projectIds, yo, { conNombres = true } = {}) {
  const lista = [].concat(incidencias).filter(Boolean);
  const ids = (tipo) => [...new Set(lista
    .filter((i) => i.entidadTipo === tipo && i.entidadId).map((i) => Number(i.entidadId)))];
  const campus = projectIds ? projectIds.map(Number) : null;
  const ventas = new Map();
  const nombres = new Map();
  if (ids('factura').length) {
    const { rows } = await query(
      `SELECT id, conversion_id FROM invoices
        WHERE id = ANY($1::int[]) AND conversion_id IS NOT NULL
          AND ($2::int[] IS NULL OR project_id = ANY($2::int[]))`, [ids('factura'), campus]);
    for (const r of rows) ventas.set(Number(r.id), Number(r.conversion_id));
  }
  if (conNombres && ids('usuario').length) {
    const { rows } = await query(
      `SELECT u.id, u.nombre FROM users u
        WHERE u.id = ANY($1::int[])
          AND ($2::int[] IS NULL OR u.id = $3 OR EXISTS (
                SELECT 1 FROM user_projects up
                 WHERE up.user_id = u.id AND up.active = true AND up.project_id = ANY($2::int[])))`,
      [ids('usuario'), campus, yo]);
    for (const r of rows) nombres.set(Number(r.id), r.nombre);
  }
  for (const i of lista) {
    i.entidadVentaId = i.entidadTipo === 'factura' ? ventas.get(Number(i.entidadId)) ?? null : null;
    i.entidadNombre = i.entidadTipo === 'usuario' ? nombres.get(Number(i.entidadId)) ?? null : null;
  }
  return incidencias;
}

/**
 * Las personas que se pueden poner como causante, detector o quien la
 * arregló: las mismas que acepta `comprobarReferencias`. Con `projectIds` en
 * null, todas; si no, quien tiene alguno de esos campus, y uno mismo.
 */
export async function personas(projectIds, userId) {
  const { rows } = await query(
    `SELECT u.id, u.nombre FROM users u
      WHERE u.active
        AND ($1::int[] IS NULL OR u.id = $2 OR EXISTS (
              SELECT 1 FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true AND up.project_id = ANY($1::int[])))
      ORDER BY u.nombre, u.id`,
    [projectIds ? projectIds.map(Number) : null, userId]);
  return rows;
}

/** ¿Existen? Para que una clave foranea rota salga como 400 y no como 500. */
export async function existe(tabla, id) {
  const permitidas = { projects: 'projects', invoice_issuers: 'invoice_issuers', users: 'users' };
  const { rowCount } = await query(`SELECT 1 FROM ${permitidas[tabla]} WHERE id = $1`, [id]);
  return rowCount > 0;
}
