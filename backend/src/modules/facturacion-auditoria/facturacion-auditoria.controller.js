import { AppError } from '../../shared/utils/AppError.js';
import * as service from './facturacion-auditoria.service.js';
import * as model from './facturacion-auditoria.model.js';
import { leerConfig } from './facturacion-auditoria.config.js';
import { sinDatosSchema, historialSchema } from './facturacion-auditoria.validation.js';

const APAGADA = () => new AppError('La auditoría de facturación está apagada.', 409, 'AUDITORIA_APAGADA');

// GET /api/facturacion-auditoria/estado — para el aviso fijo de los administradores.
// Con el interruptor apagado contesta { activa: false } y la pantalla no enseña nada.
export async function estado(req, res, next) {
  try {
    res.json({ success: true, data: await service.estado() });
  } catch (err) { next(err); }
}

// POST /api/facturacion-auditoria/reanudar — «Marcar como solucionado».
// Vuelve a auditar; solo reanuda (y emite la cola de la pausa) si sale limpia.
export async function reanudar(req, res, next) {
  try {
    sinDatosSchema.parse(req.body || {});
    const r = await service.reanudar({ userId: req.user.userId });
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// POST /api/facturacion-auditoria/auditar — «Auditar ahora». Si sale con errores
// y no estaba pausada, pausa como la de cada 2 horas.
export async function auditar(req, res, next) {
  try {
    sinDatosSchema.parse(req.body || {});
    if (!leerConfig().activa) throw APAGADA();
    const r = await service.auditar({ origen: 'manual', userId: req.user.userId });
    res.json({ success: true, data: { auditoria: r.auditoria, limpia: r.limpia, resumen: r.resumen, pausada: !!r.pausa } });
  } catch (err) { next(err); }
}

// GET /api/facturacion-auditoria/historial — cada vuelta, cada pausa y quién reanudó.
export async function historial(req, res, next) {
  try {
    const q = historialSchema.parse(req.query || {});
    if (!leerConfig().activa) return res.json({ success: true, data: { vueltas: [], pausas: [] } });
    res.json({ success: true, data: await model.historial({ limite: q.limite || 20 }) });
  } catch (err) { next(err); }
}
