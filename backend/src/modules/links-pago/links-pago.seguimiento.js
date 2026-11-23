import * as model from './links-pago.model.js';
import * as seg from './links-pago.seguimiento.model.js';
import * as service from './links-pago.service.js';
import * as stripe from './links-pago.stripe.js';
import { armarRecordatorio, textoRecordatorioWhatsapp, avisoGestora } from './links-pago.seguimiento.emails.js';
import { recordatorioWhatsappActivo } from '../../shared/config/soloEnPruebas.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  SEGUIMIENTO DE LOS LINKS QUE NO SE PAGAN (CRM#984; Diego, 21/11/2026).

  Cada 15 minutos (jobs/linksPagoSeguimientoScheduler.js), con el seguimiento
  encendido (LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION):

    1. ¿Lo ha abierto? Un Payment Link de Stripe no avisa al abrirse, pero cada
       visita crea una sesión de Checkout. Se miran las de los links «creado»
       (como mucho 40 por vuelta, los que hace más que no se miran) y, si hay
       alguna, el link pasa a «abierto» con la hora de la primera.
    2. Abierto y sin pagar desde hace las horas del campus (2 de serie): aviso a
       quien lo creó, en la campana: «Laura abrió el link de Psicopedagogía y no
       pagó». Uno por link.
    3. Recordatorio al alumno a las 24 h y a las 72 h de crearlo, si sigue sin
       pagar: por correo (plantilla y marca del campus) si hay correo y, con
       LINKS_PAGO_RECORDATORIO_WHATSAPP=1, también por WhatsApp en la
       conversación que la gestora ya tenga con él.

  La caducidad sigue en su trabajo (linksPagoCaducidadScheduler); «Renovar» un
  caducado está al final de este fichero y no depende del interruptor.
*/

/** 1. Las aperturas: de «creado» a «abierto» si el alumno llegó a la página de pago. */
export async function revisarAperturas({ lote = 40 } = {}) {
  const links = await seg.paraRevisarAperturas(lote);
  const res = { revisados: 0, abiertos: 0, sinClave: 0, fallos: 0 };
  const claves = new Map();
  for (const l of links) {
    try {
      if (!claves.has(l.project_id)) claves.set(l.project_id, await service.claveDeEscritura(l.project_id));
      const clave = claves.get(l.project_id);
      if (!clave) { res.sinClave += 1; await seg.apuntarRevision(l.id); continue; }
      const r = await stripe.sesionesDelLink(clave, l.stripe_payment_link_id);
      await seg.apuntarRevision(l.id);
      res.revisados += 1;
      const sesiones = Array.isArray(r?.data) ? r.data : [];
      if (!sesiones.length) continue;
      const primera = Math.min(...sesiones.map((s) => Number(s.created) || Infinity));
      const cuando = Number.isFinite(primera) ? new Date(primera * 1000).toISOString() : new Date().toISOString();
      if (await seg.marcarAbiertoEl(l.id, cuando)) {
        await model.anotarEvento(l.id, 'abierto', { por: 'seguimiento', abierto_el: cuando, sesiones: sesiones.length });
        res.abiertos += 1;
      }
    } catch (err) {
      res.fallos += 1;
      logger.warn({ err: err.message, linkId: l.id }, 'Links de pago: no se pudo mirar si el link se abrió; se reintenta en la siguiente vuelta');
    }
  }
  return res;
}

/** 2. El aviso a la gestora: lo abrió y no pagó. */
export async function avisarGestoras({ lote = 50 } = {}) {
  const links = await seg.paraAvisarGestora(lote);
  const res = { avisos: 0 };
  if (!links.length) return res;
  const { notifyUsers } = await import('../notifications/notifications.service.js');
  for (const l of links) {
    const a = l.created_by || l.responsable_id;
    if (!(await seg.reservar(l.id, 'gestora'))) continue;
    if (!a) { await model.anotarEvento(l.id, 'aviso_gestora', { sin_destinatario: true }); continue; }
    const { title, message } = avisoGestora(l);
    await notifyUsers({
      targetUserIds: [a],
      type: 'link_pago_abierto',
      title, message,
      link_path: l.lead_id ? `/leads/${l.lead_id}` : '/links-pago',
      metadata: { payment_link_id: l.id, lead_id: l.lead_id, conversion_id: l.conversion_id },
    });
    await model.anotarEvento(l.id, 'aviso_gestora', { a, horas: Number(l.horas) });
    res.avisos += 1;
  }
  return res;
}

/** El correo al que va el recordatorio: el del prospecto o, sin prospecto, el que escribió en Checkout. */
async function correoDelAlumno(l) {
  if (l.lead_email) return String(l.lead_email).trim();
  const c = await model.clienteDelCheckout(l.id).catch(() => null);
  return c?.email ? String(c.email).trim() : null;
}

