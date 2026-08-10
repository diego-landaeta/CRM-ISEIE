import { query } from '../../shared/config/db.js';

// Tutores y colaboraciones.
//
// El dinero NO se calcula aqui todavia: esta es la fase 1, la de dar de alta
// gente y decir que formacion lleva cada uno, desde cuando y a que porcentaje.
// El calculo llega despues, y necesita antes una decision sobre desde donde se
// cuenta lo cobrado.

// ── Tutores ─────────────────────────────────────────────────────────────────

export async function listar({ projectId, activos = true }) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.active, u.last_login_at,
            u.set_password_token IS NOT NULL AS pendiente_de_entrar,
            p.dni_nif, p.iban, p.telefono, p.notas,
            (SELECT count(*) FROM tutor_collaborations c
              WHERE c.tutor_id = u.id AND c.activa) AS formaciones
       FROM users u
       LEFT JOIN tutor_profiles p ON p.user_id = u.id
      WHERE u.role = 'tutor'
        ${activos ? 'AND u.active' : ''}
        ${projectId ? 'AND EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $1)' : ''}
      ORDER BY u.nombre`,
    projectId ? [projectId] : []
  );
  return rows;
}

export async function ficha(tutorId) {
  const { rows: [t] } = await query(
    `SELECT u.id, u.nombre, u.email, u.active, u.last_login_at,
            p.dni_nif, p.iban, p.telefono, p.notas
       FROM users u
       LEFT JOIN tutor_profiles p ON p.user_id = u.id
      WHERE u.id = $1 AND u.role = 'tutor'`,
    [tutorId]
  );
  return t || null;
}

export async function guardarPerfil(tutorId, { dniNif, iban, telefono, notas }) {
  const { rows: [p] } = await query(
    `INSERT INTO tutor_profiles (user_id, dni_nif, iban, telefono, notas)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE
       SET dni_nif = EXCLUDED.dni_nif,
           iban = EXCLUDED.iban,
           telefono = EXCLUDED.telefono,
           notas = EXCLUDED.notas,
           updated_at = NOW()
     RETURNING *`,
    [tutorId, dniNif || null, iban || null, telefono || null, notas || null]
  );
  return p;
}

// ── Colaboraciones ──────────────────────────────────────────────────────────

export async function colaboraciones({ tutorId, productId, soloActivas = false }) {
  const cond = [];
  const params = [];
  if (tutorId) { params.push(tutorId); cond.push(`c.tutor_id = $${params.length}`); }
  if (productId) { params.push(productId); cond.push(`c.product_id = $${params.length}`); }
  if (soloActivas) cond.push('c.activa');

  const { rows } = await query(
    `SELECT c.*, u.nombre AS tutor, p.nombre AS formacion, p.precio,
            -- Una colaboracion puede estar marcada activa y aun asi no regir
            -- hoy, si su vigencia ya termino. Se dice por separado para que la
            -- pantalla no tenga que recalcularlo.
            (c.activa
             AND c.vigente_desde <= CURRENT_DATE
             AND (c.vigente_hasta IS NULL OR c.vigente_hasta >= CURRENT_DATE)) AS rige_hoy
       FROM tutor_collaborations c
       JOIN users u ON u.id = c.tutor_id
       JOIN products p ON p.id = c.product_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY u.nombre, p.nombre, c.vigente_desde DESC`,
    params
  );
  return rows;
}

// Se comprueba ANTES de guardar: dos tramos del mismo tutor y formacion no
// pueden solaparse. Si lo hicieran no habria forma de saber que porcentaje
// aplicar a un pago de esas fechas, y el tutor cobraria de mas o de menos sin
// que nadie lo notara.
export async function haySolape({ tutorId, productId, desde, hasta, excluirId = null }) {
  const { rows } = await query(
    `SELECT id, vigente_desde, vigente_hasta FROM tutor_collaborations
      WHERE tutor_id = $1 AND product_id = $2
        AND ($5::int IS NULL OR id <> $5)
        AND vigente_desde <= COALESCE($4::date, DATE '9999-12-31')
        AND COALESCE(vigente_hasta, DATE '9999-12-31') >= $3::date`,
    [tutorId, productId, desde, hasta || null, excluirId]
  );
  return rows;
}

export async function colaboracionPorId(id) {
  const { rows: [c] } = await query('SELECT * FROM tutor_collaborations WHERE id = $1', [id]);
  return c || null;
}

export async function crearColaboracion({ tutorId, productId, pct, desde, hasta, notas, createdBy }) {
  const { rows: [c] } = await query(
    `INSERT INTO tutor_collaborations
       (tutor_id, product_id, pct, vigente_desde, vigente_hasta, notas, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [tutorId, productId, pct, desde, hasta || null, notas || null, createdBy]
  );
  return c;
}

