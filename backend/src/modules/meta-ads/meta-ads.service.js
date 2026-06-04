import { query } from '../../shared/config/db.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as metaClient from './meta-ads.client.js';

function packToken(plain) {
  const { encrypted, iv, authTag } = encrypt(plain);
  return `${iv}:${authTag}:${encrypted}`;
}
function unpackToken(packed) {
  const [iv, authTag, encrypted] = String(packed).split(':');
  if (!iv || !authTag || !encrypted) throw new AppError('Token corrupto', 500, 'TOKEN_CORRUPT');
  return decrypt(encrypted, iv, authTag);
}

/**
 * Lista TODAS las cuentas conectadas a un proyecto (multi-cuenta).
 * NUNCA devuelve el token plano.
 */
export async function listAccounts(projectId) {
  const { rows } = await query(
    `SELECT id, project_id, ad_account_id, ad_account_nombre, currency, timezone_name,
            last_synced_at, last_sync_status, last_sync_error, backfill_done, created_at
     FROM meta_ad_accounts WHERE project_id = $1
     ORDER BY created_at ASC`,
    [projectId]
  );
  return rows;
}

/**
 * Obtiene UNA cuenta por id interno (no por project_id).
 */
export async function getAccountById(accountId) {
  const { rows } = await query(
    `SELECT id, project_id, ad_account_id, ad_account_nombre, currency, timezone_name,
            last_synced_at, last_sync_status, last_sync_error, backfill_done, created_at
     FROM meta_ad_accounts WHERE id = $1`,
    [accountId]
  );
  return rows[0] || null;
}

/**
 * @deprecated Legacy 1:1. Devuelve la PRIMERA cuenta del proyecto. Útil solo para
 * migrar código viejo que asumía 1 cuenta por proyecto. Nuevo código debe usar
 * listAccounts() o getAccountById().
 */
export async function getAccount(projectId) {
  const all = await listAccounts(projectId);
  return all[0] || null;
}

/**
 * Conecta una cuenta Meta a un proyecto (UPSERT). Valida el token contra Meta antes de guardar.
 * En éxito, lanza backfill en background si nunca se hizo.
 */
export async function connect({ project_id, ad_account_id, access_token, userId }) {
  if (!project_id) throw new AppError('project_id requerido', 400, 'MISSING_PROJECT');
  if (!ad_account_id || !ad_account_id.match(/^act_\d+$/)) {
    throw new AppError('ad_account_id inválido (formato esperado: act_XXXXXXXXXX)', 400, 'INVALID_AD_ACCOUNT');
  }
  if (!access_token || access_token.length < 20) {
    throw new AppError('access_token requerido', 400, 'INVALID_TOKEN');
  }

  // Validar contra Meta antes de persistir
  let meta;
  try {
    meta = await metaClient.validateConnection({ adAccountId: ad_account_id, accessToken: access_token });
  } catch (err) {
    throw new AppError(`Validación falló: ${err.message}`, 400, 'META_VALIDATION_FAILED');
  }

  const enc = packToken(access_token);
  // ON CONFLICT (project_id, ad_account_id) — la misma cuenta no se duplica dentro del
  // mismo proyecto. Si ya existe, actualiza token/metadata (equivale a re-conectar).
  const { rows } = await query(
    `INSERT INTO meta_ad_accounts
       (project_id, ad_account_id, access_token_enc, ad_account_nombre, currency, timezone_name, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (project_id, ad_account_id) DO UPDATE SET
       access_token_enc = EXCLUDED.access_token_enc,
       ad_account_nombre = EXCLUDED.ad_account_nombre,
       currency = EXCLUDED.currency,
       timezone_name = EXCLUDED.timezone_name,
       updated_at = NOW()
     RETURNING id, project_id, ad_account_id, ad_account_nombre, currency, backfill_done`,
    [project_id, ad_account_id, enc, meta.nombre, meta.currency, meta.timezone_name, userId || null]
  );
  const account = rows[0];

  // Backfill 90 días en background (no bloquea respuesta)
  if (!account.backfill_done) {
    setImmediate(() => runBackfill(account.id, 90).catch((err) => {
      logger.error({ err: err.message, account_id: account.id }, 'Meta backfill falló');
    }));
  }

  return { ...account, validation: meta };
}

/**
 * Rota el access_token de UNA cuenta concreta. Identifica la cuenta por accountId
 * (id interno, no ad_account_id). Mantiene todos los datos sincronizados.
 */
