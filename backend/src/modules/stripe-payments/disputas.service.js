import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { correo, parrafo, boton, nota, esc, enlace } from '../../shared/services/email-plantilla.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import * as model from './disputas.model.js';
import * as pagosModel from './stripe-payments.model.js';
import { getStripeKey, stripeGet } from './stripe-payments.service.js';

/*
  DISPUTAS DE STRIPE, ABIERTAS Y CON AVISO (#396).

  Que pide la tarea: ver las disputas abiertas de todas las cuentas de Stripe
  conectadas, por empresa y por campus, y que los admins de cada empresa se
  enteren al entrar una y otra vez si quedan pocos dias y nadie ha respondido.

  SOLO LECTURA. El CRM no responde disputas ni manda nada a Stripe: la
  respuesta se da en el panel de Stripe. Aqui solo se lee.

  POR QUE UN SONDEO PROPIO, ADEMAS DEL WEBHOOK. El sondeo de cobros
  (`syncStripePayments`) solo pide los cargos NUEVOS desde la marca de agua, y
  una disputa llega semanas despues del cargo: ese sondeo no la ve nunca. Y hoy
  ninguna cuenta tiene el webhook configurado (base de pruebas, 17/11), asi que
  sin esto las disputas no entraban por ningun lado. Se piden a Stripe las de
  los ultimos DISPUTAS_VENTANA_DIAS dias (por defecto 120: lo que dura una
  disputa de principio a fin) y, aparte, una a una las que siguen abiertas y
  son mas viejas.

  CUENTAS. En ISEIE cada campus tiene su propia cuenta de Stripe: no hay
  cuentas compartidas ni `filtro_metadata` (eso es del CRM 360, #44), asi que
  toda disputa de la cuenta es del campus.
*/

/** Monedas sin decimales en Stripe: el importe ya viene en unidades. */
const SIN_DECIMALES = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
/** Monedas con tres decimales en Stripe. */
const TRES_DECIMALES = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

/** De la unidad minima de Stripe (centimos…) a unidades de la moneda. */
export function importeDeStripe(cantidad, moneda) {
  const m = String(moneda || '').toLowerCase();
  const n = Number(cantidad || 0);
  if (SIN_DECIMALES.has(m)) return n;
  if (TRES_DECIMALES.has(m)) return n / 1000;
  return n / 100;
}

export const estaAbierta = (status) => model.ESTADOS_ABIERTOS.includes(status);

/** El enlace a la disputa en el panel de Stripe (en modo pruebas, el suyo). */
export function enlaceEnStripe(disputeId, livemode = true) {
  return `https://dashboard.stripe.com/${livemode === false ? 'test/' : ''}disputes/${encodeURIComponent(disputeId)}`;
}

/**
 * El objeto `dispute` de Stripe, como fila. `charge` puede llegar expandido (el
 * sondeo lo pide asi, para tener el cliente y la marca) o como id (el webhook).
 */
export function disputaDeStripe(obj, projectId, { origen = 'sondeo', cargoCrm = null } = {}) {
  const cargo = obj.charge && typeof obj.charge === 'object' ? obj.charge : null;
  const pi = obj.payment_intent;
  return {
    project_id: projectId,
    dispute_id: obj.id,
    charge_id: cargo ? cargo.id : (obj.charge || null),
    payment_intent_id: pi && typeof pi === 'object' ? pi.id : (pi || null),
    amount: importeDeStripe(obj.amount, obj.currency),
    currency: String(obj.currency || 'eur').toUpperCase(),
    reason: obj.reason || null,
    status: obj.status,
    evidence_due_by: obj.evidence_details?.due_by || null,
    has_evidence: obj.evidence_details?.has_evidence ?? null,
    customer_email: cargo?.billing_details?.email || cargo?.receipt_email || cargoCrm?.customer_email || null,
    customer_name: cargo?.billing_details?.name || cargoCrm?.customer_name || null,
    livemode: obj.livemode !== false,
    stripe_created_at: obj.created,
    origen,
  };
}

/* ─── Avisos ──────────────────────────────────────────────────────────────── */

/**
 * Correo de los avisos: apagado por defecto. Apagado, el CRM arma el correo y lo
 * anota en el log, pero no llama a Brevo. La campana sale siempre.
 */
export const correoActivo = () => {
  const v = String(process.env.DISPUTAS_CORREO_ACTIVO || '').toLowerCase();
  return v === 'true' || v === '1';
};

/** Cuantos dias antes de la fecha limite sale el segundo aviso. */
export const diasDelSegundoAviso = () => {
  const n = Number(process.env.DISPUTAS_AVISO_DIAS);
  return Number.isFinite(n) && n > 0 ? n : 3;
};

