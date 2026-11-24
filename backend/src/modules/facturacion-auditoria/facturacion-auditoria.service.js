import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { CRM_CORREOS } from '../../shared/config/crm.js';
import { notifyAdmins } from '../notifications/notifications.service.js';
import * as invoicesModel from '../invoices/invoices.model.js';
import * as invoicesService from '../invoices/invoices.service.js';
import * as model from './facturacion-auditoria.model.js';
import { leerConfig } from './facturacion-auditoria.config.js';
import { pausaAbierta, emitiendoLaColaDeLaPausa } from './facturacion-auditoria.pausa.js';
import { avisarDeLaPausa } from './facturacion-auditoria.correo.js';

/*
  LA AUDITORÍA DE FACTURACIÓN (#765, Automatizaciones 2/9).

  Cada 2 horas, tres comprobaciones, por SERIE y no por campus:

    1 · Números repetidos en una serie.
    2 · Facturas emitidas hace más de X días sin los datos fiscales obligatorios.
    3 · Cobros con más de X días sin factura.

  Si alguna falla: se pausa la emisión de facturas nuevas, se avisa por correo
  a los administradores (y a FACTURACION_AUDITORIA_CORREOS) y queda un aviso
  fijo en el CRM hasta que se resuelve.

  LA AUDITORÍA NO CORRIGE NADA. Ni renumera, ni rellena datos, ni emite. Lo
  arregla una persona, y «Marcar como solucionado» vuelve a pasar la auditoría:
  solo si sale limpia se reanuda, y entonces se emite la cola de la pausa en
  orden de cobro.
*/

export const TIPOS = {
  numero_repetido: 'Números repetidos en una serie',
  datos_fiscales: 'Facturas sin datos fiscales obligatorios',
  cobro_sin_factura: 'Cobros sin factura',
};

const euros = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fechaCorta = (t) => String(t || '').slice(0, 10).split('-').reverse().join('/');
const numeroDeSerie = (ano, numero) => `${ano}/${String(numero).padStart(4, '0')}`;

