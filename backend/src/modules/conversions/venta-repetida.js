/*
  VENTAS REPETIDAS DEL MISMO ALUMNO Y PROGRAMA (CRM#898, gemela CRM-ISEIE#574).

  Casos reales del 18/11: alumnos con dos, tres o cuatro ventas del mismo
  programa en el mismo campus. Dos maneras de llegar ahí:

    · la gestora crea una venta nueva («Pago inicial») para la segunda cuota
      en vez de apuntar el cobro en la venta que ya existe;
    · una carga desde facturas creó prospectos sin correo, con el mismo nombre
      que el alumno, y una venta por cada factura.

  (El mismo cargo de Stripe apuntado dos veces lo cubre CRM#888.)

  LA REGLA, una sola para el aviso al crear y para la lista de revisar:

    · mismo campus;
    · mismo programa: el mismo producto del catálogo, o el mismo nombre de
      programa (sin tildes ni mayúsculas), que es lo que tienen las ventas
      viejas sin producto enlazado;
    · mismo alumno: el mismo prospecto, o el mismo correo, o el mismo nombre
      normalizado, o uno empieza por el otro palabra a palabra («Ana López» y
      «Ana López García»). Para lo de «empieza por» el más corto tiene que
      tener dos palabras como mínimo: un nombre de pila suelto («Ana») casaría
      con media lista;
    · las ventas marcadas como mensualidad no cuentan: ya dicen que son el
      cobro de una compra anterior.

  Crear otra igualmente se puede (`forzar: true`): queda en la venta quién lo
  forzó, cuándo y de cuál es repetida, y desde entonces esa venta no sale en
  la lista como repetida de las anteriores.
*/

import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { COBRADO_DE } from './cobrado.js';

// Tildes fuera ANTES de pasar a minúsculas: `lower()` de una mayúscula con
// tilde depende del idioma de la base, y con «C» se queda como está.
const CON_TILDE = 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç';
const SIN_TILDE = 'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc';

/** Un texto sin tildes, en minúsculas, sin espacios de sobra. SQL. */
export const NORMALIZADO = (x) =>
  `regexp_replace(lower(translate(btrim(COALESCE(${x}, '')), '${CON_TILDE}', '${SIN_TILDE}')), '[[:space:]]+', ' ', 'g')`;

/** Dos nombres ya normalizados que son la misma persona. SQL. */
export const MISMO_NOMBRE = (a, b) => `(${a} <> '' AND ${b} <> '' AND (
      ${a} = ${b}
   OR (position(' ' in ${b}) > 0 AND left(${a}, length(${b}) + 1) = ${b} || ' ')
   OR (position(' ' in ${a}) > 0 AND left(${b}, length(${a}) + 1) = ${a} || ' ')))`;

/**
 * El programa de una venta, normalizado: el nombre del catálogo si está
 * enlazada, y si no, lo que se escribió. Necesita `c` (conversions) y `p`
 * (products, LEFT JOIN por producto_contratado_id).
 */
const PROGRAMA = NORMALIZADO('COALESCE(p.nombre, c.producto_contratado)');

/** Lo que no dice qué se vendió no se compara: «pendiente de registrar». */
const PROGRAMA_VALIDO = (x) => `(${x} <> '' AND ${x} !~ 'pendiente de registrar')`;

const dinero = (n) => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * La venta que ya tiene este alumno de este programa en este campus, o null.
 *
 * El alumno se dice con `leadId` (si ya está en el CRM; su correo y su nombre
 * salen de la ficha) o con `email` y `nombre` (cliente nuevo, aún sin ficha).
 * El programa, con `productoId` o, sin él, con `productoTexto`.
 *
 * Si hay varias, devuelve primero la que tiene algo pendiente —es donde
 * tiene sentido apuntar el cobro— y, entre ellas, la más antigua. `otras`
 * dice cuántas más hay.
 */
