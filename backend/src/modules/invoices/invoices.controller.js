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
    const pid = projectId(req);
    const { estado, search, from, to, page, limit } = req.query;
    const data = await model.list({ projectId: pid, estado, search, from, to,
      page: Number(page) || 1, limit: Math.min(Number(limit) || 50, 200) });
    res.json({ success: true, data: data.rows, pagination: { total: data.total, page: Number(page) || 1, limit: Number(limit) || 50 } });
  } catch (e) { next(e); }
}

export async function stats(req, res, next) {
  try {
    const pid = projectId(req);
    res.json({ success: true, data: await model.getStats(pid) });
  } catch (e) { next(e); }
}

export async function getOne(req, res, next) {
  try {
    const inv = await model.findById(Number(req.params.id));
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: inv });
  } catch (e) { next(e); }
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
    res.json({ success: true, data: lead });
  } catch (e) { next(e); }
}

export async function create(req, res, next) {
  try {
    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'BAD_REQUEST');
    const d = parsed.data;

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
    }, req.user?.id);
    res.json({ success: true, data: inv });
  } catch (e) {
    logger.error({ e: e.message }, 'create invoice failed');
    next(e);
  }
}

export async function pdf(req, res, next) {
  try {
    const id = Number(req.params.id);
    const inv = await model.findById(id);
    if (!inv) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    let bytes;
    if (inv.pdf_path) {
      try { bytes = await fs.readFile(inv.pdf_path); } catch { bytes = null; }
    }
    if (!bytes) {
      const gen = await service.generatePDF(id);
      bytes = gen.bytes;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.codigo.replace('/', '-')}.pdf"`);
    res.send(Buffer.from(bytes));
  } catch (e) { next(e); }
}

export async function send(req, res, next) {
  try {
    const id = Number(req.params.id);
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

export async function rectificar(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { motivo, parcial, issuerId } = req.body || {};
    const rect = await model.createRectificativa(id, {
      motivo,
      parcial: parcial != null && parcial !== '' ? Number(parcial) : null,
      overrideIssuerId: issuerId ? Number(issuerId) : null,
      userId: req.user?.id,
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
