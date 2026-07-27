import fs from 'fs/promises';
import crypto from 'crypto';
import * as model from './invoices.model.js';
import * as service from './invoices.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { createInvoiceSchema, setSequenceSchema, updateConfigSchema, issuerSchema } from './invoices.validation.js';

function logoExt(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return 'jpg';
}
function logoMime(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/jpeg';
}

function isAdmin(req) {
  return ['admin', 'superadmin', 'soporte'].includes(req.user?.role);
}

function projectId(req) {
  const pid = Number(req.query.projectId || req.body?.projectId);
  if (!pid) throw new AppError('projectId requerido', 400, 'BAD_REQUEST');
  return pid;
}

export async function list(req, res, next) {
  try {
    const { estado, search, from, to, tipo, page, limit } = req.query;
    const issuerId = req.query.issuerId ? Number(req.query.issuerId) : null;
    // Vista por SOCIEDAD (todas las facturas de una empresa emisora entre
    // proyectos): global, solo admin/superadmin. Si no, se exige projectId.
    const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    let pid = null;
    if (issuerId && isAdmin) {
      pid = req.query.projectId ? Number(req.query.projectId) : null; // opcional en modo sociedad
    } else {
      pid = projectId(req);
    }
    // Gestor: solo ve SUS facturas (las de sus leads). Admin/superadmin, todas.
    const responsableId = req.user?.role === 'gestor' ? req.user.userId : null;
    const data = await model.list({ projectId: pid, issuerId: issuerId && isAdmin ? issuerId : null,
      estado, search, from, to, tipo, responsableId,
      page: Number(page) || 1, limit: Math.min(Number(limit) || 50, 200) });
    res.json({ success: true, data: data.rows, pagination: { total: data.total, page: Number(page) || 1, limit: Number(limit) || 50 } });
  } catch (e) { next(e); }
}

export async function stats(req, res, next) {
  try {
    const issuerId = req.query.issuerId ? Number(req.query.issuerId) : null;
    // Con issuerId → stats de la sociedad (opcionalmente acotada a un proyecto).
    // Sin issuerId → stats del proyecto activo (comportamiento clásico).
    const pid = req.query.projectId ? Number(req.query.projectId) : (issuerId ? null : projectId(req));
    res.json({ success: true, data: await model.getStats({ projectId: pid, issuerId }) });
  } catch (e) { next(e); }
}

export async function getOne(req, res, next) {
  try {
    const inv = await model.findById(Number(req.params.id));
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    // Borrador: informar qué falta para poder emitir ("Falta: ...").
    const faltantes = inv.estado === 'borrador' ? model.invoiceFaltantes(inv) : [];
    res.json({ success: true, data: { ...inv, faltantes } });
  } catch (e) { next(e); }
}

// POST /:id/emitir — valida el borrador (con datos opcionales para completar)
// y le asigna número fiscal. Devuelve la factura ya emitida.
export async function emitir(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.emitirBorrador(id, req.body || {});
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'emitir borrador failed');
    next(e);
  }
}

// POST /:id/completar-datos — rellena los datos fiscales del cliente en una
// factura YA emitida (auto-emitida al pagar). Desbloquea descargar/enviar.
export async function completarDatos(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.completarDatosCliente(id, req.body || {});
    res.json({ success: true, data: { ...inv, faltantes: model.invoiceFaltantes(inv) } });
  } catch (e) {
    logger.error({ e: e.message }, 'completar datos failed');
    next(e);
  }
}

// GET preview por conversion - si existe la factura la devuelve
export async function byConversion(req, res, next) {
  try {
    const conversionId = Number(req.params.conversionId);
    const inv = await model.findByConversion(conversionId);
    res.json({ success: true, data: inv });
  } catch (e) { next(e); }
}

