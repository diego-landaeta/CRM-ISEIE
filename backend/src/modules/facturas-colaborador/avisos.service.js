import crypto from 'node:crypto';
import pool from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { enlace } from '../../shared/services/email-plantilla.service.js';
import * as model from './avisos.model.js';
import * as facturas from './facturas.model.js';
import { anotar } from './facturas-colaborador.model.js';
import { leer as leerArchivo } from './almacen.js';
import { enviarLlegadas, enviarPorPagar, destinatariosDe } from './avisos.emails.js';

/*
  Facturas de colaboradores (#202) · los avisos de Diego del 04/11.

    1. «Han llegado N facturas»: al correo de facturación de la empresa
       (`invoice_issuers.email`), juntando las que llegan seguidas.
    2. «Faltan N facturas por pagar»: una vez al día, a la misma dirección.
    3. «He recibido el pago y lo confirmo»: el botón del correo de «Factura
       pagada», con su opinión (1 a 5 y un comentario) si quiere dejarla.
*/

/** Minutos sin que llegue otra antes de avisar, y lo más que espera la primera. */
export const VENTANA_MIN = 5;
export const TOPE_MIN = 30;
/** Las copias van adjuntas mientras no pasen de esto entre todas (Brevo admite unos 10 MB). */
export const TOPE_ADJUNTOS = 8 * 1024 * 1024;

/** Lo que `sendEmail` devuelve sin enviar y no es un fallo (como en facturas.service.js). */
const NO_ES_FALLO = new Set(['FRENO_DE_PRUEBAS', 'YA_ENVIADO']);

/* ─────────────────────────── 1. el aviso de llegada ─────────────────────────── */

/** Las copias de las facturas, hasta el tope; la que no se pueda leer se queda fuera. */
async function copias(lista) {
  const adjuntos = [];
  let bytes = 0;
  for (const f of lista) {
    if (!f.archivo_key) continue;
    if (f.tamano && bytes + Number(f.tamano) > TOPE_ADJUNTOS) continue;
    try {
      const buffer = await leerArchivo(f.archivo_key);
      if (!buffer?.length || bytes + buffer.length > TOPE_ADJUNTOS) continue;
      bytes += buffer.length;
      adjuntos.push({ name: f.archivo_key.split('/').pop(), content: buffer.toString('base64') });
    } catch (err) {
      logger.warn({ err: err.message, facturaId: f.id }, 'Aviso a la empresa: no se pudo leer la copia, va sin ella');
    }
  }
  return adjuntos;
}

async function avisarDeEstas(issuerId, ids) {
  const empresa = await model.empresa(issuerId);
  const lista = await model.paraElAviso(ids);
  const para = destinatariosDe(empresa?.email);
  if (!para.length) {
    // Sin correo de facturación no hay a quién: queda en el registro y la factura sigue bien.
    logger.warn({ issuerId, facturas: ids.length }, 'Aviso a la empresa: no tiene correo de facturación');
    for (const f of lista) {
      await anotar(pool, { facturaId: f.id, evento: 'aviso_empresa_fallido', detalle: { motivo: 'La empresa no tiene correo de facturación' } });
    }
    return { sent: false, reason: 'SIN_CORREO' };
  }
  const marca = await facturas.marcaDeLaEmpresa(issuerId);
  const adjuntos = await copias(lista);
  const r = await enviarLlegadas({ empresa, facturas: lista, marca, para, adjuntos });
  const destino = para.map((d) => d.email).join(', ');
  const junto = lista.length > 1 ? { junto_con: lista.length } : {};
  if (r?.sent) {
    for (const f of lista) await anotar(pool, { facturaId: f.id, evento: 'aviso_empresa', detalle: { para: destino, ...junto } });
  } else if (r && !r.simulated && !NO_ES_FALLO.has(r.reason)) {
    for (const f of lista) {
      await anotar(pool, { facturaId: f.id, evento: 'aviso_empresa_fallido', detalle: { para: destino, motivo: r.reason || r.error || 'desconocido' } });
    }
  }
  return r;
}

