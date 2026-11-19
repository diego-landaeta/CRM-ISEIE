import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

/**
 * CRM#767 (gemela CRM-ISEIE#455) · Matrícula automática en Moodle, fase 1.
 *
 *   primer pago → programada (día anterior al inicio, o ya); segundo pago → nada
 *   nuevo; quitar el pago o borrar la venta → cancelada; la vuelta de cada hora
 *   → «lista» con aviso, o reintento y «fallo» con aviso y motivo; interruptor
 *   apagado → ni una consulta de más.
 *
 * Con base real (la de db-preparar, con la 311). No se llama a Moodle.
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const { default: pool } = await import('../src/shared/config/db.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const { recalcularCobrado } = await import('../src/modules/conversions/cobrado.js');
const mm = await import('../src/modules/matricula-moodle/matricula-moodle.service.js');

const MARCA = `M767_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const DESTINO = [987654321]; // destinatarios de la campana en las pruebas
const ENV = ['MATRICULA_MOODLE_ACTIVA', 'MATRICULA_MOODLE_CAMPUS', 'MATRICULA_MOODLE_INTENTOS', 'MATRICULA_MOODLE_HORA'];
const guardadas = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let proyecto;
let otroCampus;
let producto;
let productoSinCurso;

const diaMas = (n) => {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function venta({ campus = proyecto, product = producto, pagado = 0, fecha_inicio, email = 'alumna.767@example.com' } = {}) {
  const [lead] = await q(
    'INSERT INTO leads (nombre, email, project_id) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} alumna`, email, campus.id]
  );
  return conversionModel.create({
    lead_id: lead.id, project_id: campus.id, producto_contratado: product ? product.nombre : `${MARCA} libre`,
    producto_contratado_id: product ? product.id : null,
    importe_total: 900, importe_pagado: pagado, metodo_pago: 'transferencia',
    fecha_conversion: diaMas(0), iva_incluido: true, fecha_inicio,
  });
}

const pagar = (v, importe = 300) => conversionModel.addPayment(v.id, { importe, metodo: 'transferencia' }, { allowDuplicate: true });
const matriculasDe = (v) => q('SELECT * FROM matriculas_moodle WHERE conversion_id = $1 ORDER BY id', [v.id]);
const avisosDe = (id) => q(`SELECT * FROM admin_notifications WHERE (metadata->>'matricula_id')::int = $1 ORDER BY id`, [id]);
// Que lo de otras pruebas no se cuele en la vuelta: solo los campus de esta.
const soloEstosCampus = () => { process.env.MATRICULA_MOODLE_CAMPUS = `${proyecto.id},${otroCampus.id}`; };

beforeAll(async () => {
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre, slug',
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  [otroCampus] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre, slug',
    [`${MARCA}b`, `${MARCA.toLowerCase()}b`, `${MARCA}b`]
  );
  [producto] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id, nombre', [proyecto.id, `${MARCA} Máster`]);
  [productoSinCurso] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id, nombre', [proyecto.id, `${MARCA} Curso suelto`]);
  await q(
    `INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre)
     VALUES ($1, $2, 41, 'Máster de prueba')`,
    [producto.id, proyecto.id]
  );
});

afterEach(() => {
  for (const k of ENV) {
    if (guardadas[k] === undefined) delete process.env[k]; else process.env[k] = guardadas[k];
  }
});

afterAll(async () => {
  const campus = [proyecto?.id, otroCampus?.id].filter(Boolean);
  if (campus.length) {
    const ventas = 'SELECT id FROM conversions WHERE project_id = ANY($1::int[])';
    await q(`DELETE FROM admin_notifications WHERE (metadata->>'campus_id')::int = ANY($1::int[])`, [campus]);
    await q('DELETE FROM matriculas_moodle WHERE project_id = ANY($1::int[])', [campus]);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`, [campus]);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, [campus]);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`, [campus]);
    await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [campus]);
    await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [campus]);
    await q('DELETE FROM moodle_cursos_producto WHERE project_id = ANY($1::int[])', [campus]);
    await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [campus]);
    await q('DELETE FROM projects WHERE id = ANY($1::int[])', [campus]);
  }
  await pool.end();
});

describe('#767 · con el interruptor apagado no cambia nada', () => {
  it('recalcularCobrado hace la misma única consulta de siempre', async () => {
    delete process.env.MATRICULA_MOODLE_ACTIVA;
    const consultas = [];
    const db = { query: async (sql) => { consultas.push(sql); return { rows: [{ importe_pagado: '100' }] }; } };
    expect(await recalcularCobrado(db, 1)).toBe(100);
    expect(consultas).toHaveLength(1);
    expect(consultas[0]).toMatch(/^UPDATE conversions c/);
  });

  it('un pago no programa nada y la vuelta no hace nada', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '0';
    const v = await venta();
    await pagar(v);
    expect(await matriculasDe(v)).toHaveLength(0);
    expect((await mm.vuelta({ destinatarios: DESTINO })).revisadas).toBe(0);
  });
});

describe('#767 · el primer pago programa la matrícula', () => {
  it('sin fecha de inicio: para ya; el segundo pago no programa otra', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    expect(await matriculasDe(v)).toHaveLength(0); // sin cobrar, nada

    await pagar(v);
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('programada');
    expect(m.lead_id).toBe(v.lead_id);
    expect(m.project_id).toBe(proyecto.id);
    expect(Math.abs(new Date(m.programada_para) - Date.now())).toBeLessThan(5 * 60 * 1000);

    await pagar(v, 200);
    expect(await matriculasDe(v)).toHaveLength(1);
  });

  it('con fecha de inicio futura: el día anterior a las 08:00 de Madrid', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const inicio = diaMas(20);
    const v = await venta({ fecha_inicio: inicio });
    await pagar(v);
    const [m] = await matriculasDe(v);
    const [{ esperado }] = await q(
      `SELECT ((($1::date) - 1) + time '08:00') AT TIME ZONE 'Europe/Madrid' AS esperado`, [inicio]);
    expect(new Date(m.programada_para).toISOString()).toBe(new Date(esperado).toISOString());
  });

  it('con fecha de inicio ya pasada: para ya', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta({ fecha_inicio: diaMas(-3) });
    await pagar(v);
    const [m] = await matriculasDe(v);
    expect(Math.abs(new Date(m.programada_para) - Date.now())).toBeLessThan(5 * 60 * 1000);
  });

  it('el pago inicial al crear la venta también la programa', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta({ pagado: 300 });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('programada');
  });

  it('una venta que ya tenía cobros (una cuota más) no se programa', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '0';
    const v = await venta();
    await pagar(v); // cobrada antes de encenderlo
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    await pagar(v, 200);
    expect(await matriculasDe(v)).toHaveLength(0);
  });

  it('una plataforma de IA (no es campus, no tiene Moodle) no se programa', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    await q(`UPDATE projects SET type = 'ia' WHERE id = $1`, [otroCampus.id]);
    try {
      const v = await venta({ campus: otroCampus, product: null });
      await pagar(v);
      expect(await matriculasDe(v)).toHaveLength(0);
    } finally {
      await q(`UPDATE projects SET type = 'crm' WHERE id = $1`, [otroCampus.id]);
    }
  });

  it('un campus fuera de la lista del interruptor no se programa', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    process.env.MATRICULA_MOODLE_CAMPUS = String(otroCampus.id);
    const v = await venta();
    await pagar(v);
    expect(await matriculasDe(v)).toHaveLength(0);
  });
});

describe('#767 · se cancela si se va el pago o la venta', () => {
  it('quitar el único pago la cancela; volver a pagar programa otra', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    const { payment } = await pagar(v);
    await conversionModel.deletePayment(payment.id);
    let filas = await matriculasDe(v);
    expect(filas.map((f) => f.estado)).toEqual(['cancelada']);
    expect(filas[0].motivo).toMatch(/pago/);

    await pagar(v);
    filas = await matriculasDe(v);
    expect(filas.map((f) => f.estado)).toEqual(['cancelada', 'programada']);
  });

  it('borrar la venta la cancela y la fila se queda sin venta', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    await pagar(v);
    const [m] = await matriculasDe(v);
    await q('DELETE FROM conversion_payments WHERE conversion_id = $1', [v.id]);
    await conversionModel.deleteConversion(v.id);
    const [despues] = await q('SELECT * FROM matriculas_moodle WHERE id = $1', [m.id]);
    expect(despues.estado).toBe('cancelada');
    expect(despues.conversion_id).toBeNull();
    expect(despues.motivo).toMatch(/borró la venta/);
  });

  it('si el cobro se deshace (ROLLBACK), la matrícula tampoco queda', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE)', [v.id]);
      await recalcularCobrado(client, v.id);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(await matriculasDe(v)).toHaveLength(0);
  });
});

describe('#767 · la vuelta de cada hora', () => {
  it('la que toca y está completa queda «lista» y avisa a administración', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    await pagar(v);
    const llamadas = [];
    const r = await mm.vuelta({ destinatarios: DESTINO, moodle: async (...a) => { llamadas.push(a); return { hecha: false }; } });
    expect(r.lista).toBeGreaterThanOrEqual(1);

    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('lista');
    expect(m.lista_at).not.toBeNull();
    expect(m.cursos).toEqual([{ project_id: proyecto.id, curso_moodle_id: 41, curso_nombre: 'Máster de prueba', product_id: producto.id }]);
    expect(llamadas.length).toBeGreaterThanOrEqual(1);

    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_LISTA);
    expect(aviso.target_user_ids).toEqual(DESTINO);
    expect(aviso.message).toMatch(/Máster de prueba \(id 41\)/);
    expect(aviso.link_path).toBe(`/clientes/${v.lead_id}`);

    // Otra vuelta no la vuelve a tocar ni a avisar.
    await mm.vuelta({ destinatarios: DESTINO });
    expect(await avisosDe(m.id)).toHaveLength(1);
  });

  it('la que aún no toca (inicio dentro de 20 días) se queda programada', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta({ fecha_inicio: diaMas(20) });
    await pagar(v);
    await mm.vuelta({ destinatarios: DESTINO });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('programada');
    expect(m.intentos).toBe(0);
  });

  it('si la comercial adelanta la fecha de inicio, la matrícula se mueve con ella', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta({ fecha_inicio: diaMas(20) });
    await pagar(v);
    await conversionModel.update(v.id, { fecha_inicio: diaMas(-1) });
    await mm.vuelta({ destinatarios: DESTINO });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('lista');
  });

  it('producto sin curso de Moodle: reintenta y, al agotar, «fallo» con el motivo y aviso', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    process.env.MATRICULA_MOODLE_INTENTOS = '2';
    soloEstosCampus();
    const v = await venta({ product: productoSinCurso });
    await pagar(v);

    await mm.vuelta({ destinatarios: DESTINO });
    let [m] = await matriculasDe(v);
    expect(m.estado).toBe('programada');
    expect(m.intentos).toBe(1);
    expect(m.motivo).toMatch(/no tiene curso de Moodle asignado/);
    expect(new Date(m.proximo_intento_at) > new Date()).toBe(true);
    expect(await avisosDe(m.id)).toHaveLength(0); // un tropiezo no avisa

    // Sin esperar la hora: se adelanta el reintento.
    await q('UPDATE matriculas_moodle SET proximo_intento_at = NOW() - interval \'1 minute\' WHERE id = $1', [m.id]);
    await mm.vuelta({ destinatarios: DESTINO });
    [m] = await matriculasDe(v);
    expect(m.estado).toBe('fallo');
    expect(m.intentos).toBe(2);

    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_FALLO);
    expect(aviso.message).toMatch(/Curso suelto».*no tiene curso de Moodle asignado/);
  });

  it('alumno sin correo: falla con ese motivo', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    process.env.MATRICULA_MOODLE_INTENTOS = '1';
    soloEstosCampus();
    const v = await venta({ email: null });
    await pagar(v);
    await mm.vuelta({ destinatarios: DESTINO });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('fallo');
    expect(m.motivo).toMatch(/correo/);
  });

  it('si Moodle (fase 2) lanza un error, cuenta como intento con ese mensaje', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    await pagar(v);
    await mm.vuelta({ destinatarios: DESTINO, moodle: async () => { throw new Error('Moodle no contesta'); } });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('programada');
    expect(m.motivo).toBe('Error al matricular: Moodle no contesta');
  });

  it('una programada cuya venta perdió los pagos por otro camino se cancela en la vuelta', async () => {
    process.env.MATRICULA_MOODLE_ACTIVA = '1';
    soloEstosCampus();
    const v = await venta();
    await pagar(v);
    await q('DELETE FROM conversion_payments WHERE conversion_id = $1', [v.id]); // sin pasar por el modelo
    await mm.vuelta({ destinatarios: DESTINO });
    const [m] = await matriculasDe(v);
    expect(m.estado).toBe('cancelada');
  });
});
