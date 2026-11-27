import * as service from './meta-portfolio.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { assignSchema, connectSchema } from './meta-portfolio.validation.js';

/**
 * POST /portfolios — conecta un Business Manager entero (#198, gemela de CRM#212).
 * El token nunca vuelve en la respuesta.
 */
export async function connect(req, res, next) {
  try {
    const parsed = connectSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { business_id, nombre, access_token } = parsed.data;
    const result = await service.connectPortfolio({ businessId: business_id, nombre, accessToken: access_token, userId: req.user.userId });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

/** GET /portfolios — los portfolios conectados, sin el token. */
export async function list(req, res, next) {
  try {
    const result = await service.listPortfolios();
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/** DELETE /portfolios/:portfolioId */
export async function disconnect(req, res, next) {
  try {
    const portfolioId = parseInt(req.params.portfolioId);
    if (!portfolioId) throw new AppError('portfolioId requerido', 400, 'MISSING_PORTFOLIO');
    await service.disconnectPortfolio(portfolioId);
    res.json({ success: true, data: { disconnected: true } });
  } catch (err) { next(err); }
}

/** POST /portfolios/:portfolioId/sync — manual, fuera del ciclo de 3h. */
export async function sync(req, res, next) {
  try {
    const portfolioId = parseInt(req.params.portfolioId);
    if (!portfolioId) throw new AppError('portfolioId requerido', 400, 'MISSING_PORTFOLIO');
    const result = await service.syncPortfolio(portfolioId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/** GET /portfolios/:portfolioId/discovered — la bandeja de cuentas. */
export async function listDiscovered(req, res, next) {
  try {
    const portfolioId = parseInt(req.params.portfolioId);
    if (!portfolioId) throw new AppError('portfolioId requerido', 400, 'MISSING_PORTFOLIO');
    const result = await service.listDiscoveredAccounts(portfolioId);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/** POST /portfolios/discovered/:discoveredId/assign — body: { project_id }. */
export async function assign(req, res, next) {
  try {
    const discoveredId = parseInt(req.params.discoveredId);
    if (!discoveredId) throw new AppError('discoveredId requerido', 400, 'MISSING_DISCOVERED');
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { project_id: projectId } = parsed.data;
    const result = await service.assignDiscoveredAccount(discoveredId, { projectId, userId: req.user.userId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

/** POST /portfolios/discovered/:discoveredId/ignore — definitivo. */
export async function ignore(req, res, next) {
  try {
    const discoveredId = parseInt(req.params.discoveredId);
    if (!discoveredId) throw new AppError('discoveredId requerido', 400, 'MISSING_DISCOVERED');
    await service.ignoreDiscoveredAccount(discoveredId);
    res.json({ success: true, data: { ignored: true } });
  } catch (err) { next(err); }
}