import * as model from './incidencias.model.js';
import * as service from './incidencias.service.js';
import {
  crearSchema, editarSchema, listarSchema, metricasSchema,
} from './incidencias.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, getLocal } from '../../shared/services/localStorage.service.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';

/** Los adjuntos de una incidencia, como mucho (el mismo número que la pantalla). */
const MAX_ADJUNTOS = 5;

/**
 * El id de la URL: un entero positivo que cabe en INTEGER. Cualquier otra cosa
 * es un 404, como un id que no existe (mismo criterio que Soporte).
 */
function idDe(valor, que = 'Incidencia') {
  const s = String(valor ?? '');
  const n = /^\d{1,10}$/.test(s) ? Number(s) : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) {
    throw new AppError(`${que} no encontrada`, 404, 'NOT_FOUND');
  }
  return n;
}

/**
 * El nombre del fichero tal como se escribió. multer lo lee como Latin-1:
 * «año.png» llegaba como «aÃ±o.png», y «informe—final», un nombre en chino o
 * la tilde suelta de los ficheros de un Mac, igual. Se vuelve a leer como
 * UTF-8 siempre (el `enUtf8` de WhatsApp solo lo hace si ve «Ã»), salvo que ya
 * traiga caracteres de fuera de Latin-1 o que la vuelta no cuadre. Y en NFC,
 * para que la «é» de un Mac sea la misma que la de Windows.
 */
function nombreDelFichero(original) {
  const s = String(original || '');
  if (!s) return 'archivo';
  if ([...s].some((c) => c.codePointAt(0) > 0xff)) return s.normalize('NFC');
  const u = Buffer.from(s, 'latin1').toString('utf8');
  return (u.includes('�') ? s : u).normalize('NFC');
}

/**
 * El nombre del fichero cabe en `VARCHAR(255)`: uno más largo salía como un
 * 500. Se recorta por el medio y se conserva la extensión.
 */
function nombreQueCabe(nombre) {
  if (nombre.length <= 255) return nombre;
  const punto = nombre.lastIndexOf('.');
  const ext = punto > 0 && nombre.length - punto <= 10 ? nombre.slice(punto) : '';
  return nombre.slice(0, 255 - ext.length) + ext;
}

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/**
 * El enlace de «sobre qué» de una factura o un usuario (`model.ponerDestinos`),
 * con los campus de quien mira: superadmin y soporte, todo; el resto, los suyos.
 */
async function conDestinos(req, incidencias) {
  const projectIds = veTodoElCrm(req.user) ? null : await campusDeLaPersona(req.user.userId);
  // El nombre, solo a quien puede abrir Usuarios: a una gestora el enlace la
  // llevaría a una pestaña que no puede usar (Ctrl K tampoco se los ofrece).
  const conNombres = await tienePermiso(req, 'users.view');
  return model.ponerDestinos(incidencias, projectIds, req.user.userId, { conNombres });
}

export async function listar(req, res, next) {
  try {
    const f = parsear(listarSchema, req.query);
    // El recorte lo pone el servidor, no la pantalla: una gestora que escriba
    // la direccion a mano sigue viendo solo las suyas.
    const data = await model.listar({ ...f, alcance: await service.alcanceDe(req) });
    await conDestinos(req, data.incidencias);
    res.json({
      success: true,
      data: data.incidencias,
      pagination: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  } catch (err) { next(err); }
}

export async function metricas(req, res, next) {
  try {
    const f = parsear(metricasSchema, req.query);
    res.json({ success: true, data: await model.metricas({ ...f, alcance: await service.alcanceDe(req) }) });
  } catch (err) { next(err); }
}

/**
 * Para «quién la causó, la detectó o la arregló»: solo las personas que el
 * servidor acepta al guardar. La lista de Usuarios no se recorta por campus, y
 * con ella un admin elegía a alguien de otra empresa y le salía un error.
 */
export async function personas(req, res, next) {
  try {
    const alcance = await service.alcanceDe(req);
    const projectIds = alcance === null ? null : (alcance.projectIds || []);
    res.json({ success: true, data: await model.personas(projectIds, req.user.userId) });
  } catch (err) { next(err); }
}

export async function porId(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const inc = await service.exigirAcceso(req, id);
    inc.adjuntos = await model.adjuntosDe(id);
    await conDestinos(req, inc);
    res.json({ success: true, data: inc });
  } catch (err) { next(err); }
}

export async function crear(req, res, next) {
  try {
    const d = parsear(crearSchema, req.body);
    await service.comprobarReferencias(req, d);
    // Quien la detecto, si no se dice, es quien la apunta. Un `null` a
    // proposito («Nadie del CRM») se respeta: la detecto alguien de fuera.
    const detectadaPor = d.detectadaPor === undefined ? req.user.userId : d.detectadaPor;
    const inc = await model.crear({ ...d, detectadaPor }, req.user.userId);
    await conDestinos(req, inc);
    res.status(201).json({ success: true, data: inc });
  } catch (err) { next(err); }
}

export async function editar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const actual = await service.exigirAcceso(req, id);
    const d = parsear(editarSchema, req.body);
    await service.comprobarReferencias(req, d, actual);
    const inc = await model.editar(id, d);
    if (!inc) throw new AppError('Incidencia no encontrada', 404, 'NOT_FOUND');
    inc.adjuntos = await model.adjuntosDe(id);
    await conDestinos(req, inc);
    res.json({ success: true, data: inc });
  } catch (err) { next(err); }
}

export async function subirAdjunto(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await service.exigirAcceso(req, id);
    if (!req.file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');
    // El mismo tope que la pantalla: sin él, por la API entraban los que fueran.
    if ((await model.adjuntosDe(id)).length >= MAX_ADJUNTOS) {
      throw new AppError(`Máximo ${MAX_ADJUNTOS} adjuntos por incidencia`, 400, 'DEMASIADOS_ADJUNTOS');
    }

    const ext = (req.file.originalname.split('.').pop() || 'bin')
      .toLowerCase().replace(/[^a-z0-9]/g, '');
    const azar = Math.random().toString(36).slice(2, 10);
    const clave = `incidencias/${id}/a-${Date.now()}-${azar}.${ext}`;
    await saveLocal(clave, req.file.buffer);

    const a = await model.guardarAdjunto({
      incidenciaId: id, nombre: nombreQueCabe(nombreDelFichero(req.file.originalname)),
      clave, mime: req.file.mimetype, bytes: req.file.size, subidoPor: req.user.userId,
    });
    res.status(201).json({ success: true, data: a });
  } catch (err) { next(err); }
}

/**
 * Descargar un adjunto: con sesion y comprobando que la incidencia es de su
 * alcance. Una captura de una incidencia puede llevar datos de un alumno.
 */
export async function descargarAdjunto(req, res, next) {
  try {
    const a = await model.adjuntoPorId(idDe(req.params.adjuntoId, 'Adjunto'));
    if (!a) throw new AppError('Adjunto no encontrado', 404, 'NOT_FOUND');
    try {
      await service.exigirAcceso(req, a.incidencia_id);
    } catch {
      throw new AppError('Adjunto no encontrado', 404, 'NOT_FOUND');
    }
    const { buffer } = await getLocal(a.clave);
    res.setHeader('Content-Type', a.mime || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.nombre)}"`);
    res.send(buffer);
  } catch (err) { next(err); }
}
