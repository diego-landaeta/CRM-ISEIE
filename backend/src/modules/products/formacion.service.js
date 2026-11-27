import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { horasDeTexto } from '../certifex/certifex.programa.js';
import { tipoPorNombre } from '../cursos-pendientes/cursos-pendientes.venta.js';
import { formacionSchema, ordenDeLaPosicion } from './formacion.validation.js';
import { formacionesMoodleActivas } from '../../shared/config/soloEnPruebas.js';

/**
 * Formaciones desde el CRM · fase 1 (CRM#1113 / CRM-ISEIE#767).
 *
 * Una formación ES un producto del catálogo: aquí no hay tabla nueva. Se leen y
 * se guardan de una vez sus datos (`products`), sus módulos (`product_modules`,
 * los mismos que imprime el diploma) y se enseñan sus tutoras
 * (`tutor_collaborations`, que se siguen dando de alta con las rutas de Tutores)
 * y su curso de Moodle (`moodle_cursos_producto`, el de «Cursos de Moodle»).
 *
 * Las horas se guardan donde siempre, en `products.horas` como texto («100
 * horas»), que es lo que leen el diploma y la web. Sin horas y con tipo, la regla
 * de Diego (19/10): curso 100, diplomado 750, máster 1500. Ninguna formación
 * debe quedar sin horas: salen impresas en el diploma.
 */

export const HORAS_POR_TIPO = Object.freeze({ curso: 100, diplomado: 750, master: 1500 });

/** «100 horas», «1500 horas»: el formato de las dos producciones (19/10). */
export const horasEnTexto = (n) => (n == null ? null : `${n} horas`);

/** Las horas que quedan guardadas: las escritas o, si no hay, las de la regla del tipo. */
export function horasQueSeGuardan(horas, tipo) {
  if (horas != null) return horas;
  return tipo ? HORAS_POR_TIPO[tipo] : null;
}

