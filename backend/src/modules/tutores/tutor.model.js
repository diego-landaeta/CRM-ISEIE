import bcrypt from 'bcrypt';
import { query, getClient } from '../../shared/config/db.js';

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

// ── El dinero de verdad ─────────────────────────────────────────────────────
//
// Hasta aqui todo era simulacion. De aqui abajo se ESCRIBEN comisiones, y eso
// cambia las reglas del juego.
//
// Se hace RECONCILIANDO y no al vuelo: se recorren los cobros que todavia no
// tienen comision y se crean las que falten. Pasar dos veces no cuesta nada
// porque el indice unico (payment_id, tutor_id) lo impide en la BASE DE DATOS,
// no en el codigo. Es lo que hace que un reintento de Stripe, una
// resincronizacion o dos ejecuciones a la vez no puedan duplicar dinero.
//
// La alternativa —crear la comision en el momento del cobro— ya se probo en el
// modulo de las gestoras: se pierde los cobros de Stripe, los de cuotas y los
// borrados, y cuando falla, falla en silencio.

// Crea las comisiones que falten. Devuelve cuantas y cuanto suman.
//
// Una comision ya creada NO se toca aunque despues cambie el porcentaje de la
// colaboracion: lo devengado, devengado esta. Para rehacerla hay que revertirla
// a mano, y eso deja rastro.
export async function reconciliar({ desde = null, hasta = null, projectId = null } = {}) {
  const { rows } = await query(
    `INSERT INTO tutor_commissions
       (payment_id, tutor_id, collaboration_id, product_id, base_calculo, pct, importe, periodo)
     SELECT cp.id, c.tutor_id, c.id, c.product_id,
            cp.importe,
            c.pct,
            ROUND(cp.importe * c.pct / 100, 2),
            to_char(cp.fecha, 'YYYY-MM')
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
       JOIN tutor_collaborations c ON c.product_id = cv.producto_contratado_id
       JOIN products p ON p.id = c.product_id
       CROSS JOIN tutor_settings s
      WHERE c.activa
        -- Nunca antes del arranque del modulo ni de la fecha del tutor: quien
        -- empezo en septiembre no cobra de lo cobrado en agosto.
        AND cp.fecha >= GREATEST(s.aplica_desde, c.vigente_desde)
        AND (c.vigente_hasta IS NULL OR cp.fecha <= c.vigente_hasta)
        AND ($1::date IS NULL OR cp.fecha >= $1::date)
        AND ($2::date IS NULL OR cp.fecha <= $2::date)
        AND ($3::int  IS NULL OR p.project_id = $3)
     ON CONFLICT (payment_id, tutor_id) DO NOTHING
     RETURNING id, importe, tutor_id, periodo`,
    [desde, hasta, projectId]
  );

  return {
    creadas: rows.length,
    importe: rows.reduce((s, r) => s + Number(r.importe), 0),
    tutores: new Set(rows.map((r) => r.tutor_id)).size,
    periodos: [...new Set(rows.map((r) => r.periodo))].sort(),
  };
}

// Las comisiones ya creadas, con lo que hace falta para entender cada una.
export async function comisiones({ periodo = null, tutorId = null, estado = null, projectId = null, limit = 1000 }) {
  const { rows } = await query(
    `SELECT tc.id, tc.periodo, tc.estado, tc.base_calculo, tc.pct, tc.importe,
            tc.fecha_liquidacion, tc.created_at,
            tc.tutor_id, u.nombre AS tutor,
            tc.product_id, p.nombre AS formacion, p.project_id, pr.nombre AS proyecto,
            cp.fecha AS fecha_cobro, cp.importe AS cobro,
            COALESCE(l.nombre, '—') AS alumno,
            liq.nombre AS liquidada_por_nombre
       FROM tutor_commissions tc
       JOIN users u ON u.id = tc.tutor_id
       LEFT JOIN products p ON p.id = tc.product_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN conversion_payments cp ON cp.id = tc.payment_id
       LEFT JOIN conversions cv ON cv.id = cp.conversion_id
       LEFT JOIN leads l ON l.id = cv.lead_id
       LEFT JOIN users liq ON liq.id = tc.liquidada_por
      WHERE ($1::char(7) IS NULL OR tc.periodo = $1)
        AND ($2::int IS NULL OR tc.tutor_id = $2)
        AND ($3::text IS NULL OR tc.estado = $3)
        AND ($4::int IS NULL OR p.project_id = $4)
      ORDER BY tc.periodo DESC, u.nombre, cp.fecha
      LIMIT ${Number(limit) || 1000}`,
    [periodo, tutorId, estado, projectId]
  );
  return rows;
}

