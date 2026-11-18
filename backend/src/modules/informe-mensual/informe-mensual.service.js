import fs from 'node:fs/promises';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { yaSeEnvio } from '../../shared/services/email-log.service.js';
import { marcaDeLaEmpresa, nombreCortoDeEmpresa, remitenteDe } from '../../shared/services/marca.service.js';
import { asesorasPorMes } from '../reports/report.model.js';
import { generatePDF } from '../invoices/invoices.service.js';
import { apiPublica as apiPublicaDe } from '../copia-diaria/copia-diaria.config.js';
import * as model from './informe-mensual.model.js';
import { leerConfig, destinatarios, empresaIncluida } from './informe-mensual.config.js';
import { urlDeDescarga } from './informe-mensual.enlace.js';
import { correoDelMes, asuntoDelMes } from './informe-mensual.correo.js';

/*
  EL INFORME MENSUAL Y EL ENVÍO A LA GESTORÍA (#772, Automatizaciones 9/9).

  Tres piezas, y ninguna consulta nueva para las cifras de ventas:

    · El informe del mes, por comercial y por equipo. Sale de `asesorasPorMes`
      (el panel de Asesoras de Reportes) con el mes natural como rango: lo que
      dice el correo es lo que dice la pantalla, por construcción.
        - Comercial = la vendedora de cada venta (`conversion_reparto`: la
          vendedora, o si no la responsable del cliente; compartida, su parte),
          la misma regla que el ranking.
        - Cobrado = la suma de los PAGOS registrados con fecha de cobro dentro
          del mes (`conversion_payments`), nunca `importe_pagado` (#692).
        - Facturado = las facturas por su fecha de EMISIÓN, que es como cuenta
          la contabilidad; va al lado para que no haya que elegir.
        - Equipo = un líder (`equipo_comercial`) con sus gestoras. Una comercial
          que está en dos equipos suma en los dos; el total de la empresa sale
          de las comerciales, así que no se cuenta dos veces.
    · El ZIP de una empresa: los PDF de sus facturas emitidas en el mes
      (rectificativas aparte), el listado en Excel y el informe en Excel. El
      PDF es el de siempre: el guardado si lo hay; si no, `generatePDF`.
    · El envío: el día del mes que diga el .env, a la gestoría de cada empresa y
      a administración. Solo con INFORME_MENSUAL_ACTIVO; apagado no sale nada.
      Una vez por empresa y mes (la clave del correo); si el ZIP pesa más de lo
      que cabe, va un enlace firmado que caduca.
*/

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** «2026-10» → «octubre de 2026». */
export const nombreDelMes = (periodo) => {
  const [a, m] = String(periodo).split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
};

