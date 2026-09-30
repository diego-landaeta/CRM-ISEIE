/*
  Quién está en el proceso comercial: los prospectos que ENTRARON desde el
  29/09/2026. Es la misma regla que `backend/src/shared/utils/enElProceso.js`;
  aquí hace falta porque la barra de vencidos de Prospectos («Vencidos», «Hoy»,
  «Sin contacto»…) se cuenta en la pantalla, sobre los prospectos cargados.

  Diego, 30/09: «los atrasados y eso también que sean a partir de esa fecha».
  Los de antes siguen en el listado; lo que no hacen es contar como vencidos.

  La entrada es `fecha_solicitud`, o el alta si no la hay, igual que en el
  servidor. La medianoche es la de Madrid (29/09 es horario de verano, +02:00).
*/
export const INICIO_DEL_PROCESO = new Date('2026-09-29T00:00:00+02:00');

export function entroEnElProceso(
  lead: { fecha_solicitud?: string | null; created_at?: string | null },
): boolean {
  const fecha = lead.fecha_solicitud || lead.created_at;
  if (!fecha) return false;
  const d = new Date(fecha);
  return !Number.isNaN(d.getTime()) && d >= INICIO_DEL_PROCESO;
}