// Una fila por tutor y mes: lo que hay que pagarle y lo que ya se le pago.
export async function resumenComisiones({ periodo = null, tutorId = null, projectId = null }) {
  const { rows } = await query(
    `SELECT tc.periodo, tc.tutor_id, u.nombre AS tutor,
            u.email AS tutor_email, perfil.iban AS tutor_iban,
            COUNT(*)::int AS lineas,
            COALESCE(SUM(tc.base_calculo), 0) AS base,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'pendiente'), 0) AS pendiente,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'pagada'), 0) AS pagada,
            COALESCE(SUM(tc.importe) FILTER (WHERE tc.estado = 'revertida'), 0) AS revertida,
            MAX(tc.fecha_liquidacion) AS ultima_liquidacion
       FROM tutor_commissions tc
       JOIN users u ON u.id = tc.tutor_id
       -- El IBAN y el correo viajan con el resumen: pagar a un profesor
       -- obligaba a abrir su ficha aparte para copiar la cuenta, una a una.
       LEFT JOIN tutor_profiles perfil ON perfil.user_id = tc.tutor_id
       LEFT JOIN products p ON p.id = tc.product_id
      WHERE ($1::char(7) IS NULL OR tc.periodo = $1)
        AND ($2::int IS NULL OR tc.tutor_id = $2)
        AND ($3::int IS NULL OR p.project_id = $3)
      GROUP BY tc.periodo, tc.tutor_id, u.nombre, u.email, perfil.iban
      ORDER BY tc.periodo DESC, u.nombre`,
    [periodo, tutorId, projectId]
  );
  return rows;
}

// Marcar como pagadas. Por lista de identificadores o por tutor y mes entero,
// que es como se paga de verdad: una transferencia por persona.
//
// Solo pasan de 'pendiente' a 'pagada'. Una revertida no se paga por descuido, y
// una ya pagada no se paga dos veces aunque se pulse el boton dos veces.
export async function liquidar({ ids = null, periodo = null, tutorId = null, userId }) {
  const { rows } = await query(
    `UPDATE tutor_commissions
        SET estado = 'pagada',
            fecha_liquidacion = CURRENT_DATE,
            liquidada_por = $1,
            updated_at = NOW()
      WHERE estado = 'pendiente'
        AND ($2::int[] IS NULL OR id = ANY($2))
        AND ($3::char(7) IS NULL OR periodo = $3)
        AND ($4::int IS NULL OR tutor_id = $4)
      RETURNING id, importe, tutor_id`,
    [userId, ids && ids.length ? ids : null, periodo, tutorId]
  );
  return { liquidadas: rows.length, importe: rows.reduce((s, r) => s + Number(r.importe), 0) };
}

// Deshacer una liquidacion o anular una comision. Queda escrito quien y por que:
// esto mueve dinero y no puede pasar sin dejar rastro.
export async function revertirComision(id, { userId, motivo }) {
  const { rows: [c] } = await query(
    `UPDATE tutor_commissions
        SET estado = 'revertida',
            notas = TRIM(COALESCE(notas, '') || ' · revertida el ' || CURRENT_DATE || ': ' || $2),
            liquidada_por = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, motivo || 'sin motivo', userId]
  );
  return c || null;
}

// Los cobros que NO generan comision porque su venta no dice de que formacion es.
//
// Salen a la vista a proposito: si desaparecieran, el total del mes pareceria
// cuadrado cuando en realidad hay dinero sin atribuir y un tutor sin cobrar.
export async function pagosSinFormacion({ desde, hasta, projectId = null }) {
  const { rows } = await query(
    `SELECT cp.id, cp.fecha, cp.importe,
            cv.id AS venta, COALESCE(l.nombre, '—') AS alumno,
            COALESCE(NULLIF(cv.producto_contratado, ''), '— en blanco —') AS dice,
            pr.nombre AS proyecto
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
       LEFT JOIN leads l ON l.id = cv.lead_id
       LEFT JOIN projects pr ON pr.id = cv.project_id
       CROSS JOIN tutor_settings s
      WHERE cv.producto_contratado_id IS NULL
        AND cp.fecha >= GREATEST($1::date, s.aplica_desde)
        AND cp.fecha <= $2::date
        AND ($3::int IS NULL OR cv.project_id = $3)
      ORDER BY cp.fecha DESC, cp.importe DESC`,
    [desde, hasta, projectId]
  );
  return rows;
}

/**
 * Formaciones que ya han vendido pero no tienen tutor.
 *
 * La pide Carlos: «dentro del catalogo de formaciones, tiene que existir al
 * menos 1 pago / 1 alumno y que no tenga relacionado un tutor».
 *
 * El filtro de «al menos un pago» no es un detalle: el catalogo tiene miles de
 * formaciones y casi ninguna se ha vendido nunca. Sin ese corte, la lista seria
 * el catalogo entero y no serviria para nada. Asi salen solo las que ya estan
 * generando dinero y no tienen a quien pagarle.
 *
 * Cuenta los pagos, no las ventas: una venta a plazos con seis cobros ya lleva
 * seis comisiones sin dueño, y eso es lo que mide el agujero de verdad.
 */
export async function formacionesSinTutor({ projectId = null } = {}) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.precio, pr.nombre AS proyecto, p.project_id,
            count(DISTINCT cv.id)::int  AS ventas,
            count(DISTINCT cv.lead_id)::int AS alumnos,
            count(cp.id)::int           AS pagos,
            COALESCE(sum(cp.importe), 0) AS cobrado,
            min(cp.fecha) AS primer_cobro,
            max(cp.fecha) AS ultimo_cobro
       FROM products p
       JOIN conversions cv ON cv.producto_contratado_id = p.id
       JOIN conversion_payments cp ON cp.conversion_id = cv.id
       LEFT JOIN projects pr ON pr.id = p.project_id
      WHERE NOT EXISTS (
              SELECT 1 FROM tutor_collaborations tc
               WHERE tc.product_id = p.id AND tc.activa
            )
        AND ($1::int IS NULL OR p.project_id = $1)
      GROUP BY p.id, p.nombre, p.precio, pr.nombre, p.project_id
     HAVING count(cp.id) >= 1 AND count(DISTINCT cv.lead_id) >= 1
      ORDER BY sum(cp.importe) DESC`,
    [projectId]
  );
  return rows;
}

