import { query } from '../../shared/config/db.js';

/**
 * «¿Que campaña rinde?» — de lo gastado en Meta a lo cobrado de verdad (#30, #53).
 *
 * POR QUE TIENE SQL PROPIO, SIENDO QUE `consultas.js` DICE QUE NO LO HAY
 *
 * Las otras tres consultas reutilizan `report.model.js` porque esos numeros ya
 * estan cuadrados alli. Este no: ninguna funcion de los informes une el gasto de
 * una campaña con las ventas de SUS prospectos. La cadena existe en la rama del
 * #53 (`meta-ads.service.js`, `getRoi`), que aun no esta fusionada; esta es esa
 * misma consulta, adaptada a la forma de las del asistente (ambito de la persona
 * en lista de proyectos, y campuses mezclados en una sola respuesta). Cuando el
 * #53 llegue a `main`, las dos deben seguir dando el mismo numero: la prueba de
 * aqui siembra los mismos casos y espera las mismas cifras que la de esa rama
 * (`metaRetornoPorCampana.test.js`), para que una desviacion salte.
 *
 * SOLO LECTURA: un `SELECT`, sin escribir nada. Es la unica con SQL, y por eso
 * vive en su fichero y no mezclada con el catalogo.
 *
 * LA CADENA. campaña de Meta → prospecto (`lead_utms.utm_campaign` = id de la
 * campaña; una fila de UTM por prospecto, asi que cuenta en UNA campaña) →
 * venta (`conversions.lead_id`) → lo COBRADO (`conversion_payments`, NUNCA
 * `conversions.importe_pagado`, que declara de mas: 209.930 € en ISEIE).
 *
 * LO QUE ES UNA VENTA: la conversion que ya tiene algun cobro apuntado y no es
 * una mensualidad. Es la misma regla de «Ventas», para que cuadre con Finanzas.
 *
 * DOS LECTURAS DEL MISMO RANGO, porque entre el clic y el dinero pasa tiempo y
 * una campaña de hace dos meses puede estar cobrando ahora:
 *   · COHORTE: gasto del rango frente a lo que han vendido y cobrado —hasta
 *     hoy— los prospectos captados EN el rango. Responde «¿que campaña nos trajo
 *     mas dinero este trimestre?».
 *   · CAJA: lo que ha entrado EN el rango por los prospectos de la campaña,
 *     sean de cuando sean. Responde «¿cuales estan cobrando ahora?».
 * Sin rango las dos coinciden con la vida entera de la campaña.
 */

/** Un ambito en lista, como en `report.model.js`: un campus, varios o todos. */
function comoLista(projectId, projectIds) {
  if (Array.isArray(projectIds) && projectIds.length) return projectIds.map(Number);
  if (projectId) return [Number(projectId)];
  return null;
}

const dos = (n) => Number(Number(n).toFixed(2));

/** Porcentaje de retorno sobre el gasto; `null` si no hubo gasto (no se divide por cero). */
const pct = (dinero, gasto) => (gasto > 0 ? dos(((dinero - gasto) / gasto) * 100) : null);

/**
 * @param {{projectId?: number, projectIds?: number[], from?: string, to?: string}} p
 *   `from`/`to` ya vienen limpios (YYYY-MM-DD) de `limpiarParametros`.
 */
