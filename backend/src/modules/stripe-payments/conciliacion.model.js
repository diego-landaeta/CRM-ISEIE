import { query } from '../../shared/config/db.js';
import { MARGEN } from '../conversions/saldar-cuotas.js';
import { NORMALIZADO, MISMO_NOMBRE } from '../conversions/venta-repetida.js';
import { COBRADO_DE } from '../conversions/cobrado.js';

/*
  CONCILIACIÓN › CARGOS DE STRIPE (CRM#906). Las consultas.

  Un cargo «sin enlazar» es uno cobrado en Stripe que no está en ningún cobro del
  CRM: `status = 'succeeded'`, sin `conversion_payment_id` y sin reembolsar. Es lo
  que Diego contó el 18/11 (334 en el 360; 246 tras enlazar 88 a mano).

  Las reglas para casarlo NO son nuevas, son las de siempre:
    · el importe, con el margen de un euro de `findPagoDuplicado` (`MARGEN`);
    · la fecha, a tres días o menos, como el vigilante y «sin equivalente»;
    · el alumno, con la regla de ventas repetidas (CRM#898): el mismo correo, o
      el mismo nombre sin tildes, o uno que empieza por el otro palabra a palabra;
    · un cobro que ya tiene otro cargo cobrado no se ofrece (`enlazarConCobro` lo
      rechazaría con 409 COBRO_YA_TIENE_CARGO).
  Enlazar lo hace `enlazarConCobro` (CRM#888/#892); apuntar el cobro en una venta,
  `manualLink`. Aquí solo se busca.
*/

const DIAS = 3;
const SIN_ENLAZAR = `sp.status = 'succeeded'
        AND sp.conversion_payment_id IS NULL
        AND COALESCE(sp.refunded, false) = false`;

/** El primer día del mes `AAAA-MM`, o null. */
export function inicioDelMes(mes) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes || '')) ? `${mes}-01` : null;
}

/**
 * Los cargos sin enlazar de esos campus (y de ese mes, si se dice). `holgura`
 * ensancha el mes tres días por cada lado: un cobro del día 1 puede casar con un
 * cargo del 30 del mes anterior, y para saber si un cobro es «seguro» hay que ver
 * todos los cargos que lo piden.
 */
async function cargos(projectIds, mes, { holgura = false } = {}) {
  const desde = inicioDelMes(mes);
  const { rows } = await query(
    `SELECT sp.id, sp.project_id, p.nombre AS proyecto, sp.stripe_id,
            sp.amount::float8 AS importe, sp.stripe_created_at::date::text AS fecha,
            sp.stripe_created_at, sp.customer_email, sp.customer_name, sp.description,
            sp.lead_id, sp.conversion_id, UPPER(COALESCE(sp.currency, 'EUR')) AS moneda
       FROM stripe_payments sp
       JOIN projects p ON p.id = sp.project_id
      WHERE sp.project_id = ANY($1::int[])
        AND ${SIN_ENLAZAR}
        AND ($2::date IS NULL OR (
              sp.stripe_created_at::date >= $2::date - ($3::int * $4::int)
          AND sp.stripe_created_at::date <  ($2::date + interval '1 month')::date + ($3::int * $4::int)))
      ORDER BY sp.stripe_created_at DESC, sp.id DESC
      LIMIT 2000`,
    [projectIds, desde, holgura ? DIAS : 0, 1],
  );
  return rows;
}

/**
 * Las parejas cargo ↔ cobro que casan: mismo campus, importe con un euro de
 * margen, fechas a tres días o menos y el mismo alumno (correo o nombre). También
 * el cobro de la venta que el cargo ya tiene apuntada (`conversion_id`): es el
 * caso de un cobro borrado y vuelto a apuntar (19/10).
 */