export async function buscarVentaRepetida({ projectId, productoId = null, productoTexto = null, leadId = null, email = null, nombre = null }) {
  if (!projectId || (!productoId && !String(productoTexto || '').trim())) return null;
  if (!leadId && !String(email || '').trim() && !String(nombre || '').trim()) return null;

  const { rows } = await query(
    `WITH yo AS (
       SELECT $3::int AS lead_id,
              NULLIF(lower(btrim(COALESCE(l.email, $4::text))), '') AS email,
              ${NORMALIZADO('COALESCE(l.nombre, $5::text)')} AS nombre
         FROM (SELECT 1) uno LEFT JOIN leads l ON l.id = $3::int
     ), prog AS (
       SELECT $2::int AS id,
              ${NORMALIZADO('COALESCE((SELECT nombre FROM products WHERE id = $2::int), $6::text)')} AS nombre
     ), candidatas AS (
       SELECT c.id, c.lead_id, l.nombre AS alumno, c.producto_contratado AS programa,
              c.fecha_conversion::text AS fecha, c.importe_total::float8 AS total,
              ${COBRADO_DE('c')}::float8 AS cobrado,
              CASE WHEN c.lead_id = yo.lead_id THEN 'mismo_prospecto'
                   WHEN yo.email IS NOT NULL AND lower(btrim(l.email)) = yo.email THEN 'mismo_correo'
                   ELSE 'mismo_nombre' END AS motivo
         FROM conversions c
         JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
         LEFT JOIN products p ON p.id = c.producto_contratado_id
         CROSS JOIN yo CROSS JOIN prog
        WHERE c.project_id = $1
          AND NOT COALESCE(c.es_mensualidad, FALSE)
          AND (c.producto_contratado_id = prog.id
               OR (${PROGRAMA_VALIDO('prog.nombre')} AND ${PROGRAMA} = prog.nombre))
          AND (c.lead_id = yo.lead_id
               OR (yo.email IS NOT NULL AND lower(btrim(l.email)) = yo.email)
               OR ${MISMO_NOMBRE(NORMALIZADO('l.nombre'), 'yo.nombre')})
     )
     SELECT *, GREATEST(total - cobrado, 0) AS pendiente, COUNT(*) OVER () AS cuantas
       FROM candidatas
      ORDER BY (total - cobrado > 0.005) DESC, fecha, id`,
    [projectId, productoId || null, leadId || null, email || null, nombre || null, productoTexto || null]
  );
  if (!rows[0]) return null;
  const v = rows[0];
  return {
    id: v.id,
    lead_id: v.lead_id,
    alumno: v.alumno,
    programa: v.programa,
    fecha: v.fecha,
    total: Number(v.total),
    cobrado: Number(v.cobrado),
    pendiente: Number(v.pendiente),
    motivo: v.motivo,
    otras: Number(v.cuantas) - 1,
  };
}

/** El 409 que devuelve el alta cuando la venta ya existe. */
export function errorVentaYaExiste(venta) {
  return new AppError(
    `Este alumno ya tiene una venta de este programa (total ${dinero(venta.total)}, pendiente ${dinero(venta.pendiente)}). `
      + 'Apunta el cobro en esa venta o, si de verdad es otra compra, créala igualmente.',
    409, 'VENTA_YA_EXISTE', { venta });
}

/**
 * Deja dicho en la venta nueva que se creó sabiendo que repetía otra.
 * `db` es el cliente de la transacción o cualquier cosa con `.query`.
 */