/** «2026-10» → { desde: '2026-10-01', hasta: '2026-10-31' }. */
export function rangoDelMes(periodo) {
  const [a, m] = String(periodo).split('-').map(Number);
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${String(ultimo).padStart(2, '0')}` };
}

/** El mes anterior al de (anio, mes): (2026, 1) → «2025-12». */
export function mesAnterior(anio, mes) {
  return mes === 1 ? `${anio - 1}-12` : `${anio}-${String(mes - 1).padStart(2, '0')}`;
}

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const CIFRAS = ['leads', 'ventas', 'vendido', 'cobrado', 'cobros', 'facturado', 'pendiente'];

function sumar(filas) {
  const s = Object.fromEntries(CIFRAS.map((k) => [k, 0]));
  for (const f of filas) for (const k of CIFRAS) s[k] += Number(f[k] || 0);
  for (const k of CIFRAS) s[k] = r2(s[k]);
  return s;
}

/**
 * El informe del mes: por comercial, por equipo y el total.
 *
 * `projectIds` son los campus que entran (nunca vacío: [-1] si no queda
 * ninguno; null = todos menos los de pruebas). `asesoraIds` recorta a unas
 * personas (quien lleva un equipo ve el suyo).
 */
export async function informeDelMes({ periodo, projectIds = null, asesoraIds = null }) {
  const { desde, hasta } = rangoDelMes(periodo);
  const filas = await asesorasPorMes({
    projectIds, from: desde, to: hasta, base: 'cobro', agrupar: 'rango',
    asesoraId: asesoraIds?.length ? asesoraIds : undefined,
  });

  const equipos = new Map();
  for (const r of await model.equipos()) {
    if (!equipos.has(r.lider_id)) {
      equipos.set(r.lider_id, { lider_id: r.lider_id, nombre: `Equipo de ${r.lider}`, lider: r.lider, miembros: new Set([r.lider_id]) });
    }
    equipos.get(r.lider_id).miembros.add(r.gestora_id);
  }

  const comerciales = filas.map((f) => {
    const suyos = [...equipos.values()].filter((e) => f.asesora_id != null && e.miembros.has(f.asesora_id));
    return {
      id: f.asesora_id,
      nombre: f.asesora,
      equipo: suyos.length ? suyos.map((e) => e.nombre).join(' · ') : 'Sin equipo',
      leads: Number(f.leads || 0),
      ventas: r2(f.ventas),
      vendido: r2(f.vendido),
      cobrado: r2(f.cobrado),
      cobros: r2(f.cobros),
      facturado: r2(f.facturado),
      pendiente: r2(f.pendiente),
      tasa_conversion: r2(f.tasa_conversion),
    };
  }).sort((a, b) => b.cobrado - a.cobrado || String(a.nombre).localeCompare(String(b.nombre), 'es'));

  const porEquipo = [];
  for (const e of equipos.values()) {
    const suyas = comerciales.filter((c) => c.id != null && e.miembros.has(c.id));
    if (!suyas.length) continue;
    porEquipo.push({ equipo: e.nombre, lider: e.lider, comerciales: suyas.length, ...sumar(suyas) });
  }
  porEquipo.sort((a, b) => b.cobrado - a.cobrado || a.equipo.localeCompare(b.equipo, 'es'));
  const sinEquipo = comerciales.filter((c) => c.equipo === 'Sin equipo');
  if (sinEquipo.length) porEquipo.push({ equipo: 'Sin equipo', lider: null, comerciales: sinEquipo.length, ...sumar(sinEquipo) });

  return { periodo, mes: nombreDelMes(periodo), desde, hasta, comerciales, equipos: porEquipo, total: sumar(comerciales) };
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const EUR = '#,##0.00 €';
const COLS_CIFRAS = [
  { header: 'Ventas', key: 'ventas', width: 9, numFmt: '0.##' },
  { header: 'Vendido', key: 'vendido', width: 13, numFmt: EUR },
  { header: 'Cobrado en el mes', key: 'cobrado', width: 17, numFmt: EUR },
  { header: 'Cobros', key: 'cobros', width: 9, numFmt: '0.##' },
  { header: 'Facturado en el mes', key: 'facturado', width: 18, numFmt: EUR },
  { header: 'Pendiente de esas ventas', key: 'pendiente', width: 20, numFmt: EUR },
  { header: 'Prospectos', key: 'leads', width: 11 },
];

function hoja(libro, nombre, columnas, filas, total) {
  const h = libro.addWorksheet(nombre);
  h.columns = columnas.map(({ numFmt, ...c }) => ({ ...c, style: numFmt ? { numFmt } : undefined }));
  h.getRow(1).font = { bold: true };
  for (const f of filas) h.addRow(f);
  if (total) h.addRow(total).font = { bold: true };
  return h;
}

/** El informe en Excel: «Por equipo», «Por comercial» y cómo se cuenta. */
export async function excelDelInforme(inf, { empresa = null } = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  hoja(libro, 'Por equipo', [
    { header: 'Equipo', key: 'equipo', width: 28 },
    { header: 'Comerciales', key: 'comerciales', width: 12 },
    ...COLS_CIFRAS,
  ], inf.equipos, null);
  hoja(libro, 'Por comercial', [
    { header: 'Comercial', key: 'nombre', width: 28 },
    { header: 'Equipo', key: 'equipo', width: 26 },
    ...COLS_CIFRAS,
    { header: 'Tasa de conversión %', key: 'tasa_conversion', width: 18 },
  ], inf.comerciales, { nombre: 'Total', ...inf.total });
  const notas = libro.addWorksheet('Cómo se cuenta');
  notas.columns = [{ width: 110 }];
  [
    `Informe de ventas de ${inf.mes}${empresa ? ` · ${empresa}` : ''} (del ${inf.desde} al ${inf.hasta}).`,
    'Comercial: la vendedora de cada venta; si no tiene, la responsable del cliente. Una venta compartida cuenta su parte a cada una.',
    'Cobrado en el mes: la suma de los pagos registrados con fecha de cobro dentro del mes natural.',
    'Facturado en el mes: las facturas emitidas en el mes (por su fecha de emisión), con los abonos restando. Sin proformas ni borradores.',
    'Ventas y vendido: las ventas con fecha de venta en el mes que tienen algún cobro. Pendiente: lo que les falta por cobrar hoy.',
    'Equipo: la líder y las comerciales a su cargo. Una comercial en dos equipos suma en los dos; el total sale de las comerciales.',
  ].forEach((t) => notas.addRow([t]));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

const TIPO = { normal: 'Factura', rectificativa: 'Rectificativa' };
const ESTADO = { emitida: 'Emitida', enviada: 'Enviada', pagada: 'Pagada', cancelada: 'Anulada' };

async function listadoDeFacturas(filas) {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  const vivas = filas.filter((f) => f.estado !== 'cancelada');
  const suma = (k) => r2(vivas.reduce((s, f) => s + Number(f[k] || 0), 0));
  hoja(libro, 'Facturas', [
    { header: 'Número', key: 'codigo', width: 16 },
    { header: 'Tipo', key: 'tipo', width: 14 },
    { header: 'Estado', key: 'estado', width: 10 },
    { header: 'Fecha de emisión', key: 'fecha', width: 15, numFmt: 'dd/mm/yyyy' },
    { header: 'Cliente', key: 'cliente', width: 32 },
    { header: 'NIF', key: 'nif', width: 14 },
    { header: 'Campus', key: 'campus', width: 20 },
    { header: 'Base imponible', key: 'base', width: 15, numFmt: EUR },
    { header: 'IVA %', key: 'iva_pct', width: 7 },
    { header: 'IVA', key: 'iva', width: 12, numFmt: EUR },
    { header: 'Total (€)', key: 'total', width: 13, numFmt: EUR },
    { header: 'Moneda', key: 'moneda', width: 8 },
    { header: 'Total en su moneda', key: 'total_divisa', width: 17, numFmt: '#,##0.00' },
    { header: 'Rectifica a', key: 'rectifica', width: 16 },
    { header: 'PDF', key: 'pdf', width: 36 },
  ], filas.map((f) => ({
    codigo: f.codigo, tipo: TIPO[f.tipo] || f.tipo, estado: ESTADO[f.estado] || f.estado,
    fecha: f.fecha_emision ? new Date(`${String(f.fecha_emision instanceof Date ? f.fecha_emision.toISOString() : f.fecha_emision).slice(0, 10)}T00:00:00Z`) : null,
    cliente: f.cliente_nombre, nif: f.cliente_nif || '', campus: f.campus || '',
    base: Number(f.base_imponible || 0), iva_pct: Number(f.iva_pct || 0), iva: Number(f.iva_importe || 0),
    total: Number(f.total || 0), moneda: f.moneda || 'EUR',
    total_divisa: f.total_divisa != null && (f.moneda || 'EUR') !== 'EUR' ? Number(f.total_divisa) : null,
    rectifica: f.rectifica_codigo || '', pdf: f.pdf,
  })), { codigo: 'Total (sin anuladas)', base: suma('base_imponible'), iva: suma('iva_importe'), total: suma('total') });
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** El PDF de una factura: el guardado si sigue en el disco; si no, se genera (y se guarda). */
async function pdfDe(f) {
  if (f.pdf_path) {
    try { return await fs.readFile(f.pdf_path); } catch { /* se genera */ }
  }
  const gen = await generatePDF(f.id);
  return Buffer.from(gen.bytes);
}

const nombreDeArchivo = (codigo) => String(codigo || 'sin-numero').replace(/[\\/:*?"<>|\s]+/g, '-');

/**
 * El ZIP del mes de una empresa:
 *   facturas/<número>.pdf        las facturas emitidas
 *   rectificativas/<número>.pdf  los abonos
 *   listado-facturas.xlsx        una fila por factura (también las anuladas)
 *   informe-ventas.xlsx          el informe del mes por equipo y comercial
 *
 * `projectIds`: los campus de quien lo pide (null = toda la empresa, que es lo
 * que va a la gestoría). Si un PDF no se puede generar, el ZIP sale igual y el
 * listado dice por qué falta.
 */
export async function zipDelMes({ periodo, empresa, projectIds = null }) {
  const { desde, hasta } = rangoDelMes(periodo);
  const campusInforme = projectIds || await model.campusDeLaEmpresa(empresa.id);
  const [facturas, informe] = await Promise.all([
    model.facturasDelMes({ issuerId: empresa.id, desde, hasta, projectIds }),
    informeDelMes({ periodo, projectIds: campusInforme.length ? campusInforme : [-1] }),
  ]);

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const usados = new Set();
  let sinPdf = 0;
  for (const f of facturas) {
    if (f.estado === 'cancelada') { f.pdf = 'Anulada: sin PDF'; continue; }
    const carpeta = f.tipo === 'rectificativa' ? 'rectificativas' : 'facturas';
    let nombre = `${carpeta}/${nombreDeArchivo(f.codigo)}.pdf`;
    if (usados.has(nombre)) nombre = nombre.replace(/\.pdf$/, `_${f.id}.pdf`);
    try {
      zip.file(nombre, await pdfDe(f));
      usados.add(nombre);
      f.pdf = nombre;
    } catch (err) {
      sinPdf++;
      f.pdf = `No se pudo generar: ${err.message}`.slice(0, 200);
      logger.warn({ err: err.message, invoiceId: f.id }, 'Informe mensual: una factura sin PDF');
    }
  }
  const corta = nombreCortoDeEmpresa(empresa);
  zip.file('listado-facturas.xlsx', await listadoDeFacturas(facturas));
  zip.file('informe-ventas.xlsx', await excelDelInforme(informe, { empresa: corta }));

  const vivas = facturas.filter((f) => f.estado !== 'cancelada');
  return {
    nombre: `facturas-e-informe_${periodo}_${nombreDeArchivo(corta)}.zip`,
    buffer: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    resumen: {
      facturas: vivas.filter((f) => f.tipo === 'normal').length,
      rectificativas: vivas.filter((f) => f.tipo === 'rectificativa').length,
      anuladas: facturas.length - vivas.length,
      total: r2(vivas.reduce((s, f) => s + Number(f.total || 0), 0)),
      sinPdf,
    },
    informe,
  };
}

/** La empresa, o 404. */
export async function empresaOError(issuerId) {
  const e = await model.empresa(issuerId);
  if (!e) throw new AppError('Esa empresa no existe', 404, 'NOT_FOUND');
  return e;
}

// ─── El envío ────────────────────────────────────────────────────────────────

/**
 * Manda el del mes `periodo` a cada empresa. Solo con el interruptor puesto.
 *
 * Una vez por empresa y mes: la clave del correo lo garantiza, y antes de armar
 * el ZIP se mira si ya salió para no generar los PDF en cada vuelta.
 */
export async function enviarMes({ periodo, cfg = leerConfig(), mandar = sendEmail, yaEnviado = yaSeEnvio } = {}) {
  if (!cfg.activo) return { omitido: 'apagado', mandados: 0, empresas: [] };
  const { desde, hasta } = rangoDelMes(periodo);
  const empresas = (await model.empresasConMovimiento(desde, hasta)).filter((e) => empresaIncluida(cfg, e));
  const resultado = [];
  let mandados = 0;
  for (const empresa of empresas) {
    const corta = nombreCortoDeEmpresa(empresa);
    const para = destinatarios(cfg, empresa);
    if (!para.length) {
      resultado.push({ empresa: corta, estado: 'sin destinatarios' });
      logger.warn({ empresa: corta, periodo }, 'Informe mensual: sin a quién mandarlo (INFORME_MENSUAL_PARA)');
      continue;
    }
    const clave = `informe-mensual-${empresa.id}-${periodo}`;
    if (await yaEnviado(clave)) { resultado.push({ empresa: corta, estado: 'ya enviado' }); continue; }
    try {
      const z = await zipDelMes({ periodo, empresa });
      const adjunto = z.buffer.length <= cfg.maxAdjuntoBytes;
      const enlace = adjunto ? null : urlDeDescarga(apiPublicaDe(cfg.env), empresa.id, periodo, { horas: cfg.enlaceHoras });
      const marca = await marcaDeLaEmpresa(empresa.id);
      const correo = correoDelMes({ empresa: corta, periodo, mes: nombreDelMes(periodo), zip: z, enlace, marca, zona: cfg.zona });
      const r = await mandar({
        to: para.map((email) => ({ email })),
        subject: asuntoDelMes(corta, periodo),
        htmlContent: correo.htmlContent,
        textContent: correo.textContent,
        tags: ['informe-mensual'],
        clave,
        ...(adjunto ? { attachment: [{ name: z.nombre, content: z.buffer.toString('base64') }] } : {}),
        ...remitenteDe(marca),
      });
      if (r?.sent) mandados++;
      resultado.push({ empresa: corta, estado: r?.sent ? 'enviado' : (r?.reason || 'no enviado'), adjunto, ...z.resumen });
    } catch (err) {
      resultado.push({ empresa: corta, estado: 'error', error: err.message });
      logger.error({ err: err.message, empresa: corta, periodo }, 'Informe mensual: falló el de una empresa');
    }
  }
  logger.info({ periodo, mandados, empresas: resultado }, 'Informe mensual a la gestoría');
  return { mandados, empresas: resultado };
}