const conMoneda = (importe, moneda) => {
  try {
    return Number(importe).toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR' });
  } catch {
    return `${Number(importe).toFixed(2)} ${moneda || ''}`.trim();
  }
};
const fechaCorta = (f) => (f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }) : 'sin fecha');

/** Los textos del aviso (campana y correo). Aparte para probarlos sin base. */
export function textosDelAviso(d, campus, tipo) {
  const cliente = d.customer_name || d.customer_email || 'cliente sin nombre';
  const importe = conMoneda(d.amount, d.currency);
  const proyecto = campus?.nombre || `campus ${d.project_id}`;
  const limite = fechaCorta(d.evidence_due_by);
  const titulo = tipo === 'vence'
    ? `Disputa sin responder: vence el ${limite}`
    : `Disputa nueva en Stripe: ${importe}`;
  const mensaje = `${cliente} · ${importe} · ${proyecto}${campus?.empresa ? ` (${campus.empresa})` : ''} · responder antes del ${limite}`;
  return { titulo, mensaje, cliente, importe, proyecto, limite };
}

export function armarCorreo(d, campus, tipo) {
  const t = textosDelAviso(d, campus, tipo);
  const { htmlContent, textContent } = correo({
    proyecto: campus || {},
    titulo: t.titulo,
    resumen: t.mensaje,
    bloques: [
      parrafo(tipo === 'vence'
        ? `Una disputa de <strong>${esc(t.proyecto)}</strong> sigue <strong>sin respuesta en Stripe</strong> y vence pronto.`
        : `Ha entrado una <strong>disputa</strong> en la cuenta de Stripe de <strong>${esc(t.proyecto)}</strong>.`),
      nota(`Cliente: <strong>${esc(t.cliente)}</strong><br>Importe: <strong>${esc(t.importe)}</strong><br>`
        + `Campus: <strong>${esc(t.proyecto)}</strong>${campus?.empresa ? ` · ${esc(campus.empresa)}` : ''}<br>`
        + `Fecha límite para responder: <strong>${esc(t.limite)}</strong>`),
      parrafo('La respuesta se da en Stripe. El CRM solo la enseña.'),
      boton({ texto: 'Abrir en Stripe', url: enlaceEnStripe(d.dispute_id, d.livemode) }),
      boton({ texto: 'Ver las disputas en el CRM', url: enlace('accounting/disputas'), tono: 'neutro' }),
    ],
  });
  return { asunto: t.titulo, htmlContent, textContent };
}

/**
 * Avisa a los admins del campus (y a los super admin). Primero reserva el aviso
 * en la fila: si otro proceso ya lo dio, no hace nada. Si no hay a quien avisar
 * o la campana falla, lo suelta para la siguiente vuelta. Nunca lanza.
 */
export async function avisar(d, tipo = 'nueva') {
  const columna = tipo === 'vence' ? 'recordada_at' : 'avisada_at';
  try {
    if (!(await model.reservarAviso(d.id, columna))) return { avisado: false, motivo: 'YA_AVISADA' };
    const para = await model.destinatarios(d.project_id);
    if (!para.length) {
      await model.soltarAviso(d.id, columna);
      return { avisado: false, motivo: 'SIN_DESTINATARIOS' };
    }
    const campus = await model.campus(d.project_id);
    const t = textosDelAviso(d, campus, tipo);
    const n = await notifyUsers({
      targetUserIds: para.map((u) => u.id),
      type: tipo === 'vence' ? 'stripe_disputa_vence' : 'stripe_disputa',
      title: t.titulo,
      message: t.mensaje,
      link_path: '/accounting/disputas',
      metadata: { dispute_id: d.dispute_id, project_id: d.project_id, stripe_url: enlaceEnStripe(d.dispute_id, d.livemode) },
    });
    if (!n) {
      // notifyUsers no lanza: devuelve null si no pudo. Se reintenta en la siguiente vuelta.
      await model.soltarAviso(d.id, columna);
      return { avisado: false, motivo: 'CAMPANA_FALLO' };
    }
    const c = armarCorreo(d, campus, tipo);
    const emails = para.map((u) => u.email).filter(Boolean);
    if (!correoActivo()) {
      logger.info({ disputeId: d.dispute_id, projectId: d.project_id, tipo, para: emails.length },
        'Disputa de Stripe: correo armado sin enviar (DISPUTAS_CORREO_ACTIVO apagado)');
      return { avisado: true, correo: 'APAGADO', destinatarios: para.length };
    }
    if (emails.length) {
      const r = await sendEmail({
        to: emails.map((email) => ({ email })),
        subject: c.asunto,
        htmlContent: c.htmlContent,
        textContent: c.textContent,
        tags: ['stripe', 'disputa'],
        clave: `stripe-disputa-${tipo}-${d.project_id}-${d.dispute_id}`,
        projectId: d.project_id,
        cuenta: 'crm',
      }).catch((err) => ({ sent: false, reason: err.message }));
      return { avisado: true, correo: r?.sent ? 'ENVIADO' : (r?.reason || 'NO_ENVIADO'), destinatarios: para.length };
    }
    return { avisado: true, correo: 'SIN_CORREOS', destinatarios: para.length };
  } catch (err) {
    logger.warn({ err: err.message, disputeId: d?.dispute_id }, 'Disputa de Stripe: el aviso falló');
    return { avisado: false, motivo: 'ERROR' };
  }
}