/**
 * Una vuelta del aviso de llegada: las empresas a las que ya toca avisar, cada
 * una con sus facturas juntas en un correo. Con los correos apagados se dan por
 * avisadas igual (el correo queda en el log): al encenderlos no sale de golpe
 * todo lo de antes. Si Brevo falla no se reintenta: lo recoge el resumen diario.
 */
export async function avisarLlegadas({ ventanaMin = VENTANA_MIN, topeMin = TOPE_MIN } = {}) {
  let avisos = 0;
  let avisadas = 0;
  for (const issuerId of await model.empresasConLlegadas({ ventanaMin, topeMin })) {
    const ids = await model.reclamarLlegadas(issuerId);
    if (!ids.length) continue;
    try {
      const r = await avisarDeEstas(issuerId, ids);
      if (r?.sent) { avisos++; avisadas += ids.length; }
    } catch (err) {
      logger.error({ err: err.message, issuerId, ids }, 'Aviso a la empresa: falló');
      for (const id of ids) {
        await anotar(pool, { facturaId: id, evento: 'aviso_empresa_fallido', detalle: { motivo: err.message } }).catch(() => {});
      }
    }
  }
  return { avisos, facturas: avisadas };
}

/* ─────────────────────────── 2. el resumen diario ─────────────────────────── */

/** «2026-11-04», el día en Madrid. */
export function diaEnMadrid(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora);
}

/**
 * «Faltan N facturas por pagar», por empresa, una vez al día. Sin pendientes no
 * sale nada. La fila de `facturas_colaborador_resumenes` impide que salgan dos
 * el mismo día aunque el proceso se reinicie o haya dos vueltas a la vez.
 */
export async function resumenPorPagar({ ahora = new Date() } = {}) {
  const dia = diaEnMadrid(ahora);
  const porEmpresa = new Map();
  for (const f of await model.porPagar()) {
    if (!porEmpresa.has(f.issuer_id)) porEmpresa.set(f.issuer_id, []);
    porEmpresa.get(f.issuer_id).push(f);
  }
  let enviados = 0;
  for (const [issuerId, lista] of porEmpresa) {
    try {
      if (!(await model.reclamarResumen(issuerId, dia, lista.length))) continue;
      const empresa = await model.empresa(issuerId);
      const para = destinatariosDe(empresa?.email);
      if (!para.length) {
        await model.apuntarResumen(issuerId, dia, { enviado: false, detalle: { motivo: 'sin correo de facturación' } });
        continue;
      }
      const marca = await facturas.marcaDeLaEmpresa(issuerId);
      const r = await enviarPorPagar({ empresa, facturas: lista, marca, para, dia });
      await model.apuntarResumen(issuerId, dia, {
        enviado: !!r?.sent,
        detalle: { para: para.map((d) => d.email).join(', '), ...(r?.sent ? {} : { motivo: r?.simulated ? 'correos apagados' : (r?.reason || r?.error || 'desconocido') }) },
      });
      if (r?.sent) enviados++;
    } catch (err) {
      logger.error({ err: err.message, issuerId }, 'Resumen «Faltan facturas por pagar»: falló');
    }
  }
  return { empresas: porEmpresa.size, enviados };
}

/* ─────────────────────────── 3. «He recibido el pago y lo confirmo» ─────────────────────────── */

/**
 * El enlace del botón: «<factura>.<vez>.<firma>». La firma (HMAC con la clave del
 * servidor) es la llave: no pide entrar. La vez es la vez que se pagó: si el pago
 * se deshace y se vuelve a pagar, el enlace del primer correo deja de valer.
 */
function firma(id, vez) {
  const clave = process.env.JWT_SECRET;
  if (!clave) throw new Error('Falta JWT_SECRET: no se puede firmar el enlace de confirmación del pago');
  return crypto.createHmac('sha256', clave).update(`facturas-colaborador-pago:${id}:${vez}`).digest('base64url');
}