export async function updateToken({ accountId, access_token }) {
  if (!accountId) throw new AppError('accountId requerido', 400, 'MISSING_ACCOUNT');
  if (!access_token || access_token.length < 20) {
    throw new AppError('access_token requerido', 400, 'INVALID_TOKEN');
  }
  const existing = await getAccountById(accountId);
  if (!existing) throw new AppError('Cuenta no encontrada', 404, 'NOT_FOUND');
  let meta;
  try {
    meta = await metaClient.validateConnection({
      adAccountId: existing.ad_account_id, accessToken: access_token,
    });
  } catch (err) {
    throw new AppError(`Token nuevo inválido: ${err.message}`, 400, 'META_VALIDATION_FAILED');
  }
  const enc = packToken(access_token);
  await query(
    `UPDATE meta_ad_accounts SET
       access_token_enc = $1,
       ad_account_nombre = $2,
       currency = $3,
       timezone_name = $4,
       last_sync_error = NULL,
       updated_at = NOW()
     WHERE id = $5`,
    [enc, meta.nombre, meta.currency, meta.timezone_name, accountId]
  );
  return { rotated: true, validation: meta };
}

/**
 * Desconecta UNA cuenta. Borra credenciales + campañas/adsets/ads + daily de esa
 * cuenta concreta. NO toca otras cuentas del mismo proyecto.
 */
export async function disconnect(accountId) {
  const acc = await getAccountById(accountId);
  if (!acc) throw new AppError('Cuenta no encontrada', 404, 'NOT_FOUND');
  // meta_campaigns.ad_account_id no es FK formal, borro manualmente. Cascade del PK
  // limpia adsets/ads/daily de cada nivel.
  await query(`DELETE FROM meta_campaigns WHERE project_id = $1 AND ad_account_id = $2`,
    [acc.project_id, acc.ad_account_id]);
  await query(`DELETE FROM meta_ad_accounts WHERE id = $1`, [accountId]);
  return { disconnected: true, ad_account_id: acc.ad_account_id };
}

/**
 * Sync incremental: trae el día de ayer y hoy. Ligero (1-2 chunks).
 */
export async function syncIncremental(accountId) {
  const account = await getAccountById(accountId);
  if (!account) throw new AppError('Cuenta no encontrada', 404, 'NOT_FOUND');
  const projectId = account.project_id;
  const token = await loadTokenById(accountId);
  await query(`UPDATE meta_ad_accounts SET last_sync_status='in_progress' WHERE id=$1`, [accountId]);
  try {
    await syncCampaignsSnapshot({ account, token });
    await syncAdSetsSnapshot({ account, token });
    await syncAdsSnapshot({ account, token });
    const today = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    // 3 levels, separados por pausa pequeña para no chocar rate limit.
    const campRows = await metaClient.fetchDailyInsights({ adAccountId: account.ad_account_id, accessToken: token, since: ayer, until: today, level: 'campaign' });
    await upsertCampaignDaily(projectId, campRows);
    const adsetRows = await metaClient.fetchDailyInsights({ adAccountId: account.ad_account_id, accessToken: token, since: ayer, until: today, level: 'adset' });
    await upsertAdSetDaily(projectId, adsetRows);
    const adRows = await metaClient.fetchDailyInsights({ adAccountId: account.ad_account_id, accessToken: token, since: ayer, until: today, level: 'ad' });
    await upsertAdDaily(projectId, adRows);
    await recalcCampaignTotals(projectId);
    await recalcAdSetTotals(projectId);
    await recalcAdTotals(projectId);
    await query(
      `UPDATE meta_ad_accounts SET last_synced_at=NOW(), last_sync_status='ok', last_sync_error=NULL WHERE id=$1`,
      [accountId]
    );
    return { synced: { campaign: campRows.length, adset: adsetRows.length, ad: adRows.length } };
  } catch (err) {
    await query(
      `UPDATE meta_ad_accounts SET last_sync_status='error', last_sync_error=$2 WHERE id=$1`,
      [accountId, err.message]
    );
    throw err;
  }
}

/**
 * Backfill de N días (default 90) para UNA cuenta específica.
 */