/* ─── Guardar (webhook y sondeo) ──────────────────────────────────────────── */

/**
 * Guarda una disputa y, si es nueva y esta abierta, avisa. Tambien deja al dia
 * las columnas dispute_* de su cargo, que lee la pantalla de Pagos Stripe.
 */
export async function guardar(projectId, obj, { origen = 'sondeo', cargoCrm = undefined } = {}) {
  const chargeId = obj.charge && typeof obj.charge === 'object' ? obj.charge.id : obj.charge;
  const delCrm = cargoCrm === undefined ? await model.cargoDelCrm(projectId, chargeId) : cargoCrm;
  const fila = await model.upsertDisputa(disputaDeStripe(obj, projectId, { origen, cargoCrm: delCrm }));
  if (delCrm) await pagosModel.marcarDisputaEnElCargo(projectId, chargeId, fila);
  let aviso = null;
  if (!fila.avisada_at && estaAbierta(fila.status)) aviso = await avisar(fila, 'nueva');
  return { fila, nueva: !!fila.nueva, aviso };
}

/**
 * Desde el webhook: el objeto trae el cargo solo como id. Se guarda siempre,
 * tenga o no el CRM ese cargo (en ISEIE no hay cuentas compartidas que filtrar).
 */
export async function desdeElWebhook(projectId, obj) {
  const chargeId = typeof obj.charge === 'object' ? obj.charge?.id : obj.charge;
  const cargoCrm = await model.cargoDelCrm(projectId, chargeId);
  return guardar(projectId, obj, { origen: 'webhook', cargoCrm });
}

/* ─── Sondeo ──────────────────────────────────────────────────────────────── */

const ventanaDias = () => {
  const n = Number(process.env.DISPUTAS_VENTANA_DIAS);
  return Number.isFinite(n) && n > 0 ? n : 120;
};
const MAX_PAGINAS = 20;

/**
 * Trae las disputas de un campus. Devuelve lo que hizo. Si falla, lo apunta en
 * `stripe_sync_state.disputes_last_error` (la hora del ultimo bueno no se toca).
 */
export async function sincronizar(projectId, { ahora = Date.now() } = {}) {
  try {
    const r = await sincroniza(projectId, ahora);
    await pagosModel.upsertSyncState(projectId, { disputes_synced_at: new Date(ahora).toISOString(), disputes_last_error: null });
    return r;
  } catch (err) {
    try {
      await pagosModel.upsertSyncState(projectId, { disputes_last_error: String(err?.message || err).slice(0, 500) });
    } catch (e) {
      logger.error({ projectId, err: e.message }, 'Disputas: no se pudo apuntar el fallo');
    }
    throw err;
  }
}

async function sincroniza(projectId, ahora) {
  const apiKey = await getStripeKey(projectId);
  // Sin clave no es un fallo del servidor: es un campus sin Stripe configurado (409, no 500).
  if (!apiKey) throw new AppError('Stripe API key no configurada para este proyecto', 409, 'STRIPE_SIN_CLAVE');
  const desde = Math.floor(ahora / 1000) - ventanaDias() * 86400;

  const res = { vistas: 0, nuevas: 0, avisadas: 0, revisadas: 0 };
  const vistas = new Set();
  let startingAfter = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const params = { limit: 100, 'created[gte]': desde, 'expand[]': 'data.charge' };
    if (startingAfter) params.starting_after = startingAfter;
    const data = await stripeGet(apiKey, '/v1/disputes', params);
    const lista = data?.data || [];
    for (const obj of lista) {
      try {
        const g = await guardar(projectId, obj, { origen: 'sondeo' });
        vistas.add(obj.id);
        res.vistas++;
        if (g.nueva) res.nuevas++;
        if (g.aviso?.avisado) res.avisadas++;
      } catch (e) {
        logger.warn({ projectId, disputeId: obj?.id, err: e.message }, 'Disputa de Stripe: no se pudo guardar - continua');
      }
    }
    if (!data?.has_more || !lista.length) break;
    startingAfter = lista[lista.length - 1].id;
  }

  // Las que siguen abiertas y son anteriores a la ventana: una a una, para que
  // su estado no se quede congelado.
  for (const id of await model.abiertasAnterioresA(projectId, new Date(desde * 1000).toISOString())) {
    if (vistas.has(id)) continue;
    try {
      const obj = await stripeGet(apiKey, `/v1/disputes/${encodeURIComponent(id)}`, { 'expand[]': 'charge' });
      await guardar(projectId, obj, { origen: 'sondeo' });
      res.revisadas++;
    } catch (e) {
      logger.warn({ projectId, disputeId: id, err: e.message }, 'Disputa de Stripe: no se pudo revisar');
    }
  }
  return res;
}

