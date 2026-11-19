import { AppError } from '../../shared/utils/AppError.js';

/*
  LA FECHA VA CON EL NÚMERO (19/11/2026).

  En una serie fiscal el número y la fecha van juntos: la 0287 no puede ser de
  un día anterior a la 0286 ni posterior a la 0288. El 19/11 se reemitieron dos
  facturas del 11/11 con sus mismos números y la fecha del día, y quedaron
  entre la 0285 y la 0288 con una fecha que no les tocaba.

  Diego: «habilita la edición para que puedan editar las fechas». Cambiar la
  fecha de una emitida se puede —con el permiso «Cambiar fechas»—, pero solo
  dentro de su sitio en la serie: entre la fecha del número anterior y la del
  siguiente, y dentro de su año. Así sirve para ordenar la serie, no para
  desordenarla.
*/

const d10 = (v) => {
  if (!v) return null;
  if (v instanceof Date) {
    // Fecha local, no UTC: un DATE de Postgres llega como medianoche local.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
};

/** 2026-11-16 → 16/11/2026 */
export const fechaLegible = (v) => {
  const s = d10(v);
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const conCodigo = (lim) => `${fechaLegible(lim.fecha)} (${lim.codigo})`;

/**
 * ¿Rompe `fecha` el orden de la serie? Devuelve el motivo, o null si cabe.
 *
 * `limites`: { ano, anterior: { codigo, fecha } | null, siguiente: { codigo, fecha } | null }.
 * La misma fecha que el vecino vale: varias facturas del mismo día.
 */
export function motivoFechaFueraDeOrden(fecha, { ano = null, anterior = null, siguiente = null } = {}) {
  const f = d10(fecha);
  if (!f) return null;
  if (ano != null && Number(f.slice(0, 4)) !== Number(ano)) {
    return `La factura es de la serie de ${ano}: su fecha tiene que ser de ese año.`;
  }
  const desde = anterior?.fecha ? d10(anterior.fecha) : null;
  const hasta = siguiente?.fecha ? d10(siguiente.fecha) : null;
  if ((desde && f < desde) || (hasta && f > hasta)) {
    let rango;
    if (desde && hasta) rango = `entre el ${conCodigo(anterior)} y el ${conCodigo(siguiente)}`;
    else if (desde) rango = `a partir del ${conCodigo(anterior)}`;
    else rango = `hasta el ${conCodigo(siguiente)}`;
    return `Con el ${fechaLegible(f)} la serie quedaría desordenada: el número y la fecha van juntos. `
      + `Esta factura puede ir ${rango}.`;
  }
  return null;
}

/**
 * Las facturas de número anterior y siguiente en la misma serie y año (con su
 * fecha), sin contarse a sí misma. `exec(sql, params)` → { rows }.
 */
export async function limitesDeFecha(exec, { id = null, ano, serie, numero }) {
  if (numero == null || serie == null || ano == null) return { ano, anterior: null, siguiente: null };
  const base = `SELECT codigo, fecha_emision::date::text AS fecha FROM invoices
                 WHERE ano = $1 AND serie = $2 AND numero IS NOT NULL
                   AND fecha_emision IS NOT NULL AND id <> $4`;
  const params = [ano, serie, Number(numero), id || 0];
  const [{ rows: [anterior] }, { rows: [siguiente] }] = await Promise.all([
    exec(`${base} AND numero < $3 ORDER BY numero DESC, fecha_emision DESC LIMIT 1`, params),
    exec(`${base} AND numero > $3 ORDER BY numero ASC, fecha_emision ASC LIMIT 1`, params),
  ]);
  return { ano: Number(ano), anterior: anterior || null, siguiente: siguiente || null };
}

/** 409 FECHA_FUERA_DE_ORDEN si la fecha no cabe en su sitio de la serie. */
export async function exigirFechaEnOrden(exec, { id = null, ano, serie, numero, fecha }) {
  if (numero == null || !fecha) return;
  const limites = await limitesDeFecha(exec, { id, ano, serie, numero });
  const motivo = motivoFechaFueraDeOrden(fecha, limites);
  if (motivo) {
    throw new AppError(motivo, 409, 'FECHA_FUERA_DE_ORDEN', {
      desde: limites.anterior?.fecha || null,
      hasta: limites.siguiente?.fecha || null,
    });
  }
}
