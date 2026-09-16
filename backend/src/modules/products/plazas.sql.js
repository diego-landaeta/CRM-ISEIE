/**
 * Cuántas plazas quedan libres en una convocatoria, en UN solo sitio.
 *
 * El proceso comercial pide el número de plazas en cuatro de sus cinco pasos, y
 * el documento es tajante: «el nº de plazas disponibles va en todas las
 * plantillas y se comprueba antes de cada envío: nunca se arrastra el dato del
 * mensaje anterior».
 *
 * Vivía dentro de `product.model.js` como dos constantes privadas. Sale aquí
 * porque ahora lo necesita también la cola del día: si cada pantalla se lo
 * calcula a su manera, el catálogo y la cola acabarían diciendo números
 * distintos de la misma convocatoria — y el que se envía al cliente sería el que
 * la gestora tuviera más a mano.
 *
 * Se usa igual que `clase.sql.js` en facturas: se interpola en la consulta.
 */

/**
 * El LATERAL que cuenta las ocupadas. Espera que la consulta tenga la tabla
 * `products` con el alias `p`.
 *
 * Se cuentan LEADS distintos y no ventas: si alguien compra dos veces el mismo
 * programa sigue ocupando una plaza. Por eso mismo `es_mensualidad` queda
 * fuera: una mensualidad no es una matrícula nueva.
 *
 * `plazas_ocupadas_previas` se suma porque hay matrículas anteriores al CRM que
 * ocupan plaza y de las que aquí no hay venta.
 */
export const PLAZAS_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(p.plazas_ocupadas_previas, 0) + COUNT(DISTINCT cv.lead_id) AS ocupadas
      FROM conversions cv
     WHERE cv.producto_contratado_id = p.id
       AND cv.es_mensualidad IS NOT TRUE
  ) pl ON TRUE`;

/**
 * Las columnas que salen de ahí.
 *
 * `plazas_libres` puede salir NEGATIVA, y se deja así a propósito: significa
 * que la convocatoria está sobrevendida y el administrador tiene que verlo.
 * Quien pinte una plantilla de cara al cliente es el que corta en cero, no esto.
 */
export const PLAZAS_COLS = `
  pl.ocupadas AS plazas_ocupadas,
  CASE WHEN p.plazas_totales IS NULL THEN NULL
       ELSE p.plazas_totales - pl.ocupadas END AS plazas_libres,
  CASE WHEN p.fecha_cierre_convocatoria IS NULL THEN NULL
       ELSE (p.fecha_cierre_convocatoria - CURRENT_DATE) END AS dias_para_cierre`;