export const tokenDeConfirmacion = (id, vez) => `${id}.${vez}.${firma(id, vez)}`;
export const urlDeConfirmacion = (id, vez) => enlace(`factura-colaborador/pago/${tokenDeConfirmacion(id, vez)}`);

const NO_VALE = () => new AppError('Este enlace no existe o ya no es válido', 404, 'NOT_FOUND');

function leerToken(token) {
  const m = /^(\d{1,10})\.(\d{1,4})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
  if (!m) return null;
  const id = Number(m[1]);
  const vez = Number(m[2]);
  if (!id || id > 2147483647 || !vez) return null;
  const esperada = Buffer.from(firma(id, vez));
  const llega = Buffer.from(m[3]);
  return esperada.length === llega.length && crypto.timingSafeEqual(esperada, llega) ? { id, vez } : null;
}

async function facturaDelEnlace(token) {
  const t = leerToken(token);
  if (!t) throw NO_VALE();
  const f = await facturas.porId(t.id, null);
  if (!f || !f.pagada_at || f.anulada_at) throw NO_VALE();
  if (await facturas.vecesQue(t.id, 'pagada') !== t.vez) throw NO_VALE();
  return f;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Lo que ve el colaborador: su factura, el pago y si ya lo confirmó. Nada de archivos ni correos. */
async function paraLaPagina(f) {
  const marca = await facturas.marcaDeLaEmpresa(f.issuer_id);
  return {
    colaborador: f.colaborador_nombre,
    empresa: f.razon_social,
    marca: marca ? { nombre: marca.nombre, logo_url: marca.logo_url } : null,
    mes: `${MESES[Number(f.periodo.slice(5, 7)) - 1]} de ${f.periodo.slice(0, 4)}`,
    numero_factura: f.numero_factura,
    importe: f.importe === null ? null : Number(f.importe),
    moneda: f.moneda || 'EUR',
    pagada_at: f.pagada_at,
    forma_pago: f.forma_pago,
    confirmado_at: f.pago_confirmado_at,
    opinion: f.pago_feedback_at
      ? { valoracion: f.pago_valoracion, comentario: f.pago_comentario, at: f.pago_feedback_at }
      : null,
  };
}

export async function verPago(token) {
  return paraLaPagina(await facturaDelEnlace(token));
}

/** Confirma el pago. La segunda vez no cambia nada: la fecha es la de la primera. */
export async function confirmarPago(token, ip) {
  const f = await facturaDelEnlace(token);
  if (await model.confirmarPago(f.id)) {
    await anotar(pool, { facturaId: f.id, evento: 'pago_confirmado', ip });
  }
  return paraLaPagina(await facturas.porId(f.id, null));
}

/** Su opinión del pago: una vez, después de confirmarlo. */
export async function opinarDelPago(token, { valoracion = null, comentario = null }, ip) {
  const f = await facturaDelEnlace(token);
  if (!f.pago_confirmado_at) throw new AppError('Primero confirma que has recibido el pago', 409, 'SIN_CONFIRMAR');
  if (f.pago_feedback_at) throw new AppError('Ya nos dejaste tu opinión. ¡Gracias!', 409, 'YA_OPINADO');
  const texto = typeof comentario === 'string' ? comentario.trim().slice(0, 1000) : '';
  if (!valoracion && !texto) throw new AppError('Elige una valoración o escribe un comentario', 400, 'VALIDATION_ERROR');
  if (!(await model.guardarOpinion(f.id, { valoracion: valoracion || null, comentario: texto || null }))) {
    throw new AppError('Ya nos dejaste tu opinión. ¡Gracias!', 409, 'YA_OPINADO');
  }
  await anotar(pool, {
    facturaId: f.id, evento: 'pago_opinion', ip,
    detalle: { valoracion: valoracion || null, ...(texto ? { comentario: texto } : {}) },
  });
  return paraLaPagina(await facturas.porId(f.id, null));
}
