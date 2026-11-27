import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * «Avisar al tutor» con un tutor que cobra de dos empresas (QA del 26/11 sobre
 * CRM#165 / CRM-ISEIE#188). La misma prueba en los dos CRM.
 *
 * Lo que pasó: se le avisó de lo de un campus de la empresa A, y al abrir el de
 * un campus de la empresa B (otros 33,33 € que no iban en el primer correo)
 * salía «Ya se le mandó el aviso…», el envío contestaba 409 y la fila de B decía
 * «avisado el …». El «ya se le mandó» miraba solo el tutor y el mes.
 *
 * Con base de verdad, porque lo que se defiende es la consulta: el aviso de A
 * cuenta para lo de A (y para lo que mezcla A y B), no para lo de B solo. Sin
 * mandar nada: `sendEmail` está doblado.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/avisoTutorDosEmpresas.test.js
 */

const sendEmail = vi.fn(async () => ({ sent: true, messageId: '<qa-dos-empresas@prueba>' }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: (...a) => sendEmail(...a) }));
vi.mock('../src/shared/config/frenoTutores.js', () => ({ NO_ESCRIBIR_A_TUTORES: false }));

const { default: pool } = await import('../src/shared/config/db.js');
const aviso = await import('../src/modules/tutores/avisarTutor.js');
const { resumenComisiones } = await import('../src/modules/tutores/tutor.model.js');

const MARCA = `AVT2E_${Date.now().toString(36)}`;
const PERIODO = '2026-11';
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const ids = { empresas: [], campus: [], usuarios: [] };
let tutor;
let quienAvisa;
let campusA;
let campusB;

async function comision(campus, importe) {
  const [producto] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id', [campus, `${MARCA} curso ${campus}`]);
  const [lead] = await q('INSERT INTO leads (project_id, nombre) VALUES ($1, $2) RETURNING id', [campus, `${MARCA} alumno`]);
  const [venta] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
     VALUES ($1, $2, $3, $4, 178.20, 178.20, '2026-11-05') RETURNING id`,
    [lead.id, campus, `${MARCA} curso`, producto.id],
  );
  const [pago] = await q(
    `INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 178.20, '2026-11-05') RETURNING id`, [venta.id]);
  await q(
    `INSERT INTO tutor_commissions (payment_id, tutor_id, product_id, base_calculo, pct, importe, estado, periodo)
     VALUES ($1, $2, $3, 178.20, 10, $4, 'pendiente', $5)`,
    [pago.id, tutor.id, producto.id, importe, PERIODO],
  );
}

beforeAll(async () => {
  for (const letra of ['A', 'B']) {
    const [e] = await q(
      `INSERT INTO invoice_issuers (razon_social, nif, direccion, email) VALUES ($1, $2, 'Calle Falsa 1', $3) RETURNING id`,
      [`${MARCA} Empresa ${letra} SL`, `B0000000${letra === 'A' ? 1 : 2}`, `facturas.${letra.toLowerCase()}@prueba.local`],
    );
    ids.empresas.push(e.id);
    const [p] = await q(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${letra}`, `${MARCA}-${letra}`.toLowerCase(), `${MARCA}-${letra}`, e.id],
    );
    ids.campus.push(p.id);
  }
  [campusA, campusB] = ids.campus;
  [tutor] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'tutor') RETURNING id`,
    [`${MARCA} Tutor`, `${MARCA.toLowerCase()}.tutor@prueba.local`],
  );
  [quienAvisa] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} Admin`, `${MARCA.toLowerCase()}.admin@prueba.local`],
  );
  ids.usuarios.push(tutor.id, quienAvisa.id);
  await comision(campusA, 50.00);
  await comision(campusB, 33.33);
});

