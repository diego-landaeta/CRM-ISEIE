import bcrypt from 'bcrypt';
import { query } from '../../shared/config/db.js';

// Tutores y colaboraciones.
//
// El dinero NO se calcula aqui todavia: esta es la fase 1, la de dar de alta
// gente y decir que formacion lleva cada uno, desde cuando y a que porcentaje.
// El calculo llega despues, y necesita antes una decision sobre desde donde se
// cuenta lo cobrado.

// ── Tutores ─────────────────────────────────────────────────────────────────

export async function listar({ projectId, activos = true }) {
  // Con un proyecto elegido no se corta en seco: primero los profesores de ESE
  // proyecto y despues los de los demas proyectos de la MISMA SOCIEDAD.
  //
  // Se hace asi porque quien lleva CEDIA tambien firma las facturas del resto de
  // marcas de su sociedad, y necesita saber a quien esta pagando. Lo que no ve
  // nunca es a los profesores de otra sociedad.
  //
  // En «todos los proyectos» salen todos, cada uno con sus marcas al lado.
  const { rows } = await query(
    `WITH alcance AS (
       SELECT p.id,
              (p.id = $1) AS es_el_elegido
         FROM projects p
        WHERE $1::int IS NULL
           OR p.id = $1
           OR (p.sociedad_emisora_id IS NOT NULL
               AND p.sociedad_emisora_id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1))
     )
     SELECT u.id, u.nombre, u.email, u.active, u.last_login_at,
            u.set_password_token IS NOT NULL AS pendiente_de_entrar,
            perfil.dni_nif, perfil.iban, perfil.telefono, perfil.notas,
            -- Sus cursos dentro del alcance: los de fuera no son asunto de esta pantalla.
            (SELECT count(*) FROM tutor_collaborations c
               JOIN products pp ON pp.id = c.product_id
              WHERE c.tutor_id = u.id AND c.activa
                AND pp.project_id IN (SELECT id FROM alcance)) AS formaciones,
            -- En cuantas marcas da clase en total, aunque no se vean todas aqui.
            (SELECT count(DISTINCT pp2.project_id) FROM tutor_collaborations c2
               JOIN products pp2 ON pp2.id = c2.product_id
              WHERE c2.tutor_id = u.id AND c2.activa) AS proyectos,
            -- Los nombres de sus marcas, para enseñarlos sin otra consulta.
            (SELECT string_agg(DISTINCT pr3.nombre, ' · ' ORDER BY pr3.nombre)
               FROM user_projects up3 JOIN projects pr3 ON pr3.id = up3.project_id
              WHERE up3.user_id = u.id) AS marcas,
            -- ¿Es de la marca que hay elegida arriba, o de una hermana?
            EXISTS (SELECT 1 FROM user_projects upx
                     WHERE upx.user_id = u.id AND ($1::int IS NULL OR upx.project_id = $1)) AS es_de_este_proyecto
       FROM users u
       LEFT JOIN tutor_profiles perfil ON perfil.user_id = u.id
      WHERE u.role = 'tutor'
        ${activos ? 'AND u.active' : ''}
        AND EXISTS (SELECT 1 FROM user_projects up
                     WHERE up.user_id = u.id AND up.project_id IN (SELECT id FROM alcance))
      ORDER BY es_de_este_proyecto DESC, u.nombre`,
    [projectId || null]
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

// Le pone una contraseña y jubila el token del correo: si se dejara vivo, el
// enlace de «pon tu contraseña» seguiria funcionando y cualquiera que lo tuviera
// podria cambiarsela.
//
// Coste 12, el mismo que usa el resto del CRM. Bajarlo aqui haria que las
// contraseñas de los tutores fueran mas faciles de romper que las de todos los
// demas, y nadie se enteraria.
export async function ponerContrasena(userId, password) {
  const hash = await bcrypt.hash(password, 12);
  await query(
    `UPDATE users
        SET password_hash = $2,
            set_password_token = NULL,
            set_password_expires = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [userId, hash]
  );
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
            -- De que marca es cada curso: un profesor puede dar clase en varias.
            p.project_id, pr.nombre AS proyecto,
            -- Una colaboracion puede estar marcada activa y aun asi no regir
            -- hoy, si su vigencia ya termino. Se dice por separado para que la
            -- pantalla no tenga que recalcularlo.
            (c.activa
             AND c.vigente_desde <= CURRENT_DATE
             AND (c.vigente_hasta IS NULL OR c.vigente_hasta >= CURRENT_DATE)) AS rige_hoy
       FROM tutor_collaborations c
       JOIN users u ON u.id = c.tutor_id
       JOIN products p ON p.id = c.product_id
       JOIN projects pr ON pr.id = p.project_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
      ORDER BY u.nombre, pr.nombre, p.nombre, c.vigente_desde DESC`,
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
// Un mismo profesor puede dar clase en VARIOS proyectos —da Filtración en
// ICTESS y Logopedia en Fono Aprende—, asi que cada linea dice de que proyecto
// es. Y si se pide uno concreto, solo salen los suyos: sin eso, quien lleva un
// proyecto veia en su pantalla comisiones de formaciones de otra marca.
//
// El proyecto se toma de la FORMACION, no de la venta: es la formacion la que
// tiene tutor, y es su proyecto el que paga.
export async function simular({ desde, hasta, tutorId = null, projectId = null }) {
  const { rows } = await query(
    `SELECT c.tutor_id, u.nombre AS tutor, c.product_id, p.nombre AS formacion,
            p.project_id, pr.nombre AS proyecto,
            c.pct,
            count(*)::int AS pagos,
            SUM(cp.importe) AS base,
            ROUND(SUM(cp.importe) * c.pct / 100, 2) AS comision
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
       JOIN tutor_collaborations c ON c.product_id = cv.producto_contratado_id
       JOIN users u ON u.id = c.tutor_id
       JOIN products p ON p.id = c.product_id
       JOIN projects pr ON pr.id = p.project_id
       CROSS JOIN tutor_settings s
      WHERE cp.fecha >= GREATEST($1::date, s.aplica_desde, c.vigente_desde)
        AND cp.fecha <= $2::date
        AND (c.vigente_hasta IS NULL OR cp.fecha <= c.vigente_hasta)
        AND c.activa
        AND ($3::int IS NULL OR c.tutor_id = $3)
        AND ($4::int IS NULL OR p.project_id = $4)
      GROUP BY c.tutor_id, u.nombre, c.product_id, p.nombre, p.project_id, pr.nombre, c.pct
      ORDER BY u.nombre, pr.nombre, p.nombre`,
    [desde, hasta, tutorId, projectId]
  );
  return rows;
}

// ¿Este profesor da clase en el proyecto de esta formacion?
//
// En el MultiCRM un profesor puede estar en varios proyectos, asi que no vale
// comprobar "un" proyecto: se mira si el de la formacion esta entre los suyos.
// Sin esto se le podia colgar a un tutor de ISEIH un curso de ICTESS, y cobraria
// de una marca en la que no da clase.
export async function formacionEsDeSuProyecto(tutorId, productId) {
  const { rows } = await query(
    `SELECT EXISTS (
       SELECT 1 FROM products p
        WHERE p.id = $2
          AND EXISTS (SELECT 1 FROM user_projects up
                       WHERE up.user_id = $1 AND up.project_id = p.project_id)) AS ok,
       (SELECT pr.nombre FROM products p JOIN projects pr ON pr.id = p.project_id WHERE p.id = $2) AS proyecto`,
    [tutorId, productId]
  );
  return { ok: rows[0]?.ok === true, proyecto: rows[0]?.proyecto || null };
}
