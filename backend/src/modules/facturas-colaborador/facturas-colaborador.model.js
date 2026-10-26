import pool, { query } from '../../shared/config/db.js';

/*
  Facturas de colaboradores (#202) · la base.

  Aquí solo SQL. Quién puede ver qué lo decide el servicio, que pasa la lista
  de empresas (`issuerIds`) a la que se acota cada consulta: `null` es «todas»
  (super admin) y una lista vacía es «ninguna».
*/

/** Un texto para LIKE que se busca tal cual: `%`, `_` y `\` dejan de ser comodines. */
export function textoParaLike(texto) {
  return `%${String(texto).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Las empresas del grupo de los campus de una persona (como en `ambito.js`, #245). */
export async function empresasDeLosCampus(userId) {
  const { rows } = await query(
    `SELECT DISTINCT p.sociedad_emisora_id AS id
       FROM user_projects up
       JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = $1 AND up.active = true AND p.sociedad_emisora_id IS NOT NULL
      ORDER BY 1`,
    [userId],
  );
  return rows.map((r) => Number(r.id));
}

/** Las empresas que se pueden elegir en la ficha: las activas, acotadas. */
export async function empresas(issuerIds) {
  const { rows } = await query(
    `SELECT id, razon_social, nif
       FROM invoice_issuers
      WHERE activo = true AND ($1::int[] IS NULL OR id = ANY($1::int[]))
      ORDER BY razon_social`,
    [issuerIds],
  );
  return rows;
}

/**
 * Activo = sin baja, o con la baja en un mes que todavía no ha llegado (en
 * Madrid). Se calcula, no se guarda: dar de baja «desde noviembre» el 7 de
 * octubre no lo apaga hasta noviembre (antes se apagaba en el acto y octubre
 * ya no se preparaba).
 */
export const ACTIVO = `(c.baja_desde IS NULL
  OR c.baja_desde > date_trunc('month', NOW() AT TIME ZONE 'Europe/Madrid')::date)`;

const CAMPOS_COLABORADOR = `
  c.id, c.nombre, c.email, c.nif, c.area, c.notas, c.user_id, ${ACTIVO} AS activo,
  to_char(c.alta_desde, 'YYYY-MM') AS alta_desde,
  to_char(c.baja_desde, 'YYYY-MM') AS baja_desde,
  c.created_at, c.updated_at,
  u.nombre AS usuario_nombre`;

/**
 * Sus empresas, solo las que se ven. Un admin de CEDIA ve a quien factura a
 * CEDIA y a ISEIE, pero de sus empresas solo la de CEDIA.
 */
const EMPRESAS_VISIBLES = `
  COALESCE((
    SELECT json_agg(json_build_object(
             'issuer_id', ce.issuer_id,
             'razon_social', ii.razon_social,
             'importe_acordado', ce.importe_acordado,
             'modalidad', ce.modalidad,
             'importe_fijo', ce.importe_fijo,
             'tarifa_hora', ce.tarifa_hora,
             'iva_pct', ce.iva_pct,
             'irpf_pct', ce.irpf_pct
           ) ORDER BY ii.razon_social)
      FROM colaborador_empresas ce
      JOIN invoice_issuers ii ON ii.id = ce.issuer_id
     WHERE ce.colaborador_id = c.id
       AND ($1::int[] IS NULL OR ce.issuer_id = ANY($1::int[]))
  ), '[]'::json) AS empresas`;

/**
 * Si también factura a empresas que quien mira no lleva (`$1` = sus empresas).
 * Para el super admin (`$1` null), nunca. La pantalla lo usa para avisar antes
 * de que el admin intente cambiar lo que no le toca.
 */
const COMPARTIDO = `($1::int[] IS NOT NULL AND EXISTS (
  SELECT 1 FROM colaborador_empresas ce
   WHERE ce.colaborador_id = c.id AND NOT (ce.issuer_id = ANY($1::int[])))) AS compartido`;

/** Que factura a alguna de las empresas que se ven. */
const VISIBLE = `($1::int[] IS NULL OR EXISTS (
  SELECT 1 FROM colaborador_empresas ce
   WHERE ce.colaborador_id = c.id AND ce.issuer_id = ANY($1::int[])))`;

export async function listar({ issuerIds, issuerId = null, estado = 'activos', q = null }) {
  const { rows } = await query(
    `SELECT ${CAMPOS_COLABORADOR}, ${EMPRESAS_VISIBLES}, ${COMPARTIDO}
       FROM colaboradores c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE ${VISIBLE}
        AND ($2::int IS NULL OR EXISTS (
              SELECT 1 FROM colaborador_empresas ce
               WHERE ce.colaborador_id = c.id AND ce.issuer_id = $2))
        AND ($3 = 'todos' OR ($3 = 'activos') = ${ACTIVO})
        AND ($4::text IS NULL OR c.nombre ILIKE $4 OR c.email ILIKE $4)
      ORDER BY activo DESC, c.nombre`,
    [issuerIds, issuerId, estado, q ? textoParaLike(q) : null],
  );
  return rows;
}

export async function porId(id, issuerIds) {
  const { rows } = await query(
    `SELECT ${CAMPOS_COLABORADOR}, ${EMPRESAS_VISIBLES}, ${COMPARTIDO}
       FROM colaboradores c
       LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = $2 AND ${VISIBLE}`,
    [issuerIds, id],
  );
  return rows[0] || null;
}

/** Sus empresas, todas, para saber qué cambia al guardar. */
export async function empresasDe(colaboradorId, db = pool) {
  const { rows } = await db.query(
    `SELECT issuer_id, importe_acordado, modalidad, importe_fijo, tarifa_hora, iva_pct, irpf_pct
       FROM colaborador_empresas
      WHERE colaborador_id = $1 ORDER BY issuer_id`,
    [colaboradorId],
  );
  const num = (v) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    issuer_id: Number(r.issuer_id),
    importe_acordado: num(r.importe_acordado),
    modalidad: r.modalidad,
    importe_fijo: num(r.importe_fijo),
    tarifa_hora: num(r.tarifa_hora),
    iva_pct: num(r.iva_pct),
    irpf_pct: num(r.irpf_pct),
  }));
}

/**
 * Lo que se guarda de una empresa: solo lo de su modalidad. Una ficha fija no
 * guarda tarifa, una por horas no guarda importe fijo, y sin modalidad (como
 * en la primera parte) no hay nada de cómo cobra.
 */
export function comoCobra(e) {
  const m = e.modalidad ?? null;
  return {
    modalidad: m,
    importe_fijo: m === 'fijo' ? e.importe_fijo ?? null : null,
    tarifa_hora: m === 'hora' || m === 'proyecto' ? e.tarifa_hora ?? null : null,
    iva_pct: m ? e.iva_pct ?? null : null,
    irpf_pct: m ? e.irpf_pct ?? null : null,
  };
}

/**
 * Que el usuario exista y tenga el rol colaborador (#210), como rol principal
 * o añadido (26/10/2026: Diego es soporte y además factura como colaborador).
 * Con el rol añadido, «Mi factura» le funciona porque la guardia de esas rutas
 * mira también los roles de más (`subeSuFactura`, routes).
 */
export async function esUsuarioColaborador(userId) {
  const { rows } = await query(
    `SELECT 1 FROM users WHERE id = $1 AND (role = 'colaborador' OR 'colaborador' = ANY(roles_extra::text[]))`,
    [userId],
  );
  return rows.length > 0;
}

/** ¿Factura también a alguna empresa fuera de estas? (`null` = el super admin: nunca.) */
export async function facturaFueraDe(colaboradorId, issuerIds) {
  if (!issuerIds) return false;
  const { rows } = await query(
    `SELECT 1 FROM colaborador_empresas
      WHERE colaborador_id = $1 AND NOT (issuer_id = ANY($2::int[])) LIMIT 1`,
    [colaboradorId, issuerIds],
  );
  return rows.length > 0;
}

export async function insertar(db, datos, porUserId) {
  const { rows } = await db.query(
    `INSERT INTO colaboradores (nombre, email, nif, area, notas, user_id, alta_desde, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [datos.nombre, datos.email, datos.nif ?? null, datos.area, datos.notas ?? null,
      datos.user_id ?? null, datos.alta_desde ?? null, porUserId],
  );
  return Number(rows[0].id);
}

