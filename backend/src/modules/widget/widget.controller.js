import * as model from './widget.model.js';
import * as service from './widget.service.js';
import { AppError } from '../../shared/utils/AppError.js';

// Endpoint PUBLICO: GET /api/widget/whatsapp/:projectId.js
// Sin auth. Devuelve JS para embeber. Cache 5 minutos.
export async function widgetScript(req, res, next) {
  try {
    const raw = String(req.params.projectIdJs || '');
    const m = raw.match(/^(\d+)(?:\.js)?$/);
    if (!m) return res.status(400).type('text/plain').send('// invalid project id');
    const projectId = Number(m[1]);
    const js = await service.generateWidgetScript(projectId);
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(js);
  } catch (e) {
    res.setHeader('Content-Type', 'application/javascript');
    res.status(500).send('/* widget error: ' + String(e.message).replace(/\*\//g, '') + ' */');
  }
}

// Admin endpoints (con auth)
export async function getConfig(req, res, next) {
  try {
    const pid = Number(req.query.projectId);
    if (!pid) throw new AppError('projectId requerido', 400, 'BAD_REQUEST');
    const config = await model.getConfig(pid);
    if (!config) throw new AppError('Proyecto no existe', 404, 'NOT_FOUND');
    const candidates = await model.listCandidateUsers(pid);
    res.json({ success: true, data: { config, candidates } });
  } catch (e) { next(e); }
}

export async function updateConfig(req, res, next) {
  try {
    const pid = Number(req.body?.projectId);
    if (!pid) throw new AppError('projectId requerido', 400, 'BAD_REQUEST');
    const { enabled, welcome_text, message_template, excluded_user_ids, show_bubble, bubble_delay_ms } = req.body || {};
    const config = await model.upsertConfig(pid, {
      enabled, welcome_text, message_template,
      excluded_user_ids: Array.isArray(excluded_user_ids) ? excluded_user_ids : undefined,
      show_bubble, bubble_delay_ms,
    });
    res.json({ success: true, data: config });
  } catch (e) { next(e); }
}

export async function updateUserPhone(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    const { whatsapp_phone, whatsapp_display_name, whatsapp_widget_active } = req.body || {};
    await model.updateUserPhone(userId, { whatsapp_phone, whatsapp_display_name, whatsapp_widget_active });
    res.json({ success: true });
  } catch (e) { next(e); }
}
