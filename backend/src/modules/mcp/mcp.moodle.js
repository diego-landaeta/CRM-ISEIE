import crypto from 'node:crypto';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { acotarProyectos } from './mcp.acceso.js';
import { enteroEnv } from './mcp.config.js';
import { credencialesMoodle, llamarMoodle, ErrorMoodle } from './mcp.moodle.cliente.js';
import {
  comprobarEnlace, extraerUrls, limiteEnlaces, mapConLimite, tipoDeEnlace,
} from './mcp.moodle.enlaces.js';

/**
 * Lo que Claude puede preguntarle al Moodle de cada campus (#335).
 *
 * Solo lectura (ver `mcp.moodle.cliente.js`), y con las mismas reglas que el
 * resto del MCP:
 *
 *   · `acotarProyectos`: el campus lo marca la persona; uno ajeno es un 403.
 *   · NUNCA un cero que sea en realidad «no he podido mirar». Un campus sin
 *     Moodle configurado, con el token caducado o que no responde se DICE, por
 *     campus, en `campus_con_error`. Si piden varios y falla uno, el resto
 *     contesta. Si fallan todos, es un error de la herramienta.
 *   · Alumnos: por defecto solo RECUENTOS. Nombre y correo, solo con
 *     `datos_completos` y solo super admin y admin (queda en la auditoria).
 *
 * Sin un Moodle real delante: ver la cabecera de `mcp.moodle.cliente.js`.
 */

const MAX_CAMPUS_A_LA_VEZ = 3;
const MAX_CURSOS_A_LA_VEZ = 3;
const MAX_COMPLETION_A_LA_VEZ = 5;
const POR_PAGINA_MOODLE = 500;
const SEGUNDOS_DIA = 86400;

/** Hasta cuantos alumnos de UN curso se leen (MCP_MOODLE_MAX_ALUMNOS, 5000). */
const maxAlumnos = () => enteroEnv('MCP_MOODLE_MAX_ALUMNOS', 5000);

// ─── Cache de la lista de cursos ──────────────────────────────────────────
//
// Pedir los cursos de un Moodle son un par de segundos y casi nunca cambian:
// se guardan en memoria unos minutos (MCP_MOODLE_CACHE_MIN, 5; 0 = sin cache).
// Con tope de entradas (MCP_MOODLE_CACHE_MAX, 50): al pasarse se tira la mas
// antigua. La clave lleva una huella de URL+token: si se cambia la credencial,
// la cache vieja deja de valer sola. Solo se guardan cursos y categorias, nada
// de personas. `refrescar: true` se la salta.

const cache = new Map();
const ttlMs = () => enteroEnv('MCP_MOODLE_CACHE_MIN', 5, { cero: true }) * 60_000;
const maxEntradasCache = () => enteroEnv('MCP_MOODLE_CACHE_MAX', 50);

export const vaciarCacheMoodle = () => { cache.clear(); revisiones.clear(); };
export const entradasEnCacheMoodle = () => cache.size;

const huellaDeCredencial = (cred) => crypto.createHash('sha256').update(`${cred.url}\0${cred.token}`).digest('hex').slice(0, 16);

async function conCache(clave, refrescar, cargar) {
  const ttl = ttlMs();
  const ahora = Date.now();
  if (ttl > 0 && !refrescar) {
    const e = cache.get(clave);
    if (e && ahora - e.en < ttl) return { datos: e.datos, deCache: true, hace_s: Math.round((ahora - e.en) / 1000) };
    if (e) cache.delete(clave);
  }
  const datos = await cargar();
  if (ttl > 0) {
    cache.delete(clave);
    cache.set(clave, { en: ahora, datos });
    while (cache.size > maxEntradasCache()) cache.delete(cache.keys().next().value);
  }
  return { datos, deCache: false, hace_s: 0 };
}

// ─── Cursos y categorias de un Moodle ─────────────────────────────────────

const fechaIso = (seg) => (Number(seg) > 0 ? new Date(Number(seg) * 1000).toISOString().slice(0, 10) : null);

/**
 * Los cursos del Moodle, ya normalizados (solo lo que hace falta; el resumen y
 * la descripcion de cada curso no se guardan). Los que ve el TOKEN: si no tiene
 * permiso para ver los ocultos, no salen.
 */
async function cargarCursos(cred, signal) {
  const r = await llamarMoodle(cred, 'core_course_get_courses_by_field', {}, { signal });
  if (!r || !Array.isArray(r.courses)) {
    throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió la lista de cursos con el formato esperado');
  }
  return r.courses
    .filter((c) => c && Number.isInteger(Number(c.id)) && c.format !== 'site')
    .map((c) => ({
      id: Number(c.id),
      nombre: String(c.displayname || c.fullname || c.shortname || `Curso ${c.id}`),
      nombre_corto: c.shortname ? String(c.shortname) : null,
      categoria_id: c.categoryid != null ? Number(c.categoryid) : null,
      categoria: c.categoryname ? String(c.categoryname) : null,
      inicio_s: Number(c.startdate) || 0,
      fin_s: Number(c.enddate) || 0,
      visible: c.visible === undefined ? true : Number(c.visible) === 1 || c.visible === true,
      finalizacion: Number(c.enablecompletion) === 1 || c.enablecompletion === true,
    }));
}

/** activo · proximo (aun no empieza) · terminado · oculto. */
export function estadoDelCurso(c, ahoraS = Math.floor(Date.now() / 1000)) {
  if (!c.visible) return 'oculto';
  if (c.fin_s && c.fin_s <= ahoraS) return 'terminado';
  if (c.inicio_s && c.inicio_s > ahoraS) return 'proximo';
  return 'activo';
}

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const ESTADOS = { activos: 'activo', proximos: 'proximo', terminados: 'terminado', ocultos: 'oculto' };

function filtrarCursos(cursos, { estado = 'activos', texto, categoria_id, categorias = null, curso_id } = {}, ahoraS) {
  if (curso_id != null) return cursos.filter((c) => c.id === Number(curso_id));
  const buscado = texto ? sinTildes(texto) : null;
  return cursos.filter((c) => {
    if (estado !== 'todos' && estadoDelCurso(c, ahoraS) !== ESTADOS[estado]) return false;
    // `categorias` = la pedida y todas las de dentro (los cursos cuelgan de subcategorias).
    if (categorias ? !categorias.has(c.categoria_id) : categoria_id != null && c.categoria_id !== Number(categoria_id)) return false;
    if (buscado && !sinTildes(`${c.nombre} ${c.nombre_corto || ''}`).includes(buscado)) return false;
    return true;
  });
}

