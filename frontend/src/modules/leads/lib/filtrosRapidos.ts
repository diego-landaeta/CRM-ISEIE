/**
 * Los filtros rápidos de Prospectos (`?qf=`). Todos los filtra el SERVIDOR
 * (gemela de la #132 del 360), con la misma condición con que los cuenta
 * `/api/leads/quick-counts` (`FILTROS_RAPIDOS` en `lead.model.js`): sobre la
 * página cargada (20 de `total`) la lista y la cifra no cuadraban.
 */
export const FILTROS_RAPIDOS_DEL_SERVIDOR: readonly string[] = [
  'overdue', 'today', 'tomorrow', 'week', 'no-reminder', 'no-contact', 'urgent',
  // Las alertas del Dashboard (gemela de CRM#884).
  'sin-gestora', 'sin-actividad',
];

/** El `qf` que se manda al servidor, o '' si no es un filtro rápido conocido. */
export function qfDelServidor(qf: string | null | undefined): string {
  return qf && FILTROS_RAPIDOS_DEL_SERVIDOR.includes(qf) ? qf : '';
}
