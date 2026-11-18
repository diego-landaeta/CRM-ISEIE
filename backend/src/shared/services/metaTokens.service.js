// Las tres llamadas a la Graph API que necesita la renovación diaria de tokens (#471).
//
//   · inspeccionarTokenMeta  — GET graph.facebook.com/{v}/debug_token
//                              ¿es válido y cuándo caduca? (expires_at = 0: nunca)
//   · renovarTokenMeta       — GET graph.facebook.com/{v}/oauth/access_token
//                              grant_type=fb_exchange_token (cuentas de Meta Ads)
//   · renovarTokenInstagram  — GET graph.instagram.com/refresh_access_token
//                              grant_type=ig_refresh_token (Instagram API with Instagram Login)
//
// Ninguna lanza: devuelven { ok: true, ... } o { ok: false, code, message }, como
// refreshGoogleAdsAccessToken. Así quien llama decide qué es un fallo que avisar.
//
// EL TOKEN VA EN LA URL (así lo pide Meta en estas tres). Por eso aquí no se
// registra NUNCA la URL ni la respuesta entera: solo el código y el mensaje de error
// que devuelve Meta, que no lo contienen.

const versionGraph = () => process.env.IG_GRAPH_VERSION || 'v25.0';
const GRAPH_FB = () => `https://graph.facebook.com/${versionGraph()}`;
const GRAPH_IG = 'https://graph.instagram.com';

/** La app de Meta de la que salen los tokens. META_APP_* y, si no, IG_APP_* (épica #464). */
export function appDeMeta() {
  const appId = process.env.META_APP_ID || process.env.IG_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || process.env.IG_APP_SECRET || '';
  return { appId, appSecret };
}

async function pedir(url) {
  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    return { ok: false, code: 'network_error', message: err?.message || 'Fallo de red' };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok || data?.error) {
    const e = data?.error || {};
    const code = e.code ? `meta_${e.code}${e.error_subcode ? `_${e.error_subcode}` : ''}` : `http_${res.status}`;
    // error_user_msg es el legible cuando viene; si no, el message de siempre.
    return { ok: false, code, message: String(e.error_user_msg || e.message || `HTTP ${res.status}`).slice(0, 500) };
  }
  return { ok: true, data };
}

const segundosAFecha = (s) => new Date(Number(s) * 1000);

/**
 * ¿Sigue valiendo el token y cuándo caduca? Necesita la app (appId|appSecret).
 * → { ok, valido, sinCaducidad, expiresAt }
 */
export async function inspeccionarTokenMeta({ token, appId, appSecret }) {
  if (!appId || !appSecret) return { ok: false, code: 'missing_app_config', message: 'Faltan META_APP_ID y META_APP_SECRET' };
  if (!token) return { ok: false, code: 'missing_token', message: 'La cuenta no tiene token' };
  const url = `${GRAPH_FB()}/debug_token?input_token=${encodeURIComponent(token)}`
    + `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
  const r = await pedir(url);
  if (!r.ok) return r;
  const d = r.data?.data || {};
  const expira = Number(d.expires_at);
  // 0 = no caduca (usuario del sistema del Business Manager). Sin el campo, tampoco sabemos.
  const sinCaducidad = d.expires_at !== undefined && expira === 0;
  return {
    ok: true,
    valido: d.is_valid === true,
    sinCaducidad,
    expiresAt: !sinCaducidad && expira > 0 ? segundosAFecha(expira) : null,
    message: d.error?.message || null,
  };
}

function conToken(r) {
  if (!r.ok) return r;
  const accessToken = r.data?.access_token;
  if (!accessToken) return { ok: false, code: 'no_access_token', message: 'Meta respondió sin access_token' };
  const expiresIn = Number(r.data?.expires_in);
  return { ok: true, accessToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : null };
}

/** Token de larga duración de Meta (Ads) → otro de larga duración. → { ok, accessToken, expiresIn } */
export async function renovarTokenMeta({ token, appId, appSecret }) {
  if (!appId || !appSecret) return { ok: false, code: 'missing_app_config', message: 'Faltan META_APP_ID y META_APP_SECRET' };
  if (!token) return { ok: false, code: 'missing_token', message: 'La cuenta no tiene token' };
  const url = `${GRAPH_FB()}/oauth/access_token?grant_type=fb_exchange_token`
    + `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}`
    + `&fb_exchange_token=${encodeURIComponent(token)}`;
  return conToken(await pedir(url));
}

/**
 * Token de 60 días de Instagram → otros 60 días. Meta exige que tenga al menos
 * 24 h y que no haya caducado. → { ok, accessToken, expiresIn }
 */
export async function renovarTokenInstagram({ token }) {
  if (!token) return { ok: false, code: 'missing_token', message: 'La cuenta no tiene token' };
  const url = `${GRAPH_IG}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  return conToken(await pedir(url));
}