/**
 * La categoria pedida y todas las de dentro. Una categoria que no existe es un
 * error claro, no «cero cursos».
 */
async function categoriasDe(campus, a, signal) {
  if (a.categoria_id == null) return null;
  const { datos } = await conCache(`categorias:${campus.id}:${huellaDeCredencial(campus.cred)}`, a.refrescar === true,
    () => cargarCategorias(campus.cred, signal));
  const id = Number(a.categoria_id);
  if (!datos.some((c) => c.id === id)) {
    throw new ErrorMoodle('categoria_no_encontrada', `la categoría ${id} no existe en ese Moodle (mira «moodle_estructura»)`);
  }
  const dentro = new Set([id]);
  for (let cambio = true; cambio;) {
    cambio = false;
    for (const c of datos) {
      if (c.padre_id && dentro.has(c.padre_id) && !dentro.has(c.id)) {
        dentro.add(c.id);
        cambio = true;
      }
    }
  }
  return dentro;
}

/** Cómo se pueden ordenar los cursos. Los que no tienen la fecha o la categoría van siempre al final. */
export const ORDENES_DE_CURSOS = ['nombre', 'inicio', 'fin', 'categoria'];

function comparadorDeCursos(orden = 'nombre', sentido = 'asc') {
  const dir = sentido === 'desc' ? -1 : 1;
  const porNombre = (x, y) => x.nombre.localeCompare(y.nombre);
  if (orden === 'nombre') return (x, y) => dir * porNombre(x, y);
  const campo = orden === 'categoria' ? 'categoria' : orden === 'fin' ? 'fin' : 'inicio';
  return (x, y) => {
    const vx = x[campo] ?? '';
    const vy = y[campo] ?? '';
    if (!vx && !vy) return porNombre(x, y);
    if (!vx) return 1; // sin dato: al final, ordene como ordene
    if (!vy) return -1;
    return dir * vx.localeCompare(vy) || porNombre(x, y);
  };
}

const filaDeCurso = (c, campus, ahoraS) => ({
  campus_id: campus.id,
  campus: campus.nombre,
  curso_id: c.id,
  nombre: c.nombre,
  nombre_corto: c.nombre_corto,
  categoria: c.categoria,
  estado: estadoDelCurso(c, ahoraS),
  visible: c.visible,
  inicio: fechaIso(c.inicio_s),
  fin: fechaIso(c.fin_s),
  finalizacion_activada: c.finalizacion,
});

async function cursosDelCampus(campus, refrescar, signal) {
  return conCache(`cursos:${campus.id}:${huellaDeCredencial(campus.cred)}`, refrescar, () => cargarCursos(campus.cred, signal));
}

// ─── Campus: credenciales y errores por campus ────────────────────────────

/** El mensaje de un campus que falla: siempre empieza por el nombre del campus. */
function errorDelCampus(err, campus) {
  if (err instanceof ErrorMoodle) {
    return { campus_id: campus.id, campus: campus.nombre, codigo: err.codigo, error: `${campus.nombre}: ${err.message}` };
  }
  // Algo nuestro (no de Moodle). Al log solo el nombre y el codigo: nada de
  // mensajes de la libreria de red, que pueden traer la URL.
  logger.error({ tipo: err?.name, code: err?.code, campusId: campus.id }, 'MCP Moodle: fallo inesperado');
  return { campus_id: campus.id, campus: campus.nombre, codigo: 'inesperado', error: `${campus.nombre}: error inesperado al consultar Moodle` };
}

/** Si TODOS los campus pedidos fallan, es un error de la herramienta, no un resultado. */
function todosFallaron(errores) {
  const sinConfigurar = errores.every((e) => e.codigo === 'sin_configurar');
  return new AppError(
    `No se pudo consultar Moodle. ${errores.map((e) => e.error).join('; ')}.`
    + (sinConfigurar ? ' (El Moodle de cada campus se conecta en el CRM → Conexión → Moodle.)' : ''),
    sinConfigurar ? 409 : 502,
    'MOODLE_NO_DISPONIBLE'
  );
}

/**
 * Corre `trabajo` en cada campus pedido, de a pocos, y separa lo que sale bien
 * de lo que falla. `trabajo({id, nombre, cred})` devuelve los datos del campus.
 */
async function porCampus(ambito, projectIds, trabajo) {
  const nombres = new Map(ambito.proyectos.map((p) => [Number(p.id), p.nombre]));
  const creds = await credencialesMoodle(projectIds);
  const salidas = await mapConLimite(projectIds, MAX_CAMPUS_A_LA_VEZ, async (id) => {
    const campus = { id, nombre: nombres.get(id) || `campus ${id}`, cred: creds.get(id) };
    try {
      if (!campus.cred) throw new ErrorMoodle('sin_configurar', 'sin Moodle configurado');
      if (campus.cred instanceof ErrorMoodle) throw campus.cred;
      return { campus, datos: await trabajo(campus) };
    } catch (err) {
      return { campus, error: errorDelCampus(err, campus) };
    }
  });
  const bien = salidas.filter((s) => !s.error);
  const errores = salidas.filter((s) => s.error).map((s) => s.error);
  if (!bien.length) throw todosFallaron(errores);
  return { bien, errores };
}

/**
 * El paso comun de alumnos y recursos: en cada campus, los cursos que encajan
 * con el filtro. Devuelve la lista PLANA de {campus, curso}, recortada a
 * `limite_cursos` entre todos los campus, y cuantos se quedaron fuera.
 */
