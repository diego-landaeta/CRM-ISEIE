import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { formacionesMoodleActivas, pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import { guardarCursoEnMoodle, categoriasDelCampus, urlDelCampus, MoodleError } from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';
import { textoParaElCampus } from '../consultas/consultas.service.js';
import { tipoPorNombre } from '../cursos-pendientes/cursos-pendientes.venta.js';
import * as cursosProducto from '../moodle/moodle.cursosProducto.model.js';
import { vaciarCacheCursosProducto } from '../moodle/moodle.cursosProducto.controller.js';

/**
 * Formaciones desde el CRM · fase 2 (CRM#1113 / CRM-ISEIE#767): «Crear en Moodle» /
 * «Actualizar en Moodle» desde la ficha de la formación.
 *
 * El curso se crea (o se actualiza) en el Moodle del campus con el plugin local_crm
 * 1.12.0 (`local_crm_curso_guardar`): nombre, fechas y una sección por módulo, con su
 * título y su temario. Después queda unido al producto en `moodle_cursos_producto`, lo
 * mismo que se hace a mano en «Cursos de Moodle» y lo que lee la matrícula automática.
 *
 * Reglas:
 *   · Apagado en producción hasta que se apruebe (FORMACIONES_MOODLE_EN_PRODUCCION=1).
 *   · Con un curso ya unido, se actualiza ESE; sin él, el plugin busca por el idnumber
 *     del CRM («crm-<campus>-<producto>») antes de crear: dos clics no crean dos cursos.
 *   · Con más de un curso unido no se adivina cuál: se dice y no se hace nada.
 *   · El curso nuevo nace oculto a los alumnos; las secciones de más no se borran.
 *
 * Las dos decisiones de Diego (24/11, «hazlo, acomoda eso»), configurables:
 *   · CATEGORÍA por tipo, por campus: `config_public.categorias_formacion` de su
 *     integración de Moodle ({ curso, diplomado, master }: id de la categoría; 0 = la de
 *     por defecto del Moodle). Sin guardar, se propone la que se llame como el tipo
 *     («Cursos», «Diplomados», «Másteres» / «Maestrías»); si ninguna, la de por defecto.
 *     Se edita en Integraciones › Moodle y, para una formación concreta, en su ficha.
 *   · NOMBRE CORTO (único en Moodle): el SKU del producto si lo tiene; si no, las
 *     iniciales del tipo (CUR / DIP / MAS) + un trozo del nombre + el año de inicio
 *     («DIP-PSICOLOGIA-CLINICA-INFANTIL-2027»). Si ya existe, -2, -3… Se puede cambiar en
 *     la ficha antes de crear. Al actualizar, el nombre corto y la categoría no se tocan.
 */

export const TIPOS = Object.freeze(['curso', 'diplomado', 'master']);
const INICIALES = Object.freeze({ curso: 'CUR', diplomado: 'DIP', master: 'MAS' });

/** Cuántas veces se prueba otro sufijo si Moodle dice que el nombre corto ya existe. */
const MAX_SUFIJOS = 10;

/** ¿Se puede usar en este servidor? (el interruptor y el plugin). */
export const moodleDisponible = (env = process.env) => formacionesMoodleActivas(env) && pluginMoodleActivo(env);

/** El idnumber que el CRM pone a sus cursos, para encontrarlos otra vez. */
export const idnumberDe = (projectId, productId) => `crm-${projectId}-${productId}`;

/** Un día «AAAA-MM-DD» como marca de tiempo de Moodle, a mediodía UTC: el mismo día en España y en América. */
export function marcaDeDia(dia) {
  if (!dia) return 0;
  const t = Date.parse(`${String(dia).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '');

// ─── Nombre corto ─────────────────────────────────────────────────────────

/** Palabras que no dicen nada en un nombre corto. */
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'EN', 'Y', 'E', 'O', 'U', 'A', 'AL', 'PARA', 'CON', 'POR', 'SU', 'SUS', 'UN', 'UNA']);
/** Lo que ya dicen las iniciales del tipo. */
const DEL_TIPO = new Set(['CURSO', 'DIPLOMADO', 'MASTER', 'MAESTRIA', 'MBA']);
const LARGO_DEL_TROZO = 30;

/** El trozo del nombre: sin el tipo, sin tildes ni palabras vacías, en mayúsculas, hasta 30 letras. */
export function trozoDelNombre(nombre) {
  const utiles = sinTildes(nombre).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
    .filter((p) => p && !VACIAS.has(p) && !DEL_TIPO.has(p));
  let trozo = '';
  for (const p of utiles) {
    const siguiente = trozo ? `${trozo}-${p}` : p;
    if (siguiente.length > LARGO_DEL_TROZO) break;
    trozo = siguiente;
  }
  return trozo || (utiles[0] || 'FORMACION').slice(0, LARGO_DEL_TROZO);
}

/** El tipo de la formación: el guardado o, si no hay, el que dice su nombre. */
export const tipoDe = (formacion) => (TIPOS.includes(formacion.tipo_formacion) ? formacion.tipo_formacion : tipoPorNombre(formacion.nombre));

/**
 * El nombre corto que se propone: el SKU si lo tiene; si no, CUR/DIP/MAS + trozo del
 * nombre + año de inicio (o el de hoy si no tiene fecha). `origen`: 'sku' | 'regla'.
 */
export function nombreCortoPropuesto(formacion, { hoy = new Date() } = {}) {
  const sku = String(formacion.sku ?? '').trim().replace(/\s+/g, ' ');
  if (sku) return { valor: sku.slice(0, 100), origen: 'sku' };
  const inicio = String(formacion.fecha_inicio || '');
  const anio = /^\d{4}/.test(inicio) ? inicio.slice(0, 4) : String(hoy.getUTCFullYear());
  return { valor: `${INICIALES[tipoDe(formacion)]}-${trozoDelNombre(formacion.nombre)}-${anio}`, origen: 'regla' };
}

/** «BASE», «BASE-2», «BASE-3»… */
export const conSufijo = (base, n) => (n <= 1 ? base : `${base}-${n}`);

/** El primer nombre libre de esa base, mirando los que ya tiene el campus (sin distinguir mayúsculas). */
export function primeroLibre(base, ocupados = []) {
  const cogidos = new Set([...ocupados].map((c) => String(c).trim().toLowerCase()));
  for (let n = 1; n <= 99; n += 1) {
    const candidato = conSufijo(base, n);
    if (!cogidos.has(candidato.toLowerCase())) return candidato;
  }
  return conSufijo(base, 100);
}

// ─── Categoría ────────────────────────────────────────────────────────────

/** Cómo se llama la categoría de cada tipo, de más a menos exacto. */
const NOMBRES_DE_CATEGORIA = Object.freeze({
  curso: [/^cursos?$/, /^cursos?\b/, /\bcursos?\b/],
  diplomado: [/^diplomados?$/, /^diplomados?\b/, /\bdiplomad/],
  master: [/^(master|masters|masteres|maestria|maestrias)$/, /^(master|maestria)/, /\b(master|maestria)/],
});

/**
 * La categoría que encaja con cada tipo por su nombre: { curso: { id, nombre } | null, … }.
 * Entre varias, la más exacta; a igualdad, la de más arriba en el árbol y con más cursos.
 */
export function proponerCategorias(categorias = []) {
  const propuesta = {};
  for (const tipo of TIPOS) {
    propuesta[tipo] = null;
    for (const patron of NOMBRES_DE_CATEGORIA[tipo]) {
      const encajan = categorias.filter((c) => patron.test(sinTildes(c.nombre).toLowerCase().trim()));
      if (!encajan.length) continue;
      encajan.sort((a, b) => (a.profundidad ?? 9) - (b.profundidad ?? 9) || (b.cursos || 0) - (a.cursos || 0) || a.id - b.id);
      propuesta[tipo] = { id: encajan[0].id, nombre: encajan[0].ruta || encajan[0].nombre };
      break;
    }
  }
  return propuesta;
}

/** Lo guardado en Integraciones, limpio: solo los tres tipos, con un id entero ≥ 0. */
export function categoriasGuardadas(config) {
  const g = config?.categorias_formacion;
  const limpio = {};
  if (!g || typeof g !== 'object') return limpio;
  for (const tipo of TIPOS) {
    const v = g[tipo];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) limpio[tipo] = n;
  }
  return limpio;
}

/**
 * La categoría de un tipo en un campus: la guardada (`origen: 'campus'`), si no la
 * propuesta por nombre (`'propuesta'`), y si no la de por defecto del Moodle (id 0).
 */
export function categoriaParaTipo(tipo, { guardadas = {}, categorias = [] } = {}) {
  if (Number.isInteger(guardadas[tipo])) {
    const id = guardadas[tipo];
    const c = categorias.find((x) => x.id === id);
    return { id, nombre: c ? (c.ruta || c.nombre) : null, origen: id ? 'campus' : 'por_defecto' };
  }
  const p = proponerCategorias(categorias)[tipo];
  if (p) return { id: p.id, nombre: p.nombre, origen: 'propuesta' };
  return { id: 0, nombre: null, origen: 'por_defecto' };
}

// ─── El campus ────────────────────────────────────────────────────────────

/** Lo leído de cada campus dura 2 minutos: abrir la ficha y crear no son dos lecturas enteras. */
const CACHE_MS = 2 * 60 * 1000;
const cache = new Map();
export function vaciarCacheDelCampus() { cache.clear(); }

/** Las categorías y los nombres cortos del Moodle del campus (solo lectura, con caché). */
export async function lecturaDelCampus(projectId, conexion, opciones) {
  const clave = Number(projectId);
  const guardada = cache.get(clave);
  if (guardada && Date.now() - guardada.at < CACHE_MS) return guardada.datos;
  const datos = await categoriasDelCampus(conexion, opciones);
  cache.set(clave, { at: Date.now(), datos });
  return datos;
}

/** La configuración pública de su integración de Moodle (dirección, categorías…). */
export async function configDelCampus(projectId) {
  const { rows: [r] } = await query(
    `SELECT config_public FROM project_integrations WHERE project_id = $1 AND provider = 'moodle'`, [projectId]);
  return r?.config_public || {};
}

/** ¿Tiene el campus su Moodle conectado con el plugin? Y su dirección, para el enlace al curso (sin descifrar nada). */
export async function campusConectado(projectId) {
  const { rows } = await query(
    `SELECT config_public->>'url' AS url FROM project_integrations
      WHERE project_id = $1 AND provider = 'moodle' AND active = true AND encrypted_value IS NOT NULL`,
    [projectId]
  );
  return rows.length ? { conectado: true, url: urlDelCampus(rows[0].url) || null } : { conectado: false, url: null };
}

/** El enlace a un curso del campus. */
export const enlaceAlCurso = (urlCampus, cursoId) => (urlCampus && cursoId ? `${urlDelCampus(urlCampus)}/course/view.php?id=${cursoId}` : null);

// ─── Lo que se manda ──────────────────────────────────────────────────────

/** Lo que se manda al plugin, a partir de la formación y sus módulos. */
export function datosDelCurso(formacion, modulos, { cursoId = 0, categoria = 0, nombreCorto = '' } = {}) {
  return {
    cursoId,
    idnumber: idnumberDe(formacion.project_id, formacion.id),
    nombre: formacion.nombre,
    nombreCorto: (nombreCorto || formacion.nombre).slice(0, 255),
    categoria,
    inicio: marcaDeDia(formacion.fecha_inicio),
    fin: marcaDeDia(formacion.fecha_fin),
    secciones: modulos.map((m) => ({
      nombre: m.titulo.slice(0, 255),
      resumen: m.descripcion ? textoParaElCampus(m.descripcion) : '',
      // «Se desbloquea a los … días» (CRM#1124): solo con valor; sin él, el plugin deja la
      // restricción de la sección como esté.
      ...(diasDeDesbloqueo(m) ? { dias: diasDeDesbloqueo(m) } : {}),
    })),
  };
}

/** Los días de «se desbloquea a los … días» de un módulo, o null (desde el principio). */
export function diasDeDesbloqueo(m) {
  const n = Number(m?.dias_desbloqueo);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Lo que el plugin dice que no ha podido hacer, sin fallar, dicho para quien lo lee
 * (CRM#1124). Los códigos que no se conocen se enseñan tal cual.
 */
const AVISOS_DEL_PLUGIN = Object.freeze({
  sin_relativedate: 'El campus no tiene activo el plugin «Fecha relativa» (availability_relativedate): las secciones se han dejado sin «se desbloquea a los … días».',
  curso_no_del_crm: 'El curso no lo creó el CRM: sus restricciones de acceso no se han tocado.',
});
export const textoDelAviso = (codigo) => AVISOS_DEL_PLUGIN[codigo] || codigo;

/** La formación, sus módulos y sus cursos unidos (comprobando que sea de ese campus). */
async function prepararFormacion(productId, projectId) {
  const { rows: [p] } = await query(
    'SELECT id, project_id, nombre, sku, tipo_formacion, fecha_inicio, fecha_fin FROM products WHERE id = $1', [productId]);
  if (!p) throw new AppError('Formación no encontrada', 404, 'PRODUCT_NOT_FOUND');
  if (Number(p.project_id) !== Number(projectId)) throw new AppError('No tienes acceso a esta formación', 403, 'FORBIDDEN');
  const fecha = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const formacion = { ...p, id: Number(p.id), project_id: Number(p.project_id), fecha_inicio: fecha(p.fecha_inicio), fecha_fin: fecha(p.fecha_fin) };

  const [{ rows: modulos }, { rows: unidos }] = await Promise.all([
    query('SELECT titulo, descripcion, dias_desbloqueo FROM product_modules WHERE product_id = $1 ORDER BY orden, id', [productId]),
    query('SELECT curso_moodle_id, curso_nombre FROM moodle_cursos_producto WHERE product_id = $1 AND project_id = $2 ORDER BY curso_moodle_id',
      [productId, projectId]),
  ]);
  return { formacion, modulos, unidos };
}

async function conexionOError(projectId) {
  const conexion = await conexionDelCampus(projectId);
  if (!conexion) throw new AppError('Este campus no tiene su Moodle conectado (Integraciones › Moodle).', 409, 'SIN_MOODLE');
  if (conexion.error) throw new AppError(conexion.error, 409, 'SIN_MOODLE');
  return conexion;
}

const comoAppError = (err, delante = '') => {
  if (!(err instanceof MoodleError)) return err;
  const mensaje = err.codigo === 'SIN_FUNCION' || err.codigo === 'PERMISO'
    ? `${err.message} Hace falta el plugin del CRM 1.12.0 en el campus.`
    : err.message;
  return new AppError(`${delante}${mensaje}`, 502, 'MOODLE');
};

const APAGADO = () => new AppError('Crear cursos en Moodle desde el CRM aún no está aprobado en este servidor.', 409, 'APAGADO');

/**
 * Qué se va a hacer en Moodle, antes de pulsar: crear o actualizar, en qué categoría,
 * con qué nombre corto, oculto o visible y una sección por módulo. Solo lee (el campus,
 * con caché). Si el campus no contesta, se dice y se enseña lo que se sabe sin él.
 */
export async function vistaPrevia(productId, projectId, { fetchImpl } = {}) {
  if (!moodleDisponible()) throw APAGADO();
  const { formacion, modulos, unidos } = await prepararFormacion(productId, projectId);
  const conexion = await conexionOError(projectId);
  const tipo = tipoDe(formacion);
  const base = {
    nombre: formacion.nombre,
    tipo,
    inicio: formacion.fecha_inicio || null,
    fin: formacion.fecha_fin || null,
    secciones: modulos.map((m) => m.titulo),
    // A los cuántos días se desbloquea cada sección (null = desde el principio), CRM#1124.
    desbloqueo: modulos.map(diasDeDesbloqueo),
    cursos_unidos: unidos.map((u) => ({
      id: Number(u.curso_moodle_id), nombre: u.curso_nombre || null, url: enlaceAlCurso(conexion.url, Number(u.curso_moodle_id)),
    })),
  };
  if (unidos.length > 1) return { ...base, accion: 'varios' };
  if (unidos.length === 1) {
    // Al actualizar, el plugin deja el nombre corto, la categoría y la visibilidad como estén.
    return { ...base, accion: 'actualizar', categoria: null, nombre_corto: null, visible: null };
  }

  const guardadas = categoriasGuardadas(await configDelCampus(projectId));
  const propuesto = nombreCortoPropuesto(formacion);
  let lectura = null; let aviso = null;
  try {
    lectura = await lecturaDelCampus(projectId, conexion, fetchImpl ? { fetchImpl } : undefined);
  } catch (err) {
    if (!(err instanceof MoodleError)) throw err;
    aviso = `No se ha podido leer el campus (${err.message}). Se usará la categoría guardada en Integraciones y, si el nombre corto ya existe, se le añade -2, -3…`;
  }
  const valor = lectura ? primeroLibre(propuesto.valor, lectura.cortos) : propuesto.valor;
  return {
    ...base,
    accion: 'crear',
    categoria: categoriaParaTipo(tipo, { guardadas, categorias: lectura?.categorias || [] }),
    categorias: lectura?.categorias || [],
    fuente_categorias: lectura?.fuente || null,
    nombre_corto: { valor, propuesto: propuesto.valor, origen: propuesto.origen, ajustado: valor !== propuesto.valor },
    // El curso nuevo nace oculto a los alumnos: lo publica una persona en Moodle.
    visible: false,
    aviso,
  };
}

export async function llevarAMoodle(productId, projectId, {
  categoria = null, nombreCorto = null, userId = null, ip = null, fetchImpl,
} = {}) {
  if (!moodleDisponible()) throw APAGADO();
  const { formacion, modulos, unidos } = await prepararFormacion(productId, projectId);
  if (!modulos.length) throw new AppError('La formación no tiene módulos: añádelos antes de llevarla a Moodle.', 409, 'SIN_MODULOS');
  if (unidos.length > 1) {
    throw new AppError('Esta formación está unida a varios cursos de Moodle: deja uno en «Cursos de Moodle» antes de actualizar.', 409, 'VARIOS_CURSOS');
  }
  const conexion = await conexionOError(projectId);
  const opciones = fetchImpl ? { fetchImpl } : undefined;
  const cursoId = unidos[0] ? Number(unidos[0].curso_moodle_id) : 0;

  // Al crear: la categoría y el nombre corto. Al actualizar, el plugin no los cambia.
  let cat = 0; let corto = ''; let base = ''; const ocupados = [];
  if (!cursoId) {
    const elegida = Number.isInteger(categoria) && categoria >= 0 ? categoria : null;
    const guardadas = categoriasGuardadas(await configDelCampus(projectId));
    const tipo = tipoDe(formacion);
    let lectura = null;
    try {
      lectura = await lecturaDelCampus(projectId, conexion, opciones);
    } catch (err) {
      // Sin leer el campus se crea igual si ya se sabe la categoría (elegida o guardada).
      if (!(err instanceof MoodleError) || (elegida === null && !Number.isInteger(guardadas[tipo]))) {
        throw comoAppError(err, 'No se han podido leer las categorías del campus: ');
      }
    }
    cat = elegida ?? categoriaParaTipo(tipo, { guardadas, categorias: lectura?.categorias || [] }).id;
    ocupados.push(...(lectura?.cortos || []));
    base = String(nombreCorto ?? '').trim().replace(/\s+/g, ' ').slice(0, 250) || nombreCortoPropuesto(formacion).valor;
    corto = primeroLibre(base, ocupados);
  }

  let r;
  for (let intento = 0; ; intento += 1) {
    try {
      r = await guardarCursoEnMoodle(conexion, datosDelCurso(formacion, modulos, { cursoId, categoria: cat, nombreCorto: corto }), opciones);
      break;
    } catch (err) {
      // Moodle dice que el nombre corto ya está cogido (uno creado entretanto, o un campus
      // que no dejó leer sus cursos): el siguiente sufijo, unas pocas veces y no más.
      if (err instanceof MoodleError && err.errorcode === 'cursonombrecortorepetido' && !cursoId && intento < MAX_SUFIJOS) {
        ocupados.push(corto);
        corto = primeroLibre(base, ocupados);
        continue;
      }
      throw comoAppError(err);
    }
  }

  await cursosProducto.unir({ productId, projectId, curso: { id: r.cursoId, nombre: r.nombre }, userId, ip });
  vaciarCacheCursosProducto();
  // El curso nuevo ya tiene su nombre corto: la próxima lectura tiene que verlo.
  cache.delete(Number(projectId));
  return { ...r, avisos: (r.avisos || []).map(textoDelAviso), url: enlaceAlCurso(conexion.url, r.cursoId) };
}