// GET datos fiscales del lead para pre-rellenar modal
export async function leadFiscalData(req, res, next) {
  try {
    const leadId = Number(req.params.leadId);
    const lead = await model.getLeadFiscalData(leadId);
    if (!lead) throw new AppError('Lead no encontrado', 404, 'NOT_FOUND');
    const conversiones = await model.getLeadConversions(leadId);
    res.json({ success: true, data: { ...lead, conversiones } });
  } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    const d = parsed.data;

    // Facturas de abono (rectificativas): admin/superadmin o una gestora con permiso
    // factura_manager (sobre sus propias ventas).
    const esAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
    if (d.tipo === 'rectificativa' && !esAdmin) {
      const puede = req.user?.role === 'gestor' && await model.esFacturaManager(req.user.userId);
      if (!puede) throw new AppError('No tienes permiso para emitir facturas de abono.', 403, 'FORBIDDEN');
    }

    // REGLA: sin ningún pago no se puede emitir una FACTURA fiscal por la
    // conversión — solo una proforma. Al registrar el pago, ese pago genera su
    // factura. (No aplica a proforma ni borrador.)
    if (d.conversionId && d.tipo !== 'proforma' && !d.borrador) {
      if (await model.conversionSinPago(d.conversionId)) {
        throw new AppError('Sin ningún pago no se puede emitir una factura. Emite una proforma; al registrar el pago se generará la factura.', 400, 'NO_PAYMENT');
      }
    }

    // REGLA: una conversión no puede tener dos proformas. Si ya existe una activa,
    // se bloquea la segunda emisión (evita duplicados y quemar correlativo fiscal).
    if (d.conversionId && d.tipo === 'proforma' && !d.borrador) {
      if (!(await model.conversionSinPago(d.conversionId))) {
        throw new AppError('Esta venta ya tiene pagos registrados. No se puede emitir una proforma después del primer cobro.', 409, 'PROFORMA_WITH_PAYMENT');
      }
      const existente = await model.proformaActivaDeConversion(d.conversionId);
      if (existente) {
        throw new AppError(`Esta venta ya tiene la proforma ${existente.codigo}. Anúlala antes de emitir otra.`, 409, 'PROFORMA_DUPLICADA');
      }
    }

    // Calcular importes server-side (no confiar en cliente)
    const ivaPct = d.ivaPct ?? service.getDefaultIvaPct(d.clientePais);
    const { baseImponible, ivaImporte, total } = service.calcularImportes({
      items: d.items, ivaPct, ivaIncluido: d.ivaIncluido,
    });

    const leyendaIva = ivaPct === 0
      ? (d.leyendaIva || 'Operación exenta de IVA conforme a la normativa aplicable.')
      : (d.leyendaIva || null);

    const inv = await model.create({
      ...d,
      ivaPct, baseImponible, ivaImporte, total, leyendaIva,
      moneda: d.moneda || 'EUR',
    }, req.user?.userId);
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'create invoice failed');
    next(e);
  }
}

// PATCH /:id — edición COMPLETA de un borrador (solo admin/superadmin vía ruta).
export async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const d = { ...(req.body || {}) };
    if (Array.isArray(d.items)) {
      const ivaPct = d.ivaPct ?? 0;
      const { baseImponible, ivaImporte, total } = service.calcularImportes({ items: d.items, ivaPct, ivaIncluido: d.ivaIncluido });
      d.baseImponible = baseImponible; d.ivaImporte = ivaImporte; d.total = total; d.ivaPct = ivaPct;
    }
    const inv = await model.updateBorrador(id, d);
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'update borrador failed');
    next(e);
  }
}

// PATCH /:id/corregir — corrección de una factura YA emitida/pagada (admin).
// Permite enmendar IVA, datos del cliente y concepto manteniendo el número fiscal.
export async function corregir(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await model.puedeGestionarFactura(req.user.userId, req.user.role, id))) {
      throw new AppError('Solo puedes editar tus propias facturas.', 403, 'FORBIDDEN');
    }
    const d = { ...(req.body || {}) };
    if (Array.isArray(d.items)) {
      const exento = d.exento === true || Number(d.ivaPct) === 0;
      const ivaPct = exento ? 0 : (d.ivaPct ?? 0);
      const { baseImponible, ivaImporte, total } = service.calcularImportes({ items: d.items, ivaPct, ivaIncluido: d.ivaIncluido });
      d.baseImponible = baseImponible; d.ivaImporte = ivaImporte; d.total = total; d.ivaPct = ivaPct;
      d.leyendaIva = exento ? (d.leyendaIva || 'Operación exenta de IVA conforme a la normativa aplicable.') : (ivaPct === 0 ? d.leyendaIva : null);
    }
    delete d.exento;
    const inv = await model.updateBorrador(id, d, { soloBorrador: false });
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'corregir factura failed');
    next(e);
  }
}