async function elegirCursos(ambito, projectIds, a, signal) {
  if (a.curso_id != null && projectIds.length > 1) {
    throw new AppError(
      'Un curso es de un Moodle concreto: indica el campus con proyecto_id (los ids de curso se repiten entre campus).',
      400, 'MCP_FALTA_CAMPUS'
    );
  }
  const ahoraS = Math.floor(Date.now() / 1000);
  const { bien, errores } = await porCampus(ambito, projectIds, async (campus) => {
    const { datos } = await cursosDelCampus(campus, a.refrescar === true, signal);
    const categorias = await categoriasDe(campus, a, signal);
    const elegidos = filtrarCursos(datos, { ...a, categorias }, ahoraS);
    if (a.curso_id != null && !elegidos.length) {
      throw new ErrorMoodle('curso_no_encontrado',
        `el curso ${a.curso_id} no existe en ese Moodle o el token no lo ve (si es nuevo, prueba con refrescar: true)`);
    }
    return elegidos;
  });
  const todos = bien.flatMap((b) => b.datos.map((curso) => ({ campus: b.campus, curso })))
    .sort((x, y) => x.campus.nombre.localeCompare(y.campus.nombre) || x.curso.nombre.localeCompare(y.curso.nombre));
  const limite = a.limite_cursos ?? 10;
  return {
    cursos: todos.slice(0, limite),
    sinConsultar: Math.max(0, todos.length - limite),
    coincidentes: todos.length,
    errores,
  };
}

const AVISO_LIMITE = (n, limite) => `Hay ${n} cursos más que encajan y no se han consultado (el tope es ${limite} por petición): acota con texto, categoria_id o curso_id, o sube limite_cursos.`;

function avisoSinCursos(a) {
  const estado = a.estado ?? 'activos';
  return `Ningún curso encaja con el filtro${a.texto ? ` «${a.texto}»` : ''} (estado: ${estado}). Esto NO significa que no haya alumnos o recursos: no hay curso que mirar.`
    + (estado !== 'todos' ? ' Prueba con estado: "todos" (por defecto solo se miran los activos).' : '');
}

// ─── moodle_cursos ────────────────────────────────────────────────────────

export async function moodleCursos(ambito, a, { signal } = {}) {
  const projectIds = acotarProyectos(ambito, a);
  const ahoraS = Math.floor(Date.now() / 1000);
  const { bien, errores } = await porCampus(ambito, projectIds, async (campus) => {
    const { datos, deCache, hace_s: haceS } = await cursosDelCampus(campus, a.refrescar === true, signal);
    const cuenta = { activos: 0, proximos: 0, terminados: 0, ocultos: 0 };
    for (const c of datos) cuenta[`${estadoDelCurso(c, ahoraS)}s`] += 1;
    const categorias = await categoriasDe(campus, a, signal);
    const filtrados = filtrarCursos(datos, { ...a, categorias }, ahoraS);
    return { cuenta, total: datos.length, filtrados, deCache, haceS };
  });

  const filas = bien
    .flatMap((b) => b.datos.filtrados.map((c) => filaDeCurso(c, b.campus, ahoraS)))
    .sort((x, y) => x.campus.localeCompare(y.campus) || comparadorDeCursos(a.orden, a.sentido)(x, y));
  const pagina = a.pagina ?? 1;
  const limite = a.limite ?? 25;
  const pag = filas.slice((pagina - 1) * limite, pagina * limite);
  // El numero de alumnos de cada curso de la pagina (matriculados con rol de alumno):
  // una lectura por curso, de a pocos y guardada unos minutos. Si una falla, ese curso
  // sale con `alumnos: null` y su motivo; nunca un 0.
  const campusPorId = new Map(bien.map((b) => [b.campus.id, b.campus]));
  const cursosPagina = a.con_alumnos === false ? pag : await mapConLimite(pag, MAX_CURSOS_A_LA_VEZ, async (f) => {
    const campus = campusPorId.get(f.campus_id);
    try {
      const { datos } = await conCache(`alumnos:${campus.id}:${huellaDeCredencial(campus.cred)}:${f.curso_id}`, a.refrescar === true, async () => {
        const { lista, truncado } = await leerMatriculados(campus.cred, f.curso_id, { campos: 'id,roles', signal });
        return { n: lista.filter(esAlumno).length, truncado };
      });
      return { ...f, alumnos: datos.n, ...(datos.truncado ? { alumnos_incompleto: true } : {}) };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { ...f, alumnos: null, alumnos_error: errorDelCampus(err, campus).error };
    }
  });
  return {
    filtro: { estado: a.estado ?? 'activos', texto: a.texto ?? null, categoria_id: a.categoria_id ?? null },
    con_alumnos: a.con_alumnos !== false,
    por_campus: bien.map((b) => ({
      campus_id: b.campus.id,
      campus: b.campus.nombre,
      cursos_en_moodle: b.datos.total,
      ...b.datos.cuenta,
      coincidentes: b.datos.filtrados.length,
      de_cache: b.datos.deCache,
      actualizado_hace_s: b.datos.haceS,
    })),
    total: filas.length,
    pagina,
    limite,
    cursos: cursosPagina,
    campus_con_error: errores,
    nota: 'Son los cursos que ve el token de Moodle de cada campus. «alumnos» = matriculados con rol de alumno (también los suspendidos; el desglose, en «moodle_alumnos»).  «activo» = visible y sin fecha de fin pasada; '
      + 'un curso sin fecha de fin cuenta como activo mientras esté visible. Los datos pueden tener hasta unos minutos (refrescar: true los pide de nuevo).',
  };
}

// ─── moodle_alumnos ───────────────────────────────────────────────────────

/** Todos los matriculados de un curso, de 500 en 500, hasta el tope. */
async function leerMatriculados(cred, cursoId, { campos, soloActivos = false, signal }) {
  const lista = [];
  let truncado = false;
  for (let desde = 0; ; desde += POR_PAGINA_MOODLE) {
    const opciones = [
      { name: 'userfields', value: campos },
      { name: 'limitfrom', value: desde },
      { name: 'limitnumber', value: POR_PAGINA_MOODLE },
      ...(soloActivos ? [{ name: 'onlyactive', value: 1 }] : []),
    ];
    const r = await llamarMoodle(cred, 'core_enrol_get_enrolled_users', { courseid: cursoId, options: opciones }, { signal });
    if (!Array.isArray(r)) {
      throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió la lista de matriculados con el formato esperado');
    }
    lista.push(...r);
    if (r.length < POR_PAGINA_MOODLE) break;
    if (lista.length >= maxAlumnos()) {
      truncado = true;
      break;
    }
  }
  return { lista, truncado };
}

const esAlumno = (u) => {
  // Sin roles en la respuesta no se puede distinguir: cuenta como alumno.
  if (!Array.isArray(u.roles) || !u.roles.length) return true;
  return u.roles.some((r) => r?.shortname === 'student');
};