export async function apuntarForzada(conversionId, repetidaDe, userId, db = { query }) {
  await db.query(
    `UPDATE conversions
        SET repetida_de = $2, repetida_forzada_por = $3, repetida_forzada_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [conversionId, repetidaDe, userId || null]);
}

/**
 * Los grupos de ventas que cumplen la regla, para revisarlas.
 *
 * `campus`: null = todos; si no, la lista de campus. `personas`: null = sin
 * recortar; si no, solo los grupos con alguna venta de esas personas (como
 * responsable del prospecto o como vendedora): una gestora, lo suyo.
 *
 * Se buscan PAREJAS en SQL (el programa se compara por igualdad, que va por
 * hash, y el alumno dentro de cada programa) y se juntan en grupos aquí: si A
 * repite con B y B con C, las tres van juntas.
 */
export async function posiblesRepetidas({ campus = null, personas = null } = {}) {
  const { rows: parejas } = await query(
    `WITH v AS MATERIALIZED (
       SELECT c.id, c.project_id, c.lead_id, c.repetida_forzada_at,
              ${PROGRAMA} AS programa,
              ${NORMALIZADO('l.nombre')} AS nombre,
              NULLIF(lower(btrim(l.email)), '') AS email
         FROM conversions c
         JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
         LEFT JOIN products p ON p.id = c.producto_contratado_id
        WHERE NOT COALESCE(c.es_mensualidad, FALSE)
          AND ($1::int[] IS NULL OR c.project_id = ANY($1::int[]))
     )
     SELECT a.id AS a, b.id AS b
       FROM v a
       JOIN v b ON b.project_id = a.project_id AND b.programa = a.programa AND b.id > a.id
      WHERE ${PROGRAMA_VALIDO('a.programa')}
        AND (a.lead_id = b.lead_id
             OR (a.email IS NOT NULL AND a.email = b.email)
             OR ${MISMO_NOMBRE('a.nombre', 'b.nombre')})
        -- La que se creó forzando ya se vio con el aviso delante: no vuelve
        -- a salir como repetida de las de antes.
        AND b.repetida_forzada_at IS NULL`,
    [campus]
  );
  if (!parejas.length) return [];

  // Grupos: unión de parejas.
  const padre = new Map();
  const raiz = (x) => {
    while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); }
    return x;
  };
  for (const { a, b } of parejas) {
    if (!padre.has(a)) padre.set(a, a);
    if (!padre.has(b)) padre.set(b, b);
    const ra = raiz(a); const rb = raiz(b);
    if (ra !== rb) padre.set(Math.max(ra, rb), Math.min(ra, rb));
  }
  const ids = [...padre.keys()];

  const { rows: ventas } = await query(
    `SELECT c.id, c.project_id, pr.nombre AS campus, c.lead_id, l.nombre AS alumno, l.email,
            c.producto_contratado AS programa, c.fecha_conversion::text AS fecha,
            c.importe_total::float8 AS total, ${COBRADO_DE('c')}::float8 AS cobrado,
            COALESCE(c.vendedora_id, l.responsable_id) AS gestora_id, u.nombre AS gestora,
            l.responsable_id, c.vendedora_id,
            c.repetida_forzada_at, uf.nombre AS forzada_por
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       JOIN projects pr ON pr.id = c.project_id
       LEFT JOIN users u ON u.id = COALESCE(c.vendedora_id, l.responsable_id)
       LEFT JOIN users uf ON uf.id = c.repetida_forzada_por
      WHERE c.id = ANY($1::int[])
      ORDER BY c.fecha_conversion, c.id`,
    [ids]
  );

  const grupos = new Map();
  for (const v of ventas) {
    const r = raiz(v.id);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push({
      id: v.id, project_id: v.project_id, campus: v.campus, lead_id: v.lead_id,
      alumno: v.alumno, email: v.email, programa: v.programa, fecha: v.fecha,
      total: Number(v.total), cobrado: Number(v.cobrado),
      pendiente: Math.max(Number(v.total) - Number(v.cobrado), 0),
      gestora_id: v.gestora_id, gestora: v.gestora,
      forzada_por: v.repetida_forzada_at ? (v.forzada_por || 'sin usuario') : null,
      _personas: [v.responsable_id, v.vendedora_id].filter((x) => x != null).map(Number),
    });
  }

  const dePersonas = personas ? new Set(personas.map(Number)) : null;
  return [...grupos.values()]
    .filter((g) => g.length > 1)
    .filter((g) => !dePersonas || g.some((v) => v._personas.some((p) => dePersonas.has(p))))
    .map((g) => ({
      project_id: g[0].project_id,
      campus: g[0].campus,
      alumno: g[0].alumno,
      programa: g[0].programa,
      ventas: g.map(({ _personas, ...v }) => v),
    }))
    .sort((x, y) => (y.ventas.at(-1).fecha || '').localeCompare(x.ventas.at(-1).fecha || ''));
}
