/**
 * De dónde viene un prospecto: la regla, en UN solo sitio (#48).
 *
 * Make no deduce el canal (si lo hiciera, cada escenario acabaría con su
 * versión y dejarían de cuadrar entre sí) ni lo hace la web: manda lo que ve
 * —las UTM, el `document.referrer`, la dirección completa— y lo decide el CRM.
 * Esta función es lo que usa el alta de un prospecto y también el script que
 * aplica la regla hacia atrás (`scripts/recalcular-canal.mjs`).
 *
 * LA REGLA, por orden (gana la primera que case):
 *
 *   1. IA generativa. `chatgpt.com`, `chat.openai.com`, `openai.com` → `chatgpt_ia`.
 *      Se mira el referrer Y `utm_source`: ChatGPT a veces no manda referrer y a
 *      veces llega como `utm_source=chatgpt.com`. Mirar solo uno pierde la mitad.
 *   2. `gclid` en la dirección → `google_ads`; `fbclid` → `meta_ads`; `ttclid` →
 *      `tiktok_ads`. Un identificador de clic no se escribe a mano: es de pago.
 *   3. `utm_source` de una red: fb/ig/facebook/instagram/meta → `meta_ads`;
 *      tiktok → `tiktok_ads`; google con medium cpc/ppc/paid → `google_ads`;
 *      whatsapp → `whatsapp`.
 *   4. `utm_medium`: `referral` → `referido`; `organic` → `organico`.
 *   5. `utm_source` de buscador (google, bing…) sin pago → `organico`.
 *   6. Referrer: un buscador → `organico`; la propia web → no cuenta (es
 *      navegación interna); cualquier otra web → `referido`.
 *   7. Una `utm_source` que no es ninguna de las de arriba (un boletín, una
 *      alianza) → `referido`: viene de alguien que no es el propio sitio.
 *   8. Sin ninguna pista → `directo`.
 *
 * LAS OTRAS IA (Perplexity, Gemini, Copilot, Claude). Hoy NO tienen canal
 * propio: los valores son una lista cerrada en el código y en la base, y cómo
 * llamarlos es una decisión pendiente (#48: meterlas en `chatgpt_ia`, renombrar
 * a `ia_generativa` —con migración— o un valor por cada una). Mientras tanto
 * van a `referido`, que es lo que son (una web que manda tráfico), y NO se pierde
 * nada: se guardan `utm_source`, `referrer` y `landing_url`, así que cuando se
 * decida el nombre, el script lo aplica hacia atrás. Para cambiarlo es una
 * constante: `CANAL_DE_LAS_OTRAS_IA`.
 */

export const CANAL_DE_LAS_OTRAS_IA = 'referido';

const HOSTS_CHATGPT = ['chatgpt.com', 'chat.openai.com', 'openai.com'];
const HOSTS_OTRAS_IA = ['perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai', 'you.com', 'poe.com'];
const BUSCADORES = [
  'google', 'bing.com', 'duckduckgo.com', 'yahoo.com', 'ecosia.org', 'ask.com', 'baidu.com', 'yandex', 'startpage.com', 'qwant.com',
];
const REDES_META = /(^|[^a-z0-9])(fb|ig|facebook|instagram|meta)([^a-z0-9]|$)/;

/** El host de una dirección o de un texto tipo «chatgpt.com»; null si no hay. Sin «www.». */
export function hostDe(valor) {
  if (!valor || typeof valor !== 'string') return null;
  const v = valor.trim().toLowerCase();
  if (!v) return null;
  let host = null;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : `https://${v}`).hostname;
  } catch {
    return null;
  }
  return host.replace(/^www\./, '') || null;
}

/** ¿`host` es `base` o un subdominio suyo? («chat.openai.com» es de «openai.com»). */
const esDe = (host, base) => !!host && (host === base || host.endsWith(`.${base}`));
const esDeAlguno = (host, bases) => bases.some((b) => esDe(host, b));
const esBuscador = (host) => !!host && BUSCADORES.some((b) => (b.includes('.') ? esDe(host, b) : host.split('.').includes(b)));

function parametros(url) {
  try { return new URL(url).searchParams; } catch { return new URLSearchParams(); }
}

/**
 * El canal de un prospecto, a partir de lo que se sepa de él. Cualquier campo
 * puede faltar. Devuelve siempre uno de los valores del enum `utm_channel`.
 */