/** Hasta cuantos alumnos de un curso se pregunta «¿ha terminado?» (MCP_MOODLE_MAX_TERMINADOS, 150). */
const maxTerminados = () => enteroEnv('MCP_MOODLE_MAX_TERMINADOS', 150);

/**
 * Cuantos alumnos han terminado el curso (#335).
 *
 * Moodle solo lo dice alumno por alumno (core_completion_get_course_completion_status),
 * asi que cuesta una llamada por alumno: solo se hace hasta MCP_MOODLE_MAX_TERMINADOS y
 * de a cinco. Lo que no se pueda saber va a `terminados: null` con el motivo, nunca a 0.
 *
 * Visto contra el Moodle real de Psiko: un curso con la finalizacion «activada» puede no
 * tener criterios (`nocriteriaset`). El primer alumno lo decide: si no hay criterios, no se
 * pregunta por los demas.
 */
export async function contarTerminados(cred, curso, alumnos, signal) {
  const sinDato = (avisos, criterios = null) => ({ terminados: null, criterios, avisos });
  if (!curso.finalizacion) return sinDato(['El curso no tiene la finalización activada en Moodle: no hay «terminados».'], false);
  if (!alumnos.length) return { terminados: 0, criterios: null, avisos: [] };
  if (alumnos.length > maxTerminados()) {
    return sinDato([`Hay más de ${maxTerminados()} alumnos: saber quién ha terminado exige una llamada por alumno y no se hace (terminados: false lo evita; MCP_MOODLE_MAX_TERMINADOS lo sube).`]);
  }
  const preguntar = async (u) => {
    try {
      const r = await llamarMoodle(cred, 'core_completion_get_course_completion_status', { courseid: curso.id, userid: u.id }, { signal });
      return r?.completionstatus?.completed === true ? 'si' : 'no';
    } catch (err) {
      if (!(err instanceof ErrorMoodle)) throw err;
      if (err.moodle === 'nocriteriaset') return 'sin_criterios';
      if (err.moodle === 'usernotenroled') return 'sin_comprobar';
      throw err;
    }
  };
  try {
    const primero = await preguntar(alumnos[0]);
    if (primero === 'sin_criterios') {
      return sinDato(['El curso tiene la finalización activada pero no tiene criterios de finalización definidos en Moodle: no hay «terminados».'], false);
    }
    const resto = await mapConLimite(alumnos.slice(1), MAX_COMPLETION_A_LA_VEZ, preguntar);
    const todos = [primero, ...resto];
    const sinComprobar = todos.filter((x) => x === 'sin_comprobar' || x === 'sin_criterios').length;
    return {
      terminados: todos.filter((x) => x === 'si').length,
      criterios: true,
      avisos: sinComprobar ? [`${sinComprobar} alumno${sinComprobar === 1 ? '' : 's'} no se pudo${sinComprobar === 1 ? '' : 'ieron'} comprobar (Moodle no los da por matriculados para la finalización).`] : [],
    };
  } catch (err) {
    if (signal?.aborted || !(err instanceof ErrorMoodle)) throw err;
    return sinDato([err.codigo === 'sin_permiso'
      ? 'El token no tiene permiso para ver quién ha terminado (core_completion_get_course_completion_status).'
      : `No se pudo saber quién ha terminado (${err.message}).`]);
  }
}

/**
 * Los numeros de UN curso. Las cifras que no se han podido saber van a `null`
 * con su motivo en `avisos`: nunca un 0 que parezca un dato.
 */
export async function recuentoDeAlumnos(cred, curso, { completos = false, dias = 30, terminados = true, signal } = {}) {
  const campos = ['id', 'lastaccess', 'lastcourseaccess', 'roles', ...(completos ? ['fullname', 'email'] : [])].join(',');
  const { lista, truncado } = await leerMatriculados(cred, curso.id, { campos, signal });

  // Con matricula activa (no suspendida ni fuera de plazo) = los que devuelve
  // «onlyactive». Pide el permiso de revisar matriculas; si no lo tiene el
  // token, los suspendidos se quedan sin saber.
  let activas = null;
  const avisos = [];
  try {
    const r = await leerMatriculados(cred, curso.id, { campos: 'id', soloActivos: true, signal });
    activas = new Set(r.lista.map((u) => u.id));
  } catch (err) {
    if (!(err instanceof ErrorMoodle) || !['sin_permiso', 'moodle'].includes(err.codigo)) throw err;
    avisos.push('No se pudo saber qué matrículas están suspendidas (el token no tiene permiso para revisarlas).');
  }

  const desdeS = Math.floor(Date.now() / 1000) - dias * SEGUNDOS_DIA;
  const alumnos = lista.filter(esAlumno);
  const ultimoAcceso = (u) => Number(u.lastcourseaccess !== undefined ? u.lastcourseaccess : u.lastaccess) || 0;
  // Sin alumnos no hay nadie a quien faltarle la fecha: los activos y los que nunca entraron son 0, no «no se sabe».
  const hayAcceso = !alumnos.length || alumnos.some((u) => u.lastcourseaccess !== undefined || u.lastaccess !== undefined);
  if (alumnos.length && !hayAcceso) avisos.push('Moodle no devolvió la fecha de último acceso: no se pueden contar los activos.');

  let suspendidos = 0;
  let activosRecientes = 0;
  let nuncaEntraron = 0;
  const detalle = [];
  for (const u of alumnos) {
    const matricula = activas ? (activas.has(u.id) ? 'activa' : 'suspendida') : 'desconocida';
    if (matricula === 'suspendida') suspendidos += 1;
    const ult = ultimoAcceso(u);
    if (hayAcceso && !ult) nuncaEntraron += 1;
    if (hayAcceso && ult >= desdeS && matricula !== 'suspendida') activosRecientes += 1;
    if (completos) {
      detalle.push({
        id_moodle: u.id,
        nombre: u.fullname ?? null,
        email: u.email ?? null,
        ultimo_acceso: ult ? new Date(ult * 1000).toISOString().slice(0, 10) : null,
        matricula,
      });
    }
  }
  if (truncado) avisos.push(`Hay más de ${maxAlumnos()} matriculados: el recuento está incompleto.`);

  const fin = terminados ? await contarTerminados(cred, curso, alumnos, signal) : { terminados: null, criterios: null, avisos: [] };
  avisos.push(...fin.avisos);

  return {
    matriculados: alumnos.length,
    matricula_activa: activas ? alumnos.length - suspendidos : null,
    suspendidos: activas ? suspendidos : null,
    [`activos_ultimos_${dias}_dias`]: hayAcceso ? activosRecientes : null,
    nunca_han_entrado: hayAcceso ? nuncaEntraron : null,
    terminados: fin.terminados,
    finalizacion_activada: curso.finalizacion,
    criterios_de_finalizacion: fin.criterios,
    otros_roles: lista.length - alumnos.length,
    ...(avisos.length ? { avisos } : {}),
    ...(completos ? { alumnos: detalle } : {}),
  };
}

