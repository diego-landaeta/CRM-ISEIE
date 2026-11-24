import { AppError } from '../../shared/utils/AppError.js';

/*
  LA FECHA VA EN EL ORDEN DEL NÚMERO (CRM#764, 24/11/2026).

  En una serie fiscal el número y la fecha suben juntos: la 2026/0040 no puede
  llevar una fecha anterior a la de la 0039, ni una posterior a la de la 0041.
  Es lo que pide la #764 («que la fecha nunca sea anterior a la de la última
  factura de la serie») y lo que mira cualquier inspección.

  Hasta hoy había tres caminos que lo rompían sin decir nada:
    · crear una factura con `fechaEmision` elegida a mano;
    · «Cambiar fechas» de una emitida (PATCH /:id/fechas);
    · emitir un borrador viejo: conservaba la fecha del día en que se guardó
      (la columna la rellena sola al crearlo), con un número de hoy.

  La regla es una y la usan los tres, dentro de la misma transacción que da el
  número. Rellenar un hueco antiguo sigue siendo posible (Diego, 19/11), pero
  con una fecha que quepa entre sus vecinas.

  Solo mira las facturas CON número: un borrador aún no es nada. Una proforma
  sí cuenta, porque toma número de la serie fiscal (Diego, 19/11).
*/

export const CODIGO = 'FECHA_FUERA_DE_ORDEN';

const ddmmaaaa = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};
const codigoDe = (ano, numero) => `${ano}/${String(numero).padStart(4, '0')}`;

/**
 * La factura `numero` de la serie `serie` y el año `ano`, con fecha `fecha`
 * (null = hoy, en la zona de la base), ¿respeta el orden? Si no, lanza 409
 * `FECHA_FUERA_DE_ORDEN` diciendo qué vecina lo impide.
 *
 * `exec` es cualquier cosa con `.query(sql, params)`: el cliente de la
 * transacción (para que el cerrojo de la serie también cubra esto) o el pool.
 * `excluirId`: la propia factura, cuando se le cambia la fecha.
 */
export async function exigirFechaEnOrden(exec, { ano, serie, numero, fecha = null, excluirId = null }) {
  if (numero == null || !serie || !ano) return;
  const { rows: [r] } = await exec.query(
    `WITH f AS (SELECT COALESCE($4::date, CURRENT_DATE) AS d)
     SELECT (SELECT d FROM f)::text AS fecha,
            (SELECT json_build_object('codigo', i.codigo, 'fecha', i.fecha_emision::date::text)
               FROM invoices i
              WHERE i.ano = $1 AND i.serie = $2 AND i.numero IS NOT NULL AND i.numero < $3
                AND i.id <> COALESCE($5::int, 0)
                AND i.fecha_emision::date > (SELECT d FROM f)
              ORDER BY i.fecha_emision DESC, i.numero DESC LIMIT 1) AS antes,
            (SELECT json_build_object('codigo', i.codigo, 'fecha', i.fecha_emision::date::text)
               FROM invoices i
              WHERE i.ano = $1 AND i.serie = $2 AND i.numero IS NOT NULL AND i.numero > $3
                AND i.id <> COALESCE($5::int, 0)
                AND i.fecha_emision::date < (SELECT d FROM f)
              ORDER BY i.fecha_emision ASC, i.numero ASC LIMIT 1) AS despues`,
    [ano, serie, numero, fecha || null, excluirId || null]);
  if (!r) return;
  const esta = codigoDe(ano, numero);
  if (r.antes) {
    throw new AppError(
      `La factura ${esta} de la serie ${serie} no puede llevar fecha ${ddmmaaaa(r.fecha)}: `
      + `la ${r.antes.codigo}, anterior en la serie, es del ${ddmmaaaa(r.antes.fecha)}. `
      + 'En una serie fiscal la fecha nunca va por detrás de la de la factura anterior.',
      409, CODIGO, { otra: r.antes, fecha: r.fecha });
  }
  if (r.despues) {
    throw new AppError(
      `La factura ${esta} de la serie ${serie} no puede llevar fecha ${ddmmaaaa(r.fecha)}: `
      + `la ${r.despues.codigo}, posterior en la serie, es del ${ddmmaaaa(r.despues.fecha)}. `
      + 'Para rellenar un hueco, la fecha tiene que caber entre la de la anterior y la de la siguiente.',
      409, CODIGO, { otra: r.despues, fecha: r.fecha });
  }
}

/**
 * La fecha con la que sale un borrador al recibir un número NUEVO: la suya si
 * no va por detrás de la última de la serie; si no, hoy. Un borrador guardado
 * el día 10 y emitido el 24 lleva el número del 24, y por tanto su fecha.
 */
export async function fechaParaNumeroNuevo(exec, { ano, serie, fechaBorrador = null }) {
  const { rows: [r] } = await exec.query(
    `SELECT (CASE WHEN $3::date IS NULL
                    OR $3::date < COALESCE((SELECT MAX(fecha_emision)::date FROM invoices
                                             WHERE ano = $1 AND serie = $2 AND numero IS NOT NULL),
                                           DATE '1900-01-01')
                  THEN CURRENT_DATE ELSE $3::date END)::text AS d`,
    [ano, serie, fechaBorrador || null]);
  return r?.d || null;
}
