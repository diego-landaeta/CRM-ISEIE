import * as model from './apostillas.model.js';
import * as service from './apostillas.service.js';
import {
  listarSchema, cifrasSchema, editarSchema, crearSchema, enlazarSchema, documentoSchema, ajustesSchema,
} from './apostillas.validation.js';
import { ESTADOS, TIPOS_DOCUMENTO } from './apostillas.estados.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal } from '../../shared/services/localStorage.service.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';

/*
  APOSTILLAS DE LA HAYA (CRM#1130 / CRM-ISEIE#786): la lista, las cifras, la
  ficha con su historial y sus documentos, y los cambios. Quién ve y quién
  gestiona, en `apostillas.service.js`. Ningún camino escribe al alumno.
*/

/** Los documentos de una apostilla, como mucho. */
const MAX_DOCUMENTOS = 20;

function idDe(valor, que = 'Apostilla') {
  const s = String(valor ?? '');
  const n = /^\d{1,10}$/.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) throw new AppError(`${que} no encontrada`, 404, 'NOT_FOUND');
  return n;
}

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/** El nombre del fichero tal como se escribió (multer lo lee como Latin-1), y que quepa en 255. */
function nombreDelFichero(original) {
  const s = String(original || '') || 'archivo';
  const u = [...s].some((c) => c.codePointAt(0) > 0xff) ? s : Buffer.from(s, 'latin1').toString('utf8');
  const n = (u.includes('�') ? s : u).normalize('NFC');
  if (n.length <= 255) return n;
  const punto = n.lastIndexOf('.');
  const ext = punto > 0 && n.length - punto <= 10 ? n.slice(punto) : '';
  return n.slice(0, 255 - ext.length) + ext;
}

/**
 * Los campus de la petición (campus, empresa o todos), siempre dentro de los
 * de quien pide: el mismo ámbito que Reportes y el resto de pantallas de cifras.
 */
async function campusDelAmbito(req) {
  const { projectId, projectIds } = await proyectosDelAmbito(req);
  if (projectId) return [Number(projectId)];
  return projectIds;
}

/** Para el filtro «Mías»: las personas cuyas apostillas gestiona (null = todas). */
async function idsDeGestion(req) {
  const alcance = await service.alcanceDeGestion(req);
  if (alcance === false) return [-1];
  return alcance;
}