async function porWhatsapp(l, cual) {
  if (!recordatorioWhatsappActivo() || !l.lead_id || !l.created_by) return null;
  const { instanciaDe } = await import('../whatsapp/evolution.client.js');
  const conversacionId = await seg.conversacionDeWhatsapp(l.lead_id, instanciaDe(l.created_by));
  if (!conversacionId) return { whatsapp: 'sin_conversacion' };
  try {
    const { enviar } = await import('../whatsapp/chat.service.js');
    await enviar({ conversacionId, texto: textoRecordatorioWhatsapp({ l, cual }), usuarioId: Number(l.created_by) });
    return { whatsapp: 'enviado', conversacion_id: conversacionId };
  } catch (err) {
    return { whatsapp: 'fallido', error: err.code || err.message };
  }
}

/** 3. Los recordatorios al alumno, a las 24 h y a las 72 h. */
export async function recordar({ lote = 50 } = {}) {
  const res = { '24h': 0, '72h': 0, sinCorreo: 0 };
  const { sendEmail } = await import('../../shared/services/brevo.service.js');
  for (const cual of seg.CUALES) {
    const links = await seg.paraRecordar(cual, lote);
    for (const l of links) {
      if (!(await seg.reservar(l.id, cual))) continue;
      const datos = { cual };
      const email = await correoDelAlumno(l);
      if (email) {
        const c = armarRecordatorio({ l, cual });
        try {
          const r = await sendEmail({
            to: [{ email, name: l.lead_nombre || undefined }],
            subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
            tags: ['link-de-pago', `recordatorio-${cual}`], projectId: l.project_id,
            clave: `link-pago-${l.id}-recordatorio-${cual}`,
          });
          datos.correo = r?.sent ? 'enviado' : (r?.reason || 'no_enviado');
        } catch (err) {
          datos.correo = 'fallido';
          datos.error = err.message;
        }
      } else {
        datos.correo = 'sin_correo';
        res.sinCorreo += 1;
      }
      Object.assign(datos, await porWhatsapp(l, cual) || {});
      await model.anotarEvento(l.id, `recordatorio_${cual}`, datos);
      res[cual] += 1;
    }
  }
  return res;
}

/** Una vuelta entera. Cada parte por su lado: si una falla, las demás siguen. */
export async function vuelta() {
  const res = {};
  for (const [nombre, paso] of [['aperturas', revisarAperturas], ['gestoras', avisarGestoras], ['recordatorios', recordar]]) {
    try { res[nombre] = await paso(); } catch (err) {
      res[nombre] = { error: err.message };
      logger.warn({ err: err.message, paso: nombre }, 'Links de pago: falló una parte del seguimiento');
    }
  }
  const algo = (res.aperturas?.abiertos || 0) + (res.gestoras?.avisos || 0) + (res.recordatorios?.['24h'] || 0) + (res.recordatorios?.['72h'] || 0);
  if (algo) logger.info(res, 'Links de pago: vuelta de seguimiento');
  return res;
}

// ─── Renovar un caducado con un clic ────────────────────────────────────────

/*
  «Los links caducados se marcan solos y se pueden renovar con un clic.» Un link
  nuevo, igual que el caducado (mismo alumno, venta, curso, importe, moneda y
  modalidad), con la caducidad de serie del campus. El caducado queda como
  estaba, atado al nuevo (`renovado_por`), y cada uno lo dice en su historial.

  Las reglas del dinero no se vuelven a negociar (el importe ya se aprobó al
  crearlo), pero sí lo que puede haber cambiado desde entonces:
    · desde una venta, nunca más de lo que le queda por cobrar (CRM#909);
    · la cuota de un plan de pago, solo si sigue por cobrar, y con su caducidad;
    · la moneda, si el campus la sigue admitiendo;
    · en cuotas, que el campus aún pueda cobrarlas solas.
*/
const enCurso = new Set();