export async function runBackfill(accountId, days = 90) {
  const account = await getAccountById(accountId);
  if (!account) throw new AppError('Cuenta no encontrada', 404, 'NOT_FOUND');
  const projectId = account.project_id;
  const token = await loadTokenById(accountId);
  await query(`UPDATE meta_ad_accounts SET last_sync_status='in_progress', last_sync_error=NULL WHERE id=$1`, [accountId]);
  try {
    await syncCampaignsSnapshot({ account, token });
    await syncAdSetsSnapshot({ account, token });
    await syncAdsSnapshot({ account, token });
    const until = new Date().toISOString().slice(0, 10);
    const sinceDate = new Date(Date.now() - days * 86400000);
    const since = sinceDate.toISOString().slice(0, 10);
    logger.info({ project_id: projectId, since, until }, 'Meta backfill arrancando (3 niveles)');
    // 3 backfills secuenciales. fetchDailyInsightsRange ya mete 30s entre chunks.
    const campRows = await metaClient.fetchDailyInsightsRange({
      adAccountId: account.ad_account_id, accessToken: token, since, until, level: 'campaign',
      onProgress: (i, t, c) => logger.info({ level: 'campaign', i, total: t, cur: c }, 'Meta backfill chunk'),
    });
    await upsertCampaignDaily(projectId, campRows);
    const adsetRows = await metaClient.fetchDailyInsightsRange({
      adAccountId: account.ad_account_id, accessToken: token, since, until, level: 'adset',
      onProgress: (i, t, c) => logger.info({ level: 'adset', i, total: t, cur: c }, 'Meta backfill chunk'),
    });
    await upsertAdSetDaily(projectId, adsetRows);
    const adRows = await metaClient.fetchDailyInsightsRange({
      adAccountId: account.ad_account_id, accessToken: token, since, until, level: 'ad',
      onProgress: (i, t, c) => logger.info({ level: 'ad', i, total: t, cur: c }, 'Meta backfill chunk'),
    });
    await upsertAdDaily(projectId, adRows);
    await recalcCampaignTotals(projectId);
    await recalcAdSetTotals(projectId);
    await recalcAdTotals(projectId);
    await query(
      `UPDATE meta_ad_accounts SET last_synced_at=NOW(), last_sync_status='ok', backfill_done=TRUE, last_sync_error=NULL WHERE id=$1`,
      [accountId]
    );
    const total = campRows.length + adsetRows.length + adRows.length;
    logger.info({ account_id: accountId, project_id: projectId, rows: { campaign: campRows.length, adset: adsetRows.length, ad: adRows.length } }, 'Meta backfill completo');
    return { rows: total, days, breakdown: { campaign: campRows.length, adset: adsetRows.length, ad: adRows.length } };
  } catch (err) {
    logger.error({ err: err.message, project_id: projectId }, 'Meta backfill error');
    await query(
      `UPDATE meta_ad_accounts SET last_sync_status='error', last_sync_error=$2 WHERE project_id=$1`,
      [projectId, err.message]
    );
    throw err;
  }
}

async function loadTokenById(accountId) {
  const { rows } = await query(`SELECT access_token_enc FROM meta_ad_accounts WHERE id=$1`, [accountId]);
  if (!rows[0]) throw new AppError('Cuenta no encontrada', 404, 'NOT_FOUND');
  return unpackToken(rows[0].access_token_enc);
}

async function syncCampaignsSnapshot({ account, token }) {
  const campaigns = await metaClient.listCampaigns({ adAccountId: account.ad_account_id, accessToken: token });
  for (const c of campaigns) {
    await query(
      `INSERT INTO meta_campaigns
         (campaign_id, project_id, ad_account_id, nombre, objective, status, effective_status, daily_budget, lifetime_budget, start_time, stop_time, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
       ON CONFLICT (campaign_id) DO UPDATE SET
         nombre=EXCLUDED.nombre, objective=EXCLUDED.objective, status=EXCLUDED.status,
         effective_status=EXCLUDED.effective_status, daily_budget=EXCLUDED.daily_budget,
         lifetime_budget=EXCLUDED.lifetime_budget, start_time=EXCLUDED.start_time,
         stop_time=EXCLUDED.stop_time, synced_at=NOW()`,
      [
        c.id, account.project_id, account.ad_account_id, c.name || '', c.objective || null,
        c.status || null, c.effective_status || null,
        c.daily_budget ? Number(c.daily_budget) / 100 : null, // Meta devuelve centavos
        c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
        c.start_time || null, c.stop_time || null,
      ]
    );
  }
  return campaigns.length;
}

async function upsertCampaignDaily(projectId, rows) {
  for (const r of rows) {
    const cpl = r.leads > 0 ? (r.spend / r.leads) : null;
    await query(
      `INSERT INTO meta_campaigns_daily
         (campaign_id, project_id, date, spend, impressions, reach, clicks, leads, ctr, cpc, cpm, cpl)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (campaign_id, date) DO UPDATE SET
         spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, reach=EXCLUDED.reach,
         clicks=EXCLUDED.clicks, leads=EXCLUDED.leads, ctr=EXCLUDED.ctr, cpc=EXCLUDED.cpc,
         cpm=EXCLUDED.cpm, cpl=EXCLUDED.cpl, synced_at=NOW()`,
      [r.campaign_id, projectId, r.date, r.spend, r.impressions, r.reach, r.clicks, r.leads, r.ctr, r.cpc, r.cpm, cpl]
    );
  }
}