const SUMAS = ['matriculados', 'matricula_activa', 'suspendidos', 'nunca_han_entrado'];

export async function moodleAlumnos(ambito, a, { signal } = {}) {
  const projectIds = acotarProyectos(ambito, a);
  const completos = a.datos_completos === true;
  if (completos && ambito.soloLoSuyo) {
    throw new AppError(
      'Los nombres y correos de los alumnos de Moodle solo los ve super admin o admin. Los recuentos, sí (sin datos_completos).',
      403, 'MCP_SOLO_ADMIN'
    );
  }
  const dias = a.dias_actividad ?? 30;
  const { cursos, sinConsultar, coincidentes, errores } = await elegirCursos(ambito, projectIds, a, signal);

  const filas = await mapConLimite(cursos, MAX_CURSOS_A_LA_VEZ, async ({ campus, curso }) => {
    const base = { campus_id: campus.id, campus: campus.nombre, curso_id: curso.id, curso: curso.nombre, estado: estadoDelCurso(curso) };
    try {
      return { ...base, ...(await recuentoDeAlumnos(campus.cred, curso, { completos, dias, terminados: a.terminados !== false, signal })) };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { ...base, error: errorDelCampus(err, campus).error };
    }
  });

  const buenas = filas.filter((f) => !f.error);
  const totales = Object.fromEntries(SUMAS.map((k) => [k, buenas.some((f) => f[k] === null) ? null : buenas.reduce((s, f) => s + f[k], 0)]));
  const clave = `activos_ultimos_${dias}_dias`;
  totales[clave] = buenas.some((f) => f[clave] === null) ? null : buenas.reduce((s, f) => s + f[clave], 0);
  // Terminados: se suman los cursos que dan dato y se dice cuantos no lo dan (sin criterios, sin finalizacion…).
  const conTerminados = buenas.filter((f) => f.terminados !== null);
  totales.terminados = conTerminados.length ? conTerminados.reduce((s, f) => s + f.terminados, 0) : null;
  totales.cursos_sin_dato_de_terminados = buenas.length - conTerminados.length;

  return {
    cursos_consultados: filas.length,
    cursos_que_encajan: coincidentes,
    cursos_sin_consultar: sinConsultar,
    ...(sinConsultar ? { aviso: AVISO_LIMITE(sinConsultar, a.limite_cursos ?? 10) } : {}),
    ...(!coincidentes && !errores.length ? { aviso: avisoSinCursos(a) } : {}),
    cursos: filas,
    cursos_con_error: filas.filter((f) => f.error).length,
    totales_suma_de_matriculas: totales,
    campus_con_error: errores,
    nota: `«Activos» = matrícula activa y acceso al curso en los últimos ${dias} días. Un alumno matriculado en dos cursos cuenta en cada uno. `
      + '«Terminados» = alumnos que Moodle da por completado el curso; solo hay dato si el curso tiene finalización activada Y criterios definidos (criterios_de_finalizacion), y cuesta una llamada por alumno (terminados: false la evita). Si no hay dato sale null con su motivo en «avisos», no 0.',
  };
}

// ─── moodle_recursos_externos ─────────────────────────────────────────────

const TIPOS_RECURSO = ['youtube', 'vimeo', 'drive', 'lti', 'enlace'];

/**
 * Los recursos externos de UN curso, a partir de lo que dijo Moodle:
 * `contenidos` (core_course_get_contents) y `urlsDelCurso` (los modulos «URL»
 * de mod_url_get_urls_by_courses, por id de modulo).
 */
export function recursosDelCurso(contenidos, urlsPorModulo, hostMoodle = null) {
  const recursos = [];
  let sinUrl = 0;
  for (const seccion of Array.isArray(contenidos) ? contenidos : []) {
    for (const m of Array.isArray(seccion?.modules) ? seccion.modules : []) {
      const base = {
        nombre: String(m.name ?? ''),
        seccion: seccion.name ? String(seccion.name) : null,
        visible: m.visible === undefined ? true : Number(m.visible) === 1 || m.visible === true,
      };
      if (m.modname === 'url') {
        const fallback = Array.isArray(m.contents) ? m.contents.find((c) => c?.type === 'url')?.fileurl : null;
        const url = urlsPorModulo.get(Number(m.id)) || fallback || null;
        if (!url) { sinUrl += 1; continue; }
        recursos.push({ ...base, tipo: tipoDeEnlace(url), url, origen: 'modulo_url' });
      } else if (m.modname === 'lti') {
        recursos.push({ ...base, tipo: 'lti', url: null, origen: 'herramienta_externa' });
      }
      // Enlaces escritos en la descripcion de CUALQUIER modulo (una etiqueta
      // con un video incrustado, por ejemplo).
      for (const url of extraerUrls(m.description)) {
        if (hostMoodle && new URL(url).host === hostMoodle) continue; // interno de Moodle
        recursos.push({ ...base, tipo: tipoDeEnlace(url), url, origen: 'descripcion' });
      }
    }
  }
  return { recursos, sinUrl };
}

const ROTOS = ['roto', 'no_responde', 'error_servidor'];

