// F2-014: validacion del refresh token de Google Ads. Llama al endpoint OAuth2
// de Google para intentar refresh del access_token; sirve tanto al scheduler
// diario como al endpoint manual /credentials/:id/test.
//
// La pareja client_id/client_secret es compartida para toda la app (una unica
// "Google Cloud project" registra el OAuth consent screen). Vienen de env.
// El refresh_token es por-credencial (api_credentials.encrypted_value).

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/**
 * @param {object} args
 * @param {string} args.clientId      - Google OAuth client_id (env)
 * @param {string} args.clientSecret  - Google OAuth client_secret (env)
 * @param {string} args.refreshToken  - Refresh token de la credencial
 * @returns {Promise<{ok:true, accessToken:string, expiresIn:number}
 *                  | {ok:false, code:string, message:string}>}
 */
export async function refreshGoogleAdsAccessToken({ clientId, clientSecret, refreshToken }) {
  if (!clientId || !clientSecret) {
    return { ok: false, code: 'missing_oauth_config', message: 'Faltan GOOGLE_OAUTH_CLIENT_ID o GOOGLE_OAUTH_CLIENT_SECRET' };
  }
  if (!refreshToken) {
    return { ok: false, code: 'missing_refresh_token', message: 'La credencial no tiene refresh_token' };
  }

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch (err) {
    return { ok: false, code: 'network_error', message: err.message };
  }

  let body = {};
  try { body = await res.json(); } catch { /* respuesta no-json */ }

  if (!res.ok) {
    return {
      ok: false,
      // Google devuelve `error: 'invalid_grant'` cuando el refresh_token fue
      // revocado o expiro. `unauthorized_client` cuando el OAuth client esta
      // desactivado. Pasamos el code raw para que la alerta sea precisa.
      code: body.error || `http_${res.status}`,
      message: body.error_description || `HTTP ${res.status}`,
    };
  }

  if (!body.access_token) {
    return { ok: false, code: 'no_access_token', message: 'Respuesta de Google sin access_token' };
  }

  return {
    ok: true,
    accessToken: body.access_token,
    expiresIn: body.expires_in || 3600,
  };
}