afterAll(async () => {
  if (ids.campus.length) {
    const ventas = 'SELECT id FROM conversions WHERE project_id = ANY($1::int[])';
    await q(`DELETE FROM tutor_commissions WHERE payment_id IN (SELECT id FROM conversion_payments WHERE conversion_id IN (${ventas}))`, [ids.campus]);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, [ids.campus]);
    await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.campus]);
    await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.campus]);
    await q('DELETE FROM products WHERE project_id = ANY($1::int[])', [ids.campus]);
    await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.campus]);
  }
  if (ids.usuarios.length) {
    await q('DELETE FROM tutor_avisos_comisiones WHERE tutor_id = ANY($1::int[])', [ids.usuarios]);
    await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]);
  }
  if (ids.empresas.length) await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.empresas]);
  await pool.end();
});

beforeEach(async () => {
  sendEmail.mockClear();
  await q('DELETE FROM tutor_avisos_comisiones WHERE tutor_id = $1', [tutor.id]);
});

const avisarDe = (projectIds, extra = {}) => aviso.avisar({
  tutorId: tutor.id, periodo: PERIODO, userId: quienAvisa.id, projectIds, ...extra,
});
const filaDe = async (projectIds) => (await resumenComisiones({ periodo: PERIODO, tutorId: tutor.id, projectIds }))[0];

describe('un tutor de dos empresas: el aviso de una no es el de la otra', () => {
  it('se le avisa de lo de A; lo de B no sale como «ya se le mandó» y se manda sin confirmar', async () => {
    const r1 = await avisarDe([campusA]);
    expect(r1.repetido).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // La vista previa de B: sin avisos, y la cifra es la de B.
    const previoB = await aviso.previsualizar({ tutorId: tutor.id, periodo: PERIODO, projectIds: [campusB] });
    expect(previoB.pendiente).toBe(33.33);
    expect(previoB.avisos).toEqual([]);

    // Y el envío de B no contesta 409.
    const r2 = await avisarDe([campusB]);
    expect(r2.repetido).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('lo de A, otra vez: 409 YA_AVISADO, y sale con `repetir`', async () => {
    await avisarDe([campusA]);
    await expect(avisarDe([campusA])).rejects.toMatchObject({ statusCode: 409, code: 'YA_AVISADO' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const r = await avisarDe([campusA], { repetir: true });
    expect(r.repetido).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('lo que mezcla A y B sí lleva lo ya avisado de A: ahí se pide confirmar', async () => {
    await avisarDe([campusA]);
    const previo = await aviso.previsualizar({ tutorId: tutor.id, periodo: PERIODO, projectIds: [campusA, campusB] });
    expect(previo.avisos).toHaveLength(1);
    await expect(avisarDe([campusA, campusB])).rejects.toMatchObject({ code: 'YA_AVISADO' });
  });

  it('la fila de B no dice «avisado el …»; la de A y la de las dos, sí', async () => {
    await avisarDe([campusA]);
    const filaB = await filaDe([campusB]);
    expect(filaB.avisado_at).toBeNull();
    expect(filaB.avisos_enviados).toBe(0);

    const filaA = await filaDe([campusA]);
    expect(filaA.avisado_at).not.toBeNull();
    expect(filaA.avisado_por_nombre).toBe(`${MARCA} Admin`);
    expect(filaA.avisos_enviados).toBe(1);

    expect((await filaDe([campusA, campusB])).avisos_enviados).toBe(1);
  });

  it('las cifras de la fila no cambian: la consulta de los avisos no toca el dinero', async () => {
    await avisarDe([campusA]);
    const filaB = await filaDe([campusB]);
    expect(Number(filaB.pendiente)).toBe(33.33);
    expect(filaB.lineas).toBe(1);
    const ambas = await filaDe([campusA, campusB]);
    expect(Number(ambas.pendiente)).toBe(83.33);
    expect(ambas.lineas).toBe(2);
  });

  it('un aviso sin campus anotados (de antes) cuenta para todo: no se sabe qué llevaba', async () => {
    await q(
      `INSERT INTO tutor_avisos_comisiones (tutor_id, periodo, enviado_por, email) VALUES ($1, $2, $3, 'x@prueba.local')`,
      [tutor.id, PERIODO, quienAvisa.id],
    );
    expect(await aviso.avisosDelMes({ tutorId: tutor.id, periodo: PERIODO, campus: [campusB] })).toHaveLength(1);
    expect((await filaDe([campusB])).avisos_enviados).toBe(1);
  });
});
