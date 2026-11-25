import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { cursosDelCampus, MoodleError } from '../../shared/services/moodle.client.js';
import * as mcpModel from '../mcp/mcp.model.js';
import { credencialesMoodle, ErrorMoodle } from '../mcp/mcp.moodle.cliente.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';
import * as model from './moodle.cursosProducto.model.js';

/**
 * Productos y cursos de Moodle (CRM#957): unir cada producto del catálogo con su
 * curso de Moodle, campus a campus. Lo necesita la matrícula automática (#767):
 * sin esa unión no sabe en qué curso matricular a quien compra.
 *
 * Permiso propio, `moodle.cursos_producto` (admin y soporte de serie). Cada
 * persona trabaja en SUS campus, como en el panel de Moodle: uno ajeno es un 403
 * y un producto de otro campus, un 404.
 *
 * La lista de cursos se pide al Moodle del campus con `moodle.client`
 * (`cursosDelCampus`), por la conexión del plugin (Integraciones, la que usará la
 * matrícula en su fase 2) o, si el campus no la tiene, por la del panel de
 * Moodle (Moodle › Cursos y alumnos). Al unir, el curso se comprueba contra esa lista y
 * su nombre sale de Moodle, no de lo que mande el navegador.
 */

const num = z.coerce.number().int().positive();
const CACHE_MS = 2 * 60_000;
const cache = new Map(); // projectId → { hasta, cursos, via }

export const vaciarCacheCursosProducto = () => cache.clear();

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/** El campus de la ruta, si es de quien pregunta y es un campus (no una plataforma de IA). */
async function campusDe(req) {
  const { id } = validar(z.object({ id: num }), req.params);
  const user = await mcpModel.findUserById(req.user.userId);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  // `conPruebas`: aquí el campus se ha ELEGIDO (como en el resto de pantallas de un campus).
  const proyectos = await mcpModel.proyectosDeLaPersona(user, { conPruebas: true });
  const p = proyectos.find((x) => Number(x.id) === id);
  if (!p) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
  if (p.tipo === 'ia') throw new AppError('Las plataformas de IA no tienen Moodle', 400, 'NO_ES_CAMPUS');
  return { id, nombre: p.nombre };
}

/** La conexión con el Moodle del campus: la del plugin y, si no, la del panel. */
async function conexionDe(projectId) {
  const plugin = await conexionDelCampus(projectId);
  if (plugin && !plugin.error) return { conexion: plugin, via: 'plugin' };
  const panel = (await credencialesMoodle([projectId])).get(projectId);
  if (panel && !(panel instanceof ErrorMoodle)) return { conexion: panel, via: 'panel' };
  if (plugin?.error) throw new AppError(plugin.error, 502, 'MOODLE_NO_DISPONIBLE');
  if (panel instanceof ErrorMoodle) throw new AppError(`El Moodle del campus no se puede leer: ${panel.message}.`, 502, 'MOODLE_NO_DISPONIBLE');
  return null;
}

/** Los cursos del Moodle del campus (con caché corta). null = el campus no tiene Moodle conectado. */
async function cursosDe(projectId, { refrescar = false } = {}) {
  const guardado = cache.get(projectId);
  if (!refrescar && guardado && guardado.hasta > Date.now()) return guardado;
  const c = await conexionDe(projectId);
  if (!c) return null;
  let cursos;
  try {
    cursos = await cursosDelCampus(c.conexion);
  } catch (err) {
    if (err instanceof MoodleError) throw new AppError(err.message, 502, 'MOODLE_NO_DISPONIBLE');
    throw err;
  }
  cursos.sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
  const r = { hasta: Date.now() + CACHE_MS, cursos, via: c.via };
  cache.set(projectId, r);
  return r;
}

/** GET /api/moodle/campus/:id/productos-cursos — los productos del campus con su curso. */
export async function productos(req, res, next) {
  try {
    const campus = await campusDe(req);
    const filas = await model.productosDelCampus(campus.id);
    const sinCurso = filas.filter((p) => !p.cursos.length);
    res.json({
      success: true,
      data: {
        campus,
        productos: filas,
        resumen: {
          total: filas.length,
          con_curso: filas.length - sinCurso.length,
          sin_curso: sinCurso.length,
          // Los que importan ya: vendidos y sin curso, la matrícula automática no puede con ellos.
          vendidos_sin_curso: sinCurso.filter((p) => p.ventas > 0).length,
        },
      },
    });
  } catch (err) { next(err); }
}

/** GET /api/moodle/campus/:id/cursos-moodle?refrescar=1 — los cursos de su Moodle, para elegir. */
export async function cursosMoodle(req, res, next) {
  try {
    const campus = await campusDe(req);
    const r = await cursosDe(campus.id, { refrescar: req.query.refrescar === '1' });
    if (!r) {
      throw new AppError('Este campus no tiene su Moodle conectado: conéctalo en Integraciones (plugin del CRM) o en Moodle › Cursos y alumnos.', 409, 'MOODLE_SIN_CONECTAR');
    }
    res.json({ success: true, data: { cursos: r.cursos, via: r.via } });
  } catch (err) { next(err); }
}

const unirB = z.object({ curso_moodle_id: num });
const productoP = z.object({ id: num, productId: num });

/** PUT /api/moodle/campus/:id/productos/:productId/curso { curso_moodle_id } — une (o cambia) el curso. */
export async function unir(req, res, next) {
  try {
    const campus = await campusDe(req);
    const { productId } = validar(productoP, req.params);
    const { curso_moodle_id: cursoId } = validar(unirB, req.body);
    const producto = await model.productoDelCampus(productId, campus.id);
    if (!producto) throw new AppError('Ese producto no es de este campus', 404, 'NOT_FOUND');
    // El curso tiene que existir en ESTE Moodle: se mira la lista de verdad (la última, sin caché
    // si no está en la guardada: se acaba de crear en Moodle).
    let lista = await cursosDe(campus.id);
    if (!lista) throw new AppError('Este campus no tiene su Moodle conectado.', 409, 'MOODLE_SIN_CONECTAR');
    let curso = lista.cursos.find((c) => c.id === cursoId);
    if (!curso) {
      lista = await cursosDe(campus.id, { refrescar: true });
      curso = lista?.cursos.find((c) => c.id === cursoId);
    }
    if (!curso) throw new AppError(`El Moodle de ${campus.nombre} no tiene el curso ${cursoId}`, 404, 'CURSO_NO_EXISTE');
    const r = await model.unir({
      productId, projectId: campus.id, curso: { id: curso.id, nombre: curso.nombre }, userId: req.user.userId, ip: req.ip,
    });
    res.json({ success: true, data: { product_id: productId, ...r } });
  } catch (err) { next(err); }
}

/** DELETE /api/moodle/campus/:id/productos/:productId/curso — el producto se queda sin curso. */
export async function quitar(req, res, next) {
  try {
    const campus = await campusDe(req);
    const { productId } = validar(productoP, req.params);
    const producto = await model.productoDelCampus(productId, campus.id);
    if (!producto) throw new AppError('Ese producto no es de este campus', 404, 'NOT_FOUND');
    const antes = await model.quitar({ productId, projectId: campus.id, userId: req.user.userId, ip: req.ip });
    res.json({ success: true, data: { product_id: productId, quitados: antes.length } });
  } catch (err) { next(err); }
}