export async function moodleRecursosExternos(ambito, a, { signal } = {}) {
  const projectIds = acotarProyectos(ambito, a);
  const comprobar = a.comprobar_enlaces === true;
  if (comprobar && ambito.soloLoSuyo) {
    throw new AppError(
      'Comprobar si los enlaces responden lo hace super admin o admin. Puedes ver los recursos sin comprobar_enlaces.',
      403, 'MCP_SOLO_ADMIN'
    );
  }
  const { cursos, sinConsultar, coincidentes, errores } = await elegirCursos(ambito, projectIds, a, signal);

  // Los modulos «URL» de todos los cursos de un campus, en UNA llamada.
  const urlsPorCampus = new Map();
  const falloPorCampus = new Map();
  const campus = [...new Map(cursos.map((c) => [c.campus.id, c.campus])).values()];
  await mapConLimite(campus, MAX_CAMPUS_A_LA_VEZ, async (c) => {
    const ids = cursos.filter((x) => x.campus.id === c.id).map((x) => x.curso.id);
    try {
      const r = await llamarMoodle(c.cred, 'mod_url_get_urls_by_courses', { courseids: ids }, { signal });
      const mapa = new Map();
      for (const u of Array.isArray(r?.urls) ? r.urls : []) {
        if (u?.externalurl) mapa.set(Number(u.coursemodule), String(u.externalurl));
      }
      urlsPorCampus.set(c.id, mapa);
    } catch (err) {
      if (signal?.aborted) throw err;
      // Un permiso que falta no tumba el resto: la direccion de los modulos
      // «URL» tambien viene en los contenidos del curso.
      if (err instanceof ErrorMoodle && ['sin_permiso', 'moodle'].includes(err.codigo)) urlsPorCampus.set(c.id, new Map());
      else falloPorCampus.set(c.id, err);
    }
  });

  const filas = await mapConLimite(cursos, MAX_CURSOS_A_LA_VEZ, async ({ campus: c, curso }) => {
    const base = { campus_id: c.id, campus: c.nombre, curso_id: curso.id, curso: curso.nombre, estado: estadoDelCurso(curso) };
    try {
      if (falloPorCampus.has(c.id)) throw falloPorCampus.get(c.id);
      const contenidos = await llamarMoodle(c.cred, 'core_course_get_contents', { courseid: curso.id }, { signal });
      if (!Array.isArray(contenidos)) {
        throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió el contenido del curso con el formato esperado');
      }
      const { recursos, sinUrl } = recursosDelCurso(contenidos, urlsPorCampus.get(c.id) || new Map(), new URL(c.cred.url).host);
      return { ...base, recursos, sin_url: sinUrl };
    } catch (err) {
      if (signal?.aborted) throw err;
      return { ...base, error: errorDelCampus(err, c).error };
    }
  });

  // Comprobar enlaces: los distintos, hasta el tope, de pocos en pocos.
  let comprobados = 0;
  let sinComprobar = 0;
  if (comprobar) {
    const distintos = [...new Set(filas.flatMap((f) => (f.recursos || []).map((r) => r.url).filter(Boolean)))];
    const aMirar = distintos.slice(0, limiteEnlaces());
    sinComprobar = distintos.length - aMirar.length;
    const tipoDe = new Map(filas.flatMap((f) => (f.recursos || []).filter((r) => r.url).map((r) => [r.url, r.tipo])));
    const resultados = new Map();
    await mapConLimite(aMirar, 4, async (url) => {
      resultados.set(url, await comprobarEnlace(url, tipoDe.get(url)));
    });
    comprobados = aMirar.length;
    for (const f of filas) {
      for (const r of f.recursos || []) {
        if (!r.url) continue;
        const res = resultados.get(r.url);
        Object.assign(r, res ? { estado: res.estado, ...(res.http ? { http: res.http } : {}), ...(res.detalle ? { detalle: res.detalle } : {}) } : { estado: 'sin_comprobar' });
      }
    }
  }

  // Resumen por curso y global; los cursos con error no cuentan como «sin recursos».
  const porTipoGlobal = Object.fromEntries(TIPOS_RECURSO.map((t) => [t, 0]));
  let conRecursos = 0;
  let sinRecursos = 0;
  let rotos = 0;
  const salida = filas.map((f) => {
    if (f.error) return f;
    const porTipo = Object.fromEntries(TIPOS_RECURSO.map((t) => [t, f.recursos.filter((r) => r.tipo === t).length]));
    for (const t of TIPOS_RECURSO) porTipoGlobal[t] += porTipo[t];
    if (f.recursos.length) conRecursos += 1; else sinRecursos += 1;
    const rotosDelCurso = f.recursos.filter((r) => ROTOS.includes(r.estado)).length;
    rotos += rotosDelCurso;
    const lista = (a.tipo ? f.recursos.filter((r) => r.tipo === a.tipo) : f.recursos)
      .filter((r) => !a.solo_rotos || ROTOS.includes(r.estado));
    return {
      campus_id: f.campus_id, campus: f.campus, curso_id: f.curso_id, curso: f.curso, estado: f.estado,
      total_recursos_externos: f.recursos.length,
      por_tipo: porTipo,
      ...(comprobar ? { enlaces_rotos: rotosDelCurso } : {}),
      ...(f.sin_url ? { modulos_url_sin_direccion: f.sin_url } : {}),
      recursos: lista,
    };
  });

  const avisos = [];
  if (sinConsultar) avisos.push(AVISO_LIMITE(sinConsultar, a.limite_cursos ?? 10));
  if (!coincidentes && !errores.length) avisos.push(avisoSinCursos(a));
  if (sinComprobar) avisos.push(`Solo se han comprobado ${comprobados} enlaces (tope por petición); ${sinComprobar} quedan con estado «sin_comprobar».`);

  return {
    cursos_consultados: salida.length,
    cursos_que_encajan: coincidentes,
    cursos_sin_consultar: sinConsultar,
    resumen: {
      cursos_con_recursos_externos: conRecursos,
      cursos_sin_recursos_externos: sinRecursos,
      cursos_con_error: salida.filter((f) => f.error).length,
      por_tipo: porTipoGlobal,
      ...(comprobar ? { enlaces_comprobados: comprobados, enlaces_sin_comprobar: sinComprobar, enlaces_rotos: rotos } : {}),
    },
    ...(avisos.length ? { avisos } : {}),
    cursos: salida,
    campus_con_error: errores,
    nota: 'Recursos externos = módulos «URL» y enlaces o videos escritos en la descripción de las actividades; las herramientas externas (LTI) se listan pero su dirección no se puede ver ni comprobar. '
      + (comprobar
        ? 'Estados: ok · roto (404/410 o dominio inexistente) · restringido (401/403/429: existe pero pide acceso o no deja mirar; NO es lo mismo que roto) · error_servidor · no_responde · bloqueado (dirección interna, no se comprueba).'
        : 'No se ha comprobado si los enlaces responden (comprobar_enlaces: true, solo super admin y admin).'),
  };
}

