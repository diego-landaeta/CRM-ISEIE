// F2-014: cron diario que valida el refresh_token de Google Ads de cada
// credencial activa. Si Google rechaza el refresh, marca la credencial como
// `expired` y notifica por Brevo a admins/superadmin (solo en la transicion
// ok->expired para evitar spam diario).

import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { decrypt } from '../shared/utils/crypto.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import { refreshGoogleAdsAccessToken } from '../shared/services/googleAds.service.js';
import { vigilar } from './latido.js';

const TICK_MS = parseInt(process.env.GOOGLE_TOKEN_TICK_MS || String(24 * 60 * 60 * 1000));

let running = false;

async function getAdminEmails() {
  const { rows } = await query(`
    SELECT email FROM users
    WHERE active = true AND role IN ('superadmin', 'admin') AND email IS NOT NULL
  `);
  return rows.map(r => r.email);
}

async function loadActiveGoogleCreds() {
  const { rows } = await query(`
    SELECT ac.id, ac.project_id, ac.encrypted_value, ac.iv, ac.auth_tag,
           ac.metadata, ac.last_test_result,
           p.nombre AS project_nombre
      FROM api_credentials ac
      LEFT JOIN projects p ON p.id = ac.project_id
     WHERE ac.service = 'google_ads' AND ac.active = true
  `);
  return rows;
}

async function recordResult(id, result) {
  await query(
    `UPDATE api_credentials SET last_tested_at = NOW(), last_test_result = $1 WHERE id = $2`,
    [result, id]
  );
}

async function notifyExpired(cred, errorCode, errorMessage, adminEmails) {
  if (adminEmails.length === 0) return;
  const projectLabel = cred.project_nombre || `(global, project_id=NULL)`;
  await sendEmail({
    to: adminEmails.join(','),
    subject: `[CRM] Google Ads desconectado — ${projectLabel}`,
    htmlContent: `
      <p>El refresh token de Google Ads para <strong>${projectLabel}</strong> ha dejado de ser valido.</p>
      <p><strong>Codigo:</strong> ${errorCode}</p>
      ${errorMessage ? `<p><strong>Detalle:</strong> ${errorMessage}</p>` : ''}
      <p>Las metricas dejaran de sincronizarse hasta que un superadmin re-autorice la cuenta desde
         <em>Configuracion → Credenciales API</em>.</p>
      <p>Posibles causas: el usuario Google revoco el acceso, la app de OAuth fue suspendida,
         o el refresh token expiro por inactividad (>6 meses).</p>
    `,
    tags: ['google-ads-token', `cred-${cred.id}`],
  });
}

async function notifyReactivated(cred, adminEmails) {
  if (adminEmails.length === 0) return;
  const projectLabel = cred.project_nombre || `(global)`;
  await sendEmail({
    to: adminEmails.join(','),
    subject: `[CRM] Google Ads reactivado — ${projectLabel}`,
    htmlContent: `
      <p>La conexion con Google Ads para <strong>${projectLabel}</strong> ha vuelto a funcionar.</p>
      <p>Las metricas se sincronizaran de nuevo en el proximo ciclo.</p>
    `,
    tags: ['google-ads-token', `cred-${cred.id}`],
  });
}

async function processOne(cred, adminEmails) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

  let refreshToken;
  try {
    refreshToken = decrypt(cred.encrypted_value, cred.iv, cred.auth_tag);
  } catch (err) {
    logger.warn({ err: err.message, credId: cred.id }, 'google ads token: decrypt fallo');
    await recordResult(cred.id, 'failed');
    return { credId: cred.id, ok: false };
  }

  const result = await refreshGoogleAdsAccessToken({ clientId, clientSecret, refreshToken });

  const wasExpired = cred.last_test_result === 'expired' || cred.last_test_result === 'failed';
  if (result.ok) {
    await recordResult(cred.id, 'ok');
    if (wasExpired) {
      // Transicion expired -> ok: notificar reactivacion (UX positiva)
      try { await notifyReactivated(cred, adminEmails); } catch (err) {
        logger.warn({ err: err.message, credId: cred.id }, 'google ads token: brevo reactivado fallo');
      }
    }
    return { credId: cred.id, ok: true };
  }

  // Fallido. Solo notifica en transicion ok|null -> expired (evita spam diario).
  await recordResult(cred.id, 'expired');
  if (!wasExpired) {
    try { await notifyExpired(cred, result.code, result.message, adminEmails); } catch (err) {
      logger.warn({ err: err.message, credId: cred.id }, 'google ads token: brevo expired fallo');
    }
  }
  return { credId: cred.id, ok: false, code: result.code };
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const creds = await loadActiveGoogleCreds();
    if (creds.length === 0) {
      logger.debug('google ads token tick: sin credenciales activas');
      return;
    }
    const adminEmails = await getAdminEmails();
    let okCount = 0;
    let failCount = 0;
    for (const cred of creds) {
      const res = await processOne(cred, adminEmails);
      if (res.ok) okCount++; else failCount++;
    }
    logger.info({ checked: creds.length, ok: okCount, fail: failCount }, 'google ads token tick');
  } catch (err) {
    logger.error({ err: err.message }, 'google ads token scheduler tick error');
  } finally {
    running = false;
  }
}

export function startGoogleAdsTokenScheduler() {
  if (process.env.GOOGLE_TOKEN_DISABLED === '1') {
    logger.info('Google Ads token scheduler desactivado (GOOGLE_TOKEN_DISABLED=1)');
    return;
  }
  // Primer tick a los 10 min (la app debe estar estable),
  // luego cada TICK_MS (default 24h).
  setTimeout(tick, 10 * 60 * 1000);
  vigilar('token_google_ads', 'Token de Google Ads', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Google Ads token scheduler iniciado');
}

// Exports internos para testing
export const _internals = { processOne, loadActiveGoogleCreds, recordResult };
