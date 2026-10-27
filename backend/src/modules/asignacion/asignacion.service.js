import crypto from 'node:crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { gestoresDelReparto } from '../leads/reparto.js';
import { createFromExternalWebhook } from '../leads/lead.service.js';
import { webhookLeadSchema } from '../leads/lead.validation.js';
import { comprobarDestino } from '../webhooks-salientes/webhooks-salientes.red.js';
import * as model from './asignacion.model.js';
import { activasEntre, cuentasDe, elegir, porQue } from './asignacion.actividad.js';
import { CAMPOS_QUE_PONE_EL_CRM } from './asignacion.validation.js';

/*
  ASIGNACIÓN DE LEADS POR ACTIVIDAD (CRM#513; Carlos y Diego, 27/10/2026).

  Web (Brevo / SMTP) ─► Make · ENTRADA ─► POST /api/asignacion/entrada (con su clave)
     ├─ alguna gestora activa ─► el CRM CREA el lead con ella ─► ESCENARIO 2 (datos + gestora)
     └─ ninguna (o apagada)  ─► el CRM NO lo crea ─────────────► ESCENARIO 1 (el de siempre)
  Si el CRM no contesta, la entrada de Make lo manda al escenario 1 por su cuenta.

  · La respuesta sale enseguida (< 2 s); el envío al escenario va por detrás,
    con reintentos a 1, 5 y 15 minutos y la cola en la base.
  · Sin duplicados: una decisión por campus y uid; el lead lleva la clave
    `asignacion-<uid>` (`idempotency_key`), y el alta de leads devuelve el que
    ya existe si llega otra vez.
  · Dos formularios del mismo campus a la vez se deciden uno detrás de otro, para
    que el segundo ya cuente el lead que acaba de recibir la primera.
*/

export const MAX_INTENTOS = 4;
export const ESPERAS_MS = [60_000, 5 * 60_000, 15 * 60_000];
const TIMEOUT_MS = parseInt(process.env.ASIGNACION_TIMEOUT_MS || '10000', 10);
const RESPUESTA_MAX = 1000;

export const huella = (clave) => crypto.createHash('sha256').update(String(clave)).digest('hex');
export const generarClave = () => `asig_${crypto.randomBytes(24).toString('base64url')}`;
const cola = (v) => String(v || '').slice(-8);

/** Un destino listo para guardar: cifrado, con su tipo y la cola para enseñar. */
export function cifrarDestino(n, { tipo, valor }) {
  const c = encrypt(String(valor).trim());
  return {
    [`destino${n}_tipo`]: tipo,
    [`destino${n}_cifrado`]: c.encrypted,
    [`destino${n}_iv`]: c.iv,
    [`destino${n}_tag`]: c.authTag,
    [`destino${n}_cola`]: cola(String(valor).trim()),
  };
}

function destinoDe(config, n) {
  return {
    tipo: config[`destino${n}_tipo`],
    valor: decrypt(config[`destino${n}_cifrado`], config[`destino${n}_iv`], config[`destino${n}_tag`]),
  };
}

/* ─── Un campus a la vez ─── */

const colas = new Map();
function enFila(projectId, fn) {
  const antes = colas.get(projectId) || Promise.resolve();
  const ahora = antes.catch(() => {}).then(fn);
  colas.set(projectId, ahora.finally(() => { if (colas.get(projectId) === ahora) colas.delete(projectId); }));
  return ahora;
}

/** Los campos del lead, sin lo propio de la entrada ni lo que decide el CRM. */
function camposDelLead(datos) {
  const { uid: _uid, original: _o, project_id: _p, proyecto: _s, ...resto } = datos || {};
  for (const k of CAMPOS_QUE_PONE_EL_CRM) delete resto[k];
  return resto;
}

/**
 * EL CORAZÓN. Llega un formulario por la entrada: se decide a quién y a qué
 * escenario, se crea el lead si toca, y se pone en cola el envío.
 *
 * Devuelve lo que contesta la entrada a Make: { escenario, gestora?, lead_id?, decision_id }.
 */
