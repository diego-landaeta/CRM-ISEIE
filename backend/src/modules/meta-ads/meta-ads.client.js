// Cliente Meta Marketing API v19. Solo lectura.
// Throttle + backoff defensivos para no chocar contra rate limits.
import { logger } from '../../shared/utils/logger.js';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// Pausa entre chunks de Insights (ms). Más conservador en backfill.
const SAFE_DELAY_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function metaFetch(path, accessToken, { method = 'GET' } = {}) {
  const url = `${META_API_BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, { method });
  const data = await res.json();
  // Rate limit headers
  const usage = res.headers.get('x-business-use-case-usage');
  const adUsage = res.headers.get('x-ad-account-usage');
  if (usage || adUsage) {
    try {
      const parsed = JSON.parse(usage || adUsage);
      const peak = Object.values(parsed).flat().reduce((m, v) => Math.max(m, v.call_count || 0, v.total_cputime || 0, v.total_time || 0), 0);
      if (peak >= 75) {
        logger.warn({ peak, usage, adUsage }, 'Meta rate limit alto, pausando 90s');
        await sleep(90_000);
      }
    } catch { /* header malformado, ignorar */ }
  }
  if (data?.error) {
    const code = data.error.code;
    const subcode = data.error.error_subcode;
    // Rate limit / throttle: backoff y reintentar 1 vez
    if (code === 17 || code === 4 || code === 32 || code === 613) {
      logger.warn({ code, subcode, message: data.error.message }, 'Meta rate limit, esperando 120s y reintentando');
      await sleep(120_000);
      const retryRes = await fetch(url, { method });
      const retryData = await retryRes.json();
      if (retryData?.error) throw new Error(`Meta API: ${retryData.error.message} (code ${retryData.error.code})`);
      return retryData;
    }
    throw new Error(`Meta API: ${data.error.message} (code ${code}${subcode ? `/${subcode}` : ''})`);
  }
  return data;
}

/**
 * Valida que el token tenga acceso al ad_account_id indicado.
 * Devuelve metadata de la cuenta (nombre, currency, timezone).
 */
export async function validateConnection({ adAccountId, accessToken }) {
  const fields = ['name', 'account_status', 'currency', 'timezone_name', 'business_name'].join(',');
  const data = await metaFetch(`/${adAccountId}?fields=${fields}`, accessToken);
  return {
    id: data.id,
    nombre: data.name || null,
    business_name: data.business_name || null,
    currency: data.currency || null,
    timezone_name: data.timezone_name || null,
    account_status: data.account_status,
  };
}

/**
 * Lista campañas (status snapshot, sin métricas).
 * `effectiveStatus` filtra por estado real (ACTIVE/PAUSED/...). Default: todos.
 */
export async function listCampaigns({ adAccountId, accessToken, effectiveStatuses = null, limit = 200 }) {
  const fields = ['id', 'name', 'objective', 'status', 'effective_status', 'daily_budget', 'lifetime_budget', 'start_time', 'stop_time'].join(',');
  let path = `/${adAccountId}/campaigns?fields=${fields}&limit=${limit}`;
  if (effectiveStatuses && effectiveStatuses.length) {
    path += `&effective_status=${encodeURIComponent(JSON.stringify(effectiveStatuses))}`;
  }
  const out = [];
  let next = path;
  while (next) {
    const data = await metaFetch(next, accessToken);
    out.push(...(data.data || []));
    next = data.paging?.next ? data.paging.next.replace(META_API_BASE, '').replace(/&?access_token=[^&]+/, '') : null;
    if (!next) break;
    await sleep(1000); // pequeña pausa entre páginas
  }
  return out;
}

/**
 * Insights diarios por campaña, agrupados por día. Retorna array de filas
 * { campaign_id, date_start, spend, impressions, reach, clicks, ctr, cpc, cpm, leads }.
 * Acepta time_range con since/until (YYYY-MM-DD).
 */
export async function fetchDailyInsights({ adAccountId, accessToken, since, until }) {
  const fields = ['campaign_id', 'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'actions'].join(',');
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  let next = `/${adAccountId}/insights?level=campaign&time_increment=1&time_range=${tr}&fields=${fields}&limit=500`;
  const out = [];
  while (next) {
    const data = await metaFetch(next, accessToken);
    for (const row of data.data || []) {
      const leads = (row.actions || []).find((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped')?.value || 0;
      out.push({
        campaign_id: row.campaign_id,
        date: row.date_start,
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
        reach: Number(row.reach || 0),
        clicks: Number(row.clicks || 0),
        ctr: row.ctr ? Number(row.ctr) : null,
        cpc: row.cpc ? Number(row.cpc) : null,
        cpm: row.cpm ? Number(row.cpm) : null,
        leads: Number(leads),
      });
    }
    next = data.paging?.next ? data.paging.next.replace(META_API_BASE, '').replace(/&?access_token=[^&]+/, '') : null;
    if (!next) break;
    await sleep(2000);
  }
  return out;
}

/**
 * Sync por chunks de 7 días con pausas SAFE_DELAY_MS entre cada uno.
 * Devuelve filas acumuladas. Llamar onProgress(chunkIdx, totalChunks, currentSince) si se quiere log.
 */
export async function fetchDailyInsightsRange({ adAccountId, accessToken, since, until, chunkDays = 7, onProgress = null }) {
  const sinceDate = new Date(since);
  const untilDate = new Date(until);
  const chunks = [];
  let cursor = new Date(sinceDate);
  while (cursor <= untilDate) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);
    if (chunkEnd > untilDate) chunkEnd.setTime(untilDate.getTime());
    chunks.push({
      since: cursor.toISOString().slice(0, 10),
      until: chunkEnd.toISOString().slice(0, 10),
    });
    cursor.setDate(cursor.getDate() + chunkDays);
  }
  const all = [];
  for (let i = 0; i < chunks.length; i++) {
    const { since: s, until: u } = chunks[i];
    if (onProgress) onProgress(i + 1, chunks.length, s);
    const rows = await fetchDailyInsights({ adAccountId, accessToken, since: s, until: u });
    all.push(...rows);
    if (i < chunks.length - 1) await sleep(SAFE_DELAY_MS);
  }
  return all;
}