const EDITABLES = ['nombre', 'email', 'nif', 'area', 'notas', 'user_id', 'alta_desde'];

export async function actualizar(db, id, cambios) {
  // Lo que no llega no se toca (undefined); lo que llega vacío, null.
  const campos = EDITABLES.filter((k) => cambios[k] !== undefined);
  if (!campos.length) return;
  const sets = campos.map((k, i) => `${k} = $${i + 2}`);
  await db.query(
    `UPDATE colaboradores SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...campos.map((k) => cambios[k] ?? null)],
  );
}

export async function darDeBaja(db, id, desde) {
  await db.query('UPDATE colaboradores SET baja_desde = $2, updated_at = NOW() WHERE id = $1', [id, desde]);
}

/** Vuelve a la lista desde un mes: sin baja, y con ese mes como alta. */
export async function volverDeAlta(db, id, desde) {
  await db.query(
    'UPDATE colaboradores SET baja_desde = NULL, alta_desde = $2, activo = true, updated_at = NOW() WHERE id = $1',
    [id, desde],
  );
}

export async function ponerEmpresa(db, colaboradorId, empresa) {
  const c = comoCobra(empresa);
  await db.query(
    `INSERT INTO colaborador_empresas
       (colaborador_id, issuer_id, importe_acordado, modalidad, importe_fijo, tarifa_hora, iva_pct, irpf_pct)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (colaborador_id, issuer_id) DO UPDATE SET
       importe_acordado = EXCLUDED.importe_acordado, modalidad = EXCLUDED.modalidad,
       importe_fijo = EXCLUDED.importe_fijo, tarifa_hora = EXCLUDED.tarifa_hora,
       iva_pct = EXCLUDED.iva_pct, irpf_pct = EXCLUDED.irpf_pct`,
    [colaboradorId, empresa.issuer_id, empresa.importe_acordado ?? null,
      c.modalidad, c.importe_fijo, c.tarifa_hora, c.iva_pct, c.irpf_pct],
  );
}

export async function quitarEmpresa(db, colaboradorId, issuerId) {
  await db.query(
    'DELETE FROM colaborador_empresas WHERE colaborador_id = $1 AND issuer_id = $2',
    [colaboradorId, issuerId],
  );
}

/** Una línea del registro. No se edita ni se borra (la app solo tiene INSERT). */
export async function anotar(db, { facturaId = null, colaboradorId = null, evento, userId = null, ip = null, detalle = {} }) {
  await db.query(
    `INSERT INTO facturas_colaborador_registro (factura_id, colaborador_id, evento, user_id, ip, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [facturaId, colaboradorId, evento, userId, ip, JSON.stringify(detalle)],
  );
}

/** Su historial: los cambios en la lista y lo de sus facturas de las empresas que se ven. */
export async function registroDe(colaboradorId, issuerIds) {
  const { rows } = await query(
    `SELECT r.id, r.evento, r.creado_at, r.ip, r.detalle, r.factura_id,
            u.nombre AS usuario_nombre
       FROM facturas_colaborador_registro r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.colaborador_id = $1
         OR r.factura_id IN (
              SELECT id FROM facturas_colaborador
               WHERE colaborador_id = $1
                 AND ($2::int[] IS NULL OR issuer_id = ANY($2::int[])))
      ORDER BY r.creado_at DESC, r.id DESC`,
    [colaboradorId, issuerIds],
  );
  return rows;
}