// AdSets: snapshot + daily + totales
async function syncAdSetsSnapshot({ account, token }) {
  const adsets = await metaClient.listAdSets({ adAccountId: account.ad_account_id, accessToken: token });
  for (const a of adsets) {
    await query(
      `INSERT INTO meta_adsets
         (adset_id, campaign_id, project_id, nombre, status, effective_status,
          optimization_goal, billing_event, daily_budget, lifetime_budget, start_time, end_time, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT (adset_id) DO UPDATE SET
         campaign_id=EXCLUDED.campaign_id, nombre=EXCLUDED.nombre, status=EXCLUDED.status,
         effective_status=EXCLUDED.effective_status, optimization_goal=EXCLUDED.optimization_goal,
         billing_event=EXCLUDED.billing_event, daily_budget=EXCLUDED.daily_budget,
         lifetime_budget=EXCLUDED.lifetime_budget, start_time=EXCLUDED.start_time,
         end_time=EXCLUDED.end_time, synced_at=NOW()`,
      [
        a.id, a.campaign_id, account.project_id, a.name || '', a.status || null, a.effective_status || null,
        a.optimization_goal || null, a.billing_event || null,
        a.daily_budget ? Number(a.daily_budget) / 100 : null,
        a.lifetime_budget ? Number(a.lifetime_budget) / 100 : null,
        a.start_time || null, a.end_time || null,
      ]
    );
  }
  return adsets.length;
}

async function upsertAdSetDaily(projectId, rows) {
  for (const r of rows) {
    const cpl = r.leads > 0 ? (r.spend / r.leads) : null;
    // El insights puede traer adsets que ya no existen en meta_adsets (eliminados).
    // Verificamos antes de insertar para evitar FK violation.
    const { rowCount } = await query(`SELECT 1 FROM meta_adsets WHERE adset_id=$1`, [r.adset_id]);
    if (!rowCount) continue;
    await query(
      `INSERT INTO meta_adsets_daily
         (adset_id, campaign_id, project_id, date, spend, impressions, reach, clicks, leads, ctr, cpc, cpm, cpl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (adset_id, date) DO UPDATE SET
         spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, reach=EXCLUDED.reach,
         clicks=EXCLUDED.clicks, leads=EXCLUDED.leads, ctr=EXCLUDED.ctr, cpc=EXCLUDED.cpc,
         cpm=EXCLUDED.cpm, cpl=EXCLUDED.cpl, synced_at=NOW()`,
      [r.adset_id, r.campaign_id, projectId, r.date, r.spend, r.impressions, r.reach, r.clicks, r.leads, r.ctr, r.cpc, r.cpm, cpl]
    );
  }
}

async function recalcAdSetTotals(projectId) {
  await query(
    `UPDATE meta_adsets ma SET
       total_spend = COALESCE(s.spend, 0),
       total_impressions = COALESCE(s.impressions, 0),
       total_reach = COALESCE(s.reach, 0),
       total_clicks = COALESCE(s.clicks, 0),
       total_leads = COALESCE(s.leads, 0)
     FROM (
       SELECT adset_id, SUM(spend) AS spend, SUM(impressions) AS impressions,
              MAX(reach) AS reach, SUM(clicks) AS clicks, SUM(leads) AS leads
       FROM meta_adsets_daily WHERE project_id=$1 GROUP BY adset_id
     ) s
     WHERE ma.adset_id = s.adset_id AND ma.project_id=$1`,
    [projectId]
  );
}

// Ads: snapshot + daily + totales
async function syncAdsSnapshot({ account, token }) {
  const ads = await metaClient.listAds({ adAccountId: account.ad_account_id, accessToken: token });
  for (const ad of ads) {
    // Verificamos que el adset exista; si no, saltamos (Meta a veces devuelve ads huérfanos cuando
    // se borra el adset durante la paginación).
    const { rowCount } = await query(`SELECT 1 FROM meta_adsets WHERE adset_id=$1`, [ad.adset_id]);
    if (!rowCount) continue;
    await query(
      `INSERT INTO meta_ads
         (ad_id, adset_id, campaign_id, project_id, nombre, status, effective_status, creative_id, created_time, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (ad_id) DO UPDATE SET
         adset_id=EXCLUDED.adset_id, campaign_id=EXCLUDED.campaign_id, nombre=EXCLUDED.nombre,
         status=EXCLUDED.status, effective_status=EXCLUDED.effective_status,
         creative_id=EXCLUDED.creative_id, created_time=EXCLUDED.created_time, synced_at=NOW()`,
      [
        ad.id, ad.adset_id, ad.campaign_id, account.project_id, ad.name || '',
        ad.status || null, ad.effective_status || null,
        ad.creative?.id || null, ad.created_time || null,
      ]
    );
  }
  return ads.length;
}

