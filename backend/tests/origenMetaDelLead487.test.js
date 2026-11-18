import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Puerta 8 del conector de Claude (ISEIE#487, gemela de CRM#806), contra la base de verdad (la local de
 * docker-compose.dev.yml): cada prospecto de Meta guarda su campaña, su conjunto y
 * su anuncio, se le pone la formación de su publicidad si no trae ninguna, y
 * «buscar_prospectos» y «ver_prospecto» lo devuelven, con filtro por conjunto.
 *
 * Todo cuelga de un campus de prueba con la marca P8TEST: al borrarlo al final se
 * va en cascada (prospectos, UTM, campañas, conjuntos, anuncios y formaciones).
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/origenMetaDelLead487.test.js
 */

const { query } = await import('../src/shared/config/db.js');
const leadService = await import('../src/modules/leads/lead.service.js');
const { idsMetaDelEnvio, rellenarOrigenMeta } = await import('../src/modules/leads/origen-meta.js');
const { HERRAMIENTAS } = await import('../src/modules/mcp/mcp.tools.js');

const MARCA = `P8TEST${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const BASE = String(Date.now());
const id = (sufijo) => `${BASE}${sufijo}`; // ids de Meta: solo dígitos, únicos por pasada
const C = id('01'); const S1 = id('11'); const S2 = id('12'); const A1 = id('21'); const A2 = id('22'); const A3 = id('23');
const ids = {};
const uno = async (sql, p) => (await query(sql, p)).rows[0];
const utmDe = (leadId) => uno(
  `SELECT canal_detectado, meta_campaign_id, meta_adset_id, meta_ad_id, meta_origen_por FROM lead_utms WHERE lead_id = $1`, [leadId]);
const productoDe = async (leadId) => (await uno(`SELECT producto_interes_id FROM leads WHERE id = $1`, [leadId])).producto_interes_id;

const AMBITO = () => ({ userId: 1, rol: 'superadmin', projectIds: [ids.P], proyectos: [{ id: ids.P, nombre: `${MARCA} Campus` }] });
const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);

const alta = (extra) => leadService.createFromExternalWebhook(ids.P, {
  nombre: `${MARCA} Persona`, email: `${Math.random().toString(36).slice(2, 8)}@${m}.test`, ...extra,
});

beforeAll(async () => {
  ids.P = (await uno(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, `${m}-p`, `${MARCA}-key`])).id;
  for (const k of ['FA', 'FB']) {
    ids[k] = (await uno(`INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id`, [ids.P, `${MARCA} Formación ${k}`])).id;
  }
  await query(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre) VALUES ($1, $2, 'act_${BASE}', $3)`,
    [C, ids.P, `${MARCA} Campaña másteres`]);
  await query(`INSERT INTO meta_adsets (adset_id, campaign_id, project_id, nombre) VALUES ($1, $2, $3, $4), ($5, $2, $3, $6)`,
    [S1, C, ids.P, `${MARCA} Conjunto Máster Coaching`, S2, `${MARCA} Conjunto Diplomado`]);
  await query(`INSERT INTO meta_ads (ad_id, adset_id, campaign_id, project_id, nombre, url_destino) VALUES ($1, $2, $3, $4, $5, 'https://web.test/master'), ($6, $7, $3, $4, $8, NULL)`,
    [A1, S1, C, ids.P, `${MARCA} Vídeo testimonio`, A2, S2, `${MARCA} Formulario instantáneo`]);
  // El conjunto 1 es de la formación A (a mano o por la URL, puerta 7). El 2 no tiene.
  await query(`INSERT INTO meta_adset_products (adset_id, product_id, project_id) VALUES ($1, $2, $3)`, [S1, ids.FA, ids.P]);
}, 60000);

afterAll(async () => {
  try { await query(`DELETE FROM projects WHERE id = $1`, [ids.P]); } catch { /* sigue */ }
});

describe('lo que trae el envío (sin base)', () => {
  it('los ids con nombre se creen; los números de las UTM son solo candidatos', () => {
    const r = idsMetaDelEnvio({
      utm_campaign: '120244428100730715', utm_content: '120244428100730999', utm_term: 'texto',
      custom_fields: { adset_id: '120244428100730111' },
      landing_url: 'https://web.test/x?ad_id=120244428100730222&utm_id=120244428100730715',
    });
    expect(r.explicitos).toEqual({ ad: '120244428100730222', adset: '120244428100730111', campaign: null });
    expect(r.candidatos.sort()).toEqual(['120244428100730715', '120244428100730999']);
    expect(idsMetaDelEnvio({ utm_campaign: 'PRUEBA_C1', utm_content: '12' })).toEqual({ explicitos: { ad: null, adset: null, campaign: null }, candidatos: [] });
  });
});