async function parejasConCobro(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `WITH k AS (
       SELECT sp.id, sp.project_id, sp.amount, sp.stripe_created_at::date AS fecha, sp.conversion_id,
              NULLIF(lower(btrim(sp.customer_email)), '') AS email,
              ${NORMALIZADO('sp.customer_name')} AS nombre
         FROM stripe_payments sp WHERE sp.id = ANY($1::int[])
     )
     SELECT k.id AS cargo_id, cp.id, cp.conversion_id, cp.importe::float8 AS importe, cp.fecha::text AS fecha,
            cp.metodo, c.lead_id, l.nombre AS alumno, l.email, c.producto_contratado AS programa,
            f.id AS factura_id, f.codigo AS factura_codigo,
            CASE WHEN k.conversion_id = c.id THEN 'venta'
                 WHEN k.email IS NOT NULL AND lower(btrim(l.email)) = k.email THEN 'correo'
                 ELSE 'nombre' END AS por
       FROM k
       JOIN conversions c ON c.project_id = k.project_id
       JOIN conversion_payments cp ON cp.conversion_id = c.id
       JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT i.id, i.codigo FROM invoices i
          WHERE i.payment_id = cp.id AND i.tipo <> 'proforma' AND i.estado <> 'cancelada'
          ORDER BY i.id DESC LIMIT 1
       ) f ON true
      WHERE ABS(cp.importe - k.amount) <= ${MARGEN}
        -- Un cobro que entró por PayPal o por el banco no es de un cargo de Stripe.
        AND cp.origen IS NULL
        AND ABS(cp.fecha - k.fecha) <= ${DIAS}
        AND NOT EXISTS (SELECT 1 FROM stripe_payments s2
                         WHERE s2.conversion_payment_id = cp.id AND s2.status = 'succeeded')
        AND (k.conversion_id = c.id
             OR (k.email IS NOT NULL AND lower(btrim(l.email)) = k.email)
             OR ${MISMO_NOMBRE(NORMALIZADO('l.nombre'), 'k.nombre')})
      ORDER BY k.id, ABS(cp.importe - k.amount), ABS(cp.fecha - k.fecha), cp.id`,
    [ids],
  );
  return rows;
}

/**
 * Las ventas del alumno de cada cargo (para «Apuntar el cobro en esa venta»):
 * la que el cargo ya tiene apuntada, y las del mismo correo o nombre en su
 * campus. Primero las que tienen algo pendiente. Cinco por cargo como mucho.
 */
async function ventasDelAlumno(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `WITH k AS (
       SELECT sp.id, sp.project_id, sp.conversion_id,
              NULLIF(lower(btrim(sp.customer_email)), '') AS email,
              ${NORMALIZADO('sp.customer_name')} AS nombre
         FROM stripe_payments sp WHERE sp.id = ANY($1::int[])
     ),
     -- Cada venta del campus con su alumno, el correo y el nombre ya normalizados
     -- UNA vez (#656). Antes se normalizaban en cada pareja cargo × venta: con
     -- «Todos los meses» en ISEIE eran 924 × 489 = 452.000 normalizaciones y
     -- 37 s; Cloudflare cortaba con 504. MATERIALIZED para que Postgres no lo
     -- vuelva a meter dentro del cruce.
     cl AS MATERIALIZED (
       SELECT c.id, c.project_id, c.lead_id, l.nombre AS alumno, l.email,
              c.producto_contratado AS programa, c.fecha_conversion, c.importe_total,
              lower(btrim(l.email)) AS email_n,
              ${NORMALIZADO('l.nombre')} AS nombre_n
         FROM conversions c
         JOIN leads l ON l.id = c.lead_id AND l.deleted_at IS NULL
        WHERE c.project_id IN (SELECT DISTINCT project_id FROM k)
     ), v AS (
       SELECT k.id AS cargo_id, cl.id, cl.lead_id, cl.alumno, cl.email,
              cl.programa, cl.fecha_conversion::text AS fecha,
              cl.importe_total::float8 AS total, ${COBRADO_DE('cl')}::float8 AS cobrado,
              CASE WHEN k.conversion_id = cl.id THEN 'venta'
                   WHEN k.email IS NOT NULL AND cl.email_n = k.email THEN 'correo'
                   ELSE 'nombre' END AS por
         FROM k
         JOIN cl ON cl.project_id = k.project_id
        WHERE k.conversion_id = cl.id
           OR (k.email IS NOT NULL AND cl.email_n = k.email)
           OR ${MISMO_NOMBRE('cl.nombre_n', 'k.nombre')}
     )
     SELECT * FROM (
       SELECT v.*, GREATEST(v.total - v.cobrado, 0)::float8 AS pendiente,
              ROW_NUMBER() OVER (PARTITION BY v.cargo_id
                                 ORDER BY (v.por = 'venta') DESC, (v.total - v.cobrado > 0.005) DESC,
                                          v.fecha DESC NULLS LAST, v.id DESC) AS n
         FROM v
     ) x
     WHERE n <= 5
     ORDER BY cargo_id, n`,
    [ids],
  );
  return rows.map(({ n, ...r }) => r); // eslint-disable-line no-unused-vars
}

