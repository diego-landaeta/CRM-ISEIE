import * as eqModel from './tasks.equipos.model.js';

/*
  QUIÉN PUEDE QUÉ SOBRE UNA TAREA (Diego, 26/10/2026). Un solo sitio, para que
  el servidor y lo que se le dice al frontal (`permisos` de cada tarea) no
  digan cosas distintas.

  · MOVER y COMENTAR (cambiar de columna, reordenar, arrastrar; comentarios,
    pasos y enlaces): «solo superadmin pueden mover las tareas de lugar, y
    quienes supervisan o colaboran». O sea: el superadmin, el supervisor de esa
    tarea y quien la lleva (sin responsable, quien la creó). Nadie más: ni el
    admin ni un cargo alto, si no la supervisa ni la lleva. La ven, si su ámbito
    les deja, pero no la mueven ni la comentan.
  · CERRAR (llevarla a «Hecha» o sacarla), APROBAR y DEVOLVER: el superadmin y
    el supervisor; quien la lleva, solo si además tiene «Aprobar y cerrar».
  · EDITAR LOS DEMÁS CAMPOS (título, descripción, fecha, responsable,
    supervisor, equipo, etiquetas): quien la creó, el superadmin, y quien puede
    delegar en ese equipo sobre quien la lleva (admin y superadmin en todos).
  · DELEGAR (asignar a otro): admin, superadmin y Carlos en todos los equipos
    («Asignar», tasks.assign); el resto, dentro de su equipo y solo a quien
    tiene un nivel MENOR que el suyo. El nivel más bajo crea solo sus tareas.
  · SUPERVISAR: alguien del equipo con nivel IGUAL o MAYOR que quien la lleva,
    o un admin o superadmin. Sin equipo, como antes: quien pueda asignar.
*/

export const esSuperadmin = (user) => user?.role === 'superadmin';
export const esAdminDeRol = (persona) => ['admin', 'superadmin'].includes(persona?.role);

/** Quien delega en todos los equipos: quien tiene «Asignar» (admin y superadmin de serie). */
export const esMando = (p) => p?.assign === true;

/** Quien «lleva» la tarea: su responsable; sin responsable, quien la creó. */
export const quienLaLleva = (t) => t.assigned_to ?? t.created_by;

const esSupervisor = (t, user) => t.supervisor_id != null && Number(t.supervisor_id) === Number(user.userId);

/** Mover y comentar. */
export function puedeMoverYComentar(t, user) {
  if (esSuperadmin(user)) return true;
  return quienLaLleva(t) === user.userId || esSupervisor(t, user);
}

/** Aprobar, devolver, y cerrar o reabrir desde «Por revisar». */
export function puedeRevisar(t, user) {
  return esSuperadmin(user) || esSupervisor(t, user);
}

/** Cerrar o reabrir arrastrando: el que revisa, o quien la lleva con «Aprobar y cerrar». */
export function puedeCerrar(t, user, p) {
  return puedeRevisar(t, user) || (quienLaLleva(t) === user.userId && p?.close === true);
}

/** Su nivel en el equipo, o null si no está. */
export async function nivelEn(teamId, userId) {
  if (!teamId) return null;
  return (await eqModel.nivelesEn(teamId, [userId])).get(Number(userId))?.nivel ?? null;
}

/** ¿Tiene a alguien por debajo en este equipo? (el nivel más bajo, no). */
export async function puedeDelegarEn(teamId, user, p) {
  if (esMando(p)) return true;
  if (!teamId) return false;
  const yo = await nivelEn(teamId, user.userId);
  if (yo == null) return false;
  const equipo = (await eqModel.equiposDeLaPersona(user.userId)).find((e) => e.team_id === Number(teamId));
  return equipo != null && equipo.nivel_min_cargos != null && yo > equipo.nivel_min_cargos;
}

/** Editar los demás campos: quien la creó, el superadmin, o quien delega sobre quien la lleva. */
export async function puedeEditarCampos(t, user, p) {
  if (esSuperadmin(user) || t.created_by === user.userId || esMando(p)) return true;
  if (!t.team_id) return false;
  const nv = await eqModel.nivelesEn(t.team_id, [user.userId, quienLaLleva(t)]);
  const yo = nv.get(Number(user.userId))?.nivel;
  const el = nv.get(Number(quienLaLleva(t)))?.nivel;
  return yo != null && el != null && yo > el;
}

/**
 * ¿Puede darle una tarea de este equipo a esta persona? A sí mismo, siempre.
 * Devuelve el motivo para el 403 / 400.
 */
export async function puedeAsignarA(teamId, user, p, destinoId) {
  if (!destinoId || Number(destinoId) === Number(user.userId)) return { ok: true };
  const nv = teamId ? await eqModel.nivelesEn(teamId, [user.userId, destinoId]) : new Map();
  const suyo = nv.get(Number(destinoId))?.nivel;
  if (teamId && suyo == null) return { ok: false, status: 400, motivo: 'Esa persona no es de este equipo' };
  if (esMando(p)) return { ok: true };
  if (!teamId) return { ok: false, status: 403, motivo: 'Solo puedes crearte tareas a ti: para dársela a otro, ponla en un equipo donde tengas a alguien por debajo' };
  const yo = nv.get(Number(user.userId))?.nivel;
  if (yo == null) return { ok: false, status: 403, motivo: 'No eres de este equipo' };
  if (!(yo > suyo)) return { ok: false, status: 403, motivo: 'Solo puedes asignar tareas a quien tiene un cargo por debajo del tuyo en el equipo' };
  return { ok: true };
}

/**
 * ¿Vale esta persona de supervisor? Admin o superadmin, siempre; si la tarea
 * es de un equipo, alguien del equipo con nivel igual o mayor que quien la lleva.
 * `supervisor` trae su rol (findUserBasic no lo trae: se pasa aparte).
 */
export async function supervisorValido(teamId, responsableId, supervisor) {
  if (esAdminDeRol(supervisor)) return { ok: true };
  if (!teamId) return { ok: true };
  const nv = await eqModel.nivelesEn(teamId, [supervisor.id, responsableId]);
  const sup = nv.get(Number(supervisor.id))?.nivel;
  const resp = nv.get(Number(responsableId))?.nivel;
  if (sup == null) return { ok: false, motivo: 'El supervisor tiene que ser del equipo (o un admin)' };
  if (resp != null && sup < resp) return { ok: false, motivo: 'El supervisor tiene que tener un cargo igual o mayor que quien la lleva' };
  if (resp == null) return { ok: false, motivo: 'Quien la lleva no es del equipo: solo la puede supervisar un admin' };
  return { ok: true };
}

/** Lo que se le dice al frontal de cada tarea (lo mismo que decide el servidor). */
export async function permisosDeLaTarea(t, user, p) {
  return {
    mover: puedeMoverYComentar(t, user),
    comentar: puedeMoverYComentar(t, user),
    revisar: puedeRevisar(t, user),
    cerrar: puedeCerrar(t, user, p),
    editar: await puedeEditarCampos(t, user, p),
    delegar: await puedeDelegarEn(t.team_id, user, p),
  };
}