/** El segundo aviso: las que vencen pronto y siguen sin respuesta en Stripe. */
export async function recordar() {
  const dias = diasDelSegundoAviso();
  let recordadas = 0;
  for (const d of await model.porRecordar(dias)) {
    const r = await avisar(d, 'vence');
    if (r.avisado) recordadas++;
  }
  return { recordadas };
}

/** Una vuelta del sondeo: todas las cuentas y despues los recordatorios. */
export async function vuelta() {
  const res = { campus: 0, fallos: 0, nuevas: 0, recordadas: 0 };
  for (const pid of await pagosModel.listProjectsWithStripe()) {
    try {
      const r = await sincronizar(pid);
      res.campus++;
      res.nuevas += r.nuevas;
    } catch (err) {
      res.fallos++;
      logger.warn({ projectId: pid, err: err.message }, 'Disputas de Stripe: el campus falló');
    }
  }
  res.recordadas = (await recordar()).recordadas;
  return res;
}

/* ─── Resumen de la pantalla ──────────────────────────────────────────────── */

/**
 * Las cuentas por empresa y por campus, y las que vencen pronto. Sin base: se
 * calcula sobre las filas ya leidas (y ya recortadas al ambito de quien mira).
 *
 * Las monedas NO se suman entre si: cada grupo lleva un total por moneda.
 * Si dos campus comparten cuenta sin filtro, la misma disputa sale en los dos;
 * en el total de la empresa y en el general se cuenta una vez (por dispute_id).
 */
export function resumir(filas, { dias = 7, ahora = Date.now() } = {}) {
  const limite = ahora + dias * 86400000;
  const grupo = () => ({ abiertas: 0, vencenPronto: 0, importes: {} });
  const sumar = (g, f) => {
    g.abiertas++;
    g.importes[f.currency] = Math.round(((g.importes[f.currency] || 0) + Number(f.amount || 0)) * 100) / 100;
    const vence = f.evidence_due_by ? new Date(f.evidence_due_by).getTime() : null;
    if (vence != null && vence >= ahora && vence <= limite) g.vencenPronto++;
  };
  const total = grupo();
  const porEmpresa = new Map();
  const porProyecto = new Map();
  const vistasTotal = new Set();
  const vistasEmpresa = new Map();
  const vencen = [];
  for (const f of filas) {
    if (!estaAbierta(f.status)) continue;
    const ek = f.empresa_id ?? 'sin';
    if (!porEmpresa.has(ek)) {
      porEmpresa.set(ek, { empresa_id: f.empresa_id ?? null, empresa: f.empresa || 'Sin empresa', ...grupo() });
      vistasEmpresa.set(ek, new Set());
    }
    if (!porProyecto.has(f.project_id)) {
      porProyecto.set(f.project_id, { project_id: f.project_id, proyecto: f.proyecto, empresa_id: f.empresa_id ?? null, empresa: f.empresa || 'Sin empresa', ...grupo() });
    }
    sumar(porProyecto.get(f.project_id), f);
    if (!vistasEmpresa.get(ek).has(f.dispute_id)) { vistasEmpresa.get(ek).add(f.dispute_id); sumar(porEmpresa.get(ek), f); }
    if (!vistasTotal.has(f.dispute_id)) {
      vistasTotal.add(f.dispute_id);
      sumar(total, f);
      const vence = f.evidence_due_by ? new Date(f.evidence_due_by).getTime() : null;
      if (vence != null && vence >= ahora && vence <= limite) vencen.push(f);
    }
  }
  const porNombre = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]), 'es');
  return {
    dias,
    total,
    porEmpresa: [...porEmpresa.values()].sort(porNombre('empresa')),
    porProyecto: [...porProyecto.values()].sort(porNombre('proyecto')),
    vencenPronto: vencen.sort((a, b) => new Date(a.evidence_due_by) - new Date(b.evidence_due_by))
      .map((f) => ({ id: f.id, dispute_id: f.dispute_id, project_id: f.project_id, proyecto: f.proyecto, empresa: f.empresa,
        customer_name: f.customer_name, customer_email: f.customer_email, amount: f.amount, currency: f.currency,
        evidence_due_by: f.evidence_due_by, status: f.status })),
  };
}