export async function decidir(config, datos, { prueba = false } = {}) {
  // El campus: el de la configuración; si es de una empresa o de todas, el que diga el formulario.
  let campus;
  if (config.ambito === 'campus') {
    campus = await model.campus(config.project_id);
  } else {
    const pedido = datos.project_id || datos.proyecto;
    if (!pedido) throw new AppError('Falta el campus del formulario (project_id o proyecto)', 400, 'VALIDATION_ERROR');
    campus = await model.campus(pedido);
    if (campus && config.ambito === 'empresa' && Number(campus.sociedad_emisora_id) !== Number(config.issuer_id)) {
      throw new AppError('Ese campus no es de la empresa de esta entrada', 400, 'VALIDATION_ERROR');
    }
  }
  if (!campus) throw new AppError('Ese campus no existe o está inactivo', 400, 'VALIDATION_ERROR');

  const campos = camposDelLead(datos);
  const valido = webhookLeadSchema.safeParse(campos);
  if (!valido.success) throw new AppError(valido.error.errors[0].message, 400, 'VALIDATION_ERROR');

  return enFila(campus.id, async () => {
    // Si este formulario ya entró (Make reintenta), se contesta lo mismo.
    const ya = await model.decisionPorUid(campus.id, datos.uid);
    if (ya) return respuestaDe(ya, await model.personas([ya.responsable_id]));

    const candidatas = config.activo ? await gestoresDelReparto((sql, p) => query(sql, p), campus.id) : [];
    const activas = candidatas.length ? await activasEntre(candidatas.map((g) => g.id), config.ventana_min) : new Map();
    const cuentas = activas.size ? await cuentasDe([...activas.keys()]) : new Map();
    const { elegida, orden } = elegir(activas.keys(), cuentas);

    const motivo = {
      ventana_min: config.ventana_min,
      apagada: !config.activo,
      candidatas: candidatas.map((g) => ({ id: Number(g.id), nombre: g.nombre })),
      activas: orden.map((f) => ({ ...f, ...(activas.get(f.id) || {}) })),
      texto: !config.activo ? 'La asignación por actividad está apagada en este campus'
        : !candidatas.length ? 'Nadie recibe leads en este campus'
          : !elegida ? `Ninguna gestora activa en los últimos ${config.ventana_min} min`
            : porQue(elegida, activas.get(elegida.id)),
    };

    if (!elegida) {
      const dec = await model.crearDecision({
        destinoId: config.id, projectId: campus.id, uid: datos.uid, prueba, escenario: 1, motivo, datos, destinoTipo: config.destino1_tipo,
      });
      if (!dec) return respuestaDe(await model.decisionPorUid(campus.id, datos.uid), new Map());
      setImmediate(() => { procesarEnvio(dec.id).catch(() => {}); });
      return respuestaDe(dec, new Map());
    }

    // Con alguien activo, el CRM crea el lead con ella (el escenario 2 ya no lo crea).
    const dec = await model.crearDecision({
      destinoId: config.id, projectId: campus.id, uid: datos.uid, prueba, escenario: 2,
      responsableId: elegida.id, motivo, datos, destinoTipo: config.destino2_tipo,
    });
    if (!dec) return respuestaDe(await model.decisionPorUid(campus.id, datos.uid), await model.personas([elegida.id]));

    if (!prueba) {
      try {
        const r = await createFromExternalWebhook(campus.id, {
          ...valido.data, responsable_id: elegida.id, idempotency_key: `asignacion-${datos.uid}`,
        });
        if (r?.lead_id) { await model.ponerLead(dec.id, r.lead_id); dec.lead_id = r.lead_id; }
      } catch (err) {
        logger.warn({ err: err.message, decision: dec.id }, 'asignación: no se pudo crear el lead; se queda la decisión y el envío');
      }
    }
    setImmediate(() => { procesarEnvio(dec.id).catch(() => {}); });
    return respuestaDe(dec, await model.personas([elegida.id]));
  });
}

