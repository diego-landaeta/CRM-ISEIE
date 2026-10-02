import crypto from 'crypto';
import * as model from './matricula.model.js';
import { createSchema, updateSchema, setEstadoSchema } from './matricula.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { urlFirmada, firmaValida } from '../../shared/utils/firmaDeDocumento.js';

export async function list(req, res, next) {
  try {
    const projectId = parseInt(req.query.projectId);
    if (!projectId) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
    const data = await model.findAll({
      projectId,
      estado: req.query.estado,
      search: req.query.search,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
    });
    const stats = await model.getStats(projectId);
    res.json({ success: true, data: data.matriculas.map(conDocumentosFirmados), pagination: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages }, stats });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: conDocumentosFirmados(m) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    if (parsed.data.conversion_id) {
      const exists = await model.findByConversion(parsed.data.conversion_id);
      if (exists) throw new AppError('Ya existe matricula para esta conversion', 409, 'DUPLICATE');
    }
    const created = await model.create(parsed.data);
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    const updated = await model.update(parseInt(req.params.id), parsed.data);
    if (!updated) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: conDocumentosFirmados(updated) });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    if (m.dni_doc_key) { try { await deleteLocal(m.dni_doc_key); } catch {} }
    if (m.titulo_doc_key) { try { await deleteLocal(m.titulo_doc_key); } catch {} }
    if (m.firma_key) { try { await deleteLocal(m.firma_key); } catch {} }
    await model.remove(m.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function setEstado(req, res, next) {
  try {
    const parsed = setEstadoSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    if (parsed.data.estado === 'rechazada' && !parsed.data.motivo_rechazo) {
      throw new AppError('motivo_rechazo requerido al rechazar', 400, 'MOTIVO_REQUIRED');
    }
    const updated = await model.setEstado(parseInt(req.params.id), parsed.data.estado, req.user.id, parsed.data.motivo_rechazo);
    if (!updated) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: conDocumentosFirmados(updated) });
  } catch (err) { next(err); }
}

const TIPOS_DOC = ['dni', 'titulo', 'firma'];

/**
 * Las direcciones de los documentos, FIRMADAS Y CON CADUCIDAD.
 *
 * La que se guarda en la base al subir --`/api/matriculas/7/doc/dni?v=…`-- no
 * puede llevar la firma: duraria para siempre, que es justo lo que se esta
 * arreglando. Asi que se firma AL LEER la ficha, y el enlace que llega a la
 * pantalla vale quince minutos.
 *
 * Solo se firma lo que ya existe: si la matricula no tiene documento, el campo
 * se queda como estaba --vacio-- y la pantalla enseña «Sin doc».
 */
function conDocumentosFirmados(m) {
  if (!m) return m;
  const campos = { dni: 'dni_doc_url', titulo: 'titulo_doc_url', firma: 'firma_url' };
  const claves = { dni: 'dni_doc_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
  const salida = { ...m };
  for (const tipo of TIPOS_DOC) {
    if (m[claves[tipo]]) salida[campos[tipo]] = urlFirmada(m.id, tipo);
  }
  return salida;
}

export async function uploadDoc(req, res, next) {
  try {
    const tipo = req.params.tipo;
    if (!TIPOS_DOC.includes(tipo)) throw new AppError('Tipo invalido', 400, 'INVALID_TYPE');
    if (!req.file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');
    const m = await model.findById(parseInt(req.params.id));
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyMap = { dni: 'dni_doc_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
    const urlMap = { dni: 'dni_doc_url', titulo: 'titulo_doc_url', firma: 'firma_url' };
    const oldKey = m[keyMap[tipo]];
    if (oldKey) { try { await deleteLocal(oldKey); } catch {} }
    const key = `matriculas/${m.project_id}/m-${m.id}-${tipo}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);
    const url = `/api/matriculas/${m.id}/doc/${tipo}?v=${Date.now()}`;
    const updated = await model.update(m.id, { [keyMap[tipo]]: key, [urlMap[tipo]]: url });
    // Firmada tambien aqui: la ficha pinta esta respuesta tal cual, y sin firma
    // «Ver documento» daria 403 justo despues de subirlo.
    res.json({ success: true, data: conDocumentosFirmados(updated) });
  } catch (err) { next(err); }
}

/**
 * Servir un documento de una matricula.
 *
 * ESTA RUTA VA FUERA DE `verifyToken` A PROPOSITO, y ahora si esta justificado:
 * el boton de la pantalla es un `<a href>`, y una etiqueta `<a>` no puede
 * mandar una cabecera `Authorization`. La credencial viaja en la direccion,
 * firmada y caducando a los quince minutos.
 *
 * Lo que habia antes era otra cosa: ni firma ni sesion, con el comentario «la
 * URL ya es no-guessable» al lado de una URL que es un entero correlativo. Se
 * bajaban DNI escaneados contando 1, 2, 3.
 */
export async function getDoc(req, res, next) {
  try {
    const tipo = req.params.tipo;
    if (!TIPOS_DOC.includes(tipo)) throw new AppError('Tipo invalido', 400, 'INVALID_TYPE');
    const id = parseInt(req.params.id);
    if (!firmaValida({ id, tipo, exp: req.query.exp, sig: req.query.sig })) {
      // El mismo 403 tanto si la firma falta, como si esta mal, como si ha
      // caducado: decir cual de las tres es ayuda a quien lo esta probando.
      throw new AppError('Enlace no valido o caducado', 403, 'FIRMA_INVALIDA');
    }
    const m = await model.findById(id);
    const keyMap = { dni: 'dni_doc_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
    if (!m || !m[keyMap[tipo]]) return res.status(404).end();
    const ext = m[keyMap[tipo]].split('.').pop().toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg'));
    const { buffer } = await getLocal(m[keyMap[tipo]]);
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  } catch (err) { next(err); }
}