async function upsertAdDaily(projectId, rows) {
  for (const r of rows) {
    const cpl = r.leads > 0 ? (r.spend / r.leads) : null;
    const { rowCount } = await query(`SELECT 1 FROM meta_ads WHERE ad_id=$1`, [r.ad_id]);
    if (!rowCount) continue;
    await query(
      `INSERT INTO meta_ads_daily
         (ad_id, adset_id, campaign_id, project_id, date, spend, impressions, reach, clicks, leads, ctr, cpc, cpm, cpl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (ad_id, date) DO UPDATE SET
         spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, reach=EXCLUDED.reach,
         clicks=EXCLUDED.clicks, leads=EXCLUDED.leads, ctr=EXCLUDED.ctr, cpc=EXCLUDED.cpc,
         cpm=EXCLUDED.cpm, cpl=EXCLUDED.cpl, synced_at=NOW()`,
      [r.ad_id, r.adset_id, r.campaign_id, projectId, r.date,
       r.spend, r.impressions, r.reach, r.clicks, r.leads, r.ctr, r.cpc, r.cpm, cpl]
    );
  }
}

async function recalcAdTotals(projectId) {
  await query(
    `UPDATE meta_ads mad SET
       total_spend = COALESCE(s.spend, 0),
       total_impressions = COALESCE(s.impressions, 0),
       total_reach = COALESCE(s.reach, 0),
       total_clicks = COALESCE(s.clicks, 0),
       total_leads = COALESCE(s.leads, 0)
     FROM (
       SELECT ad_id, SUM(spend) AS spend, SUM(impressions) AS impressions,
              MAX(reach) AS reach, SUM(clicks) AS clicks, SUM(leads) AS leads
       FROM meta_ads_daily WHERE project_id=$1 GROUP BY ad_id
     ) s
     WHERE mad.ad_id = s.ad_id AND mad.project_id=$1`,
    [projectId]
  );
}

async function recalcCampaignTotals(projectId) {
  await query(
    `UPDATE meta_campaigns mc SET
       total_spend = COALESCE(s.spend, 0),
       total_impressions = COALESCE(s.impressions, 0),
       total_reach = COALESCE(s.reach, 0),
       total_clicks = COALESCE(s.clicks, 0),
       total_leads = COALESCE(s.leads, 0)
     FROM (
       SELECT campaign_id,
              SUM(spend) AS spend,
              SUM(impressions) AS impressions,
              MAX(reach) AS reach,
              SUM(clicks) AS clicks,
              SUM(leads) AS leads
       FROM meta_campaigns_daily WHERE project_id=$1 GROUP BY campaign_id
     ) s
     WHERE mc.campaign_id = s.campaign_id AND mc.project_id=$1`,
    [projectId]
  );
}

// ────────────────────────────────────────────────────────────
// Lectura para UI

