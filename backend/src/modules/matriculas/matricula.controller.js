import crypto from 'crypto';
import * as model from './matricula.model.js';
import { createSchema, updateSchema, setEstadoSchema } from './matricula.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { urlFirmada, firmaValida } from '../../shared/utils/firmaDeDocumento.js';
import { proyectosDelAmbito, veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';

/**
 * Los documentos de una matrícula y sus columnas. Los cinco de Diego (#199):
 * «DNI por las dos caras, foto, título, firma» (el DNI de detrás y la foto,
 * desde la migración 212).
 */
const TIPOS_DOC = ['dni', 'dni_dorso', 'foto', 'titulo', 'firma'];
const CLAVE = { dni: 'dni_doc_key', dni_dorso: 'dni_dorso_key', foto: 'foto_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
const URL_DOC = { dni: 'dni_doc_url', dni_dorso: 'dni_dorso_url', foto: 'foto_url', titulo: 'titulo_doc_url', firma: 'firma_url' };

/**
 * La ficha tal como la pinta la pantalla: con su prospecto, sus documentos
 * firmados y su historial (#199). Todas las respuestas de la ficha (abrirla,
 * guardar, cambiar el estado, subir un documento) devuelven esto: la pantalla
 * pinta la respuesta tal cual, y sin el historial se quedaba en «Sin
 * movimientos» después de subir un documento (prueba a mano del 15/10).
 */
async function fichaCompleta(id, yaLeida = null) {
  const m = yaLeida || await model.findById(id);
  return { ...conContrato(conDocumentosFirmados(m)), historial: await model.historial(id) };
}

/**
 * Los nombres del contrato de Diego para la lista y la ficha (#198, comentario del
 * 01/10): `persona { nombre, email, telefono }`, `proyecto` y `documento`. Se
 * añaden a los de siempre (`lead_*`, `campus_nombre`, `dni`), que la pantalla ya usa.
 */
function conContrato(m) {
  if (!m) return m;
  return {
    ...m,
    persona: { nombre: m.lead_nombre ?? null, email: m.lead_email ?? null, telefono: m.lead_telefono ?? null },
    proyecto: m.campus_nombre ?? null,
    documento: m.dni ?? null,
  };
}

/**
 * Una fila de la lista: sin `datos_admision`, que en el contrato va solo en la
 * ficha. Es el envío entero tal cual llegó y puede traer imágenes en texto (la
 * firma de Elementor): en la lista serían megas que nadie mira.
 */
function filaDeLaLista(m) {
  const { datos_admision: _enLaFicha, ...fila } = conContrato(conQueDocumentos(conDocumentosFirmados(m)));
  return fila;
}

/** ¿Es este campus de quien hace la petición? Super admin y soporte, todos (`veTodoElCrm`). */
async function esDeMiAmbito(req, projectId) {
  if (veTodoElCrm(req.user)) return true;
  return (await campusDeLaPersona(req.user?.userId)).includes(Number(projectId));
}

/**
 * La matrícula, si es de un campus de quien la pide (#199, como el resto del
 * CRM). Antes, sabiendo el número, se abría, se validaba o se le subía un
 * documento a una de otro campus.
 */
async function matriculaDeMiAmbito(req) {
  const m = await model.findById(parseInt(req.params.id));
  if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
  if (!(await esDeMiAmbito(req, m.project_id))) throw new AppError('No tienes acceso a esa matrícula', 403, 'FORBIDDEN');
  return m;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function list(req, res, next) {
  try {
    // Un campus, una empresa (issuerId) o «Todos», siempre dentro de los campus
    // de quien mira (#199, como el resto del CRM).
    const ambito = await proyectosDelAmbito(req);
    const fecha = (v) => (FECHA.test(v || '') ? v : undefined);
    // Las cuatro a la vez: no dependen unas de otras.
    const [data, stats, cursos, campus] = await Promise.all([
      model.findAll({
        ...ambito,
        estado: req.query.estado,
        // Los filtros de Diego (#199): campus, curso y fechas (AAAA-MM-DD).
        campusId: parseInt(req.query.campusId) || undefined,
        curso: typeof req.query.curso === 'string' && req.query.curso.trim() ? req.query.curso.trim() : undefined,
        desde: fecha(req.query.desde),
        hasta: fecha(req.query.hasta),
        search: req.query.search,
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 50,
      }),
      // Las cifras, del ámbito y, si se filtra uno, de ese campus (que cuadren con la lista).
      model.getStats({ ...ambito, campusId: parseInt(req.query.campusId) || null }),
      // Los cursos y los campus del ámbito, para los desplegables de los filtros.
      model.getCursos(ambito),
      model.getCampus(ambito),
    ]);
    res.json({ success: true, data: data.matriculas.map(filaDeLaLista), pagination: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages }, stats, cursos, campus });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const m = await matriculaDeMiAmbito(req);
    // Con su historial (#199): la llegada y cada cambio, con quién y cuándo.
    res.json({ success: true, data: await fichaCompleta(m.id, m) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    // Crear, también solo en tus campus (como abrirla, validarla o subirle algo).
    if (!(await esDeMiAmbito(req, parsed.data.project_id))) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
    if (parsed.data.conversion_id) {
      const exists = await model.findByConversion(parsed.data.conversion_id);
      if (exists) throw new AppError('Ya existe matricula para esta conversion', 409, 'DUPLICATE');
    }
    const created = await model.create({ ...parsed.data, user_id: req.user?.userId || null });
    res.status(201).json({ success: true, data: created });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Datos invalidos', 400, 'VALIDATION_ERROR');
    await matriculaDeMiAmbito(req);
    const updated = await model.update(parseInt(req.params.id), parsed.data);
    if (!updated) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: await fichaCompleta(updated.id) });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const m = await matriculaDeMiAmbito(req);
    for (const tipo of TIPOS_DOC) {
      if (m[CLAVE[tipo]]) { try { await deleteLocal(m[CLAVE[tipo]]); } catch {} }
    }
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
    await matriculaDeMiAmbito(req);
    // El cambio y su línea del historial, juntos o ninguno: el estado nuevo,
    // quién y, si es un rechazo, el motivo (#199).
    const updated = await model.conTransaccion(async (db) => {
      const fila = await model.setEstado(parseInt(req.params.id), parsed.data.estado, req.user.userId, parsed.data.motivo_rechazo, db);
      if (!fila) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
      await model.registrarEvento({
        matriculaId: fila.id, evento: 'estado', estado: parsed.data.estado,
        motivo: parsed.data.estado === 'rechazada' ? parsed.data.motivo_rechazo : null, userId: req.user.userId, db,
      });
      return fila;
    });
    res.json({ success: true, data: await fichaCompleta(updated.id) });
  } catch (err) { next(err); }
}

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
  const campos = URL_DOC;
  const claves = CLAVE;
  const salida = { ...m };
  // Si cada documento es un PDF o una imagen, para que la ficha sepa con qué
  // visor abrirlo (#199). Sale de la extensión con la que se guardó.
  const formatos = {};
  for (const tipo of TIPOS_DOC) {
    if (m[claves[tipo]]) {
      salida[campos[tipo]] = urlFirmada(m.id, tipo);
      formatos[tipo] = /\.pdf$/i.test(m[claves[tipo]]) ? 'pdf' : 'imagen';
    }
  }
  salida.documentos_formato = formatos;
  return salida;
}

/**
 * Qué documentos han llegado, sí o no, para los iconos de la lista (#199): los
 * cinco de Diego, con los nombres del contrato de la #198.
 */
function conQueDocumentos(m) {
  if (!m) return m;
  return {
    ...m,
    documentos: {
      dni_frente: !!m.dni_doc_key, dni_dorso: !!m.dni_dorso_key, foto: !!m.foto_key,
      titulo: !!m.titulo_doc_key, firma: !!m.firma_key,
    },
  };
}

export async function uploadDoc(req, res, next) {
  try {
    const tipo = req.params.tipo;
    if (!TIPOS_DOC.includes(tipo)) throw new AppError('Tipo invalido', 400, 'INVALID_TYPE');
    if (!req.file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');
    const m = await matriculaDeMiAmbito(req);
    const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const keyMap = CLAVE;
    const urlMap = URL_DOC;
    const oldKey = m[keyMap[tipo]];
    const key = `matriculas/${m.project_id}/m-${m.id}-${tipo}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
    await saveLocal(key, req.file.buffer);
    const url = `/api/matriculas/${m.id}/doc/${tipo}?v=${Date.now()}`;
    // El documento y su línea del historial (qué documento y si sustituye a otro), juntos (#199).
    let updated;
    try {
      updated = await model.conTransaccion(async (db) => {
        const fila = await model.update(m.id, { [keyMap[tipo]]: key, [urlMap[tipo]]: url }, db);
        await model.registrarEvento({ matriculaId: m.id, evento: 'documento', documento: tipo, reemplazo: !!oldKey, userId: req.user?.userId || null, db });
        return fila;
      });
    } catch (err) {
      // No ha quedado apuntado: fuera el archivo nuevo, y el viejo sigue valiendo.
      try { await deleteLocal(key); } catch {}
      throw err;
    }
    // El viejo se borra solo cuando el nuevo ya está apuntado (antes se borraba
    // primero, y si fallaba el guardado se perdía el documento).
    if (oldKey) { try { await deleteLocal(oldKey); } catch {} }
    // Firmada tambien aqui: la ficha pinta esta respuesta tal cual, y sin firma
    // «Ver documento» daria 403 justo despues de subirlo.
    // Releída con su prospecto: la ficha pinta esta respuesta tal cual, y sin el
    // JOIN se quedaba sin nombre después de subir (#199).
    res.json({ success: true, data: await fichaCompleta(updated.id) });
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
    const keyMap = CLAVE;
    if (!m || !m[keyMap[tipo]]) return res.status(404).end();
    const ext = m[keyMap[tipo]].split('.').pop().toLowerCase();
    const mime = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg'));
    const { buffer } = await getLocal(m[keyMap[tipo]]);
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  } catch (err) { next(err); }
}
