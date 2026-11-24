import {
  describe, it, expect, afterEach,
} from 'vitest';
import { esAlumno, esRolExtraDeTutora } from '../src/shared/services/moodle.client.js';
import { alumnosDe, recortadaPorGrupos, veTodosLosGrupos } from '../src/modules/tutores/tutor.micampus.js';

/**
 * Al traer main (24/11, `esRolDeTutora` + `MOODLE_ROLES_TUTORA`) a staging (ISEIE#753, «Mi campus»
 * como Moodle 4.5): un rol que el campus pone en `MOODLE_ROLES_TUTORA` es de la tutora.
 *   · Nunca cuenta como alumno (`esAlumno`), aunque no sea uno de los roles del equipo de
 *     serie (un rol propio, p. ej. «redactora»): si no, la tutora se vería a sí misma y a sus
 *     compañeras entre los alumnos, y sus «entregas» por corregir.
 *   · Nunca cuenta como rol que ve todos los grupos (`VEN_TODOS_LOS_GRUPOS`): el CRM no sabe
 *     qué capacidades le dio el campus; si está en grupos, se recorta (nunca enseñar de más).
 */
const antes = process.env.MOODLE_ROLES_TUTORA;
afterEach(() => {
  if (antes === undefined) delete process.env.MOODLE_ROLES_TUTORA;
  else process.env.MOODLE_ROLES_TUTORA = antes;
});

describe('un rol de MOODLE_ROLES_TUTORA nunca es alumno', () => {
  it('sin MOODLE_ROLES_TUTORA, un rol propio cuenta como alumno (como hasta ahora)', () => {
    delete process.env.MOODLE_ROLES_TUTORA;
    expect(esAlumno({ roles: ['redactora'] })).toBe(true);
    expect(esAlumno({ roles: ['student'] })).toBe(true);
    expect(esAlumno({ roles: ['manager'] })).toBe(false);
  });

  it('con MOODLE_ROLES_TUTORA=redactora,manager, esos roles no son alumnos', () => {
    process.env.MOODLE_ROLES_TUTORA = 'redactora, manager';
    expect(esAlumno({ roles: ['redactora'] })).toBe(false);
    expect(esAlumno({ roles: ['manager'] })).toBe(false);
    expect(esAlumno({ roles: ['redactora', 'manager'] })).toBe(false);
    // Los permisos se suman: quien además es alumno, sí lo es.
    expect(esAlumno({ roles: ['redactora', 'student'] })).toBe(true);
    expect(esAlumno({ roles: ['student'] })).toBe(true);
  });

  it('se puede usar en .filter(esAlumno) (un solo argumento)', () => {
    process.env.MOODLE_ROLES_TUTORA = 'redactora';
    const gente = [{ id: 1, roles: ['redactora'] }, { id: 2, roles: ['student'] }];
    expect(gente.filter(esAlumno).map((g) => g.id)).toEqual([2]);
  });

  it('alumnosDe no cuenta a otra tutora con un rol de MOODLE_ROLES_TUTORA', () => {
    process.env.MOODLE_ROLES_TUTORA = 'redactora';
    const yo = { id: 1, roles: ['editingteacher'], grupos: [] };
    const gente = [yo, { id: 2, roles: ['redactora'], grupos: [] }, { id: 3, roles: ['student'], grupos: [] }];
    expect(alumnosDe(gente, yo).map((a) => a.id)).toEqual([3]);
  });
});

describe('un rol de MOODLE_ROLES_TUTORA nunca ve todos los grupos', () => {
  it('Profesor y Gestor de serie ven todos los grupos', () => {
    delete process.env.MOODLE_ROLES_TUTORA;
    expect(veTodosLosGrupos('editingteacher')).toBe(true);
    expect(veTodosLosGrupos('manager')).toBe(true);
    expect(veTodosLosGrupos('teacher')).toBe(false);
    expect(recortadaPorGrupos({ roles: ['manager'], grupos: [7] })).toBe(false);
  });

  it('con MOODLE_ROLES_TUTORA=manager (ISEIE), el Gestor-tutora en un grupo se recorta', () => {
    process.env.MOODLE_ROLES_TUTORA = 'manager';
    expect(esRolExtraDeTutora('manager')).toBe(true);
    expect(veTodosLosGrupos('manager')).toBe(false);
    expect(recortadaPorGrupos({ roles: ['manager'], grupos: [7] })).toBe(true);
    // Sin grupo, Moodle le enseña a todos: no se recorta.
    expect(recortadaPorGrupos({ roles: ['manager'], grupos: [] })).toBe(false);
    // «Profesor» sigue viendo todos aunque se ponga en el .env.
    process.env.MOODLE_ROLES_TUTORA = 'manager,editingteacher';
    expect(esRolExtraDeTutora('editingteacher')).toBe(false);
    expect(veTodosLosGrupos('editingteacher')).toBe(true);
  });

  it('alumnosDe recorta a los de su grupo con grupos separados', () => {
    process.env.MOODLE_ROLES_TUTORA = 'manager';
    const yo = { id: 1, roles: ['manager'], grupos: [7] };
    const gente = [yo,
      { id: 2, roles: ['student'], grupos: [7] },
      { id: 3, roles: ['student'], grupos: [8] }];
    expect(alumnosDe(gente, yo, { modo: 1 }).map((a) => a.id)).toEqual([2]);
    expect(alumnosDe(gente, yo, { modo: 0 }).map((a) => a.id)).toEqual([2, 3]);
  });
});
