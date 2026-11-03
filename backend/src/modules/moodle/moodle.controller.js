import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as mcpModel from '../mcp/mcp.model.js';
import { construirAmbito } from '../mcp/mcp.acceso.js';
import { campusConMoodle, credencialesMoodle, ErrorMoodle, FUNCIONES_MOODLE, normalizarUrlMoodle } from '../mcp/mcp.moodle.cliente.js';
import * as moodle from '../mcp/mcp.moodle.js';
import * as credenciales from '../credentials/credentials.model.js';
import { anotar, ACCIONES } from '../credentials/credentials.registro.js';
import { probarConexion } from './moodle.conexion.js';

/**
 * El panel de Moodle del CRM (#335): lo mismo que Claude puede preguntar por el MCP,
 * para verlo en pantalla. Solo lectura, solo super admin y admin, y con las mismas reglas
 * por campus que el MCP: cada persona ve los Moodle de SUS campus; uno ajeno es un 403.
 *
 * No hay lógica nueva de Moodle aquí: se llama a las mismas funciones del MCP
 * (`mcp.moodle.js`), que ya hablan con cada Moodle, guardan la caché y dicen «este campus
 * no responde» en vez de dar un cero. El token de Moodle no sale nunca de la base.
 */

const TOPE_MS = 25_000;
const num = z.coerce.number().int().positive();
const ESTADOS = ['activos', 'proximos', 'terminados', 'ocultos', 'todos'];
const refrescar = (q) => q.refrescar === '1';

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/** El ámbito de quien pregunta: sus campus, igual que en el MCP. */
async function ambitoDe(req) {
  const user = await mcpModel.findUserById(req.user.userId);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  // Un campus es un proyecto de educación: las plataformas de IA (tipo «ia») no tienen Moodle.
  const proyectos = (await mcpModel.proyectosDeLaPersona(user)).filter((p) => p.tipo !== 'ia');
  return construirAmbito(user, proyectos);
}

const conTope = (trabajo) => trabajo({ signal: AbortSignal.timeout(TOPE_MS) });

const campusQ = z.object({ proyecto_id: num });
const cursosQ = campusQ.extend({
  estado: z.enum(ESTADOS).default('activos'),
  texto: z.string().max(100).optional(),
  categoria_id: num.optional(),
  orden: z.enum(['nombre', 'inicio', 'fin', 'categoria']).default('nombre'),
  sentido: z.enum(['asc', 'desc']).default('asc'),
  pagina: num.default(1),
  limite: z.coerce.number().int().min(1).max(100).default(25),
});
const cursoP = z.object({ id: num });

/**
 * GET /api/moodle/campus — cada campus, si tiene Moodle conectado y cómo está.
 * Con `?proyecto_id=` solo ese campus (la pantalla de un campus no necesita preguntarle
 * a los demás Moodle); uno que no es suyo es un 403.
 */
export async function campus(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { proyecto_id: elegido } = validar(z.object({ proyecto_id: num.optional() }), req.query);
    const proyectos = elegido ? ambito.proyectos.filter((p) => Number(p.id) === elegido) : ambito.proyectos;
    if (elegido && !proyectos.length) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
    const con = await campusConMoodle(proyectos.map((p) => Number(p.id)));
    const filas = await Promise.all(proyectos.map(async (p) => {
      const base = { id: Number(p.id), nombre: p.nombre, configurado: con.has(Number(p.id)) };
      if (!base.configurado) return base;
      try {
        const r = await conTope((o) => moodle.moodleCursos(ambito, { proyecto_id: p.id, estado: 'todos', limite: 1, con_alumnos: false, refrescar: refrescar(req.query) }, o));
        const c = r.por_campus[0];
        return { ...base, cursos: { total: c.cursos_en_moodle, activos: c.activos, proximos: c.proximos, terminados: c.terminados, ocultos: c.ocultos } };
      } catch (err) {
        // Un campus caído se dice; no tumba el panel de los demás.
        return { ...base, error: err.message };
      }
    }));
    // Primero los conectados, luego el resto, cada grupo por nombre.
    filas.sort((a, b) => Number(b.configurado) - Number(a.configurado) || a.nombre.localeCompare(b.nombre));
    // `funciones`: las que tiene que tener el servicio del token (la pantalla las enseña al conectar).
    res.json({ success: true, data: { campus: filas, funciones: FUNCIONES_MOODLE } });
  } catch (err) { next(err); }
}

/** GET /api/moodle/cursos?proyecto_id=&estado=&texto=&categoria_id=&pagina=&limite= */
export async function cursos(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const q = validar(cursosQ, req.query);
    const r = await conTope((o) => moodle.moodleCursos(ambito, { ...q, refrescar: refrescar(req.query) }, o));
    res.json({ success: true, data: { total: r.total, pagina: r.pagina, limite: r.limite, cursos: r.cursos, resumen: r.por_campus[0] } });
  } catch (err) { next(err); }
}

/**
 * GET /api/moodle/campus/:id/revision — los cursos activos que conviene mirar: sin alumnos, dormidos,
 * o con alumnos que nunca han entrado. Por tandas: mientras `pendientes` > 0, la pantalla vuelve a pedirla.
 */
export async function revision(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(z.object({ id: num }), req.params);
    campusPropio(ambito, id);
    const r = await conTope((o) => moodle.revisarCampus(ambito, { proyecto_id: id, refrescar: refrescar(req.query) }, o));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

/** GET /api/moodle/categorias?proyecto_id= */
export async function categorias(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const q = validar(campusQ, req.query);
    const r = await conTope((o) => moodle.moodleEstructura(ambito, { ...q, refrescar: refrescar(req.query) }, o));
    res.json({ success: true, data: { categorias: r.campus[0]?.categorias ?? [] } });
  } catch (err) { next(err); }
}