export async function listCampaignsForUI({ projectId, status = null, dateFrom = null, dateTo = null }) {
  const params = [projectId];
  const where = ['mc.project_id = $1'];
  if (status) { params.push(status); where.push(`mc.status = $${params.length}`); }
  // Si hay rango de fechas, recalculamos métricas con SUM filtrado en la subquery.
  const useDaily = !!(dateFrom || dateTo);
  let dailyJoin = '';
  let metricCols = `mc.total_spend, mc.total_impressions, mc.total_reach, mc.total_clicks, mc.total_leads`;
  if (useDaily) {
    const dailyWhere = [`d.campaign_id = mc.campaign_id`];
    if (dateFrom) { params.push(dateFrom); dailyWhere.push(`d.date >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); dailyWhere.push(`d.date <= $${params.length}`); }
    dailyJoin = `LEFT JOIN LATERAL (
      SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, MAX(reach) AS reach,
             SUM(clicks) AS clicks, SUM(leads) AS leads
      FROM meta_campaigns_daily d WHERE ${dailyWhere.join(' AND ')}
    ) ds ON TRUE`;
    metricCols = `COALESCE(ds.spend, 0) AS total_spend, COALESCE(ds.impressions, 0) AS total_impressions,
                  COALESCE(ds.reach, 0) AS total_reach, COALESCE(ds.clicks, 0) AS total_clicks,
                  COALESCE(ds.leads, 0) AS total_leads`;
  }
  const { rows } = await query(
    `SELECT mc.campaign_id, mc.nombre, mc.objective, mc.status, mc.effective_status,
            mc.daily_budget, mc.lifetime_budget, mc.start_time, mc.stop_time,
            ${metricCols}
     FROM meta_campaigns mc ${dailyJoin}
     WHERE ${where.join(' AND ')}
     ORDER BY total_spend DESC NULLS LAST, mc.nombre`,
    params
  );
  return rows.map((r) => ({
    ...r,
    total_spend: Number(r.total_spend || 0),
    total_impressions: Number(r.total_impressions || 0),
    total_reach: Number(r.total_reach || 0),
    total_clicks: Number(r.total_clicks || 0),
    total_leads: Number(r.total_leads || 0),
    cpl: r.total_leads > 0 ? Number(r.total_spend) / Number(r.total_leads) : null,
    ctr: r.total_impressions > 0 ? (Number(r.total_clicks) / Number(r.total_impressions)) * 100 : null,
  }));
}

/**
 * AdSets de una campaña con métricas en rango (igual patrón que listCampaignsForUI).
 */
export async function listAdSetsForUI({ projectId, campaignId, dateFrom = null, dateTo = null }) {
  const params = [projectId, campaignId];
  const useDaily = !!(dateFrom || dateTo);
  let dailyJoin = '';
  let metricCols = `ma.total_spend, ma.total_impressions, ma.total_reach, ma.total_clicks, ma.total_leads`;
  if (useDaily) {
    const dw = [`d.adset_id = ma.adset_id`];
    if (dateFrom) { params.push(dateFrom); dw.push(`d.date >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); dw.push(`d.date <= $${params.length}`); }
    dailyJoin = `LEFT JOIN LATERAL (
      SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, MAX(reach) AS reach,
             SUM(clicks) AS clicks, SUM(leads) AS leads
      FROM meta_adsets_daily d WHERE ${dw.join(' AND ')}
    ) ds ON TRUE`;
    metricCols = `COALESCE(ds.spend,0) AS total_spend, COALESCE(ds.impressions,0) AS total_impressions,
                  COALESCE(ds.reach,0) AS total_reach, COALESCE(ds.clicks,0) AS total_clicks,
                  COALESCE(ds.leads,0) AS total_leads`;
  }
  const { rows } = await query(
    `SELECT ma.adset_id, ma.campaign_id, ma.nombre, ma.status, ma.effective_status,
            ma.optimization_goal, ma.billing_event, ma.daily_budget, ma.lifetime_budget,
            ma.start_time, ma.end_time, ${metricCols}
     FROM meta_adsets ma ${dailyJoin}
     WHERE ma.project_id = $1 AND ma.campaign_id = $2
     ORDER BY total_spend DESC NULLS LAST, ma.nombre`,
    params
  );
  return rows.map((r) => ({
    ...r,
    total_spend: Number(r.total_spend || 0),
    total_impressions: Number(r.total_impressions || 0),
    total_reach: Number(r.total_reach || 0),
    total_clicks: Number(r.total_clicks || 0),
    total_leads: Number(r.total_leads || 0),
    cpl: r.total_leads > 0 ? Number(r.total_spend) / Number(r.total_leads) : null,
    ctr: r.total_impressions > 0 ? (Number(r.total_clicks) / Number(r.total_impressions)) * 100 : null,
  }));
}

/**
 * Ads de un adset con métricas en rango.
 */
export async function listAdsForUI({ projectId, adsetId, dateFrom = null, dateTo = null }) {
  const params = [projectId, adsetId];
  const useDaily = !!(dateFrom || dateTo);
  let dailyJoin = '';
  let metricCols = `mad.total_spend, mad.total_impressions, mad.total_reach, mad.total_clicks, mad.total_leads`;
  if (useDaily) {
    const dw = [`d.ad_id = mad.ad_id`];
    if (dateFrom) { params.push(dateFrom); dw.push(`d.date >= $${params.length}`); }
    if (dateTo) { params.push(dateTo); dw.push(`d.date <= $${params.length}`); }
    dailyJoin = `LEFT JOIN LATERAL (
      SELECT SUM(spend) AS spend, SUM(impressions) AS impressions, MAX(reach) AS reach,
             SUM(clicks) AS clicks, SUM(leads) AS leads
      FROM meta_ads_daily d WHERE ${dw.join(' AND ')}
    ) ds ON TRUE`;
    metricCols = `COALESCE(ds.spend,0) AS total_spend, COALESCE(ds.impressions,0) AS total_impressions,
                  COALESCE(ds.reach,0) AS total_reach, COALESCE(ds.clicks,0) AS total_clicks,
                  COALESCE(ds.leads,0) AS total_leads`;
  }
  const { rows } = await query(
    `SELECT mad.ad_id, mad.adset_id, mad.campaign_id, mad.nombre, mad.status, mad.effective_status,
            mad.creative_id, mad.created_time, ${metricCols}
     FROM meta_ads mad ${dailyJoin}
     WHERE mad.project_id = $1 AND mad.adset_id = $2
     ORDER BY total_spend DESC NULLS LAST, mad.nombre`,
    params
  );
  return rows.map((r) => ({
    ...r,
    total_spend: Number(r.total_spend || 0),
    total_impressions: Number(r.total_impressions || 0),
    total_reach: Number(r.total_reach || 0),
    total_clicks: Number(r.total_clicks || 0),
    total_leads: Number(r.total_leads || 0),
    cpl: r.total_leads > 0 ? Number(r.total_spend) / Number(r.total_leads) : null,
    ctr: r.total_impressions > 0 ? (Number(r.total_clicks) / Number(r.total_impressions)) * 100 : null,
  }));
}