function validar(body) {
  const r = formacionSchema.safeParse(body || {});
  if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos inválidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

const fechaISO = (d) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

/**
 * La formación para la pantalla. `conPorcentajes`: el % de cada tutora es dinero
 * (su comisión): solo lo ve quien gestiona colaboraciones (`tutores.gestionar`).
 */
export async function verFormacion(productId, projectId, { conPorcentajes = false } = {}) {
  const { rows: [p] } = await query(
    `SELECT id, project_id, nombre, tipo_formacion, horas, precio, moneda, modalidad,
            fecha_inicio, fecha_fin, fecha_inicio_texto, num_modulos, active,
            source_type, wc_product_id, url_info, updated_at
       FROM products WHERE id = $1`,
    [productId]
  );
  if (!p) throw new AppError('Formación no encontrada', 404, 'PRODUCT_NOT_FOUND');
  if (Number(p.project_id) !== Number(projectId)) throw new AppError('No tienes acceso a esta formación', 403, 'FORBIDDEN');

  const [{ rows: modulos }, { rows: tutoras }, { rows: cursos }] = await Promise.all([
    query(
      `SELECT id, orden, titulo, descripcion, horas, dias_desbloqueo FROM product_modules
        WHERE product_id = $1 ORDER BY orden, id`,
      [productId]
    ),
    query(
      `SELECT c.id AS colaboracion_id, c.tutor_id, u.nombre, c.pct, c.vigente_desde, c.vigente_hasta
         FROM tutor_collaborations c
         JOIN users u ON u.id = c.tutor_id
        WHERE c.product_id = $1 AND c.activa
          AND (c.vigente_hasta IS NULL OR c.vigente_hasta >= CURRENT_DATE)
        ORDER BY lower(u.nombre), c.id`,
      [productId]
    ),
    query(
      `SELECT curso_moodle_id, curso_nombre, dias_secciones FROM moodle_cursos_producto
        WHERE product_id = $1 AND project_id = $2 ORDER BY curso_moodle_id`,
      [productId, p.project_id]
    ),
  ]);

  const horas = horasDeTexto(p.horas);
  const tipoGuardado = p.tipo_formacion || null;
  return {
    id: Number(p.id),
    project_id: Number(p.project_id),
    nombre: p.nombre,
    tipo_formacion: tipoGuardado,
    // Sin tipo guardado, el que se adivina por el nombre (como hasta hoy en Cursos pendientes),
    // para proponerlo en la pantalla. No se guarda hasta que alguien lo confirma.
    tipo_por_nombre: tipoGuardado ? null : tipoPorNombre(p.nombre),
    horas_totales: horas,
    horas_texto: p.horas || null,
    precio: p.precio == null ? null : Number(p.precio),
    moneda: p.moneda || null,
    modalidad: p.modalidad || null,
    fecha_inicio: fechaISO(p.fecha_inicio),
    fecha_fin: fechaISO(p.fecha_fin),
    fecha_inicio_texto: p.fecha_inicio_texto || null,
    activa: p.active,
    // Viene de la web: la importación vuelve a escribir nombre, precio y lo que la web diga.
    de_la_web: Boolean(p.source_type || p.wc_product_id),
    url_info: p.url_info || null,
    updated_at: p.updated_at,
    modulos: modulos.map((m) => ({
      id: Number(m.id), orden: m.orden, titulo: m.titulo, descripcion: m.descripcion, horas: m.horas,
      dias_desbloqueo: m.dias_desbloqueo ?? null,
    })),
    horas_de_los_modulos: modulos.reduce((s, m) => s + (Number(m.horas) || 0), 0),
    tutoras: tutoras.map((t) => ({
      colaboracion_id: Number(t.colaboracion_id),
      tutor_id: Number(t.tutor_id),
      nombre: t.nombre,
      ...(conPorcentajes ? { pct: Number(t.pct) } : {}),
      vigente_desde: fechaISO(t.vigente_desde),
      vigente_hasta: fechaISO(t.vigente_hasta),
    })),
    cursos_moodle: cursos.map((c) => ({
      curso_moodle_id: Number(c.curso_moodle_id), curso_nombre: c.curso_nombre,
      // Los días que el CRM dejó en cada sección la última vez que lo llevó a Moodle (CRM#1124).
      dias_secciones: Array.isArray(c.dias_secciones) ? c.dias_secciones : [],
    })),
  };
}

/**
 * Deja los módulos de la formación como la lista: los que traen `id` se
 * actualizan, los nuevos se crean y los que no vienen se quitan. El orden es el
 * de la lista, 1…n (`ordenDeLaPosicion`, CRM#1215). Dentro de la transacción de quien llama.
 *
 * «Se desbloquea a los … días» (CRM#1124) va con la fase 2 de Moodle: solo se escribe con
 * el interruptor encendido y si el módulo trae la clave; si no, se queda lo guardado.
 */
async function guardarModulos(db, productId, modulos, { conDesbloqueo = formacionesMoodleActivas() } = {}) {
  const { rows } = await db.query('SELECT id FROM product_modules WHERE product_id = $1', [productId]);
  const suyos = new Set(rows.map((r) => Number(r.id)));
  const ajeno = modulos.find((m) => m.id && !suyos.has(m.id));
  if (ajeno) throw new AppError('Uno de los módulos no es de esta formación', 400, 'VALIDATION_ERROR');

  const quedan = modulos.filter((m) => m.id).map((m) => m.id);
  await db.query(
    'DELETE FROM product_modules WHERE product_id = $1 AND NOT (id = ANY($2::int[]))',
    [productId, quedan]
  );
  for (let i = 0; i < modulos.length; i++) {
    const m = modulos[i];
    const valores = [m.titulo, m.descripcion ?? null, m.horas ?? null, ordenDeLaPosicion(i)];
    const dias = conDesbloqueo && m.dias_desbloqueo !== undefined;
    if (m.id) {
      await db.query(
        `UPDATE product_modules SET titulo = $1, descripcion = $2, horas = $3, orden = $4,
                dias_desbloqueo = CASE WHEN $7 THEN $8::int ELSE dias_desbloqueo END, updated_at = NOW()
          WHERE id = $5 AND product_id = $6`,
        [...valores, m.id, productId, dias, dias ? m.dias_desbloqueo : null]
      );
    } else {
      await db.query(
        `INSERT INTO product_modules (product_id, titulo, descripcion, horas, orden, dias_desbloqueo)
         VALUES ($5, $1, $2, $3, $4, $6)`,
        [...valores, productId, dias ? m.dias_desbloqueo : null]
      );
    }
  }
}

async function nombreRepetido(db, projectId, nombre, salvoId = null) {
  const { rows } = await db.query(
    `SELECT id FROM products WHERE project_id = $1 AND nombre = $2 AND active = true
        AND ($3::int IS NULL OR id <> $3)`,
    [projectId, nombre, salvoId]
  );
  return rows.length > 0;
}

const apuntar = (db, { userId, ip, accion, detalle }) => (userId
  ? db.query(
    'INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3::jsonb, $4)',
    [userId, accion, JSON.stringify(detalle), ip || null]
  )
  : null);

/** Crea la formación (producto + módulos) en el campus. Devuelve su id. */
export async function crearFormacion(projectId, body, { userId = null, ip = null } = {}) {
  const d = validar(body);
  const db = await getClient();
  try {
    await db.query('BEGIN');
    if (await nombreRepetido(db, projectId, d.nombre)) {
      throw new AppError('Ya existe una formación con ese nombre en este campus', 409, 'PRODUCT_DUPLICATE');
    }
    const horas = horasQueSeGuardan(d.horas_totales ?? null, d.tipo_formacion ?? null);
    const { rows: [p] } = await db.query(
      `INSERT INTO products (project_id, nombre, tipo_formacion, horas, precio, moneda, modalidad,
                             fecha_inicio, fecha_fin, num_modulos)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'EUR'), $7, $8, $9, $10)
       RETURNING id`,
      [projectId, d.nombre, d.tipo_formacion ?? null, horasEnTexto(horas), d.precio ?? null, d.moneda ?? null,
       d.modalidad ?? null, d.fecha_inicio ?? null, d.fecha_fin ?? null, d.modulos?.length || null]
    );
    if (d.modulos?.length) await guardarModulos(db, p.id, d.modulos);
    await apuntar(db, {
      userId, ip, accion: 'products.formacion_crear',
      detalle: { product_id: p.id, project_id: projectId, nombre: d.nombre, modulos: d.modulos?.length || 0 },
    });
    await db.query('COMMIT');
    return Number(p.id);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Guarda la formación entera. Solo cambia lo que viene: un campo que no se
 * manda se queda como estaba; `modulos` que no viene deja los módulos como
 * estaban, y `modulos: []` los quita todos.
 */
export async function guardarFormacion(productId, projectId, body, { userId = null, ip = null } = {}) {
  const d = validar(body);
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const { rows: [p] } = await db.query(
      'SELECT id, project_id, nombre, tipo_formacion, horas FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );
    if (!p) throw new AppError('Formación no encontrada', 404, 'PRODUCT_NOT_FOUND');
    if (Number(p.project_id) !== Number(projectId)) throw new AppError('No tienes acceso a esta formación', 403, 'FORBIDDEN');
    if (d.nombre !== p.nombre && await nombreRepetido(db, projectId, d.nombre, productId)) {
      throw new AppError('Ya existe una formación con ese nombre en este campus', 409, 'PRODUCT_DUPLICATE');
    }

    const sets = ['nombre = $1'];
    const valores = [d.nombre];
    const poner = (col, v) => { valores.push(v); sets.push(`${col} = $${valores.length}`); };
    if (d.tipo_formacion !== undefined) poner('tipo_formacion', d.tipo_formacion);
    const tipo = d.tipo_formacion !== undefined ? d.tipo_formacion : p.tipo_formacion;
    // Un texto de horas que no es una cifra («De 120 a 150 horas», de la web) sale vacío en
    // la pantalla: guardar sin escribir horas no lo borra.
    const textoSinCifra = Boolean(p.horas) && horasDeTexto(p.horas) == null;
    if (d.horas_totales != null || (d.horas_totales === null && !textoSinCifra)) {
      poner('horas', horasEnTexto(horasQueSeGuardan(d.horas_totales, tipo)));
    } else if (d.horas_totales === undefined && !p.horas && tipo) {
      poner('horas', horasEnTexto(HORAS_POR_TIPO[tipo]));
    }
    if (d.precio !== undefined) poner('precio', d.precio);
    // La columna no admite vacío: sin moneda, la de siempre.
    if (d.moneda !== undefined) poner('moneda', d.moneda || 'EUR');
    if (d.modalidad !== undefined) poner('modalidad', d.modalidad);
    if (d.fecha_inicio !== undefined) poner('fecha_inicio', d.fecha_inicio);
    if (d.fecha_fin !== undefined) poner('fecha_fin', d.fecha_fin);
    if (d.modulos !== undefined) poner('num_modulos', d.modulos.length || null);
    valores.push(productId);
    await db.query(`UPDATE products SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${valores.length}`, valores);

    if (d.modulos !== undefined) await guardarModulos(db, productId, d.modulos);
    await apuntar(db, {
      userId, ip, accion: 'products.formacion_guardar',
      detalle: { product_id: productId, project_id: projectId, campos: Object.keys(d).filter((k) => k !== 'modulos'), modulos: d.modulos?.length ?? null },
    });
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}
