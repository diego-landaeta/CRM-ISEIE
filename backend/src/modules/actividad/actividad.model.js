import { query } from '../../shared/config/db.js';
import { comoLista, SIN_PRUEBAS } from '../../shared/utils/ambito.js';

/**
 * «Qué ha pasado hoy»: la actividad reciente de un proyecto (#13).
 *
 * Altas de prospectos, ventas, cambios de estado y contactos (llamadas,
 * WhatsApp, correos, notas), de más nuevo a más viejo y paginado por cursor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AQUÍ NO SE APUNTA NADA. SE RECOGE (la misma decisión que el Registro, #111).
 *
 * La issue pedía una tabla `activity_feed` a la que escribieran el alta de
 * prospectos, el cambio de estado, la venta y el correo. Se descartó a
 * propósito: sería un segundo sitio que mantener, y el día que alguien añadiera
 * una acción y se olvidara de anotarla, la actividad mentiría por omisión —que
 * es la peor forma de mentir de un historial—. Todo esto YA queda escrito en
 * `leads`, `conversions`, `lead_status_history` y `lead_interactions`; esto es
 * solo lectura sobre ello.
 *
 * Y es la vista que faltaba para las gestoras: el Registro (#111) es para
 * admin y cruza a todos los compañeros; esta se recorta a lo suyo.
 *
 * CADA FUENTE SE PIDE APARTE y se mezcla aquí: para dar las N más nuevas del
 * conjunto basta con las N más nuevas de cada una, y cada consulta usa el
 * índice de su fecha en vez de ordenar un UNION entero.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const LIMITE_POR_DEFECTO = 30;
export const LIMITE_MAXIMO = 100;

export const TIPOS = ['lead_creado', 'venta_creada', 'estado_cambiado', 'contacto'];

/** Los estados con el nombre que ve la gente en pantalla. */
const ESTADOS = {
  nuevo: 'Nuevo', por_contactar: 'Por contactar', contactado: 'Contactado', en_seguimiento: 'En seguimiento',
  convertido: 'Convertido', no_interesado: 'No interesado',
};
const estado = (e) => ESTADOS[e] || e;

const CONTACTO = {
  llamada: (q, l) => `${q} llamó a ${l}`,
  email: (q, l) => `${q} escribió un correo a ${l}`,
  whatsapp: (q, l) => `${q} escribió por WhatsApp a ${l}`,
  nota: (q, l) => `${q} dejó una nota en la ficha de ${l}`,
};

/**
 * Una condición de proyecto con SU marcador y el parámetro que le toca.
 * `proyectoCol`: la columna de la fuente (`l.project_id`, `c.project_id`).
 */
function condicionDeProyecto(proyectoCol, lista, params) {
  if (lista) { params.push(lista); return `${proyectoCol} = ANY($${params.length}::int[])`; }
  return SIN_PRUEBAS(proyectoCol);
}

/**
 * @param {{ projectId?: number|null, projectIds?: number[]|null, asesoraId?: number|null,
 *           desde?: string|null, antes?: string|null, limite?: number, tipos?: string[]|null }} p
 *   `asesoraId`: una gestora solo ve lo suyo (sus prospectos y lo que ella hizo).
 *   `desde`: fecha ISO (inclusive). `antes`: cursor, el `fecha` del último evento recibido.
 */
