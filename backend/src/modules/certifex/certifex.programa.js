import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * El programa oficial de la formación que compró el alumno, para el diploma (#272).
 *
 * Moodle sabe qué actividades hizo; el CRM sabe QUÉ FORMACIÓN VENDIÓ, con sus horas
 * (`products.horas`, texto tipo «1.500 horas») y su temario (`product_modules`). Al
 * emitir, el CRM manda ese programa y Certifex lo imprime en lugar de lo de Moodle.
 *
 * Cómo se encuentra la formación, sin adivinar:
 *   1. El campus de Certifex (ISEIE, PSIKO…) se casa con UN proyecto del CRM por su
 *      nombre o su slug (PSIKO → «Psiko Aprende»). Ninguno o varios: sin programa.
 *   2. Las ventas de ese proyecto a una ficha con el correo del alumno, enlazadas a un
 *      producto del catálogo.
 *   3. De esas, la que se llama como el curso de Moodle. Exactamente una: su programa.
 *      Ninguna o varias: sin programa, y se dice por qué.
 * Sin programa, Certifex usa lo de Moodle; el panel lo enseña antes de aprobar.
 *
 * Lo que una persona revisó a mano en el panel (migración 230, «Editar») manda sobre
 * esa búsqueda, por candidato:
 *   · `emailCrm`: las ventas se buscan con ese correo y no con el de Moodle.
 *   · `productoId`: esa formación del catálogo, encaje o no con el curso.
 *   · `programaEditado`: se imprime eso, sin más (y se marca `editado: true`).
 */

/** Mismos límites que valida Certifex (validarProgramaCrm): pasarse anula la tanda entera. */
const MAX_HORAS = 5000;
const MAX_MODULOS = 100;
const MAX_HORAS_MODULO = 2000;
const MAX_MODALIDAD = 60;

/**
 * La modalidad del catálogo (`products.modalidad`: «Online», «Presencial»…), lista para
 * Certifex, que la imprime en el diploma (Certifex#96). Texto corto o nada: si no cabe, no
 * se manda y el diploma dice «Online», como siempre.
 */
export function modalidadDe(v) {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t && t.length <= MAX_MODALIDAD ? t : null;
}

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const compacto = (s) => norm(s).replace(/ /g, '');

/**
 * Las horas del texto del catálogo (`products.horas`), sin adivinar:
 *   «1.500 horas», «1,500 horas» (coma de miles, México y Colombia), «1 500 h» → 1500;
 *   «120 h» → 120; «60 ECTS - 1500 horas» → 1500; «6 meses (600 horas)» → 600.
 * Regla: el número que va delante de «h»/«horas». Si hay varios distintos ligados a
 * horas, o un rango («De 120 a 150 horas»), null: es ambiguo y se imprime en un diploma.
 * Sin «h»/«horas», solo vale un texto que sea un número y nada más («1500»).
 * Fuera de 1..5000, o sin número: null.
 */
export function horasDeTexto(t) {
  if (t == null) return null;
  // Separador de miles: punto, coma o espacio (`\s` ya incluye los duros de «1 500»)
  // seguido de exactamente tres cifras. «1,5 horas» no lo es: se queda como está.
  const s = String(t).replace(/(\d)[.,\s](?=\d{3}(?!\d))/g, '$1').trim();
  const valida = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX_HORAS ? n : null);
  // Con decimales («1,5 horas») se captura entero y luego no vale: no son horas enteras.
  const conHoras = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*h(?:oras?|rs?)?(?![\p{L}\d])/giu)];
  if (conHoras.length === 0) return /^\d+$/.test(s) ? valida(Number(s)) : null;
  const distintos = [...new Set(conHoras.map((m) => (/^\d+$/.test(m[1]) ? Number(m[1]) : NaN)))];
  if (distintos.length > 1) return null;
  // Un rango: otro número ligado a este por «a», «al», «-», «hasta», «y», «o» o «/».
  for (const m of conHoras) {
    if (/\d\s*(?:a|al|hasta|y|o|-|–|—|\/)\s*$/iu.test(s.slice(0, m.index))) return null;
  }
  return valida(distintos[0]);
}

/** ¿El producto vendido es este curso? Mismo nombre, o uno contiene al otro (largo). */
export function encaja(producto, curso) {
  const a = norm(producto);
  const b = norm(curso);
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 8 && ` ${b} `.includes(` ${a} `)) || (b.length >= 8 && ` ${a} `.includes(` ${b} `));
}

