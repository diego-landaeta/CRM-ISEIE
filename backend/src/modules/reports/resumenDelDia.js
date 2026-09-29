import { query } from '../../shared/config/db.js';

/**
 * «Ayer y hoy», con datos. La parte 3 del #130.
 *
 * Diego lo subrayo: «pero datos, no algo con IA». Cuantos leads llegaron,
 * cuantos se contactaron, cuantas ventas — por gestora, y en general para quien
 * manda.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NINGUNA DE LAS CUATRO CUENTAS SE INVENTA AQUI
 *
 * El ticket pone una condicion que manda sobre el diseño: «que los numeros del
 * resumen cuadren con los de Reportes: si el dashboard dice 18 leads y Reportes
 * dice 20, no se cree ninguno de los dos».
 *
 * Asi que cada definicion se copia de donde ya vivia, y se dice de donde:
 *
 *   leads        `overview()` — leads por `created_at`, sin los borrados
 *   contactados  `overview()` — de esos, los que estan en estado 'contactado'
 *   ventas       `overview()` — conversiones por `fecha_conversion`
 *   sin_tocar    `leadSinTocarScheduler` — 'nuevo' o 'por_contactar' y sin una
 *                sola interaccion escrita
 *
 * `resumenCuadraConReportes.test.js` compara estas cuentas con las de
 * `overview()` sobre el mismo dia: si alguien cambia una de las dos, se pone en
 * rojo. Es la unica forma de que la promesa del ticket siga siendo verdad
 * dentro de seis meses.
 *
 * SOBRE «CONTACTADOS»
 *
 * Es el estado de AHORA de los leads de ese dia, no «cuantos se contactaron
 * ese dia». Un lead de ayer que ya esta vendido cuenta como convertido y no
 * como contactado. Se deja asi a proposito porque es lo que cuenta Reportes:
 * dos definiciones distintas del mismo rotulo es justo lo que el ticket pide
 * evitar.
 *
 * SOBRE EL RECORTE
 *
 * `asesoraId` no llega de la URL a secas: lo decide `asesoraDelInforme()` en el
 * controlador, que para una gestora devuelve su propio id pida lo que pida. La
 * venta se atribuye por `vendedora_id` y, si no lo lleva, por el responsable
 * del lead — la misma regla que Ventas, para que una gestora vea el mismo
 * numero en las dos pantallas.
 */

const SIN_PRUEBAS = (col = 'project_id') =>
  `${col} NOT IN (SELECT id FROM projects WHERE es_prueba)`;

/** Los dos dias que se enseñan, siempre en el mismo orden. */
const DIAS = ['ayer', 'hoy'];

/** Una fecha 'YYYY-MM-DD', o null para el dia de verdad. */
const refONull = (v) => (v ? String(v).slice(0, 10) : null);

/**
 * `referencia` es que dia cuenta como «hoy». Vacio = el de verdad.
 *
 * No es un adorno: sin el, la prueba que ata estos numeros a los de Reportes
 * solo puede comparar el dia de hoy, y un dia sin leads compara cero con cero y
 * pasa en verde sin haber mirado nada. Con la fecha se compara contra un dia
 * que SI tiene datos, que es la unica forma de que la prueba valga.
 */
export async function resumenDelDia({ projectIds = null, asesoraId = null, referencia = null } = {}) {
  const lista = Array.isArray(projectIds) && projectIds.length ? projectIds : null;
  // La fecha de referencia va SIEMPRE como $1 en las dos consultas.
  const REF = 'COALESCE($1::date, CURRENT_DATE)';

  // ── Leads: llegados, contactados y sin tocar, de ayer y de hoy ────────────
  const pL = [refONull(referencia)];
  let i = 2;
  const filtroProyL = lista ? `AND l.project_id = ANY($${i++}::int[])` : `AND ${SIN_PRUEBAS('l.project_id')}`;
  if (lista) pL.push(lista);
  const filtroAsesoraL = asesoraId != null ? `AND l.responsable_id = $${i++}` : '';
  if (asesoraId != null) pL.push(asesoraId);

  const { rows: leadsRows } = await query(
    `SELECT CASE WHEN l.created_at::date = ${REF} THEN 'hoy' ELSE 'ayer' END AS dia,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE l.status = 'contactado')::int AS contactados,
            COUNT(*) FILTER (
              WHERE l.status IN ('nuevo', 'por_contactar')
                AND NOT EXISTS (SELECT 1 FROM lead_interactions i WHERE i.lead_id = l.id)
            )::int AS sin_tocar
       FROM leads l
      WHERE l.deleted_at IS NULL
        AND l.created_at::date >= ${REF} - 1
        AND l.created_at::date <= ${REF}
        ${filtroProyL}
        ${filtroAsesoraL}
      GROUP BY 1`,
    pL
  );

  // ── Ventas ────────────────────────────────────────────────────────────────
  const pV = [refONull(referencia)];
  let j = 2;
  const filtroProyV = lista ? `AND cv.project_id = ANY($${j++}::int[])` : `AND ${SIN_PRUEBAS('cv.project_id')}`;
  if (lista) pV.push(lista);
  const filtroAsesoraV = asesoraId != null
    ? `AND COALESCE(cv.vendedora_id, l.responsable_id) = $${j++}` : '';
  if (asesoraId != null) pV.push(asesoraId);

  const { rows: ventasRows } = await query(
    `SELECT CASE WHEN cv.fecha_conversion = ${REF} THEN 'hoy' ELSE 'ayer' END AS dia,
            COUNT(*)::int AS ventas
       FROM conversions cv
       LEFT JOIN leads l ON l.id = cv.lead_id
      WHERE cv.fecha_conversion >= ${REF} - 1
        AND cv.fecha_conversion <= ${REF}
        ${filtroProyV}
        ${filtroAsesoraV}
      GROUP BY 1`,
    pV
  );

  // Los dos dias salen SIEMPRE, con ceros si no hubo nada. Un dia que falta
  // deja un hueco en la pantalla y parece una averia; un cero es un dato.
  const porDia = (filas, dia) => filas.find((f) => f.dia === dia) || {};
  return DIAS.map((dia) => ({
    dia,
    leads: porDia(leadsRows, dia).leads ?? 0,
    contactados: porDia(leadsRows, dia).contactados ?? 0,
    ventas: porDia(ventasRows, dia).ventas ?? 0,
    sin_tocar: porDia(leadsRows, dia).sin_tocar ?? 0,
  }));
}