export async function campanaQueRinde({ projectId, projectIds, from = null, to = null } = {}) {
  const lista = comoLista(projectId, projectIds);

  // «Todos los campus» NO incluye los de prueba, igual que los informes: una
  // campaña inventada con tres ventas falsas no puede colarse en el ranking.
  // Elegido a dedo (con ambito), se ve entero.
  const { rows } = await query(
    `WITH campus AS (
       SELECT id, nombre FROM projects
        WHERE ($1::int[] IS NULL AND NOT es_prueba) OR id = ANY($1::int[])
     ),
     camp_gasto AS (
       SELECT mc.campaign_id, mc.project_id, mc.nombre, mc.effective_status,
              COALESCE(SUM(d.spend), 0)::numeric AS gasto,
              COALESCE(SUM(d.leads), 0)::int AS leads_meta
         FROM meta_campaigns mc
         JOIN campus ON campus.id = mc.project_id
         LEFT JOIN meta_campaigns_daily d ON d.campaign_id = mc.campaign_id
              AND ($2::date IS NULL OR d.date >= $2::date)
              AND ($3::date IS NULL OR d.date <= $3::date)
        GROUP BY mc.campaign_id, mc.project_id, mc.nombre, mc.effective_status
     ),
     -- Cada prospecto vivo que llego por una campaña de SU campus, con su dia.
     lead_campana AS (
       SELECT l.id AS lead_id, l.project_id, lu.utm_campaign AS campaign_id,
              l.created_at::date AS dia
         FROM lead_utms lu
         JOIN leads l ON l.id = lu.lead_id AND l.deleted_at IS NULL
         JOIN meta_campaigns mc ON mc.campaign_id = lu.utm_campaign AND mc.project_id = l.project_id
         JOIN campus ON campus.id = l.project_id
     ),
     -- Ventas de esos prospectos, con todo lo cobrado (hasta hoy) de cada una.
     venta AS (
       SELECT lc.lead_id, c.id AS conversion_id, c.importe_total,
              (SELECT COALESCE(SUM(cp.importe), 0) FROM conversion_payments cp
                WHERE cp.conversion_id = c.id) AS cobrado
         FROM lead_campana lc
         JOIN conversions c ON c.lead_id = lc.lead_id AND c.project_id = lc.project_id
              AND NOT c.es_mensualidad
        WHERE EXISTS (SELECT 1 FROM conversion_payments cx WHERE cx.conversion_id = c.id)
     ),
     cohorte AS (
       SELECT lc.campaign_id,
              COUNT(DISTINCT lc.lead_id)::int AS prospectos,
              COUNT(v.conversion_id)::int AS ventas,
              COALESCE(SUM(v.importe_total), 0)::numeric AS vendido,
              COALESCE(SUM(v.cobrado), 0)::numeric AS cobrado
         FROM lead_campana lc
         LEFT JOIN venta v ON v.lead_id = lc.lead_id
        WHERE ($2::date IS NULL OR lc.dia >= $2::date) AND ($3::date IS NULL OR lc.dia <= $3::date)
        GROUP BY lc.campaign_id
     ),
     caja AS (
       SELECT lc.campaign_id, COALESCE(SUM(cp.importe), 0)::numeric AS cobrado_periodo
         FROM lead_campana lc
         JOIN conversions c ON c.lead_id = lc.lead_id AND c.project_id = lc.project_id
              AND NOT c.es_mensualidad
         JOIN conversion_payments cp ON cp.conversion_id = c.id
              AND ($2::date IS NULL OR cp.fecha >= $2::date)
              AND ($3::date IS NULL OR cp.fecha <= $3::date)
        GROUP BY lc.campaign_id
     )
     SELECT g.campaign_id, g.nombre, g.effective_status, g.project_id, campus.nombre AS campus,
            g.gasto, g.leads_meta,
            COALESCE(co.prospectos, 0) AS prospectos,
            COALESCE(co.ventas, 0) AS ventas,
            COALESCE(co.vendido, 0)::numeric AS vendido,
            COALESCE(co.cobrado, 0)::numeric AS cobrado,
            COALESCE(ca.cobrado_periodo, 0)::numeric AS cobrado_periodo
       FROM camp_gasto g
       JOIN campus ON campus.id = g.project_id
       LEFT JOIN cohorte co ON co.campaign_id = g.campaign_id
       LEFT JOIN caja ca ON ca.campaign_id = g.campaign_id
      WHERE g.gasto > 0 OR COALESCE(co.prospectos, 0) > 0 OR COALESCE(ca.cobrado_periodo, 0) > 0
      ORDER BY g.gasto DESC, g.nombre`,
    [lista, from, to]
  );

  const campanas = rows.map((r) => {
    const gasto = dos(r.gasto);
    const prospectos = Number(r.prospectos);
    const ventas = Number(r.ventas);
    const cobrado = dos(r.cobrado);
    const cobradoPeriodo = dos(r.cobrado_periodo);
    return {
      campana: r.nombre,
      campana_id: r.campaign_id,
      campus: r.campus,
      estado: r.effective_status,
      gasto,
      prospectos_meta: Number(r.leads_meta),
      prospectos_crm: prospectos,
      ventas,
      vendido: dos(r.vendido),
      cobrado,
      coste_por_prospecto: prospectos > 0 ? dos(gasto / prospectos) : null,
      coste_por_venta: ventas > 0 ? dos(gasto / ventas) : null,
      retorno: dos(cobrado - gasto),
      retorno_pct: pct(cobrado, gasto),
      cobrado_en_periodo: cobradoPeriodo,
      retorno_en_periodo: dos(cobradoPeriodo - gasto),
      retorno_en_periodo_pct: pct(cobradoPeriodo, gasto),
    };
  });

  // El total, calculado AQUI: si lo suma el modelo, la cifra no sale de los
  // datos y `cifras.js` la marcaria como sin comprobar.
  const suma = (campo) => dos(campanas.reduce((s, c) => s + c[campo], 0));
  const gasto = suma('gasto');
  const ventas = campanas.reduce((s, c) => s + c.ventas, 0);
  const cobrado = suma('cobrado');
  const cobradoPeriodo = suma('cobrado_en_periodo');
  const totales = {
    gasto,
    prospectos_crm: campanas.reduce((s, c) => s + c.prospectos_crm, 0),
    ventas,
    cobrado,
    coste_por_venta: ventas > 0 ? dos(gasto / ventas) : null,
    retorno: dos(cobrado - gasto),
    retorno_pct: pct(cobrado, gasto),
    cobrado_en_periodo: cobradoPeriodo,
    retorno_en_periodo: dos(cobradoPeriodo - gasto),
  };

  return {
    // Como se leen las dos columnas de dinero, pegado al dato: el modelo y quien
    // mira el desglose ven lo que mide cada una sin ir a buscarlo.
    lectura: {
      cohorte: 'prospectos, ventas, cobrado y retorno: gasto del periodo frente a lo que han vendido y cobrado, hasta hoy, los prospectos captados en el periodo',
      caja: 'cobrado_en_periodo y retorno_en_periodo: lo que ha entrado dentro del periodo por los prospectos de la campaña, sean de cuando sean',
      venta: 'conversión con algún cobro apuntado, sin mensualidades',
    },
    campanas,
    totales,
  };
}
