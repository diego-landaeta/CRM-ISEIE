// Cliente Meta Marketing API v19. Solo lectura.
// Throttle + backoff defensivos para no chocar contra rate limits.
import { logger } from '../../shared/utils/logger.js';

const META_API_BASE = 'https://graph.facebook.com/v19.0';

// Pausa entre chunks de Insights (ms). Más conservador en backfill.
const SAFE_DELAY_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Si `path` empieza con http(s) lo tratamos como URL absoluta — Meta a veces devuelve
// paging.next con versión distinta (v20 vs v19), si limpiamos por prefijo se rompe.
function buildUrl(path, accessToken) {
  const isAbs = /^https?:\/\//i.test(path);
  const base = isAbs ? path : `${META_API_BASE}${path}`;
  const sep = base.includes('?') ? '&' : '?';
  // Si ya trae access_token (paging.next a veces lo conserva), no lo dupliques.
  if (/[?&]access_token=/.test(base)) return base;
  return `${base}${sep}access_token=${encodeURIComponent(accessToken)}`;
}

// Códigos/subcódigos transitorios: la petición es válida pero Meta la rechaza por
// carga temporal ("Please reduce the amount of data..."). Reintentar suele resolverlo.
const RATE_LIMIT_CODES = new Set([17, 4, 32, 613]);
const TRANSIENT_SUBCODES = new Set([1504018, 1504033, 99]); // 1504018 = data too large / temporal
const TRANSIENT_CODES = new Set([1, 2]); // 1=unknown, 2=service temporarily unavailable

function metaErrorMessage(err) {
  // error_user_msg trae el detalle legible cuando existe; si no, el message genérico.
  const detail = err.error_user_msg || err.message || 'Error desconocido';
  return `Meta API: ${detail} (code ${err.code}${err.error_subcode ? `/${err.error_subcode}` : ''})`;
}

async function metaFetch(path, accessToken, { method = 'GET' } = {}) {
  const url = buildUrl(path, accessToken);
  const MAX_RETRIES = 3;
  let attempt = 0;
  while (true) {
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
    if (!data?.error) return data;

    const code = data.error.code;
    const subcode = data.error.error_subcode;
    const isRateLimit = RATE_LIMIT_CODES.has(code);
    const isTransient = TRANSIENT_CODES.has(code) || TRANSIENT_SUBCODES.has(subcode);

    if ((isRateLimit || isTransient) && attempt < MAX_RETRIES) {
      attempt++;
      // Rate limit: esperas largas. Transitorio: backoff creciente más corto.
      const waitMs = isRateLimit ? 120_000 : 15_000 * attempt;
      logger.warn({ code, subcode, attempt, waitMs, message: data.error.message }, 'Meta error reintentable, esperando y reintentando');
      await sleep(waitMs);
      continue;
    }
    throw new Error(metaErrorMessage(data.error));
  }
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
    next = data.paging?.next || null;
    if (!next) break;
    await sleep(1000); // pequeña pausa entre páginas
  }
  return out;
}

/**
 * Lista AdSets de la cuenta (snapshot estado/budget). Pagina automáticamente.
 */
export async function listAdSets({ adAccountId, accessToken, limit = 500 }) {
  const fields = ['id', 'name', 'campaign_id', 'status', 'effective_status', 'optimization_goal',
                  'billing_event', 'daily_budget', 'lifetime_budget', 'start_time', 'end_time'].join(',');
  let next = `/${adAccountId}/adsets?fields=${fields}&limit=${limit}`;
  const out = [];
  while (next) {
    const data = await metaFetch(next, accessToken);
    out.push(...(data.data || []));
    next = data.paging?.next || null;
    if (!next) break;
    await sleep(1000);
  }
  return out;
}

/**
 * Lista Ads (anuncios individuales) de la cuenta. Snapshot creativo.
 */
export async function listAds({ adAccountId, accessToken, limit = 500 }) {
  const fields = ['id', 'name', 'adset_id', 'campaign_id', 'status', 'effective_status',
                  'creative{id}', 'created_time'].join(',');
  let next = `/${adAccountId}/ads?fields=${fields}&limit=${limit}`;
  const out = [];
  while (next) {
    const data = await metaFetch(next, accessToken);
    out.push(...(data.data || []));
    next = data.paging?.next || null;
    if (!next) break;
    await sleep(1000);
  }
  return out;
}

/**
 * Insights diarios. `level` puede ser 'campaign' | 'adset' | 'ad'.
 * Retorna array con id correspondiente al level: { campaign_id | adset_id | ad_id, date, ... }.
 */
export async function fetchDailyInsights({ adAccountId, accessToken, since, until, level = 'campaign' }) {
  const idField = level === 'ad' ? 'ad_id' : level === 'adset' ? 'adset_id' : 'campaign_id';
  // Para adset/ad, pedimos también el parent_id para denormalizar en la tabla daily.
  const idFields = level === 'ad' ? 'ad_id,adset_id,campaign_id'
                  : level === 'adset' ? 'adset_id,campaign_id'
                  : 'campaign_id';
  const fields = `${idFields},spend,impressions,reach,clicks,ctr,cpc,cpm,actions`;
  const tr = encodeURIComponent(JSON.stringify({ since, until }));
  let next = `/${adAccountId}/insights?level=${level}&time_increment=1&time_range=${tr}&fields=${fields}&limit=500`;
  const out = [];
  while (next) {
    const data = await metaFetch(next, accessToken);
    for (const row of data.data || []) {
      const leads = (row.actions || []).find((a) => a.action_type === 'lead' || a.action_type === 'onsite_conversion.lead_grouped')?.value || 0;
      out.push({
        [idField]: row[idField],
        // Parents para denormalizar:
        ...(level !== 'campaign' && { campaign_id: row.campaign_id }),
        ...(level === 'ad' && { adset_id: row.adset_id }),
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
    next = data.paging?.next || null;
    if (!next) break;
    await sleep(2000);
  }
  return out;
}

/**
 * Sync por chunks de 7 días con pausas SAFE_DELAY_MS entre cada uno.
 * Devuelve filas acumuladas. Llamar onProgress(chunkIdx, totalChunks, currentSince) si se quiere log.
 */
export async function fetchDailyInsightsRange({ adAccountId, accessToken, since, until, chunkDays = 7, onProgress = null, level = 'campaign' }) {
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
    const rows = await fetchDailyInsights({ adAccountId, accessToken, since: s, until: u, level });
    all.push(...rows);
    if (i < chunks.length - 1) await sleep(SAFE_DELAY_MS);
  }
  return all;
}
