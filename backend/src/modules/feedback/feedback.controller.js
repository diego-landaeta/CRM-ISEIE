import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { proyectosDelAmbito, veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { alcanceComercial, personasDentro } from '../../shared/utils/roles.js';
import * as service from './feedback.service.js';
import { CLAVES, DISPARADORES, MOTIVOS } from './motivos.js';
import { preguntasPara } from './preguntas.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El recorte del panel, según quién mira.
 *
 *   · superadmin y soporte: lo que pidan.
 *   · admin: lo que pida, pero solo dentro de SUS campus.
 *   · gestora: solo lo suyo, lo pida como lo pida.
 */
async function recorteDe(req) {
  const rol = req.user?.role;
  const ambito = await proyectosDelAmbito(req);
  const varios = String(req.query.projectIds || '')
    .split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  const projectIds = ambito.projectIds
    || (varios.length ? varios : (ambito.projectId ? [ambito.projectId] : null));
  const esJefe = rol === 'admin' || rol === 'superadmin' || rol === 'soporte';
  // «sin» = los envíos sin gestora (la fila «Sin gestora» del desglose, #593).
  // Solo vale para quien ve a todas las gestoras; a una gestora o a quien lleva
  // un equipo comercial se le queda su recorte de siempre.
  const sinGestora = req.query.gestoraId === 'sin';
  const pedido = sinGestora ? null : (Number(req.query.gestoraId) || null);
  // Quien lleva un equipo comercial (09/11/2026), dentro de su equipo; como
  // `personaDelInforme` en el CRM 360.
  const alcance = await alcanceComercial(req.user);
  let gestoraId;
  if (alcance && (esJefe || alcance.length > 1)) gestoraId = personasDentro(alcance, pedido);
  else if (esJefe) gestoraId = sinGestora ? 'sin' : pedido;
  else gestoraId = req.user.userId;
  return {
    projectIds,
    gestoraId,
    deUsuario: rol === 'superadmin' || rol === 'soporte' ? null : req.user.userId,
    desde: FECHA.test(req.query.desde || '') ? req.query.desde : null,
    hasta: FECHA.test(req.query.hasta || '') ? req.query.hasta : null,
  };
}

/**
 * Quién puede ver y decidir el correo de un prospecto, por su ALCANCE (#593):
 *
 *   · superadmin y soporte: cualquiera.
 *   · quien tiene alcance comercial (`alcanceComercial`): la gestora y la
 *     project manager, solo los que llevan; quien lleva un equipo comercial,
 *     los de su equipo (09/11/2026).
 *   · un admin sin equipo: los de SUS campus. Antes pasaba sin más, y un admin
 *     podía leer las respuestas de un prospecto de un campus que no es suyo y
 *     enviarle o cancelarle el correo.
 *   · el resto: solo los que lleva, como hasta ahora.
 *
 * El permiso (`feedback.view` / `feedback.enviar`) ya lo pide la ruta; aquí
 * solo se recorta a qué prospectos llega.
 */
async function exigirQueSeaSuyo(req, leadId) {
  if (!Number.isInteger(leadId) || leadId <= 0) throw new AppError('Prospecto no válido', 400, 'VALIDATION_ERROR');
  const { rows } = await query('SELECT responsable_id, project_id FROM leads WHERE id = $1 AND deleted_at IS NULL', [leadId]);
  if (!rows[0]) throw new AppError('Prospecto no encontrado', 404, 'NOT_FOUND');
  if (veTodoElCrm(req.user)) return;
  const alcance = await alcanceComercial(req.user);
  if (!alcance && req.user?.role === 'admin') {
    const suyos = await campusDeLaPersona(req.user?.userId);
    if (!suyos.includes(Number(rows[0].project_id))) {
      throw new AppError('Este prospecto es de un campus que no es tuyo', 403, 'FORBIDDEN');
    }
    return;
  }
  const permitidos = alcance || [req.user?.userId];
  if (!permitidos.includes(Number(rows[0].responsable_id))) {
    throw new AppError('Este prospecto no es tuyo', 403, 'FORBIDDEN');
  }
}

// GET /api/feedback/panel
export async function panel(req, res, next) {
  try {
    const { contestadas, ...datos } = await service.model.panel(await recorteDe(req));
    const totales = datos.totales;
    res.json({
      success: true,
      data: {
        ...datos,
        totales: {
          ...totales,
          tasa: totales.enviados ? Math.round((totales.respondidos * 1000) / totales.enviados) / 10 : 0,
        },
        motivos: MOTIVOS,
        // Pregunta a pregunta: cuántos eligieron cada cosa y lo que escribieron.
        preguntas: service.resumenDePreguntas(contestadas),
        disparadores: DISPARADORES,
      },
    });
  } catch (err) { next(err); }
}

// GET /api/feedback/lista?que=enviados|respondidos|...&motivo=&disparador=
export async function lista(req, res, next) {
  try {
    const filas = await service.model.lista(await recorteDe(req), {
      que: req.query.que,
      motivo: CLAVES.includes(req.query.motivo) ? req.query.motivo : null,
      disparador: DISPARADORES[req.query.disparador] ? req.query.disparador : null,
      limite: Number.isInteger(Number(req.query.limite)) && Number(req.query.limite) > 0 ? Number(req.query.limite) : 500,
    });
    res.json({ success: true, data: filas });
  } catch (err) { next(err); }
}

// GET /api/feedback/lead/:leadId -> como está el suyo, para su ficha
export async function deUnLead(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    await exigirQueSeaSuyo(req, leadId);
    const envio = await service.deUnLead(leadId);
    // Con las preguntas, para que la ficha pueda decir a qué contestó cada cosa.
    res.json({ success: true, data: envio ? { ...envio, preguntas: preguntasPara() } : null });
  } catch (err) { next(err); }
}

// POST /api/feedback/lead/:leadId/enviar -> el que esperaba revisión, sale
export async function enviarLoRevisado(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    await exigirQueSeaSuyo(req, leadId);
    res.json({ success: true, data: await service.enviarLoRevisado(leadId, req.user.userId) });
  } catch (err) { next(err); }
}

// POST /api/feedback/lead/:leadId/no-enviar
export async function noEnviar(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    await exigirQueSeaSuyo(req, leadId);
    res.json({ success: true, data: await service.noEnviar(leadId, req.user.userId) });
  } catch (err) { next(err); }
}

// ── Públicas: la encuesta, desde el enlace del correo ─────────────────────────

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
const respuestaSchema = z.object({
  // La encuesta de antes: solo motivo y comentario. La de ahora: `respuestas`
  // con todas, por clave. Lo que no encaje lo descarta `limpiarRespuestas`.
  motivo: z.string().max(40).optional(),
  comentario: z.string().max(1000).optional().nullable(),
  respuestas: z.record(z.any()).optional(),
});

// GET /api/f/:token
export async function encuesta(req, res, next) {
  try {
    if (!TOKEN.test(req.params.token)) throw new AppError('Este enlace no es válido', 404, 'NOT_FOUND');
    res.json({ success: true, data: await service.encuesta(req.params.token) });
  } catch (err) { next(err); }
}

// POST /api/f/:token
export async function responder(req, res, next) {
  try {
    if (!TOKEN.test(req.params.token)) throw new AppError('Este enlace no es válido', 404, 'NOT_FOUND');
    const parsed = respuestaSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError('Elige una de las opciones', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await service.responder(req.params.token, parsed.data) });
  } catch (err) { next(err); }
}