export function deducirCanal({ utm_source, utm_medium, referrer, landing_url } = {}) {
  const fuente = String(utm_source || '').trim().toLowerCase();
  const medio = String(utm_medium || '').trim().toLowerCase();
  const hostRef = hostDe(referrer);
  const hostFuente = fuente.includes('.') ? hostDe(fuente) : null;
  const clics = parametros(landing_url);
  const hostPropio = hostDe(landing_url);

  // 1 · IA generativa
  if (esDeAlguno(hostRef, HOSTS_CHATGPT) || esDeAlguno(hostFuente, HOSTS_CHATGPT) || /^(chatgpt|openai)$/.test(fuente)) return 'chatgpt_ia';
  if (esDeAlguno(hostRef, HOSTS_OTRAS_IA) || esDeAlguno(hostFuente, HOSTS_OTRAS_IA)
    || /^(perplexity|gemini|copilot|claude)$/.test(fuente)) return CANAL_DE_LAS_OTRAS_IA;

  // 2 · identificadores de clic
  if (clics.get('gclid')) return 'google_ads';
  if (clics.get('fbclid')) return 'meta_ads';
  if (clics.get('ttclid')) return 'tiktok_ads';

  // 3 · utm_source de una red
  if (fuente) {
    if (REDES_META.test(fuente)) return 'meta_ads';
    if (fuente.includes('tiktok')) return 'tiktok_ads';
    if (fuente.includes('google') && ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search'].includes(medio)) return 'google_ads';
    if (fuente === 'whatsapp') return 'whatsapp';
  }

  // 4 · utm_medium
  if (medio === 'referral') return 'referido';
  if (medio === 'organic') return 'organico';

  // 5 · utm_source de buscador sin pago
  if (fuente && (esBuscador(hostFuente) || /^(google|bing|duckduckgo|yahoo|ecosia)$/.test(fuente))) return 'organico';

  // 6 · el referrer
  if (hostRef && hostRef !== hostPropio) {
    if (esBuscador(hostRef)) return 'organico';
    if (hostRef.includes('tiktok.com')) return 'tiktok_ads';
    return 'referido';
  }

  // 7 · una fuente que no es ninguna de las de arriba
  if (fuente) return 'referido';

  // 8 · sin pistas
  return 'directo';
}

/**
 * ¿Hay alguna pista de origen? Es lo que separa un «directo» de verdad
 * (llegó con su dirección y sin referrer) de un prospecto del que no se sabe
 * nada porque la tubería no se lo trajo. El porcentaje de estos últimos es el
 * que dice si #48 funciona.
 */
export function tienePistaDeOrigen({ utm_source, utm_medium, utm_campaign, referrer, landing_url } = {}) {
  return [utm_source, utm_medium, utm_campaign, referrer, landing_url].some((v) => typeof v === 'string' && v.trim() !== '');
}

/** Las UTM que lleva pegadas una dirección (solo las que tengan texto). */
export function utmsDeLaDireccion(url) {
  const p = parametros(url);
  const sacar = (k) => { const v = p.get(k); return v && v.trim() ? v.trim() : null; };
  return {
    utm_source: sacar('utm_source'),
    utm_medium: sacar('utm_medium'),
    utm_campaign: sacar('utm_campaign'),
    utm_content: sacar('utm_content'),
    utm_term: sacar('utm_term'),
  };
}

const CANALES_DEBILES = new Set([null, undefined, 'directo']);

/**
 * Aplicar la regla HACIA ATRÁS (#48), sin tocar la base: recibe las filas y dice
 * qué cambiaría. Lo usa `scripts/recalcular-canal.mjs`, que es quien lee y
 * escribe.
 *
 * Qué toca y qué no:
 *   · Solo recalcula el canal de las filas «débiles»: sin canal o en `directo`,
 *     que es lo que el alta ponía cuando no sabía leer la pista. Un canal puesto
 *     a mano o por Make (meta_ads, whatsapp…) se respeta SIEMPRE.
 *   · Rellena las UTM que faltan con las que lleve pegada la dirección
 *     (`landing_url`), sin pisar ninguna que ya esté escrita. Un lead de Meta
 *     entró como «directo» teniendo `utm_source=fb` en la dirección.
 *   · No inventa: sin ninguna pista, la fila se queda como está.
 *   · Un canal «nuevo» igual que el que ya tenía, sin UTM que rellenar, no es un cambio.
 *
 * `filas`: { lead_id, canal_detectado, utm_source, utm_medium, utm_campaign,
 *            utm_content, utm_term, referrer, landing_url }.
 * Devuelve { cambios, sinPista, respetadas }.
 */
export function planearRecalculo(filas) {
  const cambios = [];
  let sinPista = 0;
  let respetadas = 0;
  for (const f of filas) {
    if (!CANALES_DEBILES.has(f.canal_detectado)) { respetadas += 1; continue; }
    const deLaUrl = utmsDeLaDireccion(f.landing_url);
    const utms = {};
    for (const k of Object.keys(deLaUrl)) {
      const actual = typeof f[k] === 'string' && f[k].trim() ? f[k] : null;
      if (!actual && deLaUrl[k]) utms[k] = deLaUrl[k];
    }
    const completa = { ...f, ...utms };
    if (!tienePistaDeOrigen(completa)) { sinPista += 1; continue; }
    const canal = deducirCanal(completa);
    if (canal === (f.canal_detectado ?? null) && !Object.keys(utms).length) continue;
    cambios.push({
      lead_id: f.lead_id,
      canal_antes: f.canal_detectado ?? null,
      canal_nuevo: canal,
      utms_nuevas: utms,
    });
  }
  return { cambios, sinPista, respetadas };
}