export async function renovar(linkId, { userId, puedeCobroAuto }) {
  if (enCurso.has(linkId)) throw new AppError('Ya se está renovando este link.', 409, 'YA_RENOVANDO');
  enCurso.add(linkId);
  try {
    const l = await seg.paraRenovar(linkId);
    if (!l) throw new AppError('Link de pago no encontrado', 404, 'NOT_FOUND');
    if (l.estado !== 'caducado') {
      throw new AppError(`Solo se renueva un link caducado; este está ${String(l.estado).replace('_', ' ')}.`, 409, 'NO_RENOVABLE');
    }
    if (l.renovado_por) {
      throw new AppError(`Este link ya se renovó: el nuevo es el n.º ${l.renovado_por}.`, 409, 'YA_RENOVADO');
    }
    const cfg = await model.config(l.project_id);
    const prod = l.product_id ? await model.producto(l.product_id) : null;
    if (!cfg || !prod) throw new AppError('El curso del link ya no existe: crea uno nuevo.', 409, 'NO_RENOVABLE');
    const moneda = String(l.moneda).toUpperCase();
    if (!cfg.monedas.includes(moneda)) {
      throw new AppError(`Este campus ya no cobra en ${moneda}: crea un link nuevo.`, 409, 'MONEDA_NO_ADMITIDA');
    }

    let reglas;
    let cuota = null;
    let guardaTarjeta = null;
    let enCuotas = null;
    let descuento = null;
    if (l.installment_id) {
      // Un link de una cuota del plan de pago de la venta.
      const c = await seg.cuotaPendiente(l.installment_id);
      if (!c) throw new AppError('Esa cuota ya está cobrada o ya no está en el plan de la venta.', 409, 'NO_RENOVABLE');
      reglas = service.reglasDeCuota({ cfg, prod, vence: c.vence });
      cuota = { id: c.id, numero: c.numero, vence: c.vence };
      if (l.guarda_tarjeta) {
        const cobroAuto = await import('./links-pago.cobro-auto.js');
        guardaTarjeta = await cobroAuto.guardaTarjetaPara(l.conversion_id);
      }
    } else {
      const pendiente = l.conversion_id ? await model.pendienteDeVenta(l.conversion_id) : undefined;
      service.noPasaDelPendiente({ importe: l.importe, moneda, pendiente });
      reglas = {
        moneda, caducidadDias: cfg.caducidad_dias,
        precioCatalogo: l.precio_catalogo != null ? Number(l.precio_catalogo) : null,
        descuentoPct: Number(l.descuento_pct || 0), referencia: 'renovado',
      };
      // El precio de antes y el descuento (CRM#982), tal cual los tenía.
      if (l.precio_original != null) {
        descuento = {
          precioOriginal: Number(l.precio_original), tipo: l.descuento_tipo ?? null,
          valor: l.descuento_tipo ? Number(l.descuento_valor) : null,
          importe: l.descuento_tipo ? Number(l.descuento_importe || 0) : 0,
        };
      }
      if (l.modalidad === 'cuotas') {
        const cobroAuto = await import('./links-pago.cobro-auto.js');
        const disp = await cobroAuto.paraUnLinkEnCuotas(l.project_id, { cfg, puedeCobroAuto });
        if (!disp.disponible) throw new AppError(disp.motivo, 409, 'CUOTAS_NO_DISPONIBLES');
        // Con inicial (CRM#982): la inicial y las cuotas de lo que queda (con las
        // fechas que eligió la gestora, si las eligió: 23/11); `num_cuotas` del link
        // cuenta todos los pagos. Sin ella, el total entre N.
        const conInicial = l.importe_inicial != null;
        const plan = conInicial && Array.isArray(l.plan_cuotas) && l.plan_cuotas.length ? l.plan_cuotas : null;
        // El link nuevo lleva el mismo plan: si sus fechas ya pasaron, no vale renovarlo.
        if (plan) {
          try { service.comprobarFechasDelPlan(plan); } catch {
            throw new AppError('Las fechas de las cuotas de este link ya pasaron: crea un link nuevo con fechas nuevas.', 409, 'NO_RENOVABLE');
          }
        }
        const importes = plan
          ? [Number(l.importe_inicial), ...plan.map((c) => Number(c.importe))]
          : conInicial
            ? [Number(l.importe_inicial), ...service.repartirEnCuotas(service.restaCentimos(l.importe, l.importe_inicial), Number(l.num_cuotas) - 1)]
            : service.repartirEnCuotas(l.importe, l.num_cuotas);
        enCuotas = {
          num: importes.length, importeCuota: importes[0],
          ...(conInicial ? { inicial: Number(l.importe_inicial) } : {}), ...(plan ? { plan } : {}),
        };
        // Sin cobro automático (23/11), las cuotas van con su propio link al pagarse.
        if (disp.automatico) {
          guardaTarjeta = {
            consentimiento: cobroAuto.textoConsentimiento({
              campus: await model.nombreDelCampus(l.project_id),
              cuotas: importes.slice(1).map((importe) => ({ importe })),
            }),
          };
        }
      }
    }

    const nuevo = await service.crear({
      projectId: Number(l.project_id), leadId: l.lead_id, conversionId: l.conversion_id,
      prod, reglas, importe: Number(l.importe), userId, cuota, guardaTarjeta, enCuotas, descuento,
    });
    if (!(await seg.atarRenovacion(l.id, nuevo.id))) {
      // Otro clic lo renovó a la vez: el nuevo sobra, se anula.
      await service.anular(nuevo, { userId, motivo: 'Renovación repetida: el link ya se había renovado.' }).catch(() => {});
      throw new AppError('Este link ya se renovó mientras tanto. Recarga.', 409, 'YA_RENOVADO');
    }
    await model.anotarEvento(l.id, 'renovado', { por: userId, nuevo_link_id: nuevo.id });
    await model.anotarEvento(nuevo.id, 'renueva', { por: userId, link_caducado_id: l.id });
    logger.info({ linkId: l.id, nuevoId: nuevo.id, userId }, 'Links de pago: link caducado renovado');
    return model.porId(nuevo.id);
  } finally {
    enCurso.delete(linkId);
  }
}
