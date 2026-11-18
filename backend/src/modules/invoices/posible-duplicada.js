import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

/*
  ¿POSIBLE DUPLICADA? Antes de EMITIR, no despues. (CRM#819, gemela CRM-ISEIE#500)

  17/11/2026, ISEIE: administracion emitio una factura y luego otra para el
  mismo cobro y el mismo cliente, con el nombre cambiado solo por un espacio.
  El CRM no dijo nada. En MultiCRM ya habia un aviso (`INVOICE_LOOKS_DUPLICATE`,
  la 2026/0102), pero miraba solo la misma venta, el mismo importe y el mismo
  dia, y el frontal no lo enseñaba nunca.

  La regla ahora es una y vale para todos los caminos que emiten (a mano, desde
  la cola, al aprobar un borrador y la emision automatica): hay otra factura NO
  anulada

    - del mismo cliente: el nombre normalizado (sin mayusculas, sin tildes, sin
      espacios repetidos ni al principio o al final) o el mismo NIF, o de la
      misma venta, que es lo que ya miraba el aviso viejo;
    - por el mismo total (±0,01 €);
    - y con fecha a 7 dias o menos.

  No es un muro: dos cobros de verdad iguales la misma semana existen (los de
  Bibiana). Quien emite lo ve y decide; se sigue con `confirmar_duplicada`.
  La emision automatica no puede decidir: no emite, y el cobro se queda en la
  cola con el motivo «posible duplicada».

  Solo facturas normales: una proforma es un presupuesto, un borrador aun no es
  nada y una rectificativa va en negativo. Anular o rectificar no se toca aqui
  (CRM#793).
*/

export const CODIGO = 'POSIBLE_DUPLICADA';
export const MOTIVO_EN_COLA = 'posible duplicada';
export const DIAS = 7;
export const TOLERANCIA = 0.01;

// Las tildes, en minuscula y en mayuscula: `lower()` de Postgres no siempre
// baja las letras acentuadas (depende de la configuracion regional de la base),
// asi que `translate` las coge en los dos casos.
const CON_TILDE = 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_TILDE = 'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc';
export const TABLA_TILDES = { CON_TILDE, SIN_TILDE };

/** El nombre como se compara, en SQL. `expr` es una expresion de texto. */
export const NOMBRE_NORMALIZADO = (expr) => `btrim(regexp_replace(
    translate(lower(replace(COALESCE(${expr}, ''), chr(160), ' ')), '${CON_TILDE}', '${SIN_TILDE}'),
    '\\s+', ' ', 'g'))`;

/** El NIF como se compara, en SQL: solo letras y cifras. Vacio o «—» = NULL. */
export const NIF_NORMALIZADO = (expr) =>
  `NULLIF(regexp_replace(upper(COALESCE(${expr}, '')), '[^A-Z0-9]', '', 'g'), '')`;