// ─── moodle_estructura ────────────────────────────────────────────────────

async function cargarCategorias(cred, signal) {
  const r = await llamarMoodle(cred, 'core_course_get_categories', {}, { signal });
  if (!Array.isArray(r)) {
    throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió las categorías con el formato esperado');
  }
  const porId = new Map(r.map((c) => [Number(c.id), c]));
  const ruta = (c) => {
    const partes = [];
    for (let x = c, n = 0; x && n < 20; x = porId.get(Number(x.parent)), n += 1) partes.unshift(String(x.name));
    return partes.join(' > ');
  };
  return r.map((c) => ({
    id: Number(c.id),
    nombre: String(c.name),
    ruta: ruta(c),
    padre_id: Number(c.parent) || null,
    profundidad: Number(c.depth) || 1,
    cursos: Number(c.coursecount) || 0,
    visible: c.visible === undefined ? true : Number(c.visible) === 1 || c.visible === true,
  })).sort((x, y) => x.ruta.localeCompare(y.ruta));
}

/** Las secciones y actividades de UN curso (core_course_get_contents), sin contenidos ni enlaces. */
async function estructuraDeCurso(campus, cursoId, a, ahoraS, signal) {
  const { datos: cursos } = await cursosDelCampus(campus, a.refrescar === true, signal);
  const curso = cursos.find((c) => c.id === Number(cursoId));
  if (!curso) {
    throw new ErrorMoodle('curso_no_encontrado',
      `el curso ${cursoId} no existe en ese Moodle o el token no lo ve (si es nuevo, prueba con refrescar: true)`);
  }
  const r = await llamarMoodle(campus.cred, 'core_course_get_contents', { courseid: curso.id }, { signal });
  if (!Array.isArray(r)) {
    throw new ErrorMoodle('respuesta_no_valida', 'Moodle no devolvió el contenido del curso con el formato esperado');
  }
  const porTipo = {};
  const secciones = r.map((s, i) => {
    const actividades = (Array.isArray(s.modules) ? s.modules : []).map((m) => {
      const tipo = String(m.modname || 'otro');
      porTipo[tipo] = (porTipo[tipo] || 0) + 1;
      return { nombre: String(m.name ?? ''), tipo, visible: m.visible === undefined ? true : Number(m.visible) === 1 || m.visible === true };
    });
    return {
      numero: Number.isInteger(Number(s.section)) ? Number(s.section) : i,
      nombre: String(s.name || '').trim() || (i === 0 ? 'General' : `Sección ${i}`),
      visible: s.visible === undefined ? true : Number(s.visible) === 1 || s.visible === true,
      total_actividades: actividades.length,
      actividades,
    };
  });
  return {
    curso: { curso_id: curso.id, nombre: curso.nombre, categoria: curso.categoria, estado: estadoDelCurso(curso, ahoraS), visible: curso.visible, inicio: fechaIso(curso.inicio_s), fin: fechaIso(curso.fin_s) },
    total_secciones: secciones.length,
    total_actividades: secciones.reduce((n, s) => n + s.total_actividades, 0),
    por_tipo: porTipo,
    secciones,
  };
}

export async function moodleEstructura(ambito, a, { signal } = {}) {
  const projectIds = acotarProyectos(ambito, a);
  if (a.curso_id != null) {
    if (projectIds.length > 1) {
      throw new AppError(
        'Un curso es de un Moodle concreto: indica el campus con proyecto_id (los ids de curso se repiten entre campus).',
        400, 'MCP_FALTA_CAMPUS'
      );
    }
    const ahoraS = Math.floor(Date.now() / 1000);
    const { bien, errores } = await porCampus(ambito, projectIds, (campus) => estructuraDeCurso(campus, a.curso_id, a, ahoraS, signal));
    return {
      campus: bien.map((b) => ({ campus_id: b.campus.id, campus: b.campus.nombre, ...b.datos })),
      campus_con_error: errores,
      nota: 'Las secciones y actividades del curso tal y como las ve el token (nombre, tipo y si están visibles; sin el contenido). Una sección vacía es una sección sin actividades.',
    };
  }
  const { bien, errores } = await porCampus(ambito, projectIds, async (campus) => {
    const r = await conCache(`categorias:${campus.id}:${huellaDeCredencial(campus.cred)}`, a.refrescar === true,
      () => cargarCategorias(campus.cred, signal));
    return r;
  });
  return {
    campus: bien.map((b) => ({
      campus_id: b.campus.id,
      campus: b.campus.nombre,
      total_categorias: b.datos.datos.length,
      categorias: b.datos.datos,
      de_cache: b.datos.deCache,
      actualizado_hace_s: b.datos.hace_s,
    })),
    campus_con_error: errores,
    nota: 'Las categorías de cursos de cada Moodle, con cuántos cursos tiene cada una (los que cuenta Moodle, incluidos los ocultos que el token pueda ver).',
  };
}

// ─── La revisión de un campus: lo que conviene mirar (#335) ───────────────

/**
 * Lo leído de cada curso activo en la última revisión, por campus. Va aparte de la caché de
 * arriba, que tiene tope de entradas (50): un campus tiene cientos de cursos y se perdería.
 * Solo guarda recuentos, nunca personas.
 */
const revisiones = new Map();
const MAX_CAMPUS_REVISADOS = 20;
const ttlRevisionMs = () => enteroEnv('MCP_MOODLE_REVISION_MIN', 10, { cero: true }) * 60_000;
/** Cuánto trabaja UNA petición antes de devolver lo que lleve (la pantalla vuelve a pedir el resto). */
const presupuestoDeRevisionMs = () => enteroEnv('MCP_MOODLE_REVISION_MS', 12000);

/**
 * CUIDADO CON EL MOODLE DE VERDAD. Revisar un campus son cientos de lecturas a un Moodle en
 * producción, con alumnos dentro. Con cinco a la vez, el de Psiko contestó «Database connection
 * failed» a una de cada seis. Por eso: pocas a la vez, una pausa corta entre cursos y, si Moodle
 * dice que va justo de carga, la revisión PARA y espera (no insiste ni lo da por fallo del curso).
 */