export async function actualizarColaboracion(id, { pct, desde, hasta, activa, notas }) {
  const { rows: [c] } = await query(
    `UPDATE tutor_collaborations
        SET pct = COALESCE($2, pct),
            vigente_desde = COALESCE($3, vigente_desde),
            vigente_hasta = $4,
            activa = COALESCE($5, activa),
            notas = COALESCE($6, notas),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, pct ?? null, desde ?? null, hasta ?? null, activa ?? null, notas ?? null]
  );
  return c || null;
}

export async function borrarColaboracion(id) {
  // Si ya genero comisiones no se borra: se desactiva. Borrarla dejaria pagos
  // liquidados apuntando a algo que no existe, y eso no se puede auditar.
  const { rows: [c] } = await query(
    'SELECT count(*)::int AS n FROM tutor_commissions WHERE collaboration_id = $1',
    [id]
  );
  if (c.n > 0) {
    await query('UPDATE tutor_collaborations SET activa = FALSE, updated_at = NOW() WHERE id = $1', [id]);
    return { borrada: false, desactivada: true, comisiones: c.n };
  }
  await query('DELETE FROM tutor_collaborations WHERE id = $1', [id]);
  return { borrada: true, desactivada: false, comisiones: 0 };
}

// ── Ajustes ─────────────────────────────────────────────────────────────────

export async function ajustes() {
  const { rows: [a] } = await query('SELECT * FROM tutor_settings WHERE id = TRUE');
  return a;
}

export async function guardarAjustes({ aplicaDesde, pctPorDefecto, updatedBy }) {
  const { rows: [a] } = await query(
    `UPDATE tutor_settings
        SET aplica_desde = COALESCE($1, aplica_desde),
            pct_por_defecto = COALESCE($2, pct_por_defecto),
            updated_by = $3,
            updated_at = NOW()
      WHERE id = TRUE
      RETURNING *`,
    [aplicaDesde ?? null, pctPorDefecto ?? null, updatedBy]
  );
  return a;
}

// ── Lo que se veria si se encendiera el calculo ─────────────────────────────
//
// No crea comisiones: solo enseña que pagos las generarian con las
// colaboraciones de hoy. Sirve para revisar antes de encender nada, que es
// justo lo que falta para que esto sea util sin riesgo.
//
// La base sale de conversion_payments, NUNCA de conversions.importe_pagado:
// ese campo declara mas de 200.000 EUR de mas y al 10% serian unos 21.000 EUR
// de comisiones fantasma.
export async function simular({ desde, hasta, tutorId = null }) {
  const { rows } = await query(
    `SELECT c.tutor_id, u.nombre AS tutor, c.product_id, p.nombre AS formacion,
            c.pct,
            count(*)::int AS pagos,
            SUM(cp.importe) AS base,
            ROUND(SUM(cp.importe) * c.pct / 100, 2) AS comision
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
       JOIN tutor_collaborations c ON c.product_id = cv.producto_contratado_id
       JOIN users u ON u.id = c.tutor_id
       JOIN products p ON p.id = c.product_id
       CROSS JOIN tutor_settings s
      WHERE cp.fecha >= GREATEST($1::date, s.aplica_desde, c.vigente_desde)
        AND cp.fecha <= $2::date
        AND (c.vigente_hasta IS NULL OR cp.fecha <= c.vigente_hasta)
        AND c.activa
        AND ($3::int IS NULL OR c.tutor_id = $3)
      GROUP BY c.tutor_id, u.nombre, c.product_id, p.nombre, c.pct
      ORDER BY u.nombre, p.nombre`,
    [desde, hasta, tutorId]
  );
  return rows;
}
