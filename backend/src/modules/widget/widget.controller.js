import * as model from './widget.model.js';
import * as service from './widget.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { traduccionesSchema, limpiarTraducciones, textosPorIdioma, idiomaDe } from './widget.idiomas.js';
import { gestorasParaLaWeb } from '../asignacion/asignacion.widget.js';
import { apuntarPulsacion, resumenDePulsaciones } from './widget.pulsaciones.js';
import { proyectosDelAmbito, comoLista } from '../../shared/utils/ambito.js';
import { createHash } from 'node:crypto';

// Endpoint PUBLICO: GET /api/widget/whatsapp/:projectId.js
// Sin auth. Devuelve JS para embeber. Cache 5 minutos.
export async function widgetScript(req, res, next) {
  try {
    const raw = String(req.params.projectIdJs || '');
    const m = raw.match(/^(\d+)(?:\.js)?$/);
    if (!m) return res.status(400).type('text/plain').send('// invalid project id');
    const projectId = Number(m[1]);
    // ?lang=en|fr|pt: el script antiguo lleva los textos dentro, así que se elige aquí.
    const js = await service.generateWidgetScript(projectId, idiomaDe(req.query.lang));
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Cache corto (60s): cambios casi instantáneos. Impacto SEO = 0 porque el
    // script es async de ~3.6KB (lo que afecta SEO es bloquear render, no esto).
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(js);
  } catch (e) {
    res.setHeader('Content-Type', 'application/javascript');
    res.status(500).send('/* widget error: ' + String(e.message).replace(/\*\//g, '') + ' */');
  }
}

// Endpoint PUBLICO JSON: GET /api/w/data/:projectId.json
// Devuelve config + gestoras para que el snippet INLINE (ya pintado en el HTML)
// rote y arme el href. El botón ya es visible sin esperar esto.
export async function widgetData(req, res, next) {
  try {
    const raw = String(req.params.projectIdJson || '');
    const m = raw.match(/^(\d+)(?:\.json)?$/);
    if (!m) return res.status(400).json({ enabled: false });
    const projectId = Number(m[1]);
    const config = await model.getConfig(projectId);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!config || !config.enabled) return res.json({ enabled: false });
    const users = await model.listActiveWidgetUsers(projectId, config.excluded_user_ids || []);
    res.json({
      enabled: true,
      project: config.project_nombre,
      // El español, como siempre: lo leen los códigos pegados antes de los idiomas.
      welcome: config.welcome_text,
      template: config.message_template,
      // Cada idioma, para que el código de la web elija el de la página (12/10).
      textos: textosPorIdioma(config),
      // La burbuja como dice el panel (antes el código ponía 3 s siempre).
      burbuja: config.show_bubble !== false,
      retraso: Number(config.bubble_delay_ms) || 3000,
      // Si hay una gestora activa a la que le toca, solo ella; el código de la
      // web elige al azar entre las que recibe, así que no hay que repegarlo.
      // El tercero es su id, para avisar de la pulsación (widget.pulsaciones.js).
      // Los códigos pegados antes solo leen los dos primeros.
      gestoras: (await gestorasParaLaWeb(projectId, users)).map((u) => [u.display_name, u.whatsapp_phone, u.id]),
    });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ enabled: false });
  }
}

// Endpoint PUBLICO: POST /api/w/clic/:projectId
// El código de la web avisa de cada pulsación del botón con `sendBeacon`, que
// manda texto plano: {"g": id de la gestora, "u": la página, "l": el idioma}.
// Contesta siempre 204 y nunca falla: lo que importa es que la persona llegue
// al WhatsApp, no que se cuente la pulsación.
export async function widgetClic(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const m = String(req.params.projectId || '').match(/^(\d+)$/);
    let datos = req.body;
    if (typeof datos === 'string') { try { datos = JSON.parse(datos); } catch { datos = null; } }
    if (m && datos && typeof datos === 'object') {
      // Quien pulsa, sin guardar su IP: solo para no contar dos veces el mismo doble clic.
      const quien = createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 16);
      await apuntarPulsacion({ projectId: Number(m[1]), userId: datos.g, pagina: datos.u, idioma: datos.l, quien });
    }
  } catch { /* la pulsación no puede romper el botón */ }
  res.status(204).end();
}

// Admin: GET /api/widget/pulsaciones?projectId|issuerId&from&to
// Por gestora: pulsaciones, altas por WhatsApp y cuántas tienen pulsación.
export async function pulsaciones(req, res, next) {
  try {
    const fecha = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const hoy = new Date().toISOString().slice(0, 10);
    const to = fecha(req.query.to) || hoy;
    const from = fecha(req.query.from) || new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    const ambito = await proyectosDelAmbito(req);
    const projectIds = comoLista(ambito.projectId, ambito.projectIds) || [];
    if (!projectIds.length) throw new AppError('Elige un campus', 400, 'BAD_REQUEST');
    res.json({ success: true, data: { from, to, ...(await resumenDePulsaciones({ projectIds, from, to })) } });
  } catch (e) { next(e); }
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
    const { enabled, welcome_text, message_template, excluded_user_ids, show_bubble, bubble_delay_ms, traducciones } = req.body || {};
    let trad;
    if (traducciones !== undefined) {
      const r = traduccionesSchema.safeParse(traducciones);
      if (!r.success) throw new AppError('Traducciones no válidas: solo inglés, francés y portugués, con el texto de la burbuja y el mensaje.', 400, 'VALIDATION_ERROR');
      trad = limpiarTraducciones(r.data);
    }
    const config = await model.upsertConfig(pid, {
      enabled, welcome_text, message_template,
      excluded_user_ids: Array.isArray(excluded_user_ids) ? excluded_user_ids : undefined,
      show_bubble, bubble_delay_ms, traducciones: trad,
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
