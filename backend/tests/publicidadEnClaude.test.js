import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { construirAmbito } from '../src/modules/mcp/mcp.acceso.js';
import { HERRAMIENTAS } from '../src/modules/mcp/mcp.tools.js';
import * as publicidad from '../src/modules/meta-ads/meta-ads.service.js';

/**
 * #235 (Carlos, 05/10): «¿cuánto hemos gastado en Meta este mes en Psiko y
 * cuánto ha vendido?» o «¿qué campaña funciona mejor?», con lo que ya guarda
 * el CRM en Publicidad. Contra la base de verdad, con las pruebas mínimas de
 * Diego (07/10):
 *
 *   - un campus con dos campañas y tres prospectos: dos traen la campaña (uno
 *     con venta) y el tercero trae «whk_…» → 2 prospectos, 1 venta y su coste
 *     por venta, sin contar el «whk_…»;
 *   - un campus sin campañas da «solo_total_del_campus» o «no_disponible»,
 *     nunca «0 ventas»;
 *   - un admin no ve las cuentas de un campus que no es suyo;
 *   - nunca sale el token de la cuenta.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/publicidadEnClaude.test.js
 */

const marca = `pub${Date.now().toString(36)}`;
const SECRETO = `${marca}-TOKEN-SECRETO`;
const ids = { proyectos: [], prospectos: [], ventas: [], cuentas: [], campanas: [] };
const C = {}; // campus
const K = {}; // campañas (id de Meta)
let siguiente = 0;
const idDeMeta = () => `9${Date.now()}${++siguiente}`;

const uno = async (sql, p) => (await query(sql, p)).rows[0];
const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
const campusDe = (...claves) => claves.map((k) => ({ id: C[k], nombre: `${k} ${marca}`, sociedad_id: null }));
const admin = (...claves) => construirAmbito({ id: 999997, nombre: 'Admin de prueba', role: 'admin', active: true }, campusDe(...claves));
const gestora = (...claves) => construirAmbito({ id: 999996, nombre: 'Gestora de prueba', role: 'gestor', active: true }, campusDe(...claves));
const SEPTIEMBRE = { desde: '2026-09-01', hasta: '2026-09-30' };

