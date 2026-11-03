import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { ventasSinFormacion } from '../src/modules/sales/sales.service.js';
import { create } from '../src/modules/conversions/conversion.model.js';

/**
 * Las ventas que no dicen de qué formación son (#41).
 *
 * 321 cobradas sin curso del catálogo detrás —272 en ISEIE y 49 en MultiCRM—.
 * La consecuencia no es estética: sin formación no se sabe de quién es la
 * comisión y NINGÚN PROFESOR COBRA por ellas.
 *
 * Esto cubre las dos primeras subfases: sacar la lista, y cruzar
 * automáticamente las que se puedan por el nombre. Va contra Postgres porque
 * el cruce es SQL —normalización de tildes y mayúsculas incluida— y un mock
 * del SQL no prueba el SQL.
 *
 * Lo que más importa de aquí es lo que NO propone:
 *
 *   - con DOS cursos que normalizan igual, no sugiere ninguno. Adivinar cuál
 *     de los dos es exactamente lo que no puede hacer una máquina: atar un
 *     cobro a la formación equivocada se paga a quien no era, y eso no se ve
 *     en ningún aviso.
 *   - una venta SIN COBRAR no entra: la comisión nace del cobro.
 */

/*
  PROYECTO PROPIO, y no el 1.

  La consulta devuelve las ventas de TODO un proyecto, y en el 1 escriben a la
  vez otros ficheros de la suite. Con el 1 esto pasó aislado y falló una vez en
  la suite entera — intermitente, que es tan malo como rojo: la siguiente vez
  que falle nadie sabrá si es de verdad.

  Con proyecto propio nadie interfiere y esta prueba no interfiere con nadie.
*/
let PROYECTO;
const creado = { productos: [], leads: [], ventas: [] };

async function producto(nombre) {
  const { rows } = await pool.query(
    `INSERT INTO products (project_id, nombre, precio, active)
     VALUES ($1, $2, 100, TRUE) RETURNING id`, [PROYECTO, nombre]);
  creado.productos.push(rows[0].id);
  return rows[0].id;
}

async function venta({ texto, productoId = null, conCobro = true, total = 300, cobro = 300 }) {
  const { rows: l } = await pool.query(
    `INSERT INTO leads (project_id, nombre, email, status, created_at, fecha_solicitud)
     VALUES ($1, 'Alumno SinForm', $2, 'convertido', '2026-02-01', '2026-02-01') RETURNING id`,
    [PROYECTO, `sinform-${Math.random().toString(36).slice(2, 9)}@test.com`]);
  creado.leads.push(l[0].id);
  const { rows: c } = await pool.query(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id,
                              importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-02-10') RETURNING id`,
    [l[0].id, PROYECTO, texto, productoId, total, cobro]);
  creado.ventas.push(c[0].id);
  if (conCobro) {
    await pool.query(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo)
       VALUES ($1, $2, '2026-02-10', 'tarjeta')`, [c[0].id, cobro]);
  }
  return c[0].id;
}

let idUnico;
beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, type)
     VALUES ('SinFormacion Test', 'sinformacion-test', 'whk_sinform_test', 'crm') RETURNING id`);
  PROYECTO = rows[0].id;
  idUnico = await producto('Diplomado en Neurociencia');
  await producto('Curso de Algo Repetido');
  await producto('Curso de Algo Repetído');   // mismo nombre normalizado
});

afterAll(async () => {
  for (const id of creado.ventas) {
    await pool.query('DELETE FROM conversion_payments WHERE conversion_id = $1', [id]);
    await pool.query('DELETE FROM conversions WHERE id = $1', [id]);
  }
  for (const id of creado.leads) {
    await pool.query('DELETE FROM lead_status_history WHERE lead_id = $1', [id]);
    await pool.query('DELETE FROM leads WHERE id = $1', [id]);
  }
  await pool.query('DELETE FROM products WHERE id = ANY($1::int[])', [creado.productos]);
  await pool.query('DELETE FROM projects WHERE id = $1', [PROYECTO]);
  await pool.end();
});

