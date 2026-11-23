/**
 * ¿Le enseña el servidor la gente de un equipo (`GET /tasks/assignees`)?
 *
 * La misma regla que `listAssignees` (tasks.service.js): «Ver todas las
 * tareas», «Asignar» o «Gestionar el tablero»; o, con `team_id`, poder delegar
 * en ese equipo (tener a alguien de cargo menor: `puede_delegar` de sus
 * equipos). A quien no, le contesta 403 FORBIDDEN «No tienes permiso para ver
 * el equipo», y la ficha de tarea lo preguntaba igual al abrir una tarea con
 * equipo: colaboradores y tutores, en los errores de producción del 23/11.
 */
export function puedeVerElEquipo(
  p: { viewAll?: boolean; assign?: boolean; manage?: boolean },
  equiposDondeDelego: number[] = [],
  teamId: number | string | null = null,
): boolean {
  if (p.viewAll || p.assign || p.manage) return true;
  const equipo = Number(teamId);
  return Number.isInteger(equipo) && equipo > 0 && equiposDondeDelego.map(Number).includes(equipo);
}