/** GET /api/moodle/cursos/:id/alumnos?proyecto_id= — los recuentos de un curso (sin nombres ni correos). */
export async function alumnos(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(cursoP, req.params);
    const q = validar(campusQ, req.query);
    const r = await conTope((o) => moodle.moodleAlumnos(ambito, { ...q, curso_id: id, terminados: true, refrescar: refrescar(req.query) }, o));
    const curso = r.cursos[0];
    if (!curso) throw new AppError('Curso no encontrado', 404, 'NOT_FOUND');
    if (curso.error) throw new AppError(curso.error, 502, 'MOODLE_NO_DISPONIBLE');
    res.json({ success: true, data: curso });
  } catch (err) { next(err); }
}

/** GET /api/moodle/cursos/:id/estructura?proyecto_id= — secciones y actividades. */
export async function estructura(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(cursoP, req.params);
    const q = validar(campusQ, req.query);
    const r = await conTope((o) => moodle.moodleEstructura(ambito, { ...q, curso_id: id, refrescar: refrescar(req.query) }, o));
    res.json({ success: true, data: r.campus[0] });
  } catch (err) { next(err); }
}

/** GET /api/moodle/cursos/:id/recursos?proyecto_id=&comprobar=1 — recursos externos, y si responden. */
export async function recursos(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(cursoP, req.params);
    const q = validar(campusQ, req.query);
    const r = await conTope((o) => moodle.moodleRecursosExternos(ambito, { ...q, curso_id: id, comprobar_enlaces: req.query.comprobar === '1', refrescar: refrescar(req.query) }, o));
    const curso = r.cursos[0];
    if (!curso) throw new AppError('Curso no encontrado', 404, 'NOT_FOUND');
    if (curso.error) throw new AppError(curso.error, 502, 'MOODLE_NO_DISPONIBLE');
    res.json({ success: true, data: { ...curso, resumen: r.resumen } });
  } catch (err) { next(err); }
}

// ─── Conectar el Moodle de un campus (solo super admin) ──────────────────────

const conexionB = z.object({
  // Sin dirección se reutiliza la ya guardada: así se cambia solo el token.
  url: z.string().trim().max(300).optional(),
  token: z.string().trim().min(8, 'Escribe el token').max(200),
});

/** El campus ha de ser de quien lo pide: uno ajeno es un 403, como en las lecturas. */
function campusPropio(ambito, id) {
  if (!ambito.proyectos.some((p) => Number(p.id) === id)) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
}

/**
 * POST /api/moodle/campus/:id/conexion { url?, token } — conecta (o cambia) el Moodle de un campus.
 * Sin `url` se reutiliza la guardada, para cambiar solo el token.
 *
 * Primero PRUEBA contra el Moodle; si no vale, no se guarda nada y se dice por qué. Si vale,
 * se guarda cifrado (el mismo sitio que Configuración → Claves, servicio «moodle») y se
 * contesta cuántos cursos hay y qué funciones le faltan al token. Queda anotado en el
 * registro de claves, sin el valor.
 */
export async function conectar(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(z.object({ id: num }), req.params);
    campusPropio(ambito, id);
    const b = validar(conexionB, req.body);
    let url;
    if (b.url) {
      url = normalizarUrlMoodle(b.url);
      if (!url) {
        throw new AppError('La dirección del Moodle no es válida: tiene que empezar por https:// y no llevar usuario ni contraseña.', 400, 'VALIDATION_ERROR');
      }
    } else {
      // Cambiar solo el token: la dirección es la que ya había.
      const guardada = (await credencialesMoodle([id])).get(id);
      if (!guardada || guardada instanceof ErrorMoodle) {
        throw new AppError('Escribe la dirección de su Moodle.', 400, 'VALIDATION_ERROR');
      }
      url = guardada.url;
    }

    let prueba;
    try {
      prueba = await conTope((o) => probarConexion({ url, token: b.token }, o));
    } catch (err) {
      if (err instanceof ErrorMoodle) throw new AppError(`No se pudo conectar: ${err.message}.`, 400, 'MOODLE_NO_CONECTA');
      throw err;
    }

    const previas = await credenciales.list({ projectId: id, service: 'moodle' });
    const cred = await credenciales.upsert({
      project_id: id, service: 'moodle', entorno: 'produccion', userId: req.user.userId,
      value: JSON.stringify({ url, token: b.token }),
    });
    await anotar(req, previas.length ? ACCIONES.CAMBIAR : ACCIONES.CREAR, { id: cred.id, servicio: 'moodle', projectId: id, entorno: 'produccion' });
    moodle.vaciarCacheMoodle();
    res.status(201).json({ success: true, data: prueba });
  } catch (err) { next(err); }
}

/** DELETE /api/moodle/campus/:id/conexion — desconecta el Moodle de un campus. */
export async function desconectar(req, res, next) {
  try {
    const ambito = await ambitoDe(req);
    const { id } = validar(z.object({ id: num }), req.params);
    campusPropio(ambito, id);
    const previas = await credenciales.list({ projectId: id, service: 'moodle' });
    for (const c of previas) {
      await credenciales.remove(c.id);
      await anotar(req, ACCIONES.BORRAR, { id: c.id, servicio: 'moodle', projectId: id, entorno: c.metadata?.entorno ?? 'produccion' });
    }
    moodle.vaciarCacheMoodle();
    res.json({ success: true, data: { desconectados: previas.length } });
  } catch (err) { next(err); }
}