export async function actividadReciente({
  projectId = null, projectIds = null, asesoraId = null, desde = null, antes = null,
  limite = LIMITE_POR_DEFECTO, tipos = null,
}) {
  const n = Math.min(Math.max(Number(limite) || LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO);
  const lista = comoLista(projectId, projectIds);
  const quiere = (t) => !tipos || tipos.includes(t);

  /** Las condiciones comunes: proyecto, rango del cursor y, si hay, la gestora. */
  function base({ proyectoCol, fechaCol, gestora }) {
    const params = [];
    const cond = [condicionDeProyecto(proyectoCol, lista, params)];
    if (desde) { params.push(desde); cond.push(`${fechaCol} >= $${params.length}::timestamptz`); }
    if (antes) { params.push(antes); cond.push(`${fechaCol} < $${params.length}::timestamptz`); }
    if (asesoraId) { params.push(asesoraId); cond.push(gestora(`$${params.length}`)); }
    params.push(n + 1); // uno de más para saber si hay página siguiente
    return { cond: cond.join(' AND '), params, limite: `$${params.length}` };
  }

  const pedir = [];

  if (quiere('lead_creado')) {
    const b = base({ proyectoCol: 'l.project_id', fechaCol: 'l.created_at', gestora: (ph) => `l.responsable_id = ${ph}` });
    pedir.push(query(
      `SELECT 'lead_creado' AS tipo, l.created_at AS fecha, l.id AS lead_id, l.nombre AS lead_nombre,
              l.project_id, p.nombre AS proyecto, ur.nombre AS persona, NULL::text AS detalle, NULL::numeric AS importe
         FROM leads l JOIN projects p ON p.id = l.project_id
         LEFT JOIN users ur ON ur.id = l.responsable_id
        WHERE l.deleted_at IS NULL AND ${b.cond}
        ORDER BY l.created_at DESC LIMIT ${b.limite}`, b.params));
  }

  if (quiere('venta_creada')) {
    const b = base({
      proyectoCol: 'c.project_id', fechaCol: 'c.created_at',
      gestora: (ph) => `EXISTS (SELECT 1 FROM conversion_reparto r WHERE r.conversion_id = c.id AND r.vendedora_id = ${ph})`,
    });
    pedir.push(query(
      `SELECT 'venta_creada' AS tipo, c.created_at AS fecha, c.lead_id, l.nombre AS lead_nombre,
              c.project_id, p.nombre AS proyecto, uv.nombre AS persona, c.producto_contratado AS detalle, c.importe_total AS importe
         FROM conversions c JOIN projects p ON p.id = c.project_id
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN users uv ON uv.id = c.vendedora_id
        WHERE NOT c.es_mensualidad AND ${b.cond}
        ORDER BY c.created_at DESC LIMIT ${b.limite}`, b.params));
  }

  if (quiere('estado_cambiado')) {
    const b = base({
      proyectoCol: 'l.project_id', fechaCol: 'h.changed_at',
      gestora: (ph) => `(l.responsable_id = ${ph} OR h.changed_by = ${ph})`,
    });
    pedir.push(query(
      `SELECT 'estado_cambiado' AS tipo, h.changed_at AS fecha, h.lead_id, l.nombre AS lead_nombre,
              l.project_id, p.nombre AS proyecto, uc.nombre AS persona,
              (COALESCE(h.status_anterior::text, 'nuevo') || ' → ' || h.status_nuevo::text) AS detalle, NULL::numeric AS importe
         FROM lead_status_history h
         JOIN leads l ON l.id = h.lead_id JOIN projects p ON p.id = l.project_id
         LEFT JOIN users uc ON uc.id = h.changed_by
        WHERE l.deleted_at IS NULL AND ${b.cond}
        ORDER BY h.changed_at DESC LIMIT ${b.limite}`, b.params));
  }

  if (quiere('contacto')) {
    const b = base({
      proyectoCol: 'l.project_id', fechaCol: 'i.created_at',
      gestora: (ph) => `(l.responsable_id = ${ph} OR i.created_by = ${ph})`,
    });
    pedir.push(query(
      `SELECT 'contacto' AS tipo, i.created_at AS fecha, i.lead_id, l.nombre AS lead_nombre,
              l.project_id, p.nombre AS proyecto, ui.nombre AS persona, i.tipo::text AS detalle, NULL::numeric AS importe
         FROM lead_interactions i
         JOIN leads l ON l.id = i.lead_id JOIN projects p ON p.id = l.project_id
         LEFT JOIN users ui ON ui.id = i.created_by
        WHERE l.deleted_at IS NULL AND ${b.cond}
        ORDER BY i.created_at DESC LIMIT ${b.limite}`, b.params));
  }

  const filas = (await Promise.all(pedir)).flatMap((r) => r.rows);
  filas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const hayMas = filas.length > n;
  const pagina = filas.slice(0, n).map((f) => ({
    tipo: f.tipo,
    fecha: new Date(f.fecha).toISOString(),
    lead_id: f.lead_id,
    lead_nombre: f.lead_nombre,
    project_id: f.project_id,
    proyecto: f.proyecto,
    persona: f.persona || null,
    detalle: f.detalle,
    importe: f.importe != null ? Number(f.importe) : null,
    texto: frase(f),
  }));
  return {
    eventos: pagina,
    // El cursor: el `fecha` del último evento. Con él se pide la página siguiente.
    siguiente: hayMas && pagina.length ? pagina[pagina.length - 1].fecha : null,
  };
}

const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n));

/** La frase de cada evento, ya escrita: la pantalla solo la pinta. */
export function frase(f) {
  const quien = f.persona || 'Alguien';
  const lead = f.lead_nombre || 'un prospecto';
  switch (f.tipo) {
    case 'lead_creado':
      return `Entró ${lead}${f.persona ? `, asignado a ${f.persona}` : ', sin asignar'}`;
    case 'venta_creada':
      return `${quien} registró una venta a ${lead}${f.importe != null ? ` por ${eur(f.importe)}` : ''}`;
    case 'estado_cambiado':
      return `${f.persona || 'El sistema'} pasó a ${lead} de «${String(f.detalle).split(' → ').map(estado).join('» a «')}»`;
    case 'contacto':
      return (CONTACTO[f.detalle] || ((q, l) => `${q} contactó con ${l}`))(quien, lead);
    default:
      return lead;
  }
}
