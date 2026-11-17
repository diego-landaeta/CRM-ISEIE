import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * CRM#693 (gemela CRM-ISEIE#412) · El día de una venta es el de Madrid.
 *
 * Una venta sin fecha explícita tomaba `CURRENT_DATE`, que es el día en la zona
 * de la SESIÓN de PostgreSQL. Si la base va en UTC, una venta registrada a las
 * 00:30 de España quedaba con fecha de ayer (y en otro mes, si era día 1).
 * Ahora es `(NOW() AT TIME ZONE 'Europe/Madrid')::date`, el mismo criterio que
 * informes y correos, sea cual sea la zona de la sesión.
 *
 * La sesión se abre a propósito en una zona lejana para que el día de la base
 * y el de Madrid NO coincidan a la hora a la que corre la prueba: por la mañana
 * de Madrid, Pago Pago (UTC-11) aún va por ayer; por la tarde, Kiritimati
 * (UTC+14) ya va por mañana. Con `CURRENT_DATE`, la tercera prueba falla.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/fechaDeLaVentaEnMadrid693.test.js
 */

const horaMadrid = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hourCycle: 'h23' }));
const LEJOS = horaMadrid < 12 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
const base = new URL(process.env.DATABASE_URL);
base.searchParams.set('options', `-c TimeZone=${LEJOS}`);
process.env.DATABASE_URL = base.toString();

const { HOY_EN_LA_OFICINA, create } = await import('../src/modules/conversions/conversion.model.js');
const { default: pool } = await import('../src/shared/config/db.js');

const MARCA = `F693_${Date.now().toString(36)}`;
const hoyMadridJs = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;
let lead;

beforeAll(async () => {
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
});

afterAll(async () => {
  if (proyecto) {
    await q('DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#693 · el día por defecto de una venta', () => {
  it('no depende de la zona de la sesión de PostgreSQL', async () => {
    const c = await pool.connect();
    try {
      await c.query(`SET TIME ZONE 'Pacific/Kiritimati'`); // UTC+14
      const [a] = (await c.query(`SELECT CURRENT_DATE::text AS base, ${HOY_EN_LA_OFICINA}::text AS oficina`)).rows;
      await c.query(`SET TIME ZONE 'Pacific/Pago_Pago'`); // UTC-11: 25 horas menos
      const [b] = (await c.query(`SELECT CURRENT_DATE::text AS base, ${HOY_EN_LA_OFICINA}::text AS oficina`)).rows;
      // CURRENT_DATE cambia con la sesión (lo que fallaba)...
      expect(a.base).not.toBe(b.base);
      // ...y el día de la oficina no.
      expect(a.oficina).toBe(b.oficina);
      expect(a.oficina).toBe(hoyMadridJs());
    } finally {
      c.release();
    }
  });

  it('las 23:30 y las 00:30 de Madrid caen en su día', async () => {
    const sql = HOY_EN_LA_OFICINA.replace('NOW()', '$1::timestamptz');
    const [noche] = await q(`SELECT ${sql}::text AS d`, ['2026-10-11T21:30:00Z']); // 23:30 CEST
    const [madrugada] = await q(`SELECT ${sql}::text AS d`, ['2026-10-11T22:30:00Z']); // 00:30 CEST
    expect(noche.d).toBe('2026-10-11');
    expect(madrugada.d).toBe('2026-10-12');
  });

  it('una venta registrada sin fecha lleva el día de Madrid, y su pago inicial también', async () => {
    // La sesión de la base va por otro día: si esto no se cumple, la prueba no prueba nada.
    const [sesion] = await q('SELECT CURRENT_DATE::text AS d');
    expect(sesion.d).not.toBe(hoyMadridJs());
    const venta = await create({
      lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
      importe_total: 100, importe_pagado: 40, metodo_pago: 'tarjeta',
    });
    const [fila] = await q(
      `SELECT c.fecha_conversion::text AS venta, p.fecha::text AS pago
         FROM conversions c JOIN conversion_payments p ON p.conversion_id = c.id
        WHERE c.id = $1`,
      [venta.id]
    );
    expect(fila.venta).toBe(hoyMadridJs());
    expect(fila.pago).toBe(hoyMadridJs());
  });

  it('una fecha puesta a mano se respeta tal cual', async () => {
    const venta = await create({
      lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso 2`,
      importe_total: 100, importe_pagado: 0, metodo_pago: 'tarjeta', fecha_conversion: '2026-10-12',
    });
    const [fila] = await q('SELECT fecha_conversion::text AS d FROM conversions WHERE id = $1', [venta.id]);
    expect(fila.d).toBe('2026-10-12');
  });
});