// PATCH /:id/fechas — cambiar SOLO la fecha de emisión y/o de pago de una factura.
// Para admins y para usuarios con el permiso editar_fechas_factura (que solo pueden eso).
export async function updateFechas(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await model.puedeEditarFechas(req.user.userId, req.user.role))) {
      throw new AppError('No tienes permiso para cambiar fechas de facturas.', 403, 'FORBIDDEN');
    }
    const { fechaEmision = null, fechaPago = null } = req.body || {};
    const okFecha = (v) => v == null || /^\d{4}-\d{2}-\d{2}$/.test(String(v));
    if (!okFecha(fechaEmision) || !okFecha(fechaPago)) {
      throw new AppError('Fecha inválida (formato YYYY-MM-DD).', 400, 'BAD_DATE');
    }
    if (fechaEmision == null && fechaPago == null) {
      throw new AppError('Indica al menos una fecha.', 400, 'NO_DATE');
    }
    const inv = await model.updateFechas(id, { fechaEmision, fechaPago });
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'updateFechas failed');
    next(e);
  }
}

export async function pdf(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.findById(id);
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    // ?preliminar=1 → vista previa SIN exigir datos completos. Sale con marca de
    // agua "PRELIMINAR / SIN VALIDEZ FISCAL". Sirve para ver la factura aunque
    // falten NIF/dirección del cliente (p.ej. las importadas/auto-emitidas).
    const preliminar = req.query.preliminar === '1' || req.query.preliminar === 'true';
    // ?forzar=1 → descarga la DEFINITIVA (sin marca de agua) aunque falten datos
    // del cliente. Los campos vacíos salen en blanco. El usuario decide descargarla
    // igual y completar luego.
    const forzar = req.query.forzar === '1' || req.query.forzar === 'true';
    // Factura EMITIDA con datos incompletos (auto-emitida al pagar): tiene su
    // número. Por defecto exige datos, pero con ?forzar=1 se descarga igual.
    if (!preliminar && !forzar && inv.tipo !== 'proforma' && inv.estado !== 'borrador') {
      const faltan = model.invoiceFaltantes(inv);
      if (faltan.length > 0) {
        throw new AppError(`Para descargar la factura ${inv.codigo || ''} debes rellenar: ${faltan.join(', ')}.`, 400, 'INVOICE_INCOMPLETE');
      }
    }
    let bytes;
    // El preliminar nunca usa el PDF cacheado (definitivo): siempre se regenera
    // con la marca de agua.
    if (inv.pdf_path && !preliminar) {
      try { bytes = await fs.readFile(inv.pdf_path); } catch { bytes = null; }
    }
    if (!bytes) {
      const gen = await service.generatePDF(id, { preliminar });
      bytes = gen.bytes;
    }
    res.setHeader('Content-Type', 'application/pdf');
    // Borrador: no tiene código fiscal todavía.
    const fname = (preliminar ? 'PRELIMINAR-' : '') + (inv.codigo ? inv.codigo.replace('/', '-') : `BORRADOR-${inv.id}`);
    res.setHeader('Content-Disposition', `inline; filename="${fname}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) { next(e); }
}

export async function send(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.findById(id);
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    if (inv.estado === 'borrador') {
      const faltan = model.invoiceFaltantes(inv);
      throw new AppError(
        `Es un borrador sin validez fiscal: no se puede enviar.${faltan.length ? ` Falta: ${faltan.join(', ')}.` : ''} Usa "Validar y emitir" primero.`,
        400, 'DRAFT_CANNOT_SEND');
    }
    // Emitida pero con datos incompletos (auto-emitida al pagar): no se envía
    // hasta rellenar los datos del cliente.
    if (inv.tipo !== 'proforma') {
      const faltan = model.invoiceFaltantes(inv);
      if (faltan.length > 0) {
        throw new AppError(`Para enviar la factura ${inv.codigo || ''} debes rellenar: ${faltan.join(', ')}.`, 400, 'INVOICE_INCOMPLETE');
      }
    }
    const { email } = req.body || {};
    const result = await service.sendByEmail(id, email);
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error({ e: e.message }, 'send invoice failed');
    next(e);
  }
}

export async function markPaid(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.findById(id);
    if (inv?.estado === 'borrador') {
      throw new AppError('Un borrador no puede marcarse pagado: primero "Validar y emitir".', 400, 'DRAFT_CANNOT_PAY');
    }
    await model.markPaid(id, req.body?.fechaPago);
    res.json({ success: true });
  } catch (e) { next(e); }
}

export async function cancel(req, res, next) {
  try {
    await model.cancel(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { next(e); }
}

// DELETE /:id — borra la factura y libera su número (solo admin/superadmin).
// Para errores de carga: la venta se mantiene y se puede volver a facturar.
export async function destroy(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await model.puedeGestionarFactura(req.user.userId, req.user.role, id))) {
      throw new AppError('Solo puedes eliminar tus propias facturas.', 403, 'FORBIDDEN');
    }
    const inv = await model.deleteInvoice(id);
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: { id: inv.id, codigo: inv.codigo } });
  } catch (e) {
    logger.error({ e: e.message }, 'delete invoice failed');
    next(e);
  }
}

export async function rectificar(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!(await model.puedeGestionarFactura(req.user.userId, req.user.role, id))) {
      throw new AppError('Solo puedes emitir abonos de tus propias facturas.', 403, 'FORBIDDEN');
    }
    const { motivo, parcial, issuerId } = req.body || {};
    const rect = await model.createRectificativa(id, {
      motivo,
      parcial: parcial != null && parcial !== '' ? Number(parcial) : null,
      overrideIssuerId: issuerId ? Number(issuerId) : null,
      userId: req.user?.userId,
    });
    res.json({ success: true, data: rect });
  } catch (e) {
    logger.error({ e: e.message }, 'rectificar invoice failed');
    next(e);
  }
}

// ─── Emisores (multi-empresa) — solo admin gestiona ──────────────────────────
export async function listIssuers(req, res, next) {
  try {
    const pid = Number(req.query.projectId) || null;
    res.json({ success: true, data: await model.listIssuers(pid) });
  } catch (e) { next(e); }
}

export async function createIssuer(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras pueden añadir empresas', 403, 'FORBIDDEN');
    const parsed = issuerSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    const iss = await model.createIssuer(parsed.data, req.user?.id);
    res.json({ success: true, data: iss });
  } catch (e) { next(e); }
}

export async function updateIssuer(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    const parsed = issuerSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    const iss = await model.updateIssuer(Number(req.params.id), parsed.data);
    res.json({ success: true, data: iss });
  } catch (e) { next(e); }
}

export async function deleteIssuer(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    await model.deleteIssuer(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { next(e); }
}

// Subir logo de empresa emisora al servidor (no solo URL).
export async function uploadIssuerLogo(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    const id = Number(req.params.id);
    if (!id) throw new AppError('ID inválido', 400, 'INVALID_ID');
    if (!req.file) throw new AppError('Imagen requerida (campo file)', 400, 'FILE_REQUIRED');
    const iss = await model.getIssuer(id);
    if (!iss) throw new AppError('Empresa no encontrada', 404, 'NOT_FOUND');
    if (iss.logo_key) { try { await deleteLocal(iss.logo_key); } catch {} }

    const ext = logoExt(req.file.mimetype);
    const key = `logos/issuer-${id}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);
    const logoUrl = `/api/invoices/issuers/${id}/logo?v=${Date.now()}`;
    const updated = await model.updateIssuer(id, { logoUrl, logoKey: key });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
}

