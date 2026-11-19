import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { recibirAviso } from './consultas.avisos.js';
import { conectarCampus } from './consultas.conexion.js';
import { conectarSchema } from './consultas.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * Lo que llama el plugin del CRM desde cada Moodle (#679). Va APARTE del router de
 * consultas, que exige sesión: el campus no tiene. Se monta antes que el
 * `express.json` general (app.js), como el aviso de WooCommerce.
 *
 *  - POST /conectar     el plugin se presenta con el código de un solo uso que da el
 *                       CRM; la puerta es el código (y que el Moodle conteste con el token).
 *  - POST /:projectId   cada mensaje privado del campus; la puerta es la FIRMA
 *                       (`X-Crm-Firma`), que obliga a leer el cuerpo en bruto.
 *
 * Solo se monta con el plugin aprobado (PLUGIN_MOODLE_EN_PRODUCCION, app.js). Todo lleva
 * un límite de ritmo por IP, y los cuerpos se validan con Zod (consultas.validation.js):
 * revisión de la #689, 8e.
 */
const router = Router();

// Pocos intentos por IP: el código es lo único que protege /conectar.
const limiteConectar = rateLimit({ windowMs: 15 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Espera unos minutos.', code: 'DEMASIADOS_INTENTOS' } });

// Los avisos: uno por mensaje, así que generoso (un campus con mucho movimiento, o la cola
// del cron de Moodle que se vacía de golpe), pero con techo, por campus y por IP. El plugin
// trata el 429 como «reintenta luego» (classes/aviso.php, `enviar`): no se pierde nada.
const limiteAvisos = rateLimit({
  windowMs: 60_000,
  limit: () => parseInt(process.env.MOODLE_AVISOS_POR_MINUTO || '600', 10),
  keyGenerator: (req) => `moodle-aviso-${req.params.projectId}-${ipKeyGenerator(req.ip)}`,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Demasiados avisos seguidos. Reintenta en un minuto.', code: 'DEMASIADOS_AVISOS' },
});

// La actualización: cada campus pregunta una vez al día. Esto deja margen de sobra.
const limitePlugin = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Demasiadas peticiones. Espera unos minutos.', code: 'DEMASIADOS_INTENTOS' } });

// ─── Actualización automática del plugin (#679) ───────────────────────────────
// Lo publica `npm run plugin:publicar` (firmado con la clave del CRM). Cada campus pregunta
// a diario y solo instala lo que trae una firma que su clave pública reconoce: que estas
// rutas no pidan sesión no deja colar nada.
const DIR_PLUGIN = path.resolve(process.env.PLUGIN_MOODLE_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../plugin-moodle'));
function manifiesto() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR_PLUGIN, 'manifiesto.json'), 'utf8')); } catch { return null; }
}
router.use('/plugin', limitePlugin);
router.get('/plugin/ultima', (req, res) => {
  const m = manifiesto();
  if (!m) return res.status(404).json({ success: false, error: 'No hay ninguna versión publicada', code: 'NOT_FOUND' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: m });
});
router.get('/plugin/local_crm.zip', (req, res) => {
  const m = manifiesto();
  const ruta = m ? path.join(DIR_PLUGIN, path.basename(m.archivo)) : null;
  if (!ruta || !fs.existsSync(ruta)) return res.status(404).json({ success: false, error: 'No hay ninguna versión publicada', code: 'NOT_FOUND' });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="local_crm.zip"');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(ruta).pipe(res);
});

router.post('/conectar', limiteConectar, express.json({ limit: '16kb' }), async (req, res, next) => {
  try {
    const datos = conectarSchema.safeParse(req.body || {});
    if (!datos.success) {
      // El plugin enseña este texto tal cual en el campus.
      return res.status(400).json({ success: false, error: datos.error.issues[0]?.message || 'Datos no válidos', code: 'VALIDATION_ERROR' });
    }
    const r = await conectarCampus(datos.data);
    if (!r.ok) return res.status(400).json({ success: false, error: r.error, code: 'CONEXION_RECHAZADA' });
    res.json({ success: true, data: { campus: r.campus, avisos: r.avisos, secreto: r.secreto } });
  } catch (err) { next(err); }
});

router.post('/:projectId', limiteAvisos, express.raw({ type: '*/*', limit: '1mb' }), async (req, res, next) => {
  try {
    const id = parseInt(req.params.projectId);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Firma no válida', 401, 'INVALID_SIGNATURE');
    const cuerpo = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const r = await recibirAviso(id, cuerpo, req.get('x-crm-firma'));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
});

export default router;
