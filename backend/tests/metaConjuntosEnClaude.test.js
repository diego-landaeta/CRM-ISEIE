import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * Las «puertas» de Meta del conector (#362), de la sincronización a lo que ve
 * Claude: «qué formaciones cambiamos esta semana, cuáles se quedan y qué
 * creativos cambiamos».
 *
 * Meta está DOBLADO: el cliente devuelve creativos y cifras de mentira, y aquí
 * no sale ni una llamada a la Graph API. La base es la local desechable.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/metaConjuntosEnClaude.test.js
 */

const N = String(Date.now());
const id = (s) => `${N}${s}`;
const ACT1 = `act_${N}1`;
const ACT2 = `act_${N}2`;
const DIA = '2026-11-12';
const SEMANA = { desde: '2026-11-09', hasta: '2026-11-15' };
const WEB = 'https://www.psiko362.test';

// ── Lo que «contesta» Meta para cada cuenta ──────────────────────────────────
const enlace = (link, extra = {}) => ({ id: id(`cr${link.length}`), object_story_spec: { link_data: { link } }, ...extra });
const META = {
  [ACT1]: {
    campanas: [{ id: id('C1'), name: 'Ventas másteres', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS' }],
    conjuntos: [
      { id: id('S1'), name: 'Máster X - Intereses', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-10T09:00:00+0000', start_time: '2026-11-10T10:00:00+0000', daily_budget: '2000' },
      { id: id('S2'), name: 'Curso Y - viejo', campaign_id: id('C1'), status: 'PAUSED', effective_status: 'PAUSED', created_time: '2026-01-05T09:00:00+0000', start_time: '2026-01-05T09:00:00+0000' },
      { id: id('S3'), name: 'Formulario', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-11T09:00:00+0000' },
      { id: id('S4'), name: 'Mixto', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-10-01T09:00:00+0000' },
      { id: id('S5'), name: 'Enlace repetido', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE' },
      { id: id('S6'), name: 'Con asociación manual', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE' },
      { id: id('S7'), name: 'Dejado vacío a mano', campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE' },
    ],
    anuncios: [
      { id: id('D1'), name: 'Vídeo testimonio', adset_id: id('S1'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-11T08:00:00+0000',
        creative: enlace(`${WEB}/master-x/`, { url_tags: 'utm_source=facebook' }) },
      { id: id('D2'), name: 'Carrusel', adset_id: id('S1'), campaign_id: id('C1'), status: 'PAUSED', effective_status: 'PAUSED', created_time: '2026-10-20T08:00:00+0000',
        creative: { id: id('cr2'), object_story_spec: { link_data: { child_attachments: [{ link: `${WEB}/master-x?utm_content=1` }, { link: `http://psiko362.test/master-x/#temario` }] } } } },
      { id: id('D3'), name: 'Vídeo curso', adset_id: id('S2'), campaign_id: id('C1'), status: 'PAUSED', effective_status: 'ADSET_PAUSED', created_time: '2026-01-05T08:00:00+0000',
        creative: { id: id('cr3'), object_story_spec: { video_data: { call_to_action: { value: { link: `${WEB}/curso-y` } } } } } },
      { id: id('D4'), name: 'Formulario instantáneo', adset_id: id('S3'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-11T08:00:00+0000',
        creative: { id: id('cr4'), object_story_spec: { link_data: { link: 'http://fb.me/', call_to_action: { value: { lead_gen_form_id: '555' } } } } } },
      { id: id('D5'), name: 'Mixto A', adset_id: id('S4'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', creative: enlace(`${WEB}/master-x`) },
      { id: id('D6'), name: 'Mixto B', adset_id: id('S4'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', creative: enlace(`${WEB}/curso-y`) },
      { id: id('D7'), name: 'Repetido', adset_id: id('S5'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', creative: enlace(`${WEB}/repetido`) },
      { id: id('D8'), name: 'Manual', adset_id: id('S6'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', creative: enlace(`${WEB}/master-x`) },
      { id: id('D9'), name: 'Bloqueado', adset_id: id('S7'), campaign_id: id('C1'), status: 'ACTIVE', effective_status: 'ACTIVE', creative: enlace(`${WEB}/curso-y`) },
    ],
    diario: {
      campaign: [{ campaign_id: id('C1'), date: DIA, spend: 40, impressions: 4000, clicks: 80, reach: 1, leads: 0 }],
      adset: [
        { adset_id: id('S1'), campaign_id: id('C1'), date: DIA, spend: 30, impressions: 3000, clicks: 60, reach: 1, leads: 0 },
        { adset_id: id('S1'), campaign_id: id('C1'), date: '2026-11-02', spend: 5, impressions: 500, clicks: 5, reach: 1, leads: 0 },
        { adset_id: id('S4'), campaign_id: id('C1'), date: DIA, spend: 10, impressions: 1000, clicks: 20, reach: 1, leads: 0 },
      ],
      ad: [
        { ad_id: id('D1'), adset_id: id('S1'), campaign_id: id('C1'), date: DIA, spend: 20, impressions: 2000, clicks: 40, reach: 1, leads: 0 },
        { ad_id: id('D2'), adset_id: id('S1'), campaign_id: id('C1'), date: DIA, spend: 10, impressions: 1000, clicks: 20, reach: 1, leads: 0 },
        { ad_id: id('D5'), adset_id: id('S4'), campaign_id: id('C1'), date: DIA, spend: 10, impressions: 1000, clicks: 20, reach: 1, leads: 0 },
      ],
    },
    vida: {
      adset: [{ id: id('S1'), spend: 500, impressions: 50000, clicks: 900 }, { id: id('S2'), spend: 300, impressions: 20000, clicks: 100 }, { id: id('S4'), spend: 10, impressions: 1000, clicks: 20 }],
      ad: [{ id: id('D1'), spend: 400, impressions: 40000, clicks: 800 }, { id: id('D2'), spend: 100, impressions: 10000, clicks: 100 }, { id: id('D3'), spend: 300, impressions: 20000, clicks: 100 }],
    },
  },
  [ACT2]: {
    campanas: [{ id: id('C2'), name: 'México', status: 'ACTIVE', effective_status: 'ACTIVE' }],
    conjuntos: [{ id: id('T1'), name: 'Máster X - México', campaign_id: id('C2'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-13T09:00:00+0000' }],
    anuncios: [{ id: id('E1'), name: 'Imagen MX', adset_id: id('T1'), campaign_id: id('C2'), status: 'ACTIVE', effective_status: 'ACTIVE', created_time: '2026-11-13T09:00:00+0000', creative: enlace(`https://psiko362.test/master-x?utm_source=ig`) }],
    diario: {
      campaign: [{ campaign_id: id('C2'), date: DIA, spend: 100, impressions: 5000, clicks: 50, reach: 1, leads: 0 }],
      adset: [{ adset_id: id('T1'), campaign_id: id('C2'), date: DIA, spend: 100, impressions: 5000, clicks: 50, reach: 1, leads: 0 }],
      ad: [{ ad_id: id('E1'), adset_id: id('T1'), campaign_id: id('C2'), date: DIA, spend: 100, impressions: 5000, clicks: 50, reach: 1, leads: 0 }],
    },
    vida: { adset: [{ id: id('T1'), spend: 1000, impressions: 60000, clicks: 700 }], ad: [{ id: id('E1'), spend: 1000, impressions: 60000, clicks: 700 }] },
  },
};

const llamadas = [];
vi.mock('../src/modules/meta-ads/meta-ads.client.js', () => ({
  validateConnection: vi.fn(async () => { throw new Error('No se llama a Meta en las pruebas'); }),
  listCampaigns: vi.fn(async ({ adAccountId }) => { llamadas.push(['campaigns', adAccountId]); return META[adAccountId].campanas; }),
  listAdSets: vi.fn(async ({ adAccountId }) => { llamadas.push(['adsets', adAccountId]); return META[adAccountId].conjuntos; }),
  listAds: vi.fn(async ({ adAccountId }) => { llamadas.push(['ads', adAccountId]); return META[adAccountId].anuncios; }),
  fetchDailyInsights: vi.fn(async ({ adAccountId, level }) => { llamadas.push(['daily', adAccountId, level]); return META[adAccountId].diario[level]; }),
  fetchDailyInsightsRange: vi.fn(async ({ adAccountId, level }) => META[adAccountId].diario[level]),
  fetchLifetimeInsights: vi.fn(async ({ adAccountId, level }) => { llamadas.push(['lifetime', adAccountId, level]); return META[adAccountId].vida[level]; }),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const servicio = await import('../src/modules/meta-ads/meta-ads.service.js');
const { HERRAMIENTAS } = await import('../src/modules/mcp/mcp.tools.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');

const MARCA = `M362${N.slice(-6)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [] };
let P; let OTRO; let ADMIN; let GESTORA; let CUENTA1; let CUENTA2;
const PROD = {};

const ambito = (u, campus = [P]) => construirAmbito({ id: u.id, nombre: u.nombre, role: u.role, active: true, usa_mcp: true },
  campus.map((c) => ({ id: c, nombre: `Campus ${c}`, sociedad_id: null, sociedad_nombre: null })));
const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
// Como el servidor: Zod pone los valores por defecto antes de ejecutar.
const { z } = await import('zod');
const correr = (n, args = {}, u = ADMIN, campus = [P]) =>
  herramienta(n).ejecutar(ambito(u, campus), z.object(herramienta(n).entrada).parse(args));

const asociaciones = (adset) => q(
  `SELECT product_id, origen, notas, asociado_por_user_id FROM meta_adset_products WHERE adset_id = $1 ORDER BY product_id, origen`, [adset]);

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('psiko'); OTRO = await proy('otro');
  const persona = async (n, role) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin'); GESTORA = await persona('GESTORA', 'gestor');

  // El catálogo: Máster X, Curso Y y dos con el mismo enlace. Una inactiva con
  // el enlace de Máster X no cuenta: solo se asocia a formaciones activas.
  const [cat] = await q(`INSERT INTO product_categories (project_id, nombre) VALUES ($1, 'Máster') RETURNING id`, [P]);
  const [sub] = await q(`INSERT INTO product_categories (project_id, parent_id, nombre) VALUES ($1, $2, 'Psicología') RETURNING id`, [P, cat.id]);
  const producto = async (clave, nombre, url, { activa = true, categoria = null, subcategoria = null } = {}) => {
    const [p] = await q(
      `INSERT INTO products (project_id, nombre, url_info, active, categoria_id, subcategoria_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [P, `${MARCA} ${nombre}`, url, activa, categoria, subcategoria]);
    PROD[clave] = p.id;
  };
  await producto('X', 'Máster X', `${WEB}/master-x/`, { categoria: cat.id, subcategoria: sub.id });
  await producto('Y', 'Curso Y', 'https://psiko362.test/curso-y');
  await producto('R1', 'Repetido uno', `${WEB}/repetido`);
  await producto('R2', 'Repetido dos', 'http://psiko362.test/repetido/');
  await producto('VIEJO', 'Máster X antiguo', `${WEB}/master-x`, { activa: false });

  // Dos cuentas en el mismo campus (como Psiko), con el token cifrado de verdad.
  const token = (() => { const { encrypted, iv, authTag } = encrypt('token-de-pruebas-que-no-va-a-meta'); return `${iv}:${authTag}:${encrypted}`; })();
  [{ id: CUENTA1 }] = await q(`INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, backfill_done) VALUES ($1, $2, $3, 'Psiko España', 'EUR', true) RETURNING id`, [P, ACT1, token]);
  [{ id: CUENTA2 }] = await q(`INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, backfill_done) VALUES ($1, $2, $3, 'Psiko México', 'MXN', true) RETURNING id`, [P, ACT2, token]);

  // Lo que ya había antes de esta sincronización:
  await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre) VALUES ($1, $2, $3, 'Ventas másteres')`, [id('C1'), P, ACT1]);
  for (const s of ['S2', 'S6', 'S7']) {
    await q(`INSERT INTO meta_adsets (adset_id, campaign_id, project_id, nombre) VALUES ($1, $2, $3, $4)`, [id(s), id('C1'), P, s]);
  }
  //  · un conjunto que Meta ya no lista (archivado), con su gasto de por vida;
  await q(`INSERT INTO meta_adsets (adset_id, campaign_id, project_id, nombre, status, effective_status, lifetime_spend, lifetime_synced_at, synced_at)
           VALUES ($1, $2, $3, 'Archivado', 'PAUSED', 'PAUSED', 50, NOW() - interval '30 days', NOW() - interval '30 days')`, [id('S8'), id('C1'), P]);
  //  · S2 asociado automáticamente a Máster X (sus anuncios llevaban allí; ahora, a Curso Y);
  await q(`INSERT INTO meta_adset_products (adset_id, product_id, project_id, notas, origen) VALUES ($1, $2, $3, 'auto', 'auto')`, [id('S2'), PROD.X, P]);
  //  · S6 asociado A MANO a Curso Y, aunque su anuncio lleva a Máster X;
  await q(`INSERT INTO meta_adset_products (adset_id, product_id, project_id, asociado_por_user_id) VALUES ($1, $2, $3, $4)`, [id('S6'), PROD.Y, P, ADMIN.id]);
  //  · S7, guardado a mano SIN ninguna formación.
  await servicio.setAdSetAssociations({ projectId: P, adsetId: id('S7'), productIds: [], userId: ADMIN.id });

  await servicio.syncIncremental(CUENTA1);
  await servicio.syncIncremental(CUENTA2);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM meta_campaigns WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM meta_ad_accounts WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM products WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM product_categories WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('la sincronización (Meta doblado)', () => {
  it('pide a Meta el gasto de toda la vida de conjuntos y anuncios, una vez por nivel y cuenta', () => {
    const vida = llamadas.filter((l) => l[0] === 'lifetime');
    expect(vida).toEqual([['lifetime', ACT1, 'adset'], ['lifetime', ACT1, 'ad'], ['lifetime', ACT2, 'adset'], ['lifetime', ACT2, 'ad']]);
  });

  it('guarda la fecha de creación del conjunto', async () => {
    const [s1] = await q(`SELECT created_time, start_time FROM meta_adsets WHERE adset_id = $1`, [id('S1')]);
    expect(new Date(s1.created_time).toISOString()).toBe('2026-11-10T09:00:00.000Z');
    expect(new Date(s1.start_time).toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });

  it('el gasto total es el de por vida; total_spend sigue siendo lo sincronizado', async () => {
    const [s1] = await q(`SELECT total_spend, lifetime_spend, lifetime_impressions, lifetime_clicks, lifetime_synced_at FROM meta_adsets WHERE adset_id = $1`, [id('S1')]);
    expect(Number(s1.total_spend)).toBe(35);
    expect(Number(s1.lifetime_spend)).toBe(500);
    expect(Number(s1.lifetime_impressions)).toBe(50000);
    expect(Number(s1.lifetime_clicks)).toBe(900);
    expect(s1.lifetime_synced_at).not.toBeNull();
    const [d3] = await q(`SELECT lifetime_spend FROM meta_ads WHERE ad_id = $1`, [id('D3')]);
    expect(Number(d3.lifetime_spend)).toBe(300);
  });

  it('el que Meta lista y no ha gastado nunca, 0; el que ya no lista, se queda con lo que tenía', async () => {
    const [s3] = await q(`SELECT lifetime_spend FROM meta_adsets WHERE adset_id = $1`, [id('S3')]);
    expect(Number(s3.lifetime_spend)).toBe(0);
    const [s8] = await q(`SELECT lifetime_spend FROM meta_adsets WHERE adset_id = $1`, [id('S8')]);
    expect(Number(s8.lifetime_spend)).toBe(50);
  });

  it('guarda la URL de destino de cada anuncio según su formato', async () => {
    const filas = await q(`SELECT ad_id, url_destino, urls_destino, formato_creativo, lead_form_id, url_tags FROM meta_ads WHERE ad_id = ANY($1::text[]) ORDER BY ad_id`,
      [[id('D1'), id('D2'), id('D3'), id('D4')]]);
    const de = Object.fromEntries(filas.map((f) => [f.ad_id, f]));
    expect(de[id('D1')]).toMatchObject({ url_destino: `${WEB}/master-x/`, formato_creativo: 'enlace', url_tags: 'utm_source=facebook' });
    expect(de[id('D2')]).toMatchObject({ formato_creativo: 'carrusel', url_destino: `${WEB}/master-x?utm_content=1` });
    expect(de[id('D2')].urls_destino).toEqual([`${WEB}/master-x?utm_content=1`, 'http://psiko362.test/master-x/#temario']);
    expect(de[id('D3')]).toMatchObject({ formato_creativo: 'video', url_destino: `${WEB}/curso-y` });
    expect(de[id('D4')]).toMatchObject({ formato_creativo: 'formulario_instantaneo', url_destino: null, lead_form_id: '555' });
  });
});

describe('la asociación automática conjunto ↔ formación', () => {
  it('coincide una: se asocia, marcada como automática y sin persona', async () => {
    expect(await asociaciones(id('S1'))).toEqual([{ product_id: PROD.X, origen: 'auto', notas: 'auto', asociado_por_user_id: null }]);
    // La otra cuenta del mismo campus, con el mismo catálogo.
    expect(await asociaciones(id('T1'))).toEqual([{ product_id: PROD.X, origen: 'auto', notas: 'auto', asociado_por_user_id: null }]);
  });

  it('si los anuncios cambian de formación, la automática se cambia', async () => {
    expect(await asociaciones(id('S2'))).toEqual([{ product_id: PROD.Y, origen: 'auto', notas: 'auto', asociado_por_user_id: null }]);
  });

  it('ninguna (formulario instantáneo) o varias (dos formaciones, o dos con el mismo enlace): no se asocia', async () => {
    expect(await asociaciones(id('S3'))).toEqual([]);
    expect(await asociaciones(id('S4'))).toEqual([]);
    expect(await asociaciones(id('S5'))).toEqual([]);
  });

  it('respeta la manual: ni la borra ni le añade la automática', async () => {
    expect(await asociaciones(id('S6'))).toEqual([{ product_id: PROD.Y, origen: 'manual', notas: null, asociado_por_user_id: ADMIN.id }]);
    expect(await asociaciones(id('S7'))).toEqual([]);
  });

  it('volver a sincronizar no duplica nada; y si una persona lo cambia después, la sincronización ya no lo toca', async () => {
    await servicio.syncIncremental(CUENTA1);
    expect(await asociaciones(id('S1'))).toHaveLength(1);
    await servicio.setAdSetAssociations({ projectId: P, adsetId: id('S1'), productIds: [PROD.Y], userId: ADMIN.id });
    await servicio.syncIncremental(CUENTA1);
    expect(await asociaciones(id('S1'))).toEqual([{ product_id: PROD.Y, origen: 'manual', notas: null, asociado_por_user_id: ADMIN.id }]);
    // Y se deja como estaba para las pruebas de abajo.
    await q(`DELETE FROM meta_adset_products WHERE adset_id = $1`, [id('S1')]);
    await q(`UPDATE meta_adsets SET productos_manual_at = NULL WHERE adset_id = $1`, [id('S1')]);
    await servicio.syncIncremental(CUENTA1);
    expect(await asociaciones(id('S1'))).toEqual([{ product_id: PROD.X, origen: 'auto', notas: 'auto', asociado_por_user_id: null }]);
  });
});

describe('meta_conjuntos', () => {
  it('incluye los pausados y los que no han gastado en el periodo', async () => {
    const r = await correr('meta_conjuntos', SEMANA);
    const nombres = r.conjuntos.map((c) => c.nombre);
    expect(r.total).toBe(9);
    expect(nombres).toEqual(expect.arrayContaining(['Curso Y - viejo', 'Formulario', 'Archivado']));
    const s2 = r.conjuntos.find((c) => c.conjunto_id === id('S2'));
    expect(s2).toMatchObject({ estado: 'PAUSED', gasto_periodo: 0, gasto_total: 300 });
  });

  it('cada conjunto con su cuenta, campaña, fechas, gasto del periodo y total, y su formación', async () => {
    const r = await correr('meta_conjuntos', SEMANA);
    const s1 = r.conjuntos.find((c) => c.conjunto_id === id('S1'));
    expect(s1).toMatchObject({
      nombre: 'Máster X - Intereses', estado: 'ACTIVE', campus_id: P,
      cuenta: { id: ACT1, nombre: 'Psiko España' }, campana: { id: id('C1'), nombre: 'Ventas másteres' }, moneda: 'EUR',
      gasto_periodo: 30, impresiones_periodo: 3000, clics_periodo: 60,
      gasto_total: 500, impresiones_totales: 50000, clics_totales: 900,
      presupuesto_diario: 20, anuncios: 2, anuncios_activos: 1,
      formaciones: [{ id: PROD.X, nombre: `${MARCA} Máster X`, origen: 'auto' }],
    });
    expect(new Date(s1.fecha_creacion).toISOString()).toBe('2026-11-10T09:00:00.000Z');
    expect(new Date(s1.fecha_inicio).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect(s1.gasto_sincronizado).toBeUndefined();
    // El primero, el que más ha gastado en la semana.
    expect(r.conjuntos[0].conjunto_id).toBe(id('T1'));
  });

  it('separa las cuentas de un mismo campus', async () => {
    const r = await correr('meta_conjuntos', SEMANA);
    expect(r.por_cuenta).toEqual([
      expect.objectContaining({ cuenta: { id: ACT1, nombre: 'Psiko España' }, moneda: 'EUR', conjuntos: 8, gasto_periodo: 40 }),
      expect.objectContaining({ cuenta: { id: ACT2, nombre: 'Psiko México' }, moneda: 'MXN', conjuntos: 1, gasto_periodo: 100 }),
    ]);
    const solo2 = await correr('meta_conjuntos', { ...SEMANA, cuenta_id: ACT2.replace('act_', '') });
    expect(solo2.conjuntos.map((c) => c.conjunto_id)).toEqual([id('T1')]);
  });

  it('filtra por estado, campaña, fecha de creación y gasto', async () => {
    const pausados = await correr('meta_conjuntos', { ...SEMANA, estado: 'pausados' });
    expect(pausados.conjuntos.map((c) => c.conjunto_id).sort()).toEqual([id('S2'), id('S8')].sort());
    const camp = await correr('meta_conjuntos', { ...SEMANA, campana_id: id('C2') });
    expect(camp.total).toBe(1);
    const nuevos = await correr('meta_conjuntos', { ...SEMANA, creados_desde: '2026-11-09', creados_hasta: '2026-11-15' });
    expect(nuevos.conjuntos.map((c) => c.conjunto_id).sort()).toEqual([id('S1'), id('S3'), id('T1')].sort());
    const conGasto = await correr('meta_conjuntos', { ...SEMANA, solo_con_gasto: true });
    expect(conGasto.conjuntos.map((c) => c.conjunto_id).sort()).toEqual([id('S1'), id('S4'), id('T1')].sort());
  });

  it('pagina y da el total', async () => {
    const r = await correr('meta_conjuntos', { ...SEMANA, limite: 2, pagina: 2 });
    expect(r).toMatchObject({ total: 9, pagina: 2, paginas: 5 });
    expect(r.conjuntos).toHaveLength(2);
  });

  it('solo para administración, y nunca un campus ajeno', async () => {
    await expect(correr('meta_conjuntos', SEMANA, GESTORA)).rejects.toMatchObject({ code: 'MCP_SOLO_ADMIN' });
    await expect(correr('meta_conjuntos', { ...SEMANA, proyecto_id: OTRO })).rejects.toMatchObject({ code: 'MCP_FUERA_DE_AMBITO' });
    await expect(correr('meta_conjuntos', { creados_desde: '2026-11-15', creados_hasta: '2026-11-01' })).rejects.toMatchObject({ code: 'MCP_PERIODO_AL_REVES' });
  });

  it('no enseña el token de la cuenta', async () => {
    expect(JSON.stringify(await correr('meta_conjuntos', SEMANA))).not.toMatch(/token|access/i);
  });
});

describe('meta_anuncios', () => {
  it('los anuncios de un conjunto, con su URL de destino, fechas y gasto', async () => {
    const r = await correr('meta_anuncios', { ...SEMANA, conjunto_id: id('S1') });
    expect(r.total).toBe(2);
    const [d1, d2] = r.anuncios;
    expect(d1).toMatchObject({
      anuncio_id: id('D1'), nombre: 'Vídeo testimonio', estado: 'ACTIVE',
      conjunto: { id: id('S1'), nombre: 'Máster X - Intereses' }, cuenta: { id: ACT1, nombre: 'Psiko España' },
      gasto_periodo: 20, impresiones_periodo: 2000, clics_periodo: 40, gasto_total: 400,
      url_destino: `${WEB}/master-x/`, formato: 'enlace', parametros_url: 'utm_source=facebook',
    });
    expect(new Date(d1.fecha_creacion).toISOString()).toBe('2026-11-11T08:00:00.000Z');
    expect(new Date(d1.fecha_inicio_del_conjunto).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect(d1.todas_las_urls).toBeUndefined();
    expect(d2).toMatchObject({ anuncio_id: id('D2'), estado: 'PAUSED', formato: 'carrusel', url_destino: `${WEB}/master-x?utm_content=1` });
    expect(d2.todas_las_urls).toHaveLength(2);
  });

  it('un formulario instantáneo sale sin URL y con su formulario', async () => {
    const r = await correr('meta_anuncios', { conjunto_id: id('S3') });
    expect(r.anuncios[0]).toMatchObject({ formato: 'formulario_instantaneo', url_destino: null, formulario_id: '555' });
  });

  it('incluye los pausados y los que no han gastado; filtra por fecha de creación', async () => {
    const r = await correr('meta_anuncios', SEMANA);
    expect(r.total).toBe(10);
    expect(r.anuncios.find((a) => a.anuncio_id === id('D3'))).toMatchObject({ estado: 'ADSET_PAUSED', gasto_periodo: 0, gasto_total: 300 });
    const nuevos = await correr('meta_anuncios', { creados_desde: '2026-11-09' });
    expect(nuevos.anuncios.map((a) => a.anuncio_id).sort()).toEqual([id('D1'), id('D4'), id('E1')].sort());
  });

  it('solo para administración', async () => {
    await expect(correr('meta_anuncios', {}, GESTORA)).rejects.toMatchObject({ code: 'MCP_SOLO_ADMIN' });
  });
});

describe('listar_formaciones trae la categoría (puerta 4)', () => {
  it('categoría y subcategoría, como la ficha', async () => {
    const r = await correr('listar_formaciones', { texto: `${MARCA} Máster X` });
    expect(r.formaciones).toHaveLength(1);
    expect(r.formaciones[0]).toMatchObject({ id: PROD.X, categoria: 'Máster', subcategoria: 'Psicología' });
    const y = await correr('listar_formaciones', { texto: `${MARCA} Curso Y` });
    expect(y.formaciones[0]).toMatchObject({ categoria: null, subcategoria: null });
  });
});