export async function getDashboard({ projectId, dateFrom = null, dateTo = null }) {
  const params = [projectId];
  const where = ['project_id = $1'];
  if (dateFrom) { params.push(dateFrom); where.push(`date >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); where.push(`date <= $${params.length}`); }
  const { rows } = await query(
    `SELECT date,
            SUM(spend)::numeric AS spend,
            SUM(impressions)::bigint AS impressions,
            SUM(clicks)::bigint AS clicks,
            SUM(leads)::int AS leads
     FROM meta_campaigns_daily WHERE ${where.join(' AND ')}
     GROUP BY date ORDER BY date ASC`,
    params
  );
  const totalSpend = rows.reduce((s, r) => s + Number(r.spend || 0), 0);
  const totalImpr = rows.reduce((s, r) => s + Number(r.impressions || 0), 0);
  const totalClicks = rows.reduce((s, r) => s + Number(r.clicks || 0), 0);
  const totalLeads = rows.reduce((s, r) => s + Number(r.leads || 0), 0);
  return {
    daily: rows.map((r) => ({
      date: r.date, spend: Number(r.spend), impressions: Number(r.impressions),
      clicks: Number(r.clicks), leads: Number(r.leads),
    })),
    totals: {
      spend: totalSpend, impressions: totalImpr, clicks: totalClicks, leads: totalLeads,
      cpl: totalLeads > 0 ? totalSpend / totalLeads : null,
      ctr: totalImpr > 0 ? (totalClicks / totalImpr) * 100 : null,
    },
  };
}

export async function getCampaignDetail({ projectId, campaignId, dateFrom = null, dateTo = null }) {
  const { rows: camp } = await query(
    `SELECT campaign_id, project_id, nombre, objective, status, effective_status, daily_budget, lifetime_budget, start_time, stop_time
     FROM meta_campaigns WHERE campaign_id = $1 AND project_id = $2`,
    [campaignId, projectId]
  );
  if (!camp[0]) throw new AppError('Campaña no encontrada', 404, 'NOT_FOUND');
  const params = [campaignId];
  const where = ['campaign_id = $1'];
  if (dateFrom) { params.push(dateFrom); where.push(`date >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); where.push(`date <= $${params.length}`); }
  const { rows: daily } = await query(
    `SELECT date, spend, impressions, reach, clicks, leads, ctr, cpc, cpm, cpl
     FROM meta_campaigns_daily WHERE ${where.join(' AND ')}
     ORDER BY date ASC`,
    params
  );
  return { ...camp[0], daily };
}

// ────────────────────────────────────────────────────────────
// Asociación campaña ↔ productos (ROI manual)