const concurrenciaDeRevision = () => Math.max(1, enteroEnv('MCP_MOODLE_REVISION_CONCURRENCIA', 2));
const pausaEntreCursosMs = () => enteroEnv('MCP_MOODLE_REVISION_PAUSA_MS', 150, { cero: true });
const esperaSiSaturadoMs = () => enteroEnv('MCP_MOODLE_REVISION_ESPERA_MS', 30_000);
const esSobrecarga = (err) => err instanceof ErrorMoodle && err.moodle === 'dbconnectionfailed';
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function resumenDeUnCurso(campus, cursoId, ahoraS, signal) {
  const { lista, truncado } = await leerMatriculados(campus.cred, cursoId, { campos: 'id,roles,lastaccess,lastcourseaccess', signal });
  const alumnos = lista.filter(esAlumno);
  const desdeS = ahoraS - 30 * SEGUNDOS_DIA;
  const ultimo = (u) => Number(u.lastcourseaccess !== undefined ? u.lastcourseaccess : u.lastaccess) || 0;
  return {
    matriculados: alumnos.length,
    nunca: alumnos.filter((u) => !ultimo(u)).length,
    activos: alumnos.filter((u) => ultimo(u) >= desdeS).length,
    truncado,
  };
}

/** Un fallo de TODO el campus (no de un curso): se corta la revisión en vez de apuntarlo curso a curso. */
export const FALLOS_DEL_CAMPUS = ['token_no_valido', 'sin_respuesta', 'servicios_web_apagados', 'redireccion', 'http'];

/**
 * Qué cursos ACTIVOS de un campus conviene mirar, sin entrar a Moodle a abrirlos uno a uno:
 *
 *   · sin alumnos: ninguna persona matriculada;
 *   · dormidos: tienen alumnos y ninguno ha entrado en 30 días;
 *   · con alumnos que nunca han entrado: hay actividad, pero a algunos no se les ha visto
 *     nunca (cada curso cae en UNA sola de las tres, por ese orden).
 *
 * Revisar un campus es una lectura por curso, así que se hace por tandas: cada petición
 * trabaja hasta MCP_MOODLE_REVISION_MS y devuelve lo que lleve con `pendientes`; quien llama
 * vuelve a pedir hasta que sea 0. Lo ya leído se guarda MCP_MOODLE_REVISION_MIN minutos.
 * Un curso que falla no se reintenta en esa ventana y cuenta en `no_leidos`: ni bloquea la
 * revisión ni se disfraza de «sin alumnos».
 */
export async function revisarCampus(ambito, a, { signal } = {}) {
  const projectIds = acotarProyectos(ambito, a);
  if (projectIds.length !== 1) {
    throw new AppError('La revisión es de un campus: indica proyecto_id.', 400, 'MCP_FALTA_CAMPUS');
  }
  const ahoraS = Math.floor(Date.now() / 1000);
  const { bien, errores } = await porCampus(ambito, projectIds, async (campus) => {
    const { datos: cursos } = await cursosDelCampus(campus, a.refrescar === true, signal);
    const activos = cursos.filter((c) => estadoDelCurso(c, ahoraS) === 'activo');

    const clave = `${campus.id}:${huellaDeCredencial(campus.cred)}`;
    let entrada = revisiones.get(clave);
    if (!entrada || a.refrescar === true || Date.now() - entrada.en > ttlRevisionMs()) {
      entrada = { en: Date.now(), cursos: new Map(), fallidos: new Set(), pausaHasta: 0 };
      revisiones.delete(clave);
      revisiones.set(clave, entrada);
      while (revisiones.size > MAX_CAMPUS_REVISADOS) revisiones.delete(revisiones.keys().next().value);
    }

    const porLeer = activos.filter((c) => !entrada.cursos.has(c.id) && !entrada.fallidos.has(c.id));
    const fin = Date.now() + presupuestoDeRevisionMs();
    // Si hace nada Moodle dijo que iba justo, no se le pide nada hasta que pase la espera.
    if (Date.now() >= entrada.pausaHasta) {
      await mapConLimite(porLeer, concurrenciaDeRevision(), async (c) => {
        if (Date.now() > fin || Date.now() < entrada.pausaHasta || signal?.aborted) return;
        try {
          entrada.cursos.set(c.id, await resumenDeUnCurso(campus, c.id, ahoraS, signal));
        } catch (err) {
          if (signal?.aborted) throw err;
          if (esSobrecarga(err)) {
            // Va justo de carga: se para todo y se reintenta luego. NO es un fallo de este curso.
            entrada.pausaHasta = Date.now() + esperaSiSaturadoMs();
            return;
          }
          if (err instanceof ErrorMoodle && FALLOS_DEL_CAMPUS.includes(err.codigo)) throw err;
          entrada.fallidos.add(c.id);
        }
        await dormir(pausaEntreCursosMs());
      });
    }

    const leidos = activos.filter((c) => entrada.cursos.has(c.id));
    const noLeidos = activos.filter((c) => entrada.fallidos.has(c.id)).length;
    const hallazgos = { sin_alumnos: [], dormidos: [], con_nunca_entraron: [] };
    for (const c of leidos) {
      const r = entrada.cursos.get(c.id);
      const fila = { ...filaDeCurso(c, campus, ahoraS), alumnos: r.matriculados };
      if (r.matriculados === 0) hallazgos.sin_alumnos.push(fila);
      else if (r.activos === 0) hallazgos.dormidos.push(fila);
      else if (r.nunca > 0) hallazgos.con_nunca_entraron.push({ ...fila, nunca_han_entrado: r.nunca });
    }
    hallazgos.dormidos.sort((x, y) => y.alumnos - x.alumnos || x.nombre.localeCompare(y.nombre));
    hallazgos.con_nunca_entraron.sort((x, y) => y.nunca_han_entrado - x.nunca_han_entrado || x.nombre.localeCompare(y.nombre));
    hallazgos.sin_alumnos.sort((x, y) => x.nombre.localeCompare(y.nombre));

    const espera = Math.max(0, entrada.pausaHasta - Date.now());
    return {
      total: activos.length,
      revisados: leidos.length,
      no_leidos: noLeidos,
      pendientes: activos.length - leidos.length - noLeidos,
      // Moodle dijo que iba justo de carga: la pantalla espera estos segundos antes de volver a pedir.
      saturado: espera > 0,
      espera_s: Math.ceil(espera / 1000),
      hallazgos,
    };
  });
  if (!bien.length) throw todosFallaron(errores);
  return bien[0].datos;
}