/** «AAAA-MM-DD» de `fecha` menos `dias` (en UTC, para que no baile con la hora). */
export function restarDias(fecha, dias) {
  const d = new Date(`${String(fecha).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/** Hoy en Madrid, «AAAA-MM-DD». */
export function hoyEnMadrid(ahora = new Date()) {
  return ahora.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
}

// El NIF del emisor vacío o con el marcador que sembró la migración 102.
const nifDeEmisorVacio = (nif) => !String(nif || '').trim() || /^PENDIENTE/i.test(String(nif).trim());

// ── Las tres comprobaciones ─────────────────────────────────────────────────

export async function comprobarNumerosRepetidos({ desde }) {
  const grupos = await model.numerosRepetidos({ desde });
  return grupos.map((g) => ({
    tipo: 'numero_repetido',
    serie: g.serie,
    ano: g.ano,
    numero: g.numero,
    project_ids: g.project_ids,
    invoice_ids: g.ids,
    texto: `Serie ${g.serie}: el ${numeroDeSerie(g.ano, g.numero)} lo llevan ${g.veces} facturas — `
      + (g.facturas || []).map((f) => `${f.cliente || 'sin nombre'} (${euros(f.total)}, ${fechaCorta(f.fecha)}`
        + `${f.estado === 'cancelada' ? ', anulada' : ''}${f.tipo === 'proforma' ? ', proforma' : ''})`).join(' · '),
  }));
}

export async function comprobarDatosFiscales({ desde, hasta }) {
  const facturas = await model.facturasEmitidas({ desde, hasta });
  const out = [];
  for (const f of facturas) {
    // Lo mismo que se pide para emitir un borrador: la regla ya existe y es esa.
    const faltan = invoicesModel.invoiceFaltantes(f);
    if (nifDeEmisorVacio(f.issuer_nif)) faltan.push('NIF de la empresa emisora');
    if (!faltan.length) continue;
    out.push({
      tipo: 'datos_fiscales',
      serie: f.serie,
      ano: f.ano,
      numero: f.numero,
      project_ids: [f.project_id],
      invoice_ids: [f.id],
      texto: `Serie ${f.serie}: la ${f.codigo || numeroDeSerie(f.ano, f.numero)} de ${f.cliente_nombre || 'sin nombre'} `
        + `(${f.campus}, ${fechaCorta(f.fecha)}) no tiene ${faltan.join(', ')}`,
    });
  }
  return out;
}

export async function comprobarCobrosSinFactura({ desde, hasta }) {
  const campus = await model.campusQueFacturan();
  const enLaColaDeLaPausa = await model.cobrosEnLaColaDeLaPausa();
  const out = [];
  for (const c of campus) {
    // Una sociedad que aún no ha emitido ninguna factura no factura en el CRM.
    if (!c.arranque) continue;
    // La cola de siempre: ya sabe qué cobros están cubiertos (huérfanas, venta
    // ya facturada, «al día», ejercicio anterior). No se repite aquí.
    const cola = await invoicesModel.listPagosSinFactura(c.id);
    for (const p of cola) {
      const fecha = String(p.fecha instanceof Date ? p.fecha.toISOString() : p.fecha).slice(0, 10);
      if (fecha < desde || fecha > hasta) continue;
      // Los cobros anteriores a la primera factura de la sociedad no llevan factura.
      if (fecha < c.arranque) continue;
      // Los que esperan en la cola de la pausa salen al reanudar.
      if (enLaColaDeLaPausa.has(Number(p.payment_id))) continue;
      out.push({
        tipo: 'cobro_sin_factura',
        serie: c.serie || null,
        project_ids: [c.id],
        payment_ids: [Number(p.payment_id)],
        texto: `${c.serie ? `Serie ${c.serie}: ` : ''}cobro de ${euros(p.importe)} del ${fechaCorta(fecha)} `
          + `de ${p.cliente || 'sin nombre'} (${c.nombre}) sin factura`,
      });
    }
  }
  return out;
}

// ── Una vuelta ──────────────────────────────────────────────────────────────

async function auditarDesde(cfg) {
  return cfg.desde || await model.auditarDesdeGuardado();
}

/**
 * Pasa la auditoría y la apunta. Si sale con errores y no hay pausa abierta, la
 * abre y avisa (salvo `pausarSiFalla: false`, la de «Marcar como solucionado»).
 */
export async function auditar({ origen = 'programada', userId = null, pausarSiFalla = true, cfg = leerConfig(), ahora = new Date() } = {}) {
  if (!cfg.activa) return { omitido: 'apagada' };
  const empezo = ahora;
  const hoy = hoyEnMadrid(ahora);
  const desde = await auditarDesde(cfg);
  const pausa = await pausaAbierta({ cfg });

  // Con la facturación pausada nadie puede emitir: el reloj de los cobros se
  // para el día de la pausa. Si no, cada día de pausa añadiría cobros
  // «atrasados» y la auditoría nunca saldría limpia.
  const hastaCobros = restarDias(pausa ? hoyEnMadrid(new Date(pausa.pausada_at)) : hoy, cfg.dias);
  const hastaFacturas = restarDias(hoy, cfg.dias);

  const incidencias = [
    ...await comprobarNumerosRepetidos({ desde }),
    ...await comprobarDatosFiscales({ desde, hasta: hastaFacturas }),
    ...await comprobarCobrosSinFactura({ desde, hasta: hastaCobros }),
  ];
  const resumen = {
    desde, dias: cfg.dias,
    ...Object.fromEntries(Object.keys(TIPOS).map((t) => [t, incidencias.filter((i) => i.tipo === t).length])),
  };
  const limpia = incidencias.length === 0;
  const auditoria = await model.guardarAuditoria({ origen, empezo, limpia, incidencias, resumen, userId });

  let pausaNueva = null;
  if (!limpia && !pausa && pausarSiFalla && cfg.pausar !== false) {
    pausaNueva = await pausar({ auditoria, incidencias, resumen });
  } else if (!limpia && cfg.pausar === false && origen === 'programada') {
    await avisarSinPausar({ auditoria, resumen });
  }
  logger[limpia ? 'info' : 'warn']({ origen, auditoriaId: auditoria.id, ...resumen, pausada: !!(pausa || pausaNueva) },
    limpia ? 'auditoría de facturación: limpia' : 'auditoría de facturación: con errores');
  return { auditoria, limpia, incidencias, resumen, pausa: pausaNueva || pausa };
}

/*
  MODO AVISO (FACTURACION_AUDITORIA_PAUSAR=0, 24/11). Audita y lo apunta, pero
  no pausa. Para que alguien se entere sin avisar cada 2 horas, un aviso en la
  campana solo cuando la vuelta anterior salió limpia (o no había ninguna).
*/
async function avisarSinPausar({ auditoria, resumen }) {
  try {
    const anterior = await model.vueltaAnterior(auditoria.id);
    if (anterior && !anterior.limpia) return;
    await notifyAdmins({
      type: 'facturacion_pausada',
      title: 'La auditoría de facturación ha encontrado errores',
      message: `${motivoDe(resumen)}. Modo aviso: la facturación NO se pausa. Míralo en Facturas › Facturación automática.`,
      link_path: `${CRM_CORREOS.rutas.facturas}/automatica`,
      metadata: { auditoria_id: auditoria.id, modo: 'aviso', ...resumen },
    });
  } catch (err) {
    logger.warn({ err: err.message, auditoriaId: auditoria.id }, 'auditoría de facturación: no se pudo avisar (modo aviso)');
  }
}

// ── La pasada en seco ───────────────────────────────────────────────────────

/**
 * Las mismas tres comprobaciones, sin guardar nada: ni la vuelta, ni la pausa,
 * ni el «desde», ni avisos. Funciona también con la auditoría apagada, para
 * ver qué saldría ANTES de encenderla (24/11). `desde`: la fecha de corte que
 * se quiere probar; sin ella, la que usaría la auditoría (la del .env, la
 * guardada o, si nunca ha dado una vuelta, hoy).
 */
export async function simular({ desde = null, cfg = leerConfig(), ahora = new Date() } = {}) {
  const hoy = hoyEnMadrid(ahora);
  const corte = desde || cfg.desde || await model.auditarDesdeLeido() || hoy;
  const hasta = restarDias(hoy, cfg.dias);
  const incidencias = [
    ...await comprobarNumerosRepetidos({ desde: corte }),
    ...await comprobarDatosFiscales({ desde: corte, hasta }),
    ...await comprobarCobrosSinFactura({ desde: corte, hasta }),
  ];
  const resumen = {
    desde: corte, dias: cfg.dias,
    ...Object.fromEntries(Object.keys(TIPOS).map((t) => [t, incidencias.filter((i) => i.tipo === t).length])),
  };
  return { desde: corte, hasta, limpia: incidencias.length === 0, pausaria: incidencias.length > 0 && cfg.pausar !== false, resumen, incidencias };
}

export function motivoDe(resumen) {
  return Object.entries(TIPOS)
    .filter(([t]) => resumen[t] > 0)
    .map(([t, nombre]) => `${nombre}: ${resumen[t]}`)
    .join(' · ');
}

async function pausar({ auditoria, incidencias, resumen }) {
  const motivo = motivoDe(resumen);
  const pausa = await model.abrirPausa({ auditoriaId: auditoria.id, motivo, incidencias });
  // Otra vuelta la abrió a la vez: ya avisó ella.
  if (!pausa) return pausaAbierta();
  logger.warn({ pausaId: pausa.id, auditoriaId: auditoria.id, motivo }, 'facturación PAUSADA por la auditoría');

  // Los avisos no pueden deshacer la pausa: si fallan, se apunta y se sigue.
  await notifyAdmins({
    type: 'facturacion_pausada',
    title: 'Facturación pausada por la auditoría',
    message: `${motivo}. No se emiten facturas nuevas hasta que se resuelva y se marque como solucionado.`,
    link_path: CRM_CORREOS.rutas.facturas,
    metadata: { pausa_id: pausa.id, auditoria_id: auditoria.id, ...resumen },
  });
  try {
    await avisarDeLaPausa({ pausa, incidencias, resumen });
  } catch (err) {
    logger.error({ err: err.message, pausaId: pausa.id }, 'auditoría de facturación: no se pudo mandar el correo de la pausa');
  }
  return pausa;
}

// ── El estado, para el aviso del CRM ────────────────────────────────────────

export async function estado({ cfg = leerConfig() } = {}) {
  // Apagada no consulta nada (lo que saldría al encenderla, en `simular`).
  if (!cfg.activa) return { activa: false };
  const [pausa, ultima, cola, desde] = await Promise.all([
    pausaAbierta({ cfg }), model.ultimaAuditoria(), model.colaPendiente(), model.auditarDesdeLeido(),
  ]);
  return {
    activa: true,
    dias: cfg.dias,
    pausar: cfg.pausar !== false,
    desde: cfg.desde || desde,
    pausada: !!pausa,
    pausa,
    ultima,
    cola: { cobros: cola.length, importe: cola.reduce((s, c) => s + Number(c.importe || 0), 0) },
  };
}

// ── Encolar un cobro con la facturación pausada ─────────────────────────────

/**
 * Lo llama la emisión automática al entrar un cobro. Si la facturación está
 * pausada, el cobro se apunta en la cola de la pausa y devuelve true: quien
 * llama NO emite. Sin pausa (o con el interruptor apagado), false.
 */
export async function encolarSiPausada({ paymentId, conversionId, userId = null, cfg = leerConfig() }) {
  if (!cfg.activa || !paymentId) return false;
  const pausa = await pausaAbierta({ cfg });
  if (!pausa) return false;
  await model.encolar({ paymentId, conversionId, pausaId: pausa.id, userId });
  logger.info({ paymentId, conversionId, pausaId: pausa.id }, 'facturación pausada: el cobro espera en la cola de la pausa');
  return true;
}

// ── Reanudar ────────────────────────────────────────────────────────────────

let reanudando = false;

/** Emite la cola de la pausa en orden de cobro. Devuelve lo que pasó con cada uno. */
export async function emitirColaDeLaPausa({ userId = null } = {}) {
  const cola = await model.colaPendiente();
  const resultado = [];
  await emitiendoLaColaDeLaPausa(async () => {
    for (const c of cola) {
      const fila = { payment_id: Number(c.payment_id), fecha: c.fecha, cliente: c.cliente, importe: Number(c.importe) };
      try {
        // La misma espera que sin pausa: si hay cobros anteriores sin facturar
        // en la cola de siempre, este espera detrás de ellos.
        const puede = await invoicesService.puedeFacturarAhora(c.project_id, c.fecha, c.payment_id);
        if (!puede) {
          await model.marcarProcesado({ paymentId: c.payment_id, resultado: 'a_la_cola' });
          resultado.push({ ...fila, resultado: 'a_la_cola' });
          continue;
        }
        const inv = await invoicesModel.emitirFacturaDePago(
          c.conversion_id, { paymentId: c.payment_id, importe: Number(c.importe) }, c.user_id || userId);
        const r = inv?.id ? 'emitida' : 'sin_factura';
        await model.marcarProcesado({ paymentId: c.payment_id, resultado: r, invoiceId: inv?.id || null });
        resultado.push({ ...fila, resultado: r, codigo: inv?.codigo || null });
      } catch (err) {
        // Un cobro que falla se queda en la cola de siempre, como cualquier otro.
        logger.warn({ paymentId: c.payment_id, err: err.message }, 'cola de la pausa: no se pudo emitir');
        await model.marcarProcesado({ paymentId: c.payment_id, resultado: 'error', error: String(err.message).slice(0, 500) });
        resultado.push({ ...fila, resultado: 'error', error: err.message });
      }
    }
  });
  return resultado;
}

/**
 * «Marcar como solucionado»: vuelve a auditar y SOLO reanuda si sale limpia.
 * Al reanudar, emite la cola de la pausa en orden de cobro y cierra la pausa.
 */
export async function reanudar({ userId, cfg = leerConfig() } = {}) {
  if (!cfg.activa) throw new AppError('La auditoría de facturación está apagada.', 409, 'AUDITORIA_APAGADA');
  if (reanudando) throw new AppError('Ya se está reanudando la facturación. Espera unos segundos.', 409, 'REANUDANDO');
  reanudando = true;
  try {
    const pausa = await pausaAbierta({ cfg });
    if (!pausa) throw new AppError('La facturación no está pausada.', 409, 'NO_PAUSADA');

    const vuelta = await auditar({ origen: 'reanudar', userId, pausarSiFalla: false, cfg });
    if (!vuelta.limpia) {
      return { reanudada: false, auditoria: vuelta.auditoria, incidencias: vuelta.incidencias, resumen: vuelta.resumen };
    }
    // La pausa sigue abierta mientras se emite la cola: así ningún cobro nuevo
    // se factura por delante de los que esperaban.
    const emitidas = await emitirColaDeLaPausa({ userId });
    const cerrada = await model.cerrarPausa({ pausaId: pausa.id, userId, auditoriaId: vuelta.auditoria.id, emitidas });
    logger.info({ pausaId: pausa.id, userId, emitidas: emitidas.length }, 'facturación REANUDADA');
    await notifyAdmins({
      type: 'facturacion_reanudada',
      title: 'Facturación reanudada',
      message: `La auditoría ha salido limpia. ${emitidas.filter((e) => e.resultado === 'emitida').length} factura(s) emitida(s) de la cola de la pausa.`,
      link_path: CRM_CORREOS.rutas.facturas,
      metadata: { pausa_id: pausa.id, auditoria_id: vuelta.auditoria.id },
      triggered_by_user_id: userId,
    });
    return { reanudada: !!cerrada, auditoria: vuelta.auditoria, emitidas };
  } finally {
    reanudando = false;
  }
}

export const _internos = { reiniciar: () => { reanudando = false; } };