function respuestaDe(dec, personas) {
  const g = dec?.responsable_id ? personas.get(Number(dec.responsable_id)) : null;
  return {
    decision_id: dec?.id ?? null,
    escenario: dec?.escenario ?? 1,
    gestora: g ? { id: Number(g.id), nombre: g.nombre, email: g.email } : null,
    lead_id: dec?.lead_id ?? null,
    motivo: dec?.motivo?.texto || null,
  };
}

/* ─── El envío al escenario ─── */

/** Lo que recibe el escenario: los mismos campos que llegaron, más la gestora (escenario 2). */
export function construirPayload(dec, campus, gestora) {
  const campos = camposDelLead(dec.datos);
  return {
    evento: 'lead.asignacion',
    escenario: dec.escenario,
    uid: dec.uid,
    prueba: Boolean(dec.prueba),
    campus: campus ? { id: Number(campus.id), nombre: campus.nombre, slug: campus.slug } : null,
    lead_id: dec.lead_id ?? null,
    gestora: gestora ? { id: Number(gestora.id), nombre: gestora.nombre, email: gestora.email } : null,
    // Planos, como los espera un escenario de Make.
    ...campos,
    ...(gestora ? { responsable_id: Number(gestora.id), responsable_email: gestora.email, responsable_nombre: gestora.nombre } : {}),
    datos: campos,
    original: dec.datos?.original || null,
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** El correo para un mailhook: el del formulario tal cual y, si hay gestora, arriba sus datos. */
export function construirCorreo(payload) {
  const o = payload.original || {};
  const campos = payload.datos || {};
  const filas = Object.entries(campos).filter(([, v]) => v !== '' && v != null && typeof v !== 'object');
  const tabla = `<table>${filas.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const textoCampos = filas.map(([k, v]) => `${k}: ${v}`).join('\n');
  const g = payload.gestora;
  const cabeHtml = g
    ? `<p><b>GESTORA ASIGNADA:</b> ${esc(g.nombre)} · ${esc(g.email)} · id ${esc(g.id)}${payload.lead_id ? ` · lead ${esc(payload.lead_id)}` : ''}</p><hr>` : '';
  const cabeTexto = g ? `GESTORA ASIGNADA: ${g.nombre} · ${g.email} · id ${g.id}${payload.lead_id ? ` · lead ${payload.lead_id}` : ''}\n\n` : '';
  return {
    subject: o.asunto || `Nuevo formulario · ${payload.campus?.nombre || 'CRM'}`,
    htmlContent: `${cabeHtml}${o.html || tabla}`,
    textContent: `${cabeTexto}${o.texto || textoCampos}`,
  };
}

const reintentable = (status) => status >= 500 || status === 408 || status === 429;

/** Manda una decisión a su escenario. Nunca lanza. */
export async function procesarEnvio(decisionId) {
  let dec;
  try { dec = await model.reclamar(decisionId); } catch (err) {
    logger.warn({ err: err.message, decisionId }, 'asignación: no se pudo reclamar el envío');
    return null;
  }
  if (!dec) return null;

  const fallo = async ({ error, httpStatus = null, respuesta = null, permanente = false }) => {
    const quedan = !dec.prueba && !permanente && dec.intentos < MAX_INTENTOS;
    const espera = quedan ? ESPERAS_MS[Math.min(dec.intentos - 1, ESPERAS_MS.length - 1)] : null;
    logger.warn({ decisionId, escenario: dec.escenario, intento: dec.intentos, httpStatus, error, reintentoEnMs: espera }, 'asignación: envío fallido');
    try { return await model.marcarFallo(dec.id, { httpStatus, respuesta, error: String(error).slice(0, 500), reintentarEnMs: espera }); } catch { return null; }
  };

  try {
    const config = dec.destino_id ? await model.conDestinos(dec.destino_id) : null;
    if (!config) return fallo({ error: 'La configuración de la asignación ya no existe', permanente: true });
    const destino = destinoDe(config, dec.escenario);
    const campus = await model.campus(dec.project_id);
    const gestora = dec.responsable_id ? (await model.personas([dec.responsable_id])).get(Number(dec.responsable_id)) : null;
    const payload = construirPayload(dec, campus, gestora);

    if (destino.tipo === 'mailhook') {
      const correo = construirCorreo(payload);
      const r = await sendEmail({
        to: [{ email: destino.valor }], ...correo, cuenta: 'crm',
        tags: ['asignacion-leads', `escenario-${dec.escenario}`],
        clave: `asignacion-${dec.id}-${dec.intentos}`,
      });
      if (r?.sent || r?.reason === 'YA_ENVIADO') return model.marcarEnviado(dec.id, { respuesta: String(r.messageId || 'ya enviado').slice(0, RESPUESTA_MAX) });
      if (r?.reason === 'FRENO_DE_PRUEBAS') return fallo({ error: 'El freno de correos de este entorno de pruebas no deja salir el correo al mailhook', permanente: true });
      return fallo({ error: r?.reason || r?.error || 'Brevo no aceptó el correo' });
    }

    await comprobarDestino(destino.valor);
    const cuerpo = JSON.stringify({ ...payload, enviado_at: new Date().toISOString() });
    const res = await fetch(destino.valor, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'CRM-Asignacion-Leads/1.0',
        'X-CRM-Evento': 'lead.asignacion',
        'X-CRM-Escenario': String(dec.escenario),
        'X-CRM-Decision': String(dec.id),
      },
      body: cuerpo,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let respuesta = null;
    try { respuesta = (await res.text()).slice(0, RESPUESTA_MAX) || null; } catch { /* sin cuerpo */ }
    if (res.status >= 200 && res.status < 300) return model.marcarEnviado(dec.id, { httpStatus: res.status, respuesta });
    return fallo({ httpStatus: res.status, respuesta, error: `El escenario contestó ${res.status}`, permanente: !reintentable(res.status) });
  } catch (err) {
    const tiempo = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return fallo({ error: tiempo ? `El escenario no contestó en ${Math.round(TIMEOUT_MS / 1000)} s` : (err?.message || String(err)), permanente: Boolean(err?.permanente) });
  }
}

/** «Enviar prueba» a un escenario: datos de ejemplo, sin crear lead y sin reintentos. */
export async function enviarPrueba(config, escenario) {
  const campusId = config.project_id || (config.issuer_id ? (await model.campusDeLaEmpresa(config.issuer_id))[0] : null)
    || (await query('SELECT id FROM projects WHERE active ORDER BY id LIMIT 1')).rows[0]?.id;
  if (!campusId) throw new AppError('No hay ningún campus con el que probar', 400, 'VALIDATION_ERROR');
  const uid = `prueba-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const datos = {
    uid, nombre: '[PRUEBA] Formulario de prueba', email: 'prueba@ejemplo.com', telefono: '+34600000000',
    producto_interes: 'Curso de prueba', notas: 'Envío de prueba de la asignación de leads (no es un lead real)',
  };
  const dec = await model.crearDecision({
    destinoId: config.id, projectId: campusId, uid, prueba: true, escenario,
    responsableId: null, motivo: { texto: `Prueba del escenario ${escenario}` }, datos, destinoTipo: config[`destino${escenario}_tipo`],
  });
  const r = await procesarEnvio(dec.id);
  return r || (await model.decisionPorId(dec.id));
}

export async function reenviar(decisionId) {
  const dec = await model.prepararReenvio(decisionId);
  if (!dec) throw new AppError('Solo se puede reenviar un envío fallido', 409, 'NO_FALLIDO');
  return (await procesarEnvio(dec.id)) || model.decisionPorId(dec.id);
}

/** La vuelta de los reintentos (cada 2 minutos) y la purga de `actividad_crm`. */
export async function procesarPendientes({ limite = 20 } = {}) {
  const rescatados = await model.rescatarAtascados(MAX_INTENTOS);
  const ids = await model.pendientesQueTocan(limite);
  for (const id of ids) await procesarEnvio(id);
  return { intentados: ids.length, rescatados };
}
