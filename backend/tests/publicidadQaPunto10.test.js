import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { construirAmbito } from '../src/modules/mcp/mcp.acceso.js';
import { HERRAMIENTAS } from '../src/modules/mcp/mcp.tools.js';
import * as publicidad from '../src/modules/meta-ads/meta-ads.service.js';

/**
 * QA de Diego, 22/10, punto 10, contra la base de verdad:
 *
 *   «`mcp.model.js:1009` filtra el gasto por el campus de la campaña y no por
 *    el de la fila diaria; el cruce por `utm_campaign` no tiene índice ni tope
 *    de tiempo.»
 *
 *   · un día de gasto de la campaña apuntado a OTRO campus no cuenta para este,
 *     y Claude da lo mismo que la pantalla Publicidad;
 *   · el cruce por `utm_campaign` tiene índice (migración 224).
 * El tope de tiempo está en publicidadConTope.test.js.
 */

const marca = `p10${Date.now().toString(36)}`;
const ids = { proyectos: [], cuentas: [], campanas: [] };
const C = {};
const SEPTIEMBRE = { desde: '2026-09-01', hasta: '2026-09-30' };
const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
const admin = (clave) => construirAmbito({ id: 999995, nombre: 'Admin de prueba', role: 'admin', active: true },
  [{ id: C[clave], nombre: `${clave} ${marca}`, sociedad_id: null }]);
let campana;

beforeAll(async () => {
  for (const clave of ['PSIKO', 'OTRO']) {
    const { rows: [p] } = await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${clave} ${marca}`, `${clave.toLowerCase()}-${marca}`, `${clave}-${marca}-key`]);
    ids.proyectos.push(p.id);
    C[clave] = p.id;
  }
  const actId = `act_${marca}`;
  const { rows: [a] } = await query(
    `INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, backfill_done)
     VALUES ($1, $2, 'x', $3, 'EUR', true) RETURNING id`, [C.PSIKO, actId, `Cuenta ${marca}`]);
  ids.cuentas.push(a.id);
  // La misma cuenta de Meta, conectada también en el otro campus: así puede haber
  // días de la campaña apuntados a él (la sincronización no cambia el campus).
  const { rows: [a2] } = await query(
    `INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, backfill_done)
     VALUES ($1, $2, 'x', $3, 'EUR', true) RETURNING id`, [C.OTRO, actId, `Cuenta ${marca}`]);
  ids.cuentas.push(a2.id);
  campana = `9${Date.now()}10`;
  await query(
    `INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre, objective, status, effective_status, daily_budget)
     VALUES ($1, $2, $3, $4, 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 20)`, [campana, C.PSIKO, actId, `Promo ${marca}`]);
  ids.campanas.push(campana);
  // 100 € del campus de la campaña y 500 € de un día apuntado a otro campus.
  for (const [fecha, campus, gasto] of [['2026-09-05', C.PSIKO, 100], ['2026-09-06', C.OTRO, 500]]) {
    await query(
      `INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend, impressions, clicks, leads)
       VALUES ($1, $2, $3, $4, 1000, 40, 0)`, [campana, campus, fecha, gasto]);
  }
}, 60000);

afterAll(async () => {
  await query('DELETE FROM meta_campaigns_daily WHERE campaign_id = ANY($1::text[])', [ids.campanas]);
  await query('DELETE FROM meta_campaigns WHERE campaign_id = ANY($1::text[])', [ids.campanas]);
  await query('DELETE FROM meta_ad_accounts WHERE id = ANY($1::int[])', [ids.cuentas]);
  await query('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.proyectos]);
}, 60000);

describe('el gasto, por el campus de la fila diaria', () => {
  it('resumen_publicidad: solo los 100 € de este campus, como la pantalla Publicidad', async () => {
    const r = await herramienta('resumen_publicidad').ejecutar(admin('PSIKO'), { ...SEPTIEMBRE });
    const pantalla = await publicidad.getDashboard({ projectId: C.PSIKO, dateFrom: SEPTIEMBRE.desde, dateTo: SEPTIEMBRE.hasta });
    expect(r.campus.find((c) => c.campus_id === C.PSIKO).gasto).toBe(100);
    expect(pantalla.totals.spend).toBe(100);
  });

  it('campanas_publicitarias: la campaña con 100 €, no 600 €', async () => {
    const r = await herramienta('campanas_publicitarias').ejecutar(admin('PSIKO'), { ...SEPTIEMBRE, limite: 50 });
    expect(r.campanas.find((c) => c.campaign_id === campana).gasto).toBe(100);
  });

  it('sin fechas, igual', async () => {
    const r = await herramienta('campanas_publicitarias').ejecutar(admin('PSIKO'), { limite: 50 });
    expect(r.campanas.find((c) => c.campaign_id === campana).gasto).toBe(100);
  });

  it('el otro campus SÍ ve los 500 € de su día, como la pantalla Publicidad (no se pierden)', async () => {
    const r = await herramienta('resumen_publicidad').ejecutar(admin('OTRO'), { ...SEPTIEMBRE });
    const pantalla = await publicidad.getDashboard({ projectId: C.OTRO, dateFrom: SEPTIEMBRE.desde, dateTo: SEPTIEMBRE.hasta });
    expect(r.campus.find((c) => c.campus_id === C.OTRO).gasto).toBe(500);
    expect(pantalla.totals.spend).toBe(500);
    const camp = await herramienta('campanas_publicitarias').ejecutar(admin('OTRO'), { ...SEPTIEMBRE, limite: 50 });
    expect(camp.campanas.filter((c) => c.campaign_id === campana).map((c) => c.gasto)).toEqual([500]);
  });

  it('con los dos campus a la vez: 600 €, la campaña una vez por campus', async () => {
    const ambos = construirAmbito({ id: 999995, nombre: 'Admin de prueba', role: 'admin', active: true },
      ['PSIKO', 'OTRO'].map((clave) => ({ id: C[clave], nombre: `${clave} ${marca}`, sociedad_id: null })));
    const r = await herramienta('resumen_publicidad').ejecutar(ambos, { ...SEPTIEMBRE });
    expect(r.totales.gasto).toBe(600);
    const camp = await herramienta('campanas_publicitarias').ejecutar(ambos, { ...SEPTIEMBRE, limite: 50 });
    const suyas = camp.campanas.filter((c) => c.campaign_id === campana).map((c) => [c.campus, c.gasto]).sort((x, y) => x[1] - y[1]);
    expect(suyas).toEqual([[`PSIKO ${marca}`, 100], [`OTRO ${marca}`, 500]]);
  });
});

describe('el cruce por utm_campaign', () => {
  it('tiene índice (migración 224)', async () => {
    const { rows } = await query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'lead_utms' AND indexdef ILIKE '%(utm_campaign)%'`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