describe('qué entra en la lista', () => {
  it('una venta sin curso del catálogo entra', async () => {
    const id = await venta({ texto: 'Diplomado en Neurociencia' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.map((f) => f.id)).toContain(id);
  });

  it('una que SÍ tiene curso no entra', async () => {
    const id = await venta({ texto: 'Diplomado en Neurociencia', productoId: idUnico });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.map((f) => f.id)).not.toContain(id);
  });

  it('una SIN COBRAR tampoco: la comisión nace del cobro', async () => {
    const id = await venta({ texto: 'Diplomado en Neurociencia', conCobro: false });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.map((f) => f.id)).not.toContain(id);
  });
});

describe('el cruce automático', () => {
  it('propone el curso cuando el nombre coincide', async () => {
    const id = await venta({ texto: 'Diplomado en Neurociencia' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    const f = r.filas.find((x) => x.id === id);
    expect(f.sugerencia?.id).toBe(idUnico);
  });

  it('ignora tildes y mayúsculas, como el alta', async () => {
    const id = await venta({ texto: 'DIPLOMADO EN NEUROCIÉNCIA' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.find((x) => x.id === id).sugerencia?.id).toBe(idUnico);
  });

  it('con DOS cursos que normalizan igual NO propone ninguno', async () => {
    // Lo importante de toda esta pieza. Atar el cobro a la formación
    // equivocada se paga a quien no era, y eso no sale en ningún aviso.
    const id = await venta({ texto: 'Curso de Algo Repetido' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.find((x) => x.id === id).sugerencia).toBeNull();
  });

  it('sin ningún curso parecido, tampoco', async () => {
    const id = await venta({ texto: 'Algo que no está en el catálogo' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.find((x) => x.id === id).sugerencia).toBeNull();
  });

  it('el texto sucio se limpia antes de cruzar', async () => {
    // «Producto/servicio: servicio académico, …» es lo que traía el pago, y
    // sin quitarlo no cruza con nada.
    const id = await venta({ texto: 'Producto/servicio: servicio académico, Diplomado en Neurociencia' });
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.filas.find((x) => x.id === id).sugerencia?.id).toBe(idUnico);
  });
});

describe('el resumen', () => {
  it('cuenta las que tienen sugerencia y suma el importe', async () => {
    const r = await ventasSinFormacion({ projectId: PROYECTO });
    expect(r.total).toBe(r.filas.length);
    expect(r.conSugerencia).toBe(r.filas.filter((f) => f.sugerencia).length);
    expect(r.importe).toBeGreaterThan(0);
  });
});

describe('lo vendido y lo cobrado no son lo mismo', () => {
  it('la tarjeta suma lo COBRADO: una venta de 1.000 con 400 cobrados cuenta 400', async () => {
    // Antes la tarjeta sumaba el total de la venta y lo rotulaba «cobrados»: con
    // 1.000 vendidos y 400 cobrados enseñaba 1.000 arriba y 400 en la fila de la
    // misma venta. Las demas pruebas crean ventas con total = cobrado y no lo veian.
    const id = await venta({ texto: 'Curso Parcial Sin Catalogo', total: 1000, cobro: 400 });
    const r = await ventasSinFormacion({ projectId: PROYECTO });

    expect(r.filas.find((f) => f.id === id)).toMatchObject({ importe: 1000, cobrado: 400 });
    expect(r.cobrado).toBeCloseTo(r.filas.reduce((t, f) => t + f.cobrado, 0), 2);
    expect(r.importe).toBeCloseTo(r.filas.reduce((t, f) => t + f.importe, 0), 2);
    // Y no son la misma cifra: hay una venta a medio cobrar en la lista.
    expect(r.cobrado).toBeLessThan(r.importe);
  });
});

describe('cerrar el grifo: el curso sale de las lineas', () => {
  /*
    De dónde salían las nuevas (#41, última subfase).

    Una venta con VARIOS ARTÍCULOS nacía siempre sin curso: el diálogo manda
    `producto_contratado_id: null` a propósito —son varias líneas, no cabe una
    sola FK— y el texto queda como «1x Curso A + 2x Curso B», que no cruza con
    nada. Ningún profesor cobraba comisión por ellas, y entraban en la lista de
    arriba para quedarse.

    Las líneas sí guardan su `product_id`, así que de ahí sale el curso cuando
    todas apuntan al mismo. Cuando apuntan a cursos distintos no se inventa
    ninguno: ahí de verdad no hay un curso único.
  */
  async function lead() {
    const { rows } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email, status, created_at, fecha_solicitud)
       VALUES ($1, 'Alumno Lineas', $2, 'en_seguimiento', '2026-02-01', '2026-02-01') RETURNING id`,
      [PROYECTO, `lineas-${Math.random().toString(36).slice(2, 9)}@test.com`]);
    creado.leads.push(rows[0].id);
    return rows[0].id;
  }

  async function conLineas(items) {
    const leadId = await lead();
    const c = await create({
      lead_id: leadId, project_id: PROYECTO,
      producto_contratado: items.map((i) => `1x ${i.descripcion}`).join(' + '),
      importe_total: 300, importe_pagado: 0, items,
      // `lead_status_history.changed_by` es NOT NULL: el modelo apunta quién
      // pasó el lead a convertido. Sin esto la creación se cae entera.
      changed_by: 1,
    });
    creado.ventas.push(c.id);
    return c;
  }

  it('una sola línea del catálogo: la venta se queda con ese curso', async () => {
    const c = await conLineas([
      { product_id: idUnico, descripcion: 'Diplomado en Neurociencia', cantidad: 1, precio_unitario: 300 },
    ]);
    expect(c.producto_contratado_id).toBe(idUnico);
  });

  it('varias líneas del MISMO curso, también', async () => {
    // El caso normal: una venta partida en dos lineas del mismo curso.
    const c = await conLineas([
      { product_id: idUnico, descripcion: 'Diplomado en Neurociencia', cantidad: 1, precio_unitario: 150 },
      { product_id: idUnico, descripcion: 'Diplomado en Neurociencia', cantidad: 1, precio_unitario: 150 },
    ]);
    expect(c.producto_contratado_id).toBe(idUnico);
  });

  it('líneas de cursos DISTINTOS: no se inventa ninguno', async () => {
    const otro = await producto('Otro Curso Distinto');
    const c = await conLineas([
      { product_id: idUnico, descripcion: 'Diplomado en Neurociencia', cantidad: 1, precio_unitario: 150 },
      { product_id: otro, descripcion: 'Otro Curso Distinto', cantidad: 1, precio_unitario: 150 },
    ]);
    expect(c.producto_contratado_id).toBeNull();
  });

  it('líneas sin producto del catálogo: se queda sin curso, como antes', async () => {
    const c = await conLineas([
      { product_id: null, descripcion: 'Algo escrito a mano', cantidad: 1, precio_unitario: 300 },
    ]);
    expect(c.producto_contratado_id).toBeNull();
  });

  it('si el curso venía puesto, las líneas NO lo pisan', async () => {
    const otro = await producto('Curso Que No Manda');
    const leadId = await lead();
    const c = await create({
      lead_id: leadId, project_id: PROYECTO,
      producto_contratado: 'Diplomado en Neurociencia',
      producto_contratado_id: idUnico,
      importe_total: 300, importe_pagado: 0, changed_by: 1,
      items: [{ product_id: otro, descripcion: 'Curso Que No Manda', cantidad: 1, precio_unitario: 300 }],
    });
    creado.ventas.push(c.id);
    expect(c.producto_contratado_id).toBe(idUnico);
  });
});