// ── Reembolsos ──────────────────────────────────────────────────────────────
//
// Si a un alumno se le devuelve el dinero, el tutor no puede cobrar comision de
// ese cobro. Hasta ahora era imposible saberlo: la devolucion apuntaba a la
// VENTA y no al COBRO, asi que con una venta pagada en tres plazos no habia
// forma de saber cual se devolvio.

// Registra una devolucion y revierte de paso las comisiones de ESE cobro.
//
// Las dos cosas van en la MISMA transaccion a proposito: si se registrara la
// devolucion y fallara la reversion, el alumno tendria su dinero de vuelta y el
// tutor seguiria cobrando por el. Ese descuadre no se ve hasta que llega el
// banco, y para entonces ya se pago.
export async function registrarDevolucion({
  conversionId, paymentId = null, importe, fecha = null, motivo = null,
  stripeRefundId = null, origen = 'manual', userId = null,
}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Si viene de Stripe y ya estaba registrada, no se hace nada: ni una
    // devolucion duplicada ni una comision revertida dos veces. Lo garantiza
    // ademas el indice unico, pero se comprueba antes para poder decirlo.
    if (stripeRefundId) {
      const { rows: ya } = await client.query(
        'SELECT id FROM conversion_refunds WHERE stripe_refund_id = $1', [stripeRefundId]);
      if (ya.length) {
        await client.query('COMMIT');
        return { devolucion: ya[0], comisionesRevertidas: 0, repetida: true };
      }
    }

    const { rows: [dev] } = await client.query(
      `INSERT INTO conversion_refunds
         (conversion_id, payment_id, importe, fecha, motivo, stripe_refund_id, origen, created_by)
       VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5, $6, $7, $8)
       RETURNING *`,
      [conversionId, paymentId, importe, fecha, motivo, stripeRefundId, origen, userId]);

    // Solo se revierten las comisiones DE ESE COBRO. Si no se sabe cual es, no
    // se toca ninguna: es preferible que alguien lo revise a mano a revertir la
    // que no era y dejar a un tutor sin cobrar algo que si le corresponde.
    let revertidas = { rowCount: 0 };
    if (paymentId) {
      revertidas = await client.query(
        `UPDATE tutor_commissions
            SET estado = 'revertida',
                refund_id = $2,
                notas = TRIM(COALESCE(notas, '') || ' · revertida por la devolución del ' || CURRENT_DATE),
                updated_at = NOW()
          WHERE payment_id = $1
            AND estado <> 'revertida'
          RETURNING id`,
        [paymentId, dev.id]);
    }

    await client.query('COMMIT');
    return {
      devolucion: dev,
      comisionesRevertidas: revertidas.rowCount || 0,
      sinCobroConcreto: !paymentId,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Devoluciones de una venta, con el cobro al que corresponde cada una.
export async function devoluciones(conversionId) {
  const { rows } = await query(
    `SELECT r.*, cp.fecha AS fecha_cobro, cp.importe AS importe_cobro,
            u.nombre AS registrada_por,
            (SELECT COUNT(*) FROM tutor_commissions tc WHERE tc.refund_id = r.id)::int AS comisiones_revertidas
       FROM conversion_refunds r
       LEFT JOIN conversion_payments cp ON cp.id = r.payment_id
       LEFT JOIN users u ON u.id = r.created_by
      WHERE r.conversion_id = $1
      ORDER BY r.fecha DESC, r.id DESC`,
    [conversionId]);
  return rows;
}

// La ficha del curso tal como se publica, para que el profesor la vea.
//
// Es SOLO LECTURA a proposito: el profesor tiene que poder consultar el temario,
// los objetivos y a quien va dirigido —es lo que imparte— pero el catalogo lo
// lleva el equipo. Aqui no hay forma de escribir nada.
export async function cursoDetalle(productId) {
  const { rows: [p] } = await query(
    `SELECT p.id, p.nombre, p.precio, p.project_id, pr.nombre AS proyecto,
            p.fecha_inicio_texto, p.presentacion_texto, p.objetivos_texto,
            p.beneficios_texto, p.dirigido_a_texto, p.para_que_te_prepara_texto,
            p.por_que_estudiar_texto, p.modulos_texto, p.metodologia_texto, p.faqs_texto
       FROM products p
       LEFT JOIN projects pr ON pr.id = p.project_id
      WHERE p.id = $1`,
    [productId]
  );
  return p || null;
}

// ¿Este profesor imparte este curso? Es lo que decide si puede ver su ficha.
// Se mira la colaboracion, no el proyecto: estar en la marca no basta para ver
// el temario de un curso que no da.
export async function imparteEsteCurso(tutorId, productId) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM tutor_collaborations
                     WHERE tutor_id = $1 AND product_id = $2) AS ok`,
    [tutorId, productId]
  );
  return rows[0]?.ok === true;
}

// El brochure del curso: el PDF que se le manda al alumno.
//
// Vive en el modulo de dossiers y esta versionado —la version anterior no se
// borra, se marca inactiva—. Al profesor se le enseña SOLO la vigente: el
// historial de versiones es cosa de quien lleva el catalogo.
export async function brochureDelCurso(productId) {
  const { rows: [d] } = await query(
    `SELECT id, filename_original, version, size_bytes, created_at
       FROM dossiers
      WHERE product_id = $1 AND active
      ORDER BY version DESC
      LIMIT 1`,
    [productId]
  );
  return d || null;
}

// ¿Tiene la casilla de gestor de colaboraciones?
//
// Se consulta la BASE y no el token. El token dura quince minutos y lleva solo
// el rol; si la casilla viajara ahi, quitarle el permiso a alguien no surtiria
// efecto hasta que caducara su sesion. Es el mismo criterio que usa
// esFacturaManager en el modulo de facturas.
export async function esGestorColaboraciones(userId) {
  if (!userId) return false;
  const { rows } = await query('SELECT gestor_colaboraciones FROM users WHERE id = $1', [userId]);
  return rows[0]?.gestor_colaboraciones === true;
}

// Retirar a un profesor.
//
// NO se borra la fila: sus comisiones y sus colaboraciones apuntan a el, y
// borrarlo dejaria dinero pagado colgando de un usuario que ya no existe. Se
// desactiva —deja de entrar y desaparece de las listas— y se cierran sus
// colaboraciones a dia de hoy, para que no siga devengando comisiones.
export async function retirarTutor(tutorId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: [t] } = await client.query(
      `UPDATE users SET active = false, updated_at = NOW()
        WHERE id = $1 AND role = 'tutor' RETURNING id, nombre, email`, [tutorId]);
    if (!t) { await client.query('ROLLBACK'); return null; }
    const { rowCount } = await client.query(
      `UPDATE tutor_collaborations
          SET activa = false,
              vigente_hasta = COALESCE(vigente_hasta, CURRENT_DATE),
              updated_at = NOW()
        WHERE tutor_id = $1 AND activa`, [tutorId]);
    const { rows: [pend] } = await client.query(
      `SELECT COALESCE(SUM(importe), 0) AS pendiente
         FROM tutor_commissions WHERE tutor_id = $1 AND estado = 'pendiente'`, [tutorId]);
    await client.query('COMMIT');
    return { ...t, cursosCerrados: rowCount, pendienteDePagar: Number(pend.pendiente) };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

export async function reactivarTutor(tutorId) {
  const { rows: [t] } = await query(
    `UPDATE users SET active = true, updated_at = NOW()
      WHERE id = $1 AND role = 'tutor' RETURNING id, nombre, email`, [tutorId]);
  return t || null;
}
