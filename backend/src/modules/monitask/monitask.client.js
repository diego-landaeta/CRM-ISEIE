/**
 * Las llamadas a Monitask (#236). Solo LECTURA de la API: no crea ni borra nada
 * en la cuenta. Aislado aquí para que, si Monitask cambia algo, se toque un sitio.
 *
 *   autorizar   https://app.monitask.com/identity/connect/authorize  (authorization code + PKCE)
 *   token       https://app.monitask.com/identity/connect/token      (código → tokens, y renovar)
 *   API         https://external.monitask.com/api/v1/external/...
 *                 GET /users                                  las personas de la cuenta
 *                 GET /projects                               los proyectos (para los nombres)
 *                 GET /timeEntry/getByDateRange?userId&start&end   las entradas de tiempo
 *                 GET /activity/getByDateRange?userId&start&end    la actividad (%)
 *
 * Las capturas de pantalla (/screenshots) NO se piden nunca: la issue lo prohíbe.
 *
 * Las direcciones son las de Monitask. `MONITASK_API_URL` solo puede cambiar la de la
 * API y solo a otra de monitask.com: el token de la cuenta no puede salir hacia otro sitio
 * por un .env mal escrito. Las pruebas sustituyen `fetch`.
 */

export const URL_AUTORIZAR = 'https://app.monitask.com/identity/connect/authorize';
export const URL_TOKEN = 'https://app.monitask.com/identity/connect/token';
export const API_POR_DEFECTO = 'https://external.monitask.com';
// Lo justo para leer la API y renovar solo. Sin `openid`, `email` ni `profile`: el
// CRM no usa la identidad de quien autoriza, y pedirlos sin `openid` lo rechaza el servidor de Monitask.
export const ALCANCES_POR_DEFECTO = 'ExternalApi offline_access';

export function baseDeLaApi(env = process.env) {
  const pedida = String(env.MONITASK_API_URL || '').trim().replace(/\/+$/, '');
  if (!pedida) return API_POR_DEFECTO;
  try {
    const u = new URL(pedida);
    if (u.protocol === 'https:' && (u.hostname === 'monitask.com' || u.hostname.endsWith('.monitask.com'))) return pedida;
  } catch { /* no es una URL */ }
  return API_POR_DEFECTO;
}

export function alcances(env = process.env) {
  return String(env.MONITASK_SCOPES || '').trim() || ALCANCES_POR_DEFECTO;
}

/** Un error de Monitask con su estado HTTP y su código OAuth, si lo hay. */
export class ErrorMonitask extends Error {
  constructor(mensaje, { status = null, codigo = null } = {}) {
    super(mensaje);
    this.status = status;
    this.codigo = codigo;
  }
}

/** La dirección a la que se manda a quien pulsa «Conectar con Monitask». */
export function urlDeAutorizacion({ clientId, redirectUri, state, codeChallenge, env = process.env }) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: alcances(env),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${URL_AUTORIZAR}?${p}`;
}

async function pedirToken(campos) {
  let r;
  try {
    r = await fetch(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(campos).toString(),
    });
  } catch (err) {
    throw new ErrorMonitask(`No se pudo hablar con Monitask: ${err.message}`);
  }
  let datos = null;
  try { datos = await r.json(); } catch { datos = null; }
  if (!r.ok || !datos?.access_token) {
    const codigo = datos?.error || null;
    const detalle = datos?.error_description || codigo || `HTTP ${r.status}`;
    throw new ErrorMonitask(`Monitask no ha dado el token: ${detalle}`, { status: r.status, codigo });
  }
  return {
    accessToken: datos.access_token,
    refreshToken: datos.refresh_token || null,
    expiraEn: Number(datos.expires_in) || 3600,
  };
}

/** El código de la vuelta del OAuth, por los tokens. */
export function cambiarCodigo({ clientId, secreto, code, redirectUri, codeVerifier }) {
  return pedirToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: secreto,
    code_verifier: codeVerifier,
  });
}

/** Un access token nuevo con el refresh token. Monitask puede dar otro refresh: se guarda el nuevo. */
export function renovar({ clientId, secreto, refreshToken }) {
  return pedirToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: secreto,
  });
}

/** Fecha para la API: ISO en UTC sin milisegundos. */
export function fechaApi(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * GET a la API con el token. Un 401 se devuelve como ErrorMonitask con status 401
 * para que el servicio renueve y repita una vez.
 */
export async function pedir(token, ruta, params = {}, env = process.env) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString();
  const url = `${baseDeLaApi(env)}/api/v1/external${ruta}${qs ? `?${qs}` : ''}`;
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch (err) {
    throw new ErrorMonitask(`No se pudo hablar con Monitask: ${err.message}`);
  }
  if (!r.ok) {
    let texto = '';
    try { texto = (await r.text()).slice(0, 200); } catch { /* nada */ }
    throw new ErrorMonitask(`Monitask ${ruta} HTTP ${r.status}${texto ? `: ${texto}` : ''}`, { status: r.status });
  }
  if (r.status === 204) return [];
  try { return await r.json(); } catch { return []; }
}

export const usuarios = (token, env) => pedir(token, '/users', {}, env);
export const proyectos = (token, env) => pedir(token, '/projects', {}, env);
export const entradas = (token, { userId, desdeMs, hastaMs }, env) => pedir(token, '/timeEntry/getByDateRange',
  { userId, start: fechaApi(desdeMs), end: fechaApi(hastaMs) }, env);
export const actividad = (token, { userId, desdeMs, hastaMs }, env) => pedir(token, '/activity/getByDateRange',
  { userId, start: fechaApi(desdeMs), end: fechaApi(hastaMs) }, env);
