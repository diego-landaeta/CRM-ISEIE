import { describe, it, expect } from 'vitest';
import { esRolDeTutora } from '../src/shared/services/moodle.client.js';

/**
 * Con qué rol del curso cuenta una tutora (Diego, 24/11/2026): en ISEIE las tutoras
 * redactoras están como «Gestor» (`manager`) en sus cursos y tienen que contar. Se
 * añade por el .env (`MOODLE_ROLES_TUTORA=manager`), así el 360 sigue igual.
 */
describe('esRolDeTutora', () => {
  it('Profesor y Profesor sin edición cuentan siempre', () => {
    expect(esRolDeTutora('editingteacher', {})).toBe(true);
    expect(esRolDeTutora('teacher', {})).toBe(true);
  });

  it('Gestor y alumno, no, si el .env no dice nada', () => {
    expect(esRolDeTutora('manager', {})).toBe(false);
    expect(esRolDeTutora('student', {})).toBe(false);
  });

  it('con MOODLE_ROLES_TUTORA=manager, el Gestor cuenta (y el alumno sigue sin contar)', () => {
    const env = { MOODLE_ROLES_TUTORA: ' manager , coursecreator' };
    expect(esRolDeTutora('manager', env)).toBe(true);
    expect(esRolDeTutora('coursecreator', env)).toBe(true);
    expect(esRolDeTutora('student', env)).toBe(false);
  });
});
