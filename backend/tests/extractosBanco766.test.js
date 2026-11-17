import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #766 · Extractos del banco (Santander): Norma 43 y CSV inventados.
 *
 *   · lectura de los dos formatos (sin base);
 *   · un abono con UN candidato claro (nombre e importe) se registra solo;
 *   · con dos candidatos queda «a revisar» y una persona lo confirma;
 *   · sin parecido, «sin candidato»; las liquidaciones de Stripe/PayPal, fuera;
 *   · lo ya apuntado a mano se engancha, no se suma;
 *   · el mismo fichero dos veces se rechaza y un extracto que se solapa no repite;
 *   · con el interruptor apagado, la subida contesta 404.
 *
 *   npx vitest run tests/extractosBanco766.test.js
 */
vi.setConfig({ testTimeout: 60000 });

const { query } = await import('../src/shared/config/db.js');
const parser = await import('../src/modules/cobros-externos/extracto.parser.js');
const servicio = await import('../src/modules/cobros-externos/extracto.service.js');
const conversiones = await import('../src/modules/conversions/conversion.service.js');
const { default: modulo } = await import('../src/modules/cobros-externos/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const MARCA = `BK766${Date.now().toString(36)}`;
const M = MARCA.toUpperCase();

// ─── Norma 43 de mentira ───────────────────────────────────────────────────
const n = (v, largo) => String(v).padStart(largo, '0');
const t = (v, largo) => String(v).padEnd(largo, ' ').slice(0, largo);
const aammdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
function n43(movs, { desde = '2026-11-01', hasta = '2026-11-30' } = {}) {
  const lineas = [`11${'0049'}${'1234'}${'0123456789'}${aammdd(desde)}${aammdd(hasta)}2${n(100000, 14)}9783${t('EMPRESA DE PRUEBA SL', 26)}   `];
  for (const m of movs) {
    const dh = m.importe < 0 ? '1' : '2';
    lineas.push(`22    1234${aammdd(m.fecha)}${aammdd(m.fecha)}02099${dh}${n(Math.round(Math.abs(m.importe) * 100), 14)}${n(0, 10)}${t(m.ref1 || '', 12)}${t(m.ref2 || '', 16)}`);
    if (m.concepto) lineas.push(`2301${t(m.concepto.slice(0, 38), 38)}${t(m.concepto.slice(38, 76), 38)}`);
  }
  lineas.push(`33${'0049'}${'1234'}${'0123456789'}${n(0, 5)}${n(0, 14)}${n(0, 5)}${n(0, 14)}2${n(0, 14)}978    `);
  lineas.push(`88${'9'.repeat(18)}${n(lineas.length, 6)}`);
  return Buffer.from(lineas.join('\r\n'), 'latin1');
}

describe('#766 · leer el extracto (sin base)', () => {
  it('Norma 43: abonos y cargos con su signo, fechas, concepto y la cuenta enmascarada', () => {
    const r = parser.leerExtracto(n43([
      { fecha: '2026-11-05', importe: 300, concepto: 'TRANSFERENCIA DE LUCIA EJEMPLO PRUEBA', ref1: 'REF123' },
      { fecha: '2026-11-06', importe: -45.5, concepto: 'RECIBO LUZ' },
    ]));
    expect(r.formato).toBe('n43');
    expect(r.cuenta).toBe('****6789');
    expect(r.movimientos).toHaveLength(2);
    expect(r.movimientos[0]).toMatchObject({ fechaOperacion: '2026-11-05', importe: 300, moneda: 'EUR' });
    expect(r.movimientos[0].concepto).toContain('LUCIA EJEMPLO PRUEBA');
    expect(r.movimientos[1].importe).toBe(-45.5);
  });

  it('CSV de la banca online: cabecera tras el titular, separador «;», coma decimal y miles con punto', () => {
    const csv = [
      'Titular;EMPRESA DE PRUEBA SL',
      'Cuenta;ES00 0049 1234 0000 0000 9999',
      '',
      'Fecha Operación;Fecha Valor;Concepto;Importe;Saldo',
      '05/11/2026;05/11/2026;TRANSFERENCIA DE LUCIA EJEMPLO;1.250,00;10.000,00',
      '06/11/2026;06/11/2026;"RECIBO; LUZ";-45,50;9.954,50',
    ].join('\n');
    const r = parser.leerExtracto(Buffer.from(csv, 'utf8'));
    expect(r.formato).toBe('csv');
    expect(r.cuenta).toBe('****9999');
    expect(r.movimientos.map((m) => m.importe)).toEqual([1250, -45.5]);
    expect(r.movimientos[1].concepto).toBe('RECIBO; LUZ');
  });

  it('CSV con Debe y Haber en columnas separadas', () => {
    const csv = 'Fecha,Concepto,Debe,Haber\n2026-11-07,ABONO X,,99.90\n2026-11-08,CARGO Y,10.00,\n';
    expect(parser.leerExtracto(Buffer.from(csv)).movimientos.map((m) => m.importe)).toEqual([99.9, -10]);
  });

  it('un fichero que no es ninguno de los dos se rechaza con un mensaje claro', () => {
    expect(() => parser.leerExtracto(Buffer.from('hola,adios\n1,2\n'))).toThrow(/Fecha/);
  });

  it('dos movimientos idénticos el mismo día tienen huellas distintas; el mismo en otro fichero, la misma', () => {
    const m = { cuenta: '****1', fechaOperacion: '2026-11-05', fechaValor: null, importe: 50, concepto: 'X', referencia: null };
    const [a, b] = parser.huellas(1, [m, { ...m }]);
    expect(a).not.toBe(b);
    expect(parser.huellas(1, [m])[0]).toBe(a);
  });

  it('proponer: nombre e importe con un solo candidato se enlaza; dos con el nombre, a revisar', () => {
    const ventas = [
      { id: 1, lead_id: 1, nombre: 'Lucía Ejemplo Prueba', importe_total: 900, cobrado: 0, proxima_cuota: 300 },
      { id: 2, lead_id: 2, nombre: 'Ana Gemela', importe_total: 500, cobrado: 0, proxima_cuota: null },
      { id: 3, lead_id: 3, nombre: 'Eva Gemela', importe_total: 500, cobrado: 0, proxima_cuota: null },
    ];
    expect(servicio.proponerVenta({ importe: 300, concepto: 'TRANSF LUCIA EJEMPLO' }, ventas))
      .toMatchObject({ estado: 'enlazar', conversionId: 1 });
    // Solo el nombre, sin el importe: aunque sea uno, lo decide una persona.
    expect(servicio.proponerVenta({ importe: 123, concepto: 'TRANSF LUCIA EJEMPLO' }, ventas).estado).toBe('a_revisar');
    // Una sola palabra del nombre no basta, y ninguna venta espera 777: nadie.
    expect(servicio.proponerVenta({ importe: 777, concepto: 'PAGO GEMELA' }, ventas).estado).toBe('sin_candidato');
    const dos = servicio.proponerVenta({ importe: 500, concepto: 'PAGO ANA EVA GEMELA' }, ventas);
    expect(dos.estado).toBe('a_revisar');
    expect(dos.candidatos.map((c) => c.conversion_id).sort()).toEqual([2, 3]);
    // Solo el importe: dos ventas esperan 500 → a revisar, nunca solo.
    expect(servicio.proponerVenta({ importe: 500, concepto: 'TRANSFERENCIA' }, ventas).estado).toBe('a_revisar');
    expect(servicio.proponerVenta({ importe: 870.12, concepto: 'LIQUIDACION STRIPE PAYMENTS' }, ventas))
      .toMatchObject({ estado: 'descartado', liquidacion: true });
  });
});

describe('#766 · importar el extracto (contra la base)', () => {
  const ids = { project: null, user: null, ventas: {} };
  const venta = async (clave, nombre, total, { cuota = null } = {}) => {
    const l = (await query(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`,
      [ids.project, nombre, `${clave}.${MARCA.toLowerCase()}@prueba.test`])).rows[0].id;
    const v = (await query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
       VALUES ($1, $2, 'Curso', $3, 0, DATE '2026-10-01') RETURNING id`, [l, ids.project, total])).rows[0].id;
    if (cuota) {
      for (let i = 1; i <= Math.round(total / cuota); i++) {
        await query(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
                     VALUES ($1, $2, $3, DATE '2026-10-01' + ($2 * 30))`, [v, i, cuota]);
      }
    }
    ids.ventas[clave] = v;
    return v;
  };
  const cobros = (v) => query('SELECT id, importe, origen, origen_ref FROM conversion_payments WHERE conversion_id = $1 ORDER BY id', [v])
    .then((r) => r.rows);
  const movs = () => query('SELECT * FROM movimientos_banco WHERE project_id = $1 ORDER BY id', [ids.project]).then((r) => r.rows);
  const FICHERO = () => n43([
    { fecha: '2026-11-05', importe: 300, concepto: `TRANSFERENCIA DE LUCIA UNO ${M} CUOTA` },
    { fecha: '2026-11-06', importe: 500, concepto: `PAGO ANA EVA GEMELA ${M}` },
    { fecha: '2026-11-06', importe: 12.34, concepto: 'DEVOLUCION SEGURO' },
    { fecha: '2026-11-07', importe: 870.12, concepto: 'LIQUIDACION STRIPE PAYMENTS' },
    { fecha: '2026-11-08', importe: 450, concepto: `TRANSF CLIENTE MANUAL ${M}` },
    { fecha: '2026-11-08', importe: -99, concepto: 'COMISION MANTENIMIENTO' },
  ]);

  beforeAll(async () => {
    ids.project = (await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`])).rows[0].id;
    ids.user = (await query(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
      [`${MARCA} admin`, `admin@${MARCA.toLowerCase()}.test`])).rows[0].id;
    await query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ids.user, ids.project]);
    await venta('uno', `Lucía Uno ${MARCA}`, 900, { cuota: 300 });
    await venta('ana', `Ana Gemela ${MARCA}`, 500);
    await venta('eva', `Eva Gemela ${MARCA}`, 500);
    await venta('manual', `Cliente Manual ${MARCA}`, 900);
    await conversiones.addPayment(ids.ventas.manual, { importe: 450, fecha: '2026-11-03', metodo: 'transferencia' });
  }, 60000);

  afterAll(async () => {
    for (const [sql, v] of [
      ['DELETE FROM movimientos_banco WHERE project_id = $1', ids.project],
      ['DELETE FROM extractos_banco WHERE project_id = $1', ids.project],
      ['DELETE FROM conversion_installments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', ids.project],
      ['DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', ids.project],
      ['DELETE FROM conversions WHERE project_id = $1', ids.project],
      ['DELETE FROM leads WHERE project_id = $1', ids.project],
      ['DELETE FROM user_projects WHERE project_id = $1', ids.project],
      ['DELETE FROM users WHERE id = $1', ids.user],
      ['DELETE FROM projects WHERE id = $1', ids.project],
    ]) {
      try { await query(sql, [v]); } catch { /* sigue limpiando */ }
    }
    delete process.env.SANTANDER_EXTRACTOS_ACTIVO;
  });

  it('cada abono acaba donde debe y los cargos no se guardan', async () => {
    const r = await servicio.importarExtracto({ projectId: ids.project, buffer: FICHERO(), nombre: 'nov.n43', userId: ids.user });
    expect(r).toMatchObject({ formato: 'n43', movimientos: 6, abonos: 5, nuevos: 5, enlazados: 1, yaApuntados: 1, aRevisar: 1, sinCandidato: 1, liquidaciones: 1 });
    const m = await movs();
    expect(m).toHaveLength(5);
    const de = (imp) => m.find((x) => Number(x.importe) === imp);

    // Un candidato claro: registrado solo, con su origen, y salda la primera cuota.
    const uno = await cobros(ids.ventas.uno);
    expect(uno).toHaveLength(1);
    expect(uno[0]).toMatchObject({ origen: 'santander', origen_ref: de(300).huella });
    expect(de(300)).toMatchObject({ estado: 'enlazado', conversion_payment_id: uno[0].id, link_method: 'auto' });
    const { rows: [cuota] } = await query(
      'SELECT payment_id FROM conversion_installments WHERE conversion_id = $1 AND numero = 1', [ids.ventas.uno]);
    expect(cuota.payment_id).toBe(uno[0].id);
    const { rows: [v] } = await query('SELECT importe_pagado FROM conversions WHERE id = $1', [ids.ventas.uno]);
    expect(Number(v.importe_pagado)).toBe(300);

    // Dos candidatos: no se registra nada.
    expect(de(500)).toMatchObject({ estado: 'a_revisar', conversion_payment_id: null });
    expect(de(500).candidatos.map((c) => c.conversion_id).sort()).toEqual([ids.ventas.ana, ids.ventas.eva].sort());
    expect(await cobros(ids.ventas.ana)).toHaveLength(0);
    expect(await cobros(ids.ventas.eva)).toHaveLength(0);

    expect(de(12.34)).toMatchObject({ estado: 'sin_candidato' });
    expect(de(870.12)).toMatchObject({ estado: 'descartado', link_method: 'auto_liquidacion' });

    // Ya estaba apuntado a mano: se engancha a ese y no se suma otro.
    const manual = await cobros(ids.ventas.manual);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ origen: 'santander', origen_ref: de(450).huella });
    expect(de(450)).toMatchObject({ estado: 'enlazado', conversion_payment_id: manual[0].id, link_method: 'auto_dedup' });
  });

  it('una persona confirma el dudoso: se registra en la venta que elige, una sola vez', async () => {
    const mov = (await movs()).find((x) => Number(x.importe) === 500);
    const [a, b] = await Promise.all([
      servicio.confirmar(mov.id, ids.ventas.eva, ids.user),
      servicio.confirmar(mov.id, ids.ventas.eva, ids.user),
    ]);
    expect([a, b].filter((x) => x.paymentId)).toHaveLength(1);
    expect(await cobros(ids.ventas.eva)).toHaveLength(1);
    expect(await servicio.confirmar(mov.id, ids.ventas.ana, ids.user)).toEqual({ error: 'YA_ENLAZADO' });
    expect(await cobros(ids.ventas.ana)).toHaveLength(0);
  });

  it('el mismo fichero otra vez se rechaza, y un extracto que se solapa no repite abonos', async () => {
    await expect(servicio.importarExtracto({ projectId: ids.project, buffer: FICHERO(), nombre: 'nov.n43', userId: ids.user }))
      .rejects.toMatchObject({ code: 'YA_SUBIDO' });
    const solapado = n43([
      { fecha: '2026-11-05', importe: 300, concepto: `TRANSFERENCIA DE LUCIA UNO ${M} CUOTA` },
      { fecha: '2026-11-20', importe: 300, concepto: `TRANSFERENCIA DE LUCIA UNO ${M} CUOTA 2` },
    ], { desde: '2026-11-05', hasta: '2026-11-20' });
    const r = await servicio.importarExtracto({ projectId: ids.project, buffer: solapado, nombre: 'nov2.n43', userId: ids.user });
    expect(r).toMatchObject({ abonos: 2, nuevos: 1, repetidos: 1, enlazados: 1 });
    expect(await cobros(ids.ventas.uno)).toHaveLength(2);
  });

  it('apuntar a mano lo que ya entró por el banco se rechaza', async () => {
    await expect(conversiones.addPayment(ids.ventas.uno, { importe: 300, fecha: '2026-11-06', metodo: 'transferencia', permitir_duplicado: true }))
      .rejects.toMatchObject({ statusCode: 409, code: 'DUPLICATE_AUTOMATIC_PAYMENT' });
  });

  it('con el interruptor apagado la subida contesta 404; encendido, entra', async () => {
    const app = express();
    app.use(express.json());
    app.use(modulo.prefix, modulo.router);
    app.use(errorHandler);
    const token = jwt.sign({ userId: ids.user, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const subir = (nombre, buffer) => supertest(app).post(`/api/cobros-externos/banco/extractos?projectId=${ids.project}`)
      .set('Authorization', `Bearer ${token}`).attach('file', buffer, nombre);
    const otro = n43([{ fecha: '2026-11-25', importe: 77.7, concepto: 'NADA QUE VER' }], { desde: '2026-11-25', hasta: '2026-11-25' });

    delete process.env.SANTANDER_EXTRACTOS_ACTIVO;
    const apagado = await subir('dic.n43', otro);
    expect(apagado.status).toBe(404);
    const estado = await supertest(app).get('/api/cobros-externos/estado').set('Authorization', `Bearer ${token}`);
    expect(estado.body.data).toEqual({ paypal: false, santander: false });
    expect((await movs()).some((x) => Number(x.importe) === 77.7)).toBe(false);

    process.env.SANTANDER_EXTRACTOS_ACTIVO = '1';
    const ok = await subir('dic.n43', otro);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ nuevos: 1, sinCandidato: 1 });
    const mal = await subir('dic.pdf', otro);
    expect(mal.status).toBe(400);
  });
});