async function campus(clave) {
  const p = await uno(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${clave} ${marca}`, `${clave.toLowerCase()}-${marca}`, `${clave}-${marca}-key`]);
  ids.proyectos.push(p.id);
  C[clave] = p.id;
}

async function cuenta(clave, moneda = 'EUR') {
  const actId = `act_${idDeMeta()}`;
  const a = await uno(
    `INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency,
                                   last_sync_status, last_synced_at, last_sync_error, backfill_done)
     VALUES ($1, $2, $3, $4, $6, 'ok', '2026-10-15 09:00+00', $5, true) RETURNING id`,
    [C[clave], actId, SECRETO, `Cuenta ${clave} ${marca}`, `error con ${SECRETO}`, moneda]
  );
  ids.cuentas.push(a.id);
  return actId;
}

async function campana(clave, campusClave, actId, nombre, gastos) {
  K[clave] = idDeMeta();
  await query(
    `INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre, objective, status, effective_status, daily_budget)
     VALUES ($1, $2, $3, $4, 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 20)`,
    [K[clave], C[campusClave], actId, nombre]
  );
  ids.campanas.push(K[clave]);
  for (const [fecha, spend] of gastos) {
    await query(
      `INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend, impressions, clicks, leads)
       VALUES ($1, $2, $3, $4, 1000, 40, 0)`,
      [K[clave], C[campusClave], fecha, spend]
    );
  }
}

async function prospecto(campusClave, utm, { venta = null, dia = '2026-09-10' } = {}) {
  const l = await uno(
    `INSERT INTO leads (project_id, nombre, email, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [C[campusClave], `Prospecto ${marca}`, `p${ids.prospectos.length}@${marca}.test`, `${dia} 12:00+00`]
  );
  ids.prospectos.push(l.id);
  if (utm) await query(`INSERT INTO lead_utms (lead_id, utm_source, utm_campaign) VALUES ($1, 'facebook', $2)`, [l.id, utm]);
  if (venta) {
    const v = await uno(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion)
       VALUES ($1, $2, 'Máster de prueba', $3, $4) RETURNING id`,
      [l.id, C[campusClave], venta, dia]
    );
    ids.ventas.push(v.id);
  }
}

/**
 *   PSIKO   dos campañas: «Promo Psiko» (150 € en septiembre y 999 € el
 *           31/08, fuera del periodo) y «Captación 2026 octubre» (30 €).
 *           Tres prospectos: dos con la primera campaña (uno compra 1.200 €)
 *           y uno con «whk_…».
 *   ICTESS  una campaña con gasto; sus prospectos traen «whk_…».
 *   ISEIE   una campaña con gasto; sus prospectos no traen campaña (uno compra).
 *   SINMETA ninguna cuenta de Meta.
 *   AJENO   una cuenta que el admin de la prueba no tiene.
 */
beforeAll(async () => {
  for (const k of ['PSIKO', 'ICTESS', 'ISEIE', 'SINMETA', 'AJENO', 'MONEDAS']) await campus(k);

  const psiko = await cuenta('PSIKO');
  await campana('PROMO', 'PSIKO', psiko, `Promo Psiko ${marca}`, [['2026-09-05', 100], ['2026-09-20', 50], ['2026-08-31', 999]]);
  await campana('CAPTACION', 'PSIKO', psiko, `Captación 2026 octubre ${marca}`, [['2026-09-12', 30]]);
  await prospecto('PSIKO', K.PROMO, { venta: 1200 });
  await prospecto('PSIKO', K.PROMO);
  await prospecto('PSIKO', 'whk_abc123');

  const ictess = await cuenta('ICTESS');
  await campana('ICTESS', 'ICTESS', ictess, `Ictess ${marca}`, [['2026-09-08', 70]]);
  await prospecto('ICTESS', 'whk_def456', { venta: 500 });

  const iseie = await cuenta('ISEIE');
  await campana('ISEIE', 'ISEIE', iseie, `Iseie ${marca}`, [['2026-09-08', 40]]);
  await prospecto('ISEIE', null, { venta: 800 });

  await prospecto('SINMETA', null);

  const ajeno = await cuenta('AJENO');
  await campana('AJENO', 'AJENO', ajeno, `Ajena ${marca}`, [['2026-09-08', 10]]);

  // Revisión del 15/10: prospectos de OTRO campus que traen el id de una
  // campaña no cuentan para ella (serían datos ajenos al ámbito).
  await prospecto('AJENO', K.PROMO, { venta: 5000 });
  await prospecto('PSIKO', K.ISEIE, { venta: 3000 });

  // Un campus con una cuenta en euros y otra en dólares, con una venta
  // atribuida: el gasto suma monedas distintas.
  const enEuros = await cuenta('MONEDAS', 'EUR');
  const enDolares = await cuenta('MONEDAS', 'USD');
  await campana('EUROS', 'MONEDAS', enEuros, `En euros ${marca}`, [['2026-09-10', 100]]);
  await campana('DOLARES', 'MONEDAS', enDolares, `En dólares ${marca}`, [['2026-09-10', 50]]);
  await prospecto('MONEDAS', K.EUROS, { venta: 900 });
}, 60000);

afterAll(async () => {
  await query('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await query('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.prospectos]);
  await query('DELETE FROM meta_campaigns WHERE campaign_id = ANY($1::text[])', [ids.campanas]);
  await query('DELETE FROM meta_ad_accounts WHERE id = ANY($1::int[])', [ids.cuentas]);
  await query('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.proyectos]);
}, 60000);

describe('cuentas_publicitarias', () => {
  it('da campus, nombre, moneda y la sincronización de cada cuenta, sin el token', async () => {
    const r = await herramienta('cuentas_publicitarias').ejecutar(admin('PSIKO', 'ICTESS'), {});
    expect(r.total).toBe(2);
    expect(r.cuentas[0]).toMatchObject({
      campus: `ICTESS ${marca}`, nombre: `Cuenta ICTESS ${marca}`, moneda: 'EUR',
      estado_sincronizacion: 'ok', historico_cargado: true, campanas: 1,
    });
    expect(r.cuentas[0].ultima_sincronizacion).toBeTruthy();
    expect(JSON.stringify(r)).not.toContain(SECRETO);
  });

  it('un admin no ve las cuentas de un campus que no es suyo', async () => {
    const r = await herramienta('cuentas_publicitarias').ejecutar(admin('PSIKO'), {});
    expect(r.cuentas.map((c) => c.campus)).toEqual([`PSIKO ${marca}`]);
    const e = await herramienta('cuentas_publicitarias').ejecutar(admin('PSIKO'), { proyecto_id: C.AJENO }).catch((x) => x);
    expect(e.code).toBe('MCP_FUERA_DE_AMBITO');
  });
});

describe('resumen_publicidad', () => {
  const resumen = (ambito, args = {}) => herramienta('resumen_publicidad').ejecutar(ambito, { ...SEPTIEMBRE, ...args });
  const delCampus = (r, k) => r.campus.find((c) => c.campus_id === C[k]);

  it('el gasto es el mismo que la pantalla Publicidad', async () => {
    const r = await resumen(admin('PSIKO'));
    const pantalla = await publicidad.getDashboard({ projectId: C.PSIKO, dateFrom: SEPTIEMBRE.desde, dateTo: SEPTIEMBRE.hasta });
    expect(delCampus(r, 'PSIKO').gasto).toBe(180);
    expect(pantalla.totals.spend).toBe(180);
  });

  it('dos prospectos con la campaña, uno con venta: 2 prospectos, 1 venta y su coste por venta; el «whk_…» no cuenta', async () => {
    const r = await resumen(admin('PSIKO'));
    expect(delCampus(r, 'PSIKO')).toMatchObject({
      atribucion: 'por_campaña',
      gasto: 180,
      prospectos_atribuidos: 2,
      ventas_atribuidas: 1,
      facturado_atribuido: 1200,
      coste_por_venta: 180,
    });
    expect(r.totales).toMatchObject({ gasto: 180, prospectos_atribuidos: 2, ventas_atribuidas: 1, coste_por_venta: 180 });
  });

  it('los «leads» de Meta llevan siempre el aviso (#48)', async () => {
    const r = await resumen(admin('PSIKO'));
    expect(delCampus(r, 'PSIKO').leads_segun_meta).toBe(0);
    expect(r.aviso_leads_meta).toMatch(/no son fiables/);
  });

  it('un campus cuyos prospectos traen «whk_…»: no_disponible con el motivo, nunca 0 ventas', async () => {
    const ictess = delCampus(await resumen(admin('ICTESS')), 'ICTESS');
    expect(ictess).toMatchObject({ atribucion: 'no_disponible', gasto: 70, ventas_atribuidas: null, prospectos_atribuidos: null, coste_por_venta: null });
    expect(ictess.motivo).toMatch(/no traen la campaña de Meta/);
  });

  it('un campus cuyos prospectos no traen campaña: solo el total del campus, dicho como tal', async () => {
    const iseie = delCampus(await resumen(admin('ISEIE')), 'ISEIE');
    expect(iseie).toMatchObject({
      atribucion: 'solo_total_del_campus', gasto: 40, ventas_atribuidas: null,
      ventas_de_todo_el_campus: 1, facturado_de_todo_el_campus: 800,
    });
    expect(iseie.nota).toMatch(/TODAS las ventas del campus/);
  });

  it('un campus sin campañas da no_disponible, nunca 0 ventas', async () => {
    const r = await resumen(admin('SINMETA'));
    expect(r.campus).toEqual([]);
    expect(r.sin_cuenta_de_meta).toMatchObject({ atribucion: 'no_disponible', campus: [`SINMETA ${marca}`] });
    expect(r.sin_cuenta_de_meta.motivo).toMatch(/ninguna cuenta de Meta/);
    expect(r.totales).toMatchObject({ ventas_atribuidas: null, coste_por_venta: null, gasto_de_los_atribuibles: null });
    expect(r.totales.campus_atribuibles).toEqual([]);
  });

  it('los totales atribuidos son solo de los campus que se pueden atribuir', async () => {
    const r = await resumen(admin('PSIKO', 'ICTESS', 'ISEIE', 'SINMETA'));
    expect(r.totales).toMatchObject({
      gasto: 290,
      campus_atribuibles: [`PSIKO ${marca}`],
      gasto_de_los_atribuibles: 180,
      ventas_atribuidas: 1,
      coste_por_venta: 180,
    });
  });

  it('a una gestora se le niega', async () => {
    const e = await resumen(gestora('PSIKO')).catch((x) => x);
    expect(e.code).toBe('MCP_SOLO_ADMIN');
  });

  it('un prospecto de otro campus que trae la campaña no cuenta, ni hace atribuible un campus que no lo es', async () => {
    const r = await resumen(admin('PSIKO', 'ISEIE'));
    // Las 5.000 € del prospecto de AJENO no entran en Psiko…
    expect(delCampus(r, 'PSIKO')).toMatchObject({ prospectos_atribuidos: 2, ventas_atribuidas: 1, facturado_atribuido: 1200 });
    // …y el de Psiko con la campaña de ISEIE no convierte a ISEIE en «por_campaña».
    expect(delCampus(r, 'ISEIE').atribucion).toBe('solo_total_del_campus');
  });

  it('un periodo al revés se rechaza, no da 0 de todo', async () => {
    const e = await resumen(admin('PSIKO'), { desde: '2026-09-30', hasta: '2026-09-01' }).catch((x) => x);
    expect(e.code).toBe('MCP_PERIODO_AL_REVES');
  });
});

describe('monedas distintas', () => {
  it('con cuentas en euros y en dólares, avisa y no da un coste por venta que mezcle monedas', async () => {
    const r = await herramienta('resumen_publicidad').ejecutar(admin('MONEDAS'), SEPTIEMBRE);
    const fila = r.campus.find((c) => c.campus_id === C.MONEDAS);
    expect(fila.monedas.sort()).toEqual(['EUR', 'USD']);
    expect(fila.aviso_monedas).toMatch(/monedas distintas \(EUR, USD\)|monedas distintas \(USD, EUR\)/);
    expect(fila).toMatchObject({ atribucion: 'por_campaña', ventas_atribuidas: 1, coste_por_venta: null });
    expect(r.aviso_monedas).toMatch(/monedas distintas/);
    expect(r.totales.coste_por_venta).toBeNull();
  });

  it('con una sola moneda no hay aviso', async () => {
    const r = await herramienta('resumen_publicidad').ejecutar(admin('PSIKO'), SEPTIEMBRE);
    expect(r.aviso_monedas).toBeUndefined();
    expect(r.campus[0].aviso_monedas).toBeUndefined();
  });
});

describe('campanas_publicitarias', () => {
  const campanas = (ambito, args = {}) => herramienta('campanas_publicitarias').ejecutar(ambito, { ...SEPTIEMBRE, limite: 50, ...args });

  it('cada campaña con su gasto, prospectos, ventas y coste por venta, de la que más gasta a la que menos', async () => {
    const r = await campanas(admin('PSIKO'));
    expect(r.campanas.map((c) => c.campaign_id)).toEqual([K.PROMO, K.CAPTACION]);
    expect(r.campanas[0]).toMatchObject({
      nombre: `Promo Psiko ${marca}`, estado: 'ACTIVE', objetivo: 'OUTCOME_LEADS', presupuesto_diario: 20, moneda: 'EUR',
      gasto: 150, leads_segun_meta: 0, atribucion: 'por_campaña', prospectos_atribuidos: 2, ventas_atribuidas: 1, coste_por_venta: 150,
    });
    expect(r.campanas[1]).toMatchObject({ gasto: 30, prospectos_atribuidos: 0, ventas_atribuidas: 0, coste_por_venta: null });
    expect(r.aviso_leads_meta).toMatch(/no son fiables/);
  });

  it('en un campus que no se puede atribuir, la campaña lleva el motivo y no un 0', async () => {
    const r = await campanas(admin('ICTESS'));
    expect(r.campanas[0]).toMatchObject({ gasto: 70, atribucion: 'no_disponible', ventas_atribuidas: null });
    expect(r.campanas[0].motivo).toMatch(/no traen la campaña de Meta/);
  });

  it('nunca da el token ni nada de la cuenta ajena', async () => {
    const r = await campanas(admin('PSIKO', 'ICTESS', 'ISEIE'));
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(SECRETO);
    expect(r.campanas.map((c) => c.campaign_id)).not.toContain(K.AJENO);
  });
});
