import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * El programa de una venta es el del catálogo, no el nombre del cliente (#160).
 *
 * `createSale` mandaba el NOMBRE DEL CLIENTE como `producto_contratado`
 * contando con que el servicio lo corrigiera con un lookup. Pero ese lookup
 * solo iba de texto a id, y con el id ya puesto no corría: toda venta hecha
 * desde el formulario guardaba «Pedro Sanchez» como programa.
 *
 * Se fija contra Postgres de verdad, porque lo que falla aquí es lo que llega
 * a la columna:
 *
 *   - el alta por el formulario guarda el nombre del catálogo;
 *   - la migración repara las ya guardadas mal, solo esas, y se puede aplicar
 *     dos veces sin que la segunda toque nada.
 */

const request = supertest(app);
const PROYECTO = 1;
const FECHA = '2026-03-11';
const CATALOGO = 'Curso Producto Catalogo Test';
const MIGRACION = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations/231_producto_de_las_ventas_viejas.sql'
);

let token;
let leadId;
let productoId;
const creadas = [];

async function fichaDirecta(producto) {
  const { rows } = await pool.query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id,
                              importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, 100, 100, $5) RETURNING id`,
    [leadId, PROYECTO, producto, productoId, FECHA]);
  creadas.push(rows[0].id);
  return rows[0].id;
}

const textoDe = async (id) =>
  (await pool.query('SELECT producto_contratado FROM conversions WHERE id = $1', [id]))
    .rows[0].producto_contratado;

beforeAll(async () => {
  const login = await request.post('/api/auth/login')
    .send({ email: 'diego@empresa.com', password: 'CrmTemp2026!' });
  token = login.body.data.accessToken;

  const { rows: pr } = await pool.query(
    `INSERT INTO products (project_id, nombre, precio, active)
     VALUES ($1, $2, 300, TRUE) RETURNING id`, [PROYECTO, CATALOGO]);
  productoId = pr[0].id;

  const { rows } = await pool.query(
    // `fecha_solicitud` además de `created_at`: el CRM no deja vender antes de
    // que el prospecto entre, y mira la primera de las dos.
    `INSERT INTO leads (project_id, nombre, email, status, responsable_id, created_at, fecha_solicitud)
     VALUES ($1, 'Pedro Sanchez Producto Test', 'pedro-producto@test-producto.com', 'en_seguimiento', 2, $2, $2)
     RETURNING id`, [PROYECTO, '2026-03-01 09:00:00']);
  leadId = rows[0].id;
});

afterAll(async () => {
  for (const id of creadas) {
    await pool.query('DELETE FROM conversions_producto_reparado WHERE conversion_id = $1', [id]);
    await pool.query('DELETE FROM conversion_payments WHERE conversion_id = $1', [id]);
    await pool.query('DELETE FROM conversion_items WHERE conversion_id = $1', [id]);
    await pool.query('DELETE FROM conversions WHERE id = $1', [id]);
  }
  await pool.query('DELETE FROM lead_status_history WHERE lead_id = $1', [leadId]);
  await pool.query('DELETE FROM leads WHERE id = $1', [leadId]);
  await pool.query('DELETE FROM products WHERE id = $1', [productoId]);
  await pool.end();
});

describe('el alta por el formulario de Ventas', () => {
  it('guarda el nombre del catálogo, no el del cliente', async () => {
    const res = await request.post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        project_id: PROYECTO,
        lead_id: leadId,
        producto_interes_id: productoId,
        importe_total: 60,
        importe_pagado: 60,
        metodo_pago: 'transferencia',
        fecha_pago: FECHA,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.conversion_id;
    creadas.push(id);

    const { rows } = await pool.query(
      'SELECT producto_contratado, producto_contratado_id FROM conversions WHERE id = $1', [id]);
    expect(rows[0].producto_contratado).toBe(CATALOGO);
    expect(rows[0].producto_contratado_id).toBe(productoId);
  });
});

describe('la migración que repara las ya guardadas mal', () => {
  it('repara las que dicen el nombre del cliente o «Cliente», y solo esas', async () => {
    const conNombre = await fichaDirecta('Pedro Sanchez Producto Test');
    const conLiteral = await fichaDirecta('Cliente');
    // Difiere del catálogo, pero NO es lo que escribía el fallo: un curso que
    // se renombró después. No es de este bug y no se toca.
    const renombrada = await fichaDirecta('Curso con el nombre de antes');
    const yaBien = await fichaDirecta(CATALOGO);

    await pool.query(fs.readFileSync(MIGRACION, 'utf8'));

    expect(await textoDe(conNombre)).toBe(CATALOGO);
    expect(await textoDe(conLiteral)).toBe(CATALOGO);
    expect(await textoDe(renombrada)).toBe('Curso con el nombre de antes');
    expect(await textoDe(yaBien)).toBe(CATALOGO);

    // El antes queda apuntado, para poder deshacerlo sin adivinar.
    const { rows } = await pool.query(
      'SELECT conversion_id, decia FROM conversions_producto_reparado WHERE conversion_id = ANY($1::int[]) ORDER BY conversion_id',
      [[conNombre, conLiteral, renombrada, yaBien]]);
    expect(rows.map((r) => [r.conversion_id, r.decia])).toEqual([
      [conNombre, 'Pedro Sanchez Producto Test'],
      [conLiteral, 'Cliente'],
    ]);
  });

  it('aplicarla otra vez no cambia nada', async () => {
    const id = await fichaDirecta('Pedro Sanchez Producto Test');
    await pool.query(fs.readFileSync(MIGRACION, 'utf8'));
    expect(await textoDe(id)).toBe(CATALOGO);

    const { rows: antes } = await pool.query(
      'SELECT reparado_at FROM conversions_producto_reparado WHERE conversion_id = $1', [id]);
    await pool.query(fs.readFileSync(MIGRACION, 'utf8'));
    const { rows: despues } = await pool.query(
      'SELECT reparado_at FROM conversions_producto_reparado WHERE conversion_id = $1', [id]);

    expect(await textoDe(id)).toBe(CATALOGO);
    expect(despues[0].reparado_at).toEqual(antes[0].reparado_at);
  });
});