export async function getIssuerLogo(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!id) throw new AppError('ID inválido', 400, 'INVALID_ID');
    const iss = await model.getIssuer(id);
    if (!iss?.logo_key) return res.status(404).end();
    const ext = iss.logo_key.split('.').pop();
    let buffer, size;
    try { ({ buffer, size } = await getLocal(iss.logo_key)); }
    catch (e) { if (e.code === 'ENOENT') return res.status(404).end(); throw e; }
    res.setHeader('Content-Type', logoMime(ext));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', size);
    res.end(buffer);
  } catch (e) { next(e); }
}

export async function deleteIssuerLogo(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    const id = Number(req.params.id);
    const iss = await model.getIssuer(id);
    if (!iss) throw new AppError('Empresa no encontrada', 404, 'NOT_FOUND');
    if (iss.logo_key) { try { await deleteLocal(iss.logo_key); } catch {} }
    const updated = await model.updateIssuer(id, { logoUrl: null, logoKey: null });
    res.json({ success: true, data: updated });
  } catch (e) { next(e); }
}

// ── Regímenes fiscales + coletillas ────────────────────────────────────────
export async function listRegimenes(req, res, next) {
  try {
    const pid = Number(req.query.projectId) || null;
    res.json({ success: true, data: await model.listRegimenes(pid) });
  } catch (e) { next(e); }
}

