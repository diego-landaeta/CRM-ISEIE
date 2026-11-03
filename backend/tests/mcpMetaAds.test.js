import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * «meta_ads» en el MCP (#325): la publicidad de Meta, como la pantalla, y solo para
 * quien manda. Contra la base de verdad.
 *
 *   npx vitest run tests/mcpMetaAds.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { HERRAMIENTAS } = await import('../src/modules/mcp/mcp.tools.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');

const MARCA = `MTA${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [] };
let P; let SIN_META; let OTRO; let ADMIN; let LAURA;
const C1 = `${MARCA}-C1`;
const meta = HERRAMIENTAS.find((h) => h.nombre === 'meta_ads');
const ambito = (u, campus) => construirAmbito({ id: u.id, nombre: u.nombre, role: u.role, active: true, usa_mcp: true },
  campus.map((c) => ({ id: c, nombre: `Campus ${c}`, sociedad_id: null, sociedad_nombre: null })));
const correr = (u, args = {}, campus = [P]) => meta.ejecutar(ambito(u, campus), { vista: 'campanas', limite: 30, ...args });

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); SIN_META = await proy('b'); OTRO = await proy('c');
  const persona = async (n, role) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin'); LAURA = await persona('LAURA', 'gestor');
  await q(`INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc) VALUES ($1, $2, 'x')`, [P, `act_${MARCA}`]);
  await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre, status, effective_status) VALUES ($1, $2, $3, $4, 'ACTIVE', 'ACTIVE')`,
    [C1, P, `act_${MARCA}`, `${MARCA} Cursos destacados`]);
  await q(`INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend, impressions, clicks, leads) VALUES ($1, $2, '2026-10-05', 100, 10000, 200, 5), ($1, $2, '2026-10-06', 50, 5000, 100, 2)`, [C1, P]);
  const [l] = await q(`INSERT INTO leads (project_id, nombre, created_at) VALUES ($1, $2, '2026-10-06') RETURNING id`, [P, `${MARCA} Marta`]);
  ids.leads.push(l.id);
  await q(`INSERT INTO lead_utms (lead_id, utm_campaign) VALUES ($1, $2)`, [l.id, C1]);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM lead_utms WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM meta_campaigns_daily WHERE project_id = $1`, [P]);
  await q(`DELETE FROM meta_campaigns WHERE project_id = $1`, [P]);
  await q(`DELETE FROM meta_ad_accounts WHERE project_id = $1`, [P]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('meta_ads', () => {
  it('por campaña: gasto, impresiones, clics, CTR, leads de Meta y prospectos del CRM', async () => {
    const r = await correr(ADMIN, { desde: '2026-10-01', hasta: '2026-10-31' });
    expect(r.vista).toBe('campanas');
    const c = r.campus[0].campanas[0];
    expect(c).toMatchObject({ campana_id: C1, nombre: `${MARCA} Cursos destacados`, estado: 'ACTIVE', gasto: 150, impresiones: 15000, clics: 300, leads_meta: 7, prospectos_crm: 1 });
    expect(c.ctr).toBeCloseTo(2, 5);
    expect(c.cpl_meta).toBeCloseTo(150 / 7, 5);
    expect(c.cpl_crm).toBe(150);
    expect(r.campus[0]).toMatchObject({ campus_id: P, total_campanas: 1 });
  });

  it('el periodo recorta el gasto', async () => {
    const r = await correr(ADMIN, { desde: '2026-10-06', hasta: '2026-10-06' });
    expect(r.campus[0].campanas[0].gasto).toBe(50);
  });

  it('la evolución diaria y el ROI responden', async () => {
    const d = await correr(ADMIN, { vista: 'evolucion_diaria', desde: '2026-10-01', hasta: '2026-10-31' });
    expect(d.campus[0].daily).toHaveLength(2);
    expect(d.campus[0].totals).toMatchObject({ spend: 150, clicks: 300 });
    const roi = await correr(ADMIN, { vista: 'roi', desde: '2026-10-01', hasta: '2026-10-31' });
    expect(roi.campus[0].campanas[0]).toMatchObject({ campaign_id: C1, spend: 150 });
    expect(Array.isArray((await correr(ADMIN, { vista: 'por_producto' })).campus[0].productos)).toBe(true);
  });

  it('un campus sin Meta conectado lo dice; no sale como cero gastado', async () => {
    const r = await correr(ADMIN, {}, [SIN_META]);
    expect(r.campus[0]).toMatchObject({ campus_id: SIN_META, aviso: 'sin Meta conectado' });
    expect(r.campus[0].campanas).toBeUndefined();
  });

  it('varios campus: cada uno con lo suyo', async () => {
    const r = await correr(ADMIN, {}, [P, SIN_META]);
    expect(r.campus.map((c) => c.campus_id)).toEqual([P, SIN_META]);
  });

  it('solo para administración: una gestora, no', async () => {
    await expect(correr(LAURA)).rejects.toMatchObject({ code: 'MCP_SOLO_ADMIN' });
  });

  it('un campus que no es suyo, 403', async () => {
    await expect(meta.ejecutar(ambito(ADMIN, [P]), { vista: 'campanas', limite: 30, proyecto_id: OTRO })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
  });

  it('no enseña ni la cuenta publicitaria ni su token', async () => {
    const texto = JSON.stringify(await correr(ADMIN, { desde: '2026-10-01', hasta: '2026-10-31' }));
    expect(texto).not.toContain('access_token');
    expect(texto).not.toContain(`act_${MARCA}`);
  });
});
