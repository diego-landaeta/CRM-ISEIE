import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as leadModel from '../src/modules/leads/lead.model.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';

/**
 * CRM-ISEIE#533 (gemela de CRM#868) · la tarjeta «con los filtros puestos» de
 * Prospectos contaba a los convertidos con venta real, que la tabla no
 * enseña (salen en Clientes). `getStats` debe contar lo mismo que `findAll`.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/prospectosCifraConvertidos533.test.js
 */

const MARCA = `C533_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;

beforeAll(async () => {
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
});

afterAll(async () => {
  if (proyecto) {
    const leads = `SELECT id FROM leads WHERE project_id = ${Number(proyecto.id)}`;
    await q(`DELETE FROM conversions WHERE lead_id IN (${leads})`);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('la cifra de Prospectos cuenta lo mismo que la tabla (#533)', () => {
  it('un convertido con venta real no cuenta ni en el total ni en "convertidos"', async () => {
    const [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
    await conversionModel.create({
      lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
      importe_total: 500, importe_pagado: 500, metodo_pago: 'tarjeta',
      fecha_conversion: '2026-11-01', iva_incluido: true,
    });

    const stats = await leadModel.getStats(proyecto.id);
    const { leads, total } = await leadModel.findAll({ projectId: proyecto.id, page: 1, limit: 50 });

    expect(Number(stats.total)).toBe(total);
    expect(leads.find((l) => l.id === lead.id)).toBeUndefined();
    expect(Number(stats.convertidos)).toBe(0);
  });

  it('un "convertido" sin ninguna venta sigue contando y visible (el caso Orlando Villalobos, #591)', async () => {
    const [lead] = await q(
      `INSERT INTO leads (nombre, project_id, status) VALUES ($1, $2, 'convertido') RETURNING id`,
      [`${MARCA}_sin_venta`, proyecto.id]
    );

    const stats = await leadModel.getStats(proyecto.id);
    const { leads } = await leadModel.findAll({ projectId: proyecto.id, page: 1, limit: 50 });

    expect(leads.find((l) => l.id === lead.id)).toBeTruthy();
    expect(Number(stats.convertidos)).toBeGreaterThanOrEqual(1);
  });
});