// Motor fiscal: resuelve el régimen aplicable (IVA + coletilla) según producto + cliente.
export async function resolveRegimen(req, res, next) {
  try {
    const pid = projectId(req);
    const { productId, pais, cp, provincia, tipo, vies } = req.query;
    const out = await model.resolveRegimen(pid, {
      productId: productId ? Number(productId) : null,
      pais, cp, provincia, tipo,
      viesValido: vies === 'true' || vies === '1',
    });
    res.json({ success: true, data: out });
  } catch (e) { next(e); }
}
export async function createRegimen(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    res.json({ success: true, data: await model.createRegimen(req.body) });
  } catch (e) { next(e); }
}
export async function updateRegimen(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    res.json({ success: true, data: await model.updateRegimen(Number(req.params.id), req.body) });
  } catch (e) { next(e); }
}
export async function deleteRegimen(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    await model.deleteRegimen(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { next(e); }
}

// ── Plantillas (editor Canva) ──────────────────────────────────────────────
export async function listTemplates(req, res, next) {
  try {
    const pid = Number(req.query.projectId) || null;
    res.json({ success: true, data: await model.listTemplates(pid) });
  } catch (e) { next(e); }
}
export async function getTemplate(req, res, next) {
  try { res.json({ success: true, data: await model.getTemplate(Number(req.params.id)) }); }
  catch (e) { next(e); }
}
export async function createTemplate(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    res.json({ success: true, data: await model.createTemplate(req.body, req.user?.id) });
  } catch (e) { next(e); }
}
export async function updateTemplate(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    res.json({ success: true, data: await model.updateTemplate(Number(req.params.id), req.body) });
  } catch (e) { next(e); }
}
export async function deleteTemplate(req, res, next) {
  try {
    if (!isAdmin(req)) throw new AppError('Solo administradoras', 403, 'FORBIDDEN');
    await model.deleteTemplate(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { next(e); }
}

export async function ventasSinFactura(req, res, next) {
  try {
    const pid = projectId(req);
    res.json({ success: true, data: await model.listVentasSinFactura(pid) });
  } catch (e) { next(e); }
}

export async function listSequences(req, res, next) {
  try {
    const pid = projectId(req);
    res.json({ success: true, data: await model.listSequences(pid) });
  } catch (e) { next(e); }
}

export async function setSequence(req, res, next) {
  try {
    if (!['admin', 'superadmin', 'soporte'].includes(req.user?.role)) {
      throw new AppError('Solo admin/superadmin/soporte', 403, 'FORBIDDEN');
    }
    const parsed = setSequenceSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    await model.setSequence(parsed.data.projectId, parsed.data.ano, parsed.data.serie, parsed.data.ultimoNumero);
    res.json({ success: true });
  } catch (e) { next(e); }
}

export async function getConfig(req, res, next) {
  try {
    const pid = projectId(req);
    const data = await model.getProjectInvoicerData(pid);
    res.json({ success: true, data });
  } catch (e) { next(e); }
}

export async function updateConfig(req, res, next) {
  try {
    if (!['admin', 'superadmin', 'soporte'].includes(req.user?.role)) {
      throw new AppError('Solo admin/superadmin/soporte', 403, 'FORBIDDEN');
    }
    const parsed = updateConfigSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    await model.updateProjectFacturacionConfig(parsed.data.projectId, parsed.data);
    res.json({ success: true });
  } catch (e) { next(e); }
}
