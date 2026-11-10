import * as model from './credentials.model.js';
import { upsertCredentialSchema, listCredentialsSchema } from './credentials.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { refreshGoogleAdsAccessToken } from '../../shared/services/googleAds.service.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';

/**
 * Lo que ve de las claves quien no ve todo el CRM (CRM#632 / ISEIE#359).
 *
 * El admin recibía 403 en Informes al preguntar si la clave de Claude está
 * puesta. Diego, 03/11: «el admin debe ver todo de todo», cada uno con los datos
 * de sus campus. Superadmin y soporte, todo. El admin, las de SUS campus y que
 * existen las generales (la de Claude), sin los últimos caracteres de esas, que
 * no son suyas. Guardar, probar y borrar siguen siendo de soporte.
 */
async function recortar(req, filas) {
  if (veTodoElCrm(req.user)) return filas;
  const mios = await campusDeLaPersona(req.user?.userId);
  return filas
    .filter((c) => c.project_id == null || mios.includes(Number(c.project_id)))
    .map((c) => (c.project_id == null ? { ...c, masked_value: '••••••••' } : c));
}

export async function list(req, res, next) {
  try {
    const parsed = listCredentialsSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const creds = await recortar(req, await model.list(parsed.data));
    res.json({ success: true, data: creds });
  } catch (err) { next(err); }
}

export async function upsert(req, res, next) {
  try {
    const parsed = upsertCredentialSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const cred = await model.upsert(parsed.data);
    res.status(201).json({ success: true, data: cred });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    await model.remove(id);
    res.json({ success: true, data: { message: 'Credencial eliminada' } });
  } catch (err) { next(err); }
}

export async function test(req, res, next) {
  const id = parseInt(req.params.id);
  try {
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');

    // Carga la fila completa para conocer el `service`. Necesario para decidir
    // si hacemos validacion real (google_ads) o stub.
    const { rows } = await query(
      `SELECT service, encrypted_value, iv, auth_tag FROM api_credentials WHERE id = $1`,
      [id]
    );
    const row = rows[0];
    if (!row) throw new AppError('Credencial no encontrada', 404, 'NOT_FOUND');

    if (row.service === 'google_ads') {
      // F2-014: validacion real contra el endpoint OAuth2 de Google.
      let refreshToken;
      try {
        refreshToken = decrypt(row.encrypted_value, row.iv, row.auth_tag);
      } catch (err) {
        await model.recordTestResult(id, 'failed');
        return res.json({ success: true, data: { result: 'failed', message: `Decrypt fallo: ${err.message}` } });
      }
      const result = await refreshGoogleAdsAccessToken({
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        refreshToken,
      });
      const stored = result.ok ? 'ok' : 'expired';
      await model.recordTestResult(id, stored);
      return res.json({
        success: true,
        data: result.ok
          ? { result: 'ok', message: `Token refrescado, expira en ${result.expiresIn}s.` }
          : { result: stored, code: result.code, message: result.message },
      });
    }

    // Resto de servicios: stub (solo verifica que decrypta bien).
    await model.recordTestResult(id, 'ok');
    res.json({ success: true, data: { result: 'ok', message: 'Credencial decrypted correctamente. Test real disponible solo para google_ads (F2-014).' } });
  } catch (err) {
    if (err.message?.includes('ENCRYPTION_KEY')) throw err;
    try { await model.recordTestResult(id, 'failed'); } catch {}
    next(err);
  }
}