export async function listAssociations(projectId, campaignId = null) {
  const params = [projectId];
  const where = ['mcp.project_id = $1'];
  if (campaignId) { params.push(campaignId); where.push(`mcp.campaign_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT mcp.id, mcp.campaign_id, mcp.product_id, mcp.notas, mcp.created_at,
            p.nombre AS product_nombre, p.precio AS product_precio,
            mc.nombre AS campaign_nombre
     FROM meta_campaign_products mcp
     LEFT JOIN products p ON p.id = mcp.product_id
     LEFT JOIN meta_campaigns mc ON mc.campaign_id = mcp.campaign_id
     WHERE ${where.join(' AND ')}
     ORDER BY mc.nombre, p.nombre`,
    params
  );
  return rows;
}

// ────────────────────────────────────────────────────────────
// Asociación AdSet ↔ productos (más granular que campaña-nivel).

export async function listAdSetAssociations(projectId, adsetId = null) {
  const params = [projectId];
  const where = ['mp.project_id = $1'];
  if (adsetId) { params.push(adsetId); where.push(`mp.adset_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT mp.id, mp.adset_id, mp.product_id, mp.notas, mp.created_at,
            p.nombre AS product_nombre, p.precio AS product_precio,
            ma.nombre AS adset_nombre, ma.campaign_id
     FROM meta_adset_products mp
     LEFT JOIN products p ON p.id = mp.product_id
     LEFT JOIN meta_adsets ma ON ma.adset_id = mp.adset_id
     WHERE ${where.join(' AND ')}
     ORDER BY ma.nombre, p.nombre`,
    params
  );
  return rows;
}

export async function setAdSetAssociations({ projectId, adsetId, productIds, userId }) {
  await query(`DELETE FROM meta_adset_products WHERE adset_id = $1 AND project_id = $2`, [adsetId, projectId]);
  for (const pid of productIds || []) {
    await query(
      `INSERT INTO meta_adset_products (adset_id, product_id, project_id, asociado_por_user_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [adsetId, pid, projectId, userId || null]
    );
  }
  return { adset_id: adsetId, product_ids: productIds || [] };
}

export async function setAssociations({ projectId, campaignId, productIds, userId }) {
  // Reemplaza todas las asociaciones de esta campaña por la nueva lista (replace semantics).
  await query(`DELETE FROM meta_campaign_products WHERE campaign_id = $1 AND project_id = $2`, [campaignId, projectId]);
  for (const pid of productIds || []) {
    await query(
      `INSERT INTO meta_campaign_products (campaign_id, product_id, project_id, asociado_por_user_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [campaignId, pid, projectId, userId || null]
    );
  }
  return { campaign_id: campaignId, product_ids: productIds || [] };
}

/**
 * ROI: por cada campaña con productos asociados, calcular:
 *   spend (suma de campaign daily en rango)
 *   facturado (suma conversions.importe_total de productos asociados en rango)
 *   ROI = (facturado - spend) / spend
 */
export async function getRoi({ projectId, dateFrom = null, dateTo = null }) {
  const params = [projectId];
  const dailyWhere = ['d.project_id = $1'];
  const convWhere = ['c.project_id = $1'];
  if (dateFrom) {
    params.push(dateFrom);
    dailyWhere.push(`d.date >= $${params.length}`);
    convWhere.push(`c.fecha_conversion >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    dailyWhere.push(`d.date <= $${params.length}`);
    convWhere.push(`c.fecha_conversion <= $${params.length}`);
  }
  const { rows } = await query(
    `WITH camp_spend AS (
       SELECT mc.campaign_id, mc.nombre, mc.status, mc.effective_status,
              COALESCE(SUM(d.spend), 0)::numeric AS spend,
              COALESCE(SUM(d.leads), 0)::int AS leads_meta
       FROM meta_campaigns mc
       LEFT JOIN meta_campaigns_daily d ON d.campaign_id = mc.campaign_id AND ${dailyWhere.join(' AND ').replace('d.project_id = $1', 'mc.project_id = $1')}
       WHERE mc.project_id = $1
       GROUP BY mc.campaign_id, mc.nombre, mc.status, mc.effective_status
     ),
     camp_revenue AS (
       SELECT mcp.campaign_id,
              COUNT(DISTINCT c.id)::int AS ventas,
              COALESCE(SUM(c.importe_total), 0)::numeric AS facturado,
              COALESCE(SUM(c.importe_pagado), 0)::numeric AS cobrado
       FROM meta_campaign_products mcp
       LEFT JOIN conversions c ON c.producto_contratado_id = mcp.product_id AND ${convWhere.join(' AND ')}
       WHERE mcp.project_id = $1
       GROUP BY mcp.campaign_id
     ),
     camp_products AS (
       SELECT mcp.campaign_id, COUNT(*)::int AS n_productos,
              STRING_AGG(p.nombre, ', ' ORDER BY p.nombre) AS productos_nombres
       FROM meta_campaign_products mcp
       LEFT JOIN products p ON p.id = mcp.product_id
       WHERE mcp.project_id = $1
       GROUP BY mcp.campaign_id
     )
     SELECT cs.campaign_id, cs.nombre, cs.status, cs.effective_status,
            cs.spend, cs.leads_meta,
            COALESCE(cr.ventas, 0) AS ventas,
            COALESCE(cr.facturado, 0)::numeric AS facturado,
            COALESCE(cr.cobrado, 0)::numeric AS cobrado,
            COALESCE(cp.n_productos, 0) AS n_productos,
            cp.productos_nombres
     FROM camp_spend cs
     LEFT JOIN camp_revenue cr ON cr.campaign_id = cs.campaign_id
     LEFT JOIN camp_products cp ON cp.campaign_id = cs.campaign_id
     WHERE cs.spend > 0 OR cp.n_productos > 0
     ORDER BY cs.spend DESC`,
    params
  );
  return rows.map((r) => {
    const spend = Number(r.spend || 0);
    const facturado = Number(r.facturado || 0);
    const cobrado = Number(r.cobrado || 0);
    const roi = spend > 0 ? ((facturado - spend) / spend) * 100 : null;
    return {
      campaign_id: r.campaign_id,
      nombre: r.nombre,
      status: r.status,
      effective_status: r.effective_status,
      spend,
      leads_meta: Number(r.leads_meta || 0),
      ventas: Number(r.ventas || 0),
      facturado,
      cobrado,
      ganancia: facturado - spend,
      roi_pct: roi != null ? Number(roi.toFixed(2)) : null,
      n_productos_asociados: Number(r.n_productos || 0),
      productos_nombres: r.productos_nombres,
    };
  });
}