/** Los proyectos del CRM (sin los de prueba) que corresponden a un campus de Certifex. */
export function proyectosDeCentro(centro, proyectos) {
  const c = compacto(centro);
  if (!c) return [];
  // Si alguno coincide EXACTO, solo esos (30/10): «ICTESS» casaba con ICTESS y con
  // ICTESS US, y con dos campus el centro no era de nadie (Yosbely no veía diplomas).
  const exactos = proyectos.filter((p) => compacto(p.nombre) === c || compacto(p.slug) === c);
  if (exactos.length) return exactos;
  return proyectos.filter((p) => compacto(p.nombre).startsWith(c) || compacto(p.slug).startsWith(c));
}

/**
 * Un programa escrito a mano, con los mismos límites que Certifex: horas enteras de
 * 1 a 5000, hasta 100 módulos, título de 1 a 300 caracteres y horas de módulo de 0 a
 * 2000. Algo que no cumpla: null (y no se manda).
 */
export function programaValido(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  let horas = null;
  if (p.horas != null) {
    const h = Number(p.horas);
    if (!Number.isInteger(h) || h < 1 || h > MAX_HORAS) return null;
    horas = h;
  }
  const lista = p.modulos == null ? [] : p.modulos;
  if (!Array.isArray(lista) || lista.length > MAX_MODULOS) return null;
  const modulos = [];
  for (const m of lista) {
    const titulo = typeof m?.titulo === 'string' ? m.titulo.replace(/\s+/g, ' ').trim() : '';
    if (!titulo || titulo.length > 300) return null;
    if (m.horas != null) {
      const h = Number(m.horas);
      if (!Number.isInteger(h) || h < 0 || h > MAX_HORAS_MODULO) return null;
      modulos.push({ titulo, horas: h });
    } else {
      modulos.push({ titulo });
    }
  }
  if (horas == null && modulos.length === 0) return null;
  const modalidad = modalidadDe(p.modalidad);
  return { ...(horas != null ? { horas } : {}), modulos, ...(modalidad ? { modalidad } : {}) };
}