/** La ficha del alumno por el correo del cargo, si la hay (para crear la venta en ella). */
async function fichasPorCorreo(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT DISTINCT ON (sp.id) sp.id AS cargo_id, l.id, l.nombre, l.responsable_id
       FROM stripe_payments sp
       JOIN leads l ON l.project_id = sp.project_id AND l.deleted_at IS NULL
                   AND NULLIF(btrim(sp.customer_email), '') IS NOT NULL
                   AND lower(btrim(l.email)) = lower(btrim(sp.customer_email))
      WHERE sp.id = ANY($1::int[])
      ORDER BY sp.id, l.id DESC`,
    [ids],
  );
  return rows;
}

const agrupar = (filas) => {
  const m = new Map();
  for (const f of filas) {
    if (!m.has(f.cargo_id)) m.set(f.cargo_id, []);
    const { cargo_id, ...resto } = f; // eslint-disable-line no-unused-vars
    m.get(f.cargo_id).push(resto);
  }
  return m;
};

/**
 * La lista de la pantalla: cada cargo sin enlazar del mes con sus cobros
 * candidatos, las ventas del alumno y si es «seguro».
 *
 * SEGURO = el cargo tiene un solo cobro candidato y ese cobro solo lo pide este
 * cargo (entre todos los sin enlazar del campus, también los de los días del mes
 * de al lado). Si dos cargos de 100 € del mismo alumno caen la misma semana, ninguno
 * es seguro: lo decide una persona.
 */
export async function conciliar(projectIds, mes) {
  const vistos = await cargos(projectIds, mes, { holgura: true });
  const desde = inicioDelMes(mes);
  const hasta = desde ? new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)), 1)).toISOString().slice(0, 10) : null;
  const enElMes = (c) => !desde || (c.fecha >= desde && c.fecha < hasta);

  const todos = vistos.map((c) => c.id);
  const parejas = await parejasConCobro(todos);
  const porCargo = agrupar(parejas);
  const cargosDelCobro = new Map();
  for (const p of parejas) cargosDelCobro.set(p.id, (cargosDelCobro.get(p.id) || 0) + 1);

  const delMes = vistos.filter(enElMes);
  const ids = delMes.map((c) => c.id);
  const ventas = agrupar(await ventasDelAlumno(ids));
  const fichas = new Map((await fichasPorCorreo(ids)).map(({ cargo_id, ...f }) => [cargo_id, f]));

  const filas = delMes.map((c) => {
    const cobros = (porCargo.get(c.id) || []).map((cp) => ({ ...cp, otrosCargos: (cargosDelCobro.get(cp.id) || 1) - 1 }));
    const seguro = cobros.length === 1 && cobros[0].otrosCargos === 0;
    const susVentas = ventas.get(c.id) || [];
    const { stripe_created_at, ...resto } = c; // eslint-disable-line no-unused-vars
    return {
      ...resto,
      cobros,
      ventas: susVentas,
      ficha: fichas.get(c.id) || null,
      seguro,
      // Lo que toca: enlazar con su cobro, apuntarlo en una venta del alumno o crear la venta.
      sugerencia: cobros.length ? 'enlazar' : susVentas.length ? 'apuntar' : 'crear',
    };
  });
  return filas;
}

/** Lo que queda por mes en esos campus (para el selector y la cabecera). */
export async function porMes(projectIds) {
  const { rows } = await query(
    `SELECT to_char(sp.stripe_created_at, 'YYYY-MM') AS mes, COUNT(*)::int AS cargos,
            ROUND(SUM(sp.amount), 2)::float8 AS importe
       FROM stripe_payments sp
      WHERE sp.project_id = ANY($1::int[]) AND ${SIN_ENLAZAR}
      GROUP BY 1 ORDER BY 1 DESC`,
    [projectIds],
  );
  return rows;
}

/** Los productos y las vendedoras de un campus, para «Crear la venta». */
export async function opcionesDeVenta(projectId) {
  const [{ rows: productos }, { rows: vendedoras }] = await Promise.all([
    query(
      `SELECT id, nombre, precio::float8 AS precio FROM products
        WHERE project_id = $1 AND active ORDER BY nombre LIMIT 1000`,
      [projectId]),
    query(
      `SELECT u.id, u.nombre, u.role FROM users u
         JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active
        WHERE u.active AND u.role IN ('gestor', 'admin')
        ORDER BY u.nombre`,
      [projectId]),
  ]);
  return { productos, vendedoras };
}