export async function listar(req, res, next) {
  try {
    const f = parsear(listarSchema, req.query);
    const projectIds = await campusDelAmbito(req);
    const ids = f.mias ? await idsDeGestion(req) : null;
    const data = await model.listar({ ...f, projectIds, ids });
    await service.conLoQuePuede(req, data.apostillas);
    res.json({
      success: true,
      data: data.apostillas,
      pagination: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  } catch (err) { next(err); }
}

export async function cifras(req, res, next) {
  try {
    const f = parsear(cifrasSchema, req.query);
    const projectIds = await campusDelAmbito(req);
    res.json({ success: true, data: await model.cifras({ ...f, projectIds }) });
  } catch (err) { next(err); }
}

/** Los estados y tipos de documento, para que la pantalla no los repita a mano. */
export async function catalogo(_req, res) {
  res.json({ success: true, data: { estados: ESTADOS, tipos_documento: TIPOS_DOCUMENTO } });
}

export async function porId(req, res, next) {
  try {
    const a = await service.exigirAcceso(req, idDe(req.params.id));
    const [eventos, documentos] = await Promise.all([model.eventos(a.id), model.documentos(a.id)]);
    res.json({ success: true, data: { ...a, eventos, documentos } });
  } catch (err) { next(err); }
}

/** El bloque de la ficha del cliente. */
export async function deLead(req, res, next) {
  try {
    const leadId = idDe(req.params.leadId, 'Cliente');
    const data = await model.deLead(leadId, await service.campusQueVe(req));
    await service.conLoQuePuede(req, data);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** El bloque de la ficha de la venta. */
export async function deVenta(req, res, next) {
  try {
    const conversionId = idDe(req.params.conversionId, 'Venta');
    const data = await model.deVenta(conversionId, await service.campusQueVe(req));
    await service.conLoQuePuede(req, data);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Quién puede llevarla (el desplegable de «Responsable»), en los campus de quien pide. */
export async function personas(req, res, next) {
  try {
    res.json({ success: true, data: await model.personas(await service.campusQueVe(req)) });
  } catch (err) { next(err); }
}

export async function editar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const a = await service.exigirGestion(req, id);
    const d = parsear(editarSchema, req.body);
    const textos = {};
    if (d.responsableId !== undefined && d.responsableId) {
      const p = await model.personaDelCampus(d.responsableId, a.project_id);
      if (!p) throw new AppError('Esa persona no existe o no es de este campus', 400, 'VALIDATION_ERROR');
      textos.responsableAhora = p.nombre;
    }
    if (d.responsableId !== undefined) textos.responsableAntes = a.responsable || null;
    await model.editar(id, d, req.user.userId, { textos });
    const ahora = await service.exigirAcceso(req, id);
    const [eventos, documentos] = await Promise.all([model.eventos(id), model.documentos(id)]);
    res.json({ success: true, data: { ...ahora, eventos, documentos } });
  } catch (err) { next(err); }
}

export async function crear(req, res, next) {
  try {
    const d = parsear(crearSchema, req.body);
    await service.exigirCampus(req, d.projectId);
    if (d.leadId) {
      const l = await model.lead(d.leadId);
      if (!l || Number(l.project_id) !== Number(d.projectId)) throw new AppError('Ese cliente no es de este campus', 400, 'VALIDATION_ERROR');
    }
    if (d.conversionId) {
      const v = await model.venta(d.conversionId);
      if (!v || Number(v.project_id) !== Number(d.projectId)) throw new AppError('Esa venta no es de este campus', 400, 'VALIDATION_ERROR');
      if (d.leadId && Number(v.lead_id) !== Number(d.leadId)) throw new AppError('Esa venta es de otro cliente', 400, 'VALIDATION_ERROR');
    }
    let id;
    try {
      id = await model.crearManual({ ...d, userId: req.user.userId });
    } catch (err) {
      if (err?.code === '23505') throw new AppError('Esa venta ya tiene su apostilla', 409, 'YA_EXISTE');
      throw err;
    }
    res.status(201).json({ success: true, data: await service.exigirAcceso(req, id) });
  } catch (err) { next(err); }
}

/** Una de «Sin asociar», con su cliente (y su venta, si se dice). */
export async function enlazar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const a = await service.exigirAcceso(req, id);
    const d = parsear(enlazarSchema, req.body);
    const l = await model.lead(d.leadId);
    if (!l || Number(l.project_id) !== Number(a.project_id)) throw new AppError('Ese cliente no es de este campus', 400, 'VALIDATION_ERROR');
    if (d.conversionId) {
      const v = await model.venta(d.conversionId);
      if (!v || Number(v.lead_id) !== Number(d.leadId)) throw new AppError('Esa venta no es de ese cliente', 400, 'VALIDATION_ERROR');
    }
    try {
      await model.enlazar(id, { ...d, texto: l.nombre, userId: req.user.userId });
    } catch (err) {
      if (err?.code === '23505') throw new AppError('Esa venta ya tiene su apostilla', 409, 'YA_EXISTE');
      throw err;
    }
    res.json({ success: true, data: await service.exigirAcceso(req, id) });
  } catch (err) { next(err); }
}

export async function subirDocumento(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await service.exigirGestion(req, id);
    if (!req.file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');
    const { tipo } = parsear(documentoSchema, req.body || {});
    if ((await model.documentos(id)).length >= MAX_DOCUMENTOS) {
      throw new AppError(`Máximo ${MAX_DOCUMENTOS} documentos por apostilla`, 400, 'DEMASIADOS_DOCUMENTOS');
    }
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const clave = `apostillas/${id}/d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    await saveLocal(clave, req.file.buffer);
    const doc = await model.guardarDocumento({
      apostillaId: id, tipo, nombre: nombreDelFichero(req.file.originalname), clave,
      mime: req.file.mimetype, bytes: req.file.size, userId: req.user.userId,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) { next(err); }
}

/**
 * Descargar un documento: con sesión, de sus campus y quien puede gestionar esa
 * apostilla (o superadmin y soporte). Un diploma lleva datos personales.
 */
export async function descargarDocumento(req, res, next) {
  try {
    const doc = await model.documentoPorId(idDe(req.params.docId, 'Documento'));
    if (!doc) throw new AppError('Documento no encontrado', 404, 'NOT_FOUND');
    let a;
    try {
      a = await service.exigirAcceso(req, doc.apostilla_id);
    } catch {
      throw new AppError('Documento no encontrado', 404, 'NOT_FOUND');
    }
    if (!a.ve_documentos) throw new AppError('Los documentos los abre quien gestiona esta apostilla', 403, 'NO_ES_TUYA');
    const { buffer } = await getLocal(doc.clave);
    res.setHeader('Content-Type', doc.mime || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.nombre)}"`);
    res.send(buffer);
  } catch (err) { next(err); }
}

export async function verAjustes(req, res, next) {
  try {
    res.json({ success: true, data: await model.ajustes(await service.campusQueVe(req)) });
  } catch (err) { next(err); }
}

export async function guardarAjustes(req, res, next) {
  try {
    const d = parsear(ajustesSchema, req.body);
    await service.exigirCampus(req, d.projectId);
    await model.guardarAjustes(d.projectId, d.diasAviso, req.user.userId);
    res.json({ success: true, data: await model.ajustes([d.projectId]) });
  } catch (err) { next(err); }
}