/** Lo mismo en JS, para pruebas y para quien lo necesite fuera de SQL. */
export function normalizarNombre(s) {
  return String(s ?? '')
    .replace(/\u00a0/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarNif(s) {
  const n = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return n || null;
}

/*
  La condicion, sobre la factura `i`. Recibe EXPRESIONES SQL (parametros o
  columnas): asi la usan igual la emision, con parametros, y la cola, con las
  columnas del cobro y del cliente.
*/
export function condicionParecida({ nombre, nif, total, fecha, conversionId = 'NULL', excluirId = 'NULL' }) {
  const n = NOMBRE_NORMALIZADO(nombre);
  const f = NIF_NORMALIZADO(nif);
  return `i.tipo = 'normal'
     AND i.estado NOT IN ('cancelada', 'borrador')
     AND (${excluirId}::int IS NULL OR i.id <> ${excluirId}::int)
     AND ABS(i.total - (${total})::numeric) <= ${TOLERANCIA}
     AND ABS(i.fecha_emision::date - COALESCE((${fecha})::date, CURRENT_DATE)) <= ${DIAS}
     AND (
          (${n} <> '' AND ${NOMBRE_NORMALIZADO('i.cliente_nombre')} = ${n})
       OR (${f} IS NOT NULL AND ${NIF_NORMALIZADO('i.cliente_nif')} = ${f})
       OR (${conversionId}::int IS NOT NULL AND i.conversion_id = ${conversionId}::int)
     )`;
}

const COLUMNAS = `i.id, i.codigo, i.fecha_emision::date::text AS fecha,
       i.total::float8 AS total, i.cliente_nombre`;

/** Lo que viaja al frontal: numero, fecha e importe de la otra factura. */
export function comoOtra(r) {
  if (!r) return null;
  return {
    id: r.id,
    numero: r.codigo,
    fecha: r.fecha,
    importe: Number(r.total),
    cliente: r.cliente_nombre || null,
  };
}

/**
 * La otra factura que se parece a la que se va a emitir, o null.
 * `exec(sql, params)` permite usarla dentro de una transaccion abierta.
 */
export async function buscarPosibleDuplicada(
  { nombre, nif, total, fecha = null, conversionId = null, excluirId = null },
  exec = query,
) {
  if (total == null || !Number.isFinite(Number(total))) return null;
  const { rows } = await exec(
    `SELECT ${COLUMNAS}
       FROM invoices i
      WHERE ${condicionParecida({
        nombre: '$1::text', nif: '$2::text', total: '$3', fecha: '$4',
        conversionId: '$5', excluirId: '$6',
      })}
      ORDER BY ABS(i.fecha_emision::date - COALESCE($4::date, CURRENT_DATE)), i.id DESC
      LIMIT 1`,
    [nombre ?? null, nif ?? null, Number(total), fecha || null, conversionId || null, excluirId || null],
  );
  return comoOtra(rows[0]);
}

function fechaLegible(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/** El 409 que para la emision. Lleva la otra factura en `data.otra`. */
export function errorPosibleDuplicada(otra) {
  const importe = Number(otra.importe).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return new AppError(
    `Ya existe la factura ${otra.numero} de este cliente por el mismo importe (${importe} €) `
    + `el día ${fechaLegible(otra.fecha)}. Si de verdad es otra factura, confírmalo para emitirla igualmente.`,
    409, CODIGO, { otra });
}

/**
 * Para antes de numerar. Si hay una parecida y no viene confirmado, lanza el 409.
 * Una proforma, un borrador o una rectificativa no pasan por aqui.
 */
export async function frenarSiPosibleDuplicada(datos, { confirmada = false, exec = query } = {}) {
  if (confirmada) return null;
  const otra = await buscarPosibleDuplicada(datos, exec);
  if (otra) throw errorPosibleDuplicada(otra);
  return null;
}

/** ¿Viene confirmado? Acepta el nombre de la API y los de antes. */
export function vieneConfirmada(d = {}) {
  return d.confirmar_duplicada === true || d.confirmarDuplicada === true || d.permitirParecida === true;
}

/*
  La cola: que cobros se quedarian parados por esta regla si se emitieran
  ahora. Mismo criterio que al emitir --el nombre que llevaria la factura (la
  razon social si es empresa), el NIF del cliente, el importe del cobro, hoy y
  la venta--, en UNA consulta para toda la cola.

  Devuelve un Map payment_id → la otra factura.
*/
export async function duplicadasDeLaCola(paymentIds, exec = query) {
  const ids = (paymentIds || []).map(Number).filter(Number.isInteger);
  if (!ids.length) return new Map();
  const nombreFactura = `COALESCE(NULLIF(CASE WHEN l.cliente_tipo = 'empresa'
        THEN btrim(l.custom_fields->>'razon_social') END, ''), l.nombre)`;
  const { rows } = await exec(
    `SELECT cp.id AS payment_id, o.*
       FROM conversion_payments cp
       JOIN conversions c ON c.id = cp.conversion_id
       LEFT JOIN leads l ON l.id = c.lead_id
       CROSS JOIN LATERAL (
         SELECT ${COLUMNAS}
           FROM invoices i
          WHERE ${condicionParecida({
            nombre: nombreFactura, nif: 'l.identificacion_fiscal', total: 'cp.importe',
            fecha: 'NULL', conversionId: 'c.id',
          })}
          ORDER BY ABS(i.fecha_emision::date - CURRENT_DATE), i.id DESC
          LIMIT 1
       ) o
      WHERE cp.id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [Number(r.payment_id), comoOtra(r)]));
}