function programaDe(producto, modulos) {
  const horas = horasDeTexto(producto.horas);
  const lista = modulos
    .map((m) => {
      const titulo = String(m.titulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const h = Number(m.horas);
      return titulo ? { titulo, ...(m.horas != null && Number.isInteger(h) && h >= 0 && h <= MAX_HORAS_MODULO ? { horas: h } : {}) } : null;
    })
    .filter(Boolean)
    .slice(0, MAX_MODULOS);
  if (horas == null && lista.length === 0) return null;
  // La modalidad viaja con las horas y el temario; sola no hace un programa.
  const modalidad = modalidadDe(producto.modalidad);
  return { ...(horas != null ? { horas } : {}), modulos: lista, ...(modalidad ? { modalidad } : {}) };
}

/** Los módulos del catálogo de esos productos, por producto y en su orden. */
async function modulosDe(ids) {
  const modsDe = new Map();
  if (!ids.length) return modsDe;
  const { rows } = await query(
    `SELECT product_id, titulo, horas FROM product_modules
      WHERE product_id = ANY($1::int[]) ORDER BY product_id, orden, id`,
    [ids],
  );
  for (const m of rows) {
    if (!modsDe.has(m.product_id)) modsDe.set(m.product_id, []);
    modsDe.get(m.product_id).push(m);
  }
  return modsDe;
}

const formacionDe = (p) => ({ id: p.product_id ?? p.id, nombre: p.nombre, numModulos: p.num_modulos ?? null });

/**
 * Para cada candidato `{ matriculaId, centro, email, curso, emailCrm?, productoId?,
 * programaEditado? }` (curso = nombre en Moodle), el programa a imprimir:
 * `{ programa, formacion, motivo, editado, elegida }`. `programa` null = se usará lo de
 * Moodle, y `motivo` dice por qué. Si lo revisado a mano cambia el resultado, `auto`
 * trae lo que habría salido solo (para «Automática» en el panel).
 *
 * Si la base del CRM no contesta:
 *  · en los listados (por defecto) no lanza: sin programa, con el motivo;
 *  · con `estricto` (al aprobar y emitir) LANZA. Emitir con lo de Moodle porque la base
 *    se cayó un momento imprimiría un diploma que no se puede borrar con lo que no era.
 */
export async function programasPara(candidatos, { estricto = false } = {}) {
  const out = new Map();
  if (!candidatos.length) return out;
  try {
    // El correo con el que se busca: el revisado a mano, si lo hay; si no, el de Moodle.
    const correoDe = (c) => String(c.emailCrm || c.email || '').trim().toLowerCase();
    const correos = [...new Set(candidatos.map(correoDe).filter(Boolean))];
    const elegidos = [...new Set(candidatos.map((c) => Number(c.productoId)).filter((n) => Number.isInteger(n) && n > 0))];
    const [{ rows: proyectos }, { rows: ventas }, { rows: catalogo }] = await Promise.all([
      query(`SELECT id, nombre, slug FROM projects WHERE NOT COALESCE(es_prueba, false)`),
      correos.length
        ? query(
          `SELECT lower(l.email) AS email, c.project_id, c.producto_contratado AS vendido,
                  p.id AS product_id, p.nombre, p.horas, p.num_modulos, p.modalidad
             FROM conversions c
             JOIN leads l ON l.id = c.lead_id
             LEFT JOIN products p ON p.id = c.producto_contratado_id
            WHERE l.deleted_at IS NULL AND lower(l.email) = ANY($1::text[])`,
          [correos],
        )
        : { rows: [] },
      elegidos.length
        ? query(`SELECT id AS product_id, nombre, horas, num_modulos, modalidad FROM products WHERE id = ANY($1::int[])`, [elegidos])
        : { rows: [] },
    ]);
    const productos = new Map(catalogo.map((p) => [p.product_id, p]));
    const modsDe = await modulosDe([...new Set([...ventas.map((v) => v.product_id), ...elegidos].filter(Boolean))]);

    // La busqueda de siempre: campus -> proyecto -> ventas de ese correo -> la que encaja.
    const automatico = (c) => {
      const sin = (motivo, formacion = null) => ({ programa: null, formacion, motivo });
      const email = correoDe(c);
      const conCorreo = c.emailCrm ? ` con el correo ${email}` : '';
      if (!email) return sin('Sin correo: no se puede buscar su venta en el CRM.');
      const proys = proyectosDeCentro(c.centro, proyectos);
      if (proys.length === 0) return sin(`Ningún proyecto del CRM corresponde al campus ${c.centro}.`);
      if (proys.length > 1) return sin(`Varios proyectos del CRM podrían ser el campus ${c.centro} (${proys.map((p) => p.nombre).join(', ')}).`);
      const proyecto = proys[0];
      const suyas = ventas.filter((v) => v.email === email && v.project_id === proyecto.id);
      if (suyas.length === 0) return sin(`No tiene ninguna venta en ${proyecto.nombre}${conCorreo}.`);
      const conProducto = [...new Map(suyas.filter((v) => v.product_id).map((v) => [v.product_id, v])).values()];
      if (conProducto.length === 0) return sin('Su venta no está enlazada a una formación del catálogo.');
      const encajan = conProducto.filter((v) => encaja(v.nombre, c.curso));
      if (encajan.length === 0) {
        return sin(`Ninguna formación vendida coincide con el curso «${c.curso}» (vendida: ${conProducto.map((v) => v.nombre).join(', ')}).`);
      }
      if (encajan.length > 1) return sin(`Varias formaciones vendidas encajan con el curso: ${encajan.map((v) => v.nombre).join(', ')}.`);
      const p = encajan[0];
      const formacion = formacionDe(p);
      const programa = programaDe(p, modsDe.get(p.product_id) ?? []);
      if (!programa) return sin(`«${p.nombre}» no tiene horas ni módulos en el CRM.`, formacion);
      return { programa, formacion, motivo: null };
    };

    for (const c of candidatos) {
      const auto = automatico(c);
      const productoId = Number(c.productoId) || null;
      const editado = c.programaEditado != null ? programaValido(c.programaEditado) : null;
      if (!productoId && !editado && c.programaEditado == null) {
        out.set(c.matriculaId, { ...auto, editado: false, elegida: false });
        continue;
      }
      // La formacion elegida a mano, encaje o no por nombre con el curso de Moodle.
      const p = productoId ? productos.get(productoId) : null;
      const formacion = p ? formacionDe(p) : null;
      if (editado) {
        out.set(c.matriculaId, { programa: editado, formacion, motivo: null, editado: true, elegida: !!p, auto });
        continue;
      }
      // Escrito a mano pero ya no vale: no se cae en silencio a la formación ni a lo automático.
      if (c.programaEditado != null) {
        out.set(c.matriculaId, { programa: null, formacion, motivo: 'El programa escrito a mano no cumple los límites de Certifex: vuelve a editarlo.', editado: false, elegida: !!p, auto });
        continue;
      }
      if (!p) {
        out.set(c.matriculaId, { programa: null, formacion: null, motivo: 'La formación elegida ya no está en el catálogo del CRM.', editado: false, elegida: true, auto });
        continue;
      }
      const programa = programaDe(p, modsDe.get(p.product_id) ?? []);
      out.set(c.matriculaId, programa
        ? { programa, formacion, motivo: null, editado: false, elegida: true, auto }
        : { programa: null, formacion, motivo: `«${p.nombre}» no tiene horas ni módulos en el CRM.`, editado: false, elegida: true, auto });
    }
  } catch (e) {
    logger.warn({ err: e.message, estricto }, 'Certifex: no se pudo buscar el programa en el CRM');
    if (estricto) {
      throw new AppError('No se pudo consultar el CRM para buscar el programa de la formación: no se ha aprobado ni emitido nada. Prueba de nuevo en un momento.', 503, 'CRM_NO_CONTESTA');
    }
    for (const c of candidatos) {
      if (!out.has(c.matriculaId)) out.set(c.matriculaId, { programa: null, formacion: null, motivo: 'No se pudo consultar el CRM.', editado: false, elegida: false });
    }
  }
  return out;
}

/**
 * El proyecto del CRM de un campus de Certifex: `{ proyecto }` si casa con exactamente
 * uno; si no, `{ proyecto: null, motivo }`.
 */
export async function proyectoDeCentro(centro) {
  const { rows } = await query(`SELECT id, nombre, slug FROM projects WHERE NOT COALESCE(es_prueba, false)`);
  const proys = proyectosDeCentro(centro, rows);
  if (proys.length === 0) return { proyecto: null, motivo: `Ningún proyecto del CRM corresponde al campus ${centro}.` };
  if (proys.length > 1) return { proyecto: null, motivo: `Varios proyectos del CRM podrían ser el campus ${centro} (${proys.map((p) => p.nombre).join(', ')}).` };
  return { proyecto: { id: proys[0].id, nombre: proys[0].nombre }, motivo: null };
}

/**
 * Las formaciones del catálogo del proyecto de ese campus, para elegir a mano la
 * vendida: id, nombre, horas (número) y sus módulos. Las activas primero.
 */
export async function formacionesDeCentro(centro) {
  const { proyecto, motivo } = await proyectoDeCentro(centro);
  if (!proyecto) return { proyecto: null, motivo, formaciones: [] };
  const { rows } = await query(
    `SELECT id, nombre, horas, num_modulos, active FROM products
      WHERE project_id = $1 ORDER BY active DESC, nombre, id`,
    [proyecto.id],
  );
  const modsDe = await modulosDe(rows.map((p) => p.id));
  const formaciones = rows.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    activa: p.active !== false,
    horas: horasDeTexto(p.horas),
    numModulos: p.num_modulos ?? null,
    modulos: programaDe(p, modsDe.get(p.id) ?? [])?.modulos ?? [],
  }));
  return { proyecto, motivo: null, formaciones };
}

/** Lo que hace falta de una fila de Certifex para buscar su programa. */
export const datosDeCandidato = (c) => ({
  matriculaId: c.matriculaId, centro: c.centro, email: c.titular?.email ?? null, curso: c.curso?.nombre ?? '',
  // Lo revisado a mano en el panel (ver `conEdicion` en certifex.diplomas.js).
  emailCrm: c.edicion?.emailCrm ?? null,
  productoId: c.edicion?.productoId ?? null,
  programaEditado: c.edicion?.programaEditado ?? null,
});

/** ¿Alguien revisó a mano con qué datos se trabaja (correo del CRM, formación o programa)? */
export const tieneEdicion = (d) => !!(d && (d.emailCrm || d.productoId != null || d.programaEditado != null));