describe('al entrar el prospecto', { timeout: 60000 }, () => {
  it('desde un anuncio con web de destino: campaña, conjunto y anuncio, y la formación del conjunto', async () => {
    const r = await alta({
      landing_url: `https://web.test/master/?fbclid=abc&utm_source=fb&utm_medium=paid&utm_campaign=${C}&utm_term=${S1}&utm_content=${A1}`,
    });
    ids.L1 = r.lead_id;
    expect(await utmDe(r.lead_id)).toEqual({
      canal_detectado: 'meta_ads', meta_campaign_id: C, meta_adset_id: S1, meta_ad_id: A1, meta_origen_por: 'url',
    });
    expect(await productoDe(r.lead_id)).toBe(ids.FA);
  });

  it('desde un formulario instantáneo (Make manda el anuncio): se completan conjunto y campaña, y el canal es Meta', async () => {
    const r = await alta({ meta_ad_id: A2 });
    ids.L2 = r.lead_id;
    expect(await utmDe(r.lead_id)).toEqual({
      canal_detectado: 'meta_ads', meta_campaign_id: C, meta_adset_id: S2, meta_ad_id: A2, meta_origen_por: 'envio',
    });
    // El conjunto 2 no tiene formación y la campaña tampoco: no se inventa.
    expect(await productoDe(r.lead_id)).toBeNull();
  });

  it('la formación que viene manda sobre la de la publicidad', async () => {
    const r = await alta({ producto_interes_id: ids.FB, landing_url: `https://web.test/?utm_source=fb&utm_term=${S1}&utm_content=${A1}` });
    expect(await productoDe(r.lead_id)).toBe(ids.FB);
    expect((await utmDe(r.lead_id)).meta_adset_id).toBe(S1);
  });

  it('un lead sin nada de Meta no se toca', async () => {
    const r = await alta({ landing_url: 'https://web.test/?utm_source=google&utm_medium=organic&utm_campaign=PRUEBA_C1' });
    expect(await utmDe(r.lead_id)).toMatchObject({ meta_campaign_id: null, meta_adset_id: null, meta_ad_id: null });
  });

  it('un anuncio que aún no se ha sincronizado se completa tras la siguiente sincronización', async () => {
    const r = await alta({ landing_url: `https://web.test/?utm_source=fb&utm_content=${A3}` });
    ids.L3 = r.lead_id;
    expect((await utmDe(r.lead_id)).meta_ad_id).toBeNull();
    // Llega el anuncio (del conjunto 1) con la sincronización de Meta.
    await query(`INSERT INTO meta_ads (ad_id, adset_id, campaign_id, project_id, nombre) VALUES ($1, $2, $3, $4, $5)`,
      [A3, S1, C, ids.P, `${MARCA} Carrusel nuevo`]);
    const hechos = await rellenarOrigenMeta(ids.P);
    expect(hechos.anuncios).toBeGreaterThanOrEqual(1);
    expect(await utmDe(r.lead_id)).toMatchObject({ meta_campaign_id: C, meta_adset_id: S1, meta_ad_id: A3, meta_origen_por: 'url' });
    expect(await productoDe(r.lead_id)).toBe(ids.FA);
    // Pasarlo otra vez no cambia nada.
    expect(await rellenarOrigenMeta(ids.P)).toEqual({ anuncios: 0, conjuntos: 0, campanas: 0, formaciones: 0 });
  });
});

describe('en el conector', { timeout: 60000 }, () => {
  it('buscar_prospectos: cada fila con su campaña, conjunto y anuncio; y el filtro por conjunto', async () => {
    const buscar = (a) => herramienta('buscar_prospectos').ejecutar(AMBITO(), { pagina: 1, limite: 50, ...a });
    const porConjunto = await buscar({ conjunto_id: S2 });
    expect(porConjunto.prospectos.map((p) => p.id)).toEqual([ids.L2]);
    expect(porConjunto.prospectos[0]).toMatchObject({
      meta_campana_id: C, meta_campana: `${MARCA} Campaña másteres`,
      meta_conjunto_id: S2, meta_conjunto: `${MARCA} Conjunto Diplomado`,
      meta_anuncio_id: A2, meta_anuncio: `${MARCA} Formulario instantáneo`,
    });
    // Por parte del nombre, sin tildes: los del conjunto 1 (L1, L3 y el que traía su formación).
    const porNombre = await buscar({ conjunto: 'master coaching' });
    expect(porNombre.total).toBe(3);
    expect(porNombre.prospectos.map((p) => p.id)).toEqual(expect.arrayContaining([ids.L1, ids.L3]));
    expect((await buscar({ anuncio_id: A3 })).prospectos.map((p) => p.id)).toEqual([ids.L3]);
  });

  it('ver_prospecto: el origen de Meta con nombres y la URL del anuncio', async () => {
    const r = await herramienta('ver_prospecto').ejecutar(AMBITO(), { id: ids.L1 });
    expect(r).toMatchObject({
      canal: 'meta_ads', meta_conjunto_id: S1, meta_conjunto: `${MARCA} Conjunto Máster Coaching`,
      meta_anuncio_id: A1, meta_anuncio: `${MARCA} Vídeo testimonio`, meta_anuncio_url: 'https://web.test/master',
      meta_origen_por: 'url', utm_content: A1, utm_term: S1,
    });
  });
});
