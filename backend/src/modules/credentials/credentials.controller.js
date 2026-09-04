import * as model from './credentials.model.js';
import { upsertCredentialSchema, listCredentialsSchema } from './credentials.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { refreshGoogleAdsAccessToken } from '../../shared/services/googleAds.service.js';
import { anotar, historial, ACCIONES } from './credentials.registro.js';

export async function list(req, res, next) {
  try {
    const parsed = listCredentialsSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const creds = await model.list(parsed.data);
    res.json({ success: true, data: creds });
  } catch (err) { next(err); }
}

export async function upsert(req, res, next) {
  try {
    const parsed = upsertCredentialSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    // Se mira si ya existia ANTES de escribir, para poder decir en el registro
    // si esto fue crear o cambiar. Despues ya no se distingue.
    const previas = await model.list({
      projectId: parsed.data.project_id ?? null, service: parsed.data.service,
    });
    const cred = await model.upsert({ ...parsed.data, userId: req.user.userId });
    await anotar(req, previas.length ? ACCIONES.CAMBIAR : ACCIONES.CREAR, {
      id: cred.id, servicio: cred.service,
      projectId: cred.project_id, entorno: cred.metadata?.entorno,
    });
    res.status(201).json({ success: true, data: cred });
  } catch (err) { next(err); }
}

/**
 * GET /api/credentials/:id/revelar — el valor entero, UNA credencial.
 *
 * Llamada aparte del listado y **registrada**, que es lo que pide la #80: «ver
 * el valor entero es una llamada aparte, y queda registrada: quien lo miro y
 * cuando».
 *
 * Se anota ANTES de contestar. Si se anotara despues y algo fallara por medio,
 * el valor habria salido sin dejar rastro — que es justo el caso que no puede
 * darse.
 */
export async function revelar(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const cred = await model.revelar(id);
    if (!cred) throw new AppError('Credencial no encontrada', 404, 'NOT_FOUND');

    await anotar(req, ACCIONES.VER, {
      id: cred.id, servicio: cred.service,
      projectId: cred.project_id, entorno: cred.entorno,
    });

    res.json({ success: true, data: cred });
  } catch (err) { next(err); }
}

/** GET /api/credentials/paridad — que le falta a un entorno que el otro si tiene. */
export async function paridad(_req, res, next) {
  try {
    res.json({ success: true, data: await model.paridad() });
  } catch (err) { next(err); }
}

/** GET /api/credentials/registro — quien ha tocado que. */
export async function registro(req, res, next) {
  try {
    res.json({
      success: true,
      data: await historial({ limite: req.query.limit, servicio: req.query.servicio }),
    });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    // Se lee antes de borrar: despues ya no se sabe que era.
    const cred = await model.revelar(id);
    await model.remove(id);
    if (cred) {
      await anotar(req, ACCIONES.BORRAR, {
        id, servicio: cred.service, projectId: cred.project_id, entorno: cred.entorno,
      });
    }
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
