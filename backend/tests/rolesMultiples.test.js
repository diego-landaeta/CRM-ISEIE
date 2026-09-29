import { describe, it, expect } from 'vitest';
import { rolesDe, tieneRol, limpiaRolesExtra } from '../src/shared/utils/roles.js';

/*
  Más de un rol por persona.

  Diego, 22/09: «necesitamos que se pueda colocar más de un rol a un usuario».
  El caso real es quien lleva prospectos y además da clase: antes había que
  elegir, y lo que no se eligiera se perdía.

  Lo que se prueba aquí es la regla, que es donde está el riesgo: un fallo al
  sumar roles no rompe una pantalla, abre o cierra una puerta.
*/

describe('los roles de una persona', () => {
  it('sin roles añadidos, es el de siempre', () => {
    expect(rolesDe({ role: 'gestor' })).toEqual(['gestor']);
    expect(tieneRol({ role: 'gestor' }, 'gestor')).toBe(true);
    expect(tieneRol({ role: 'gestor' }, 'admin')).toBe(false);
  });

  it('con uno añadido, vale cualquiera de los dos', () => {
    const gestoraYTutora = { role: 'gestor', roles_extra: ['tutor'] };
    expect(rolesDe(gestoraYTutora)).toEqual(['gestor', 'tutor']);
    expect(tieneRol(gestoraYTutora, 'tutor')).toBe(true);
    expect(tieneRol(gestoraYTutora, 'gestor')).toBe(true);
    // Y sigue sin ser lo que no es.
    expect(tieneRol(gestoraYTutora, 'admin')).toBe(false);
  });

  it('el guardia acepta si CUALQUIERA de sus roles entra', () => {
    // Es la regla de `roleGuard`: basta con uno.
    const admin = { role: 'gestor', roles_extra: ['admin'] };
    expect(tieneRol(admin, 'admin', 'superadmin')).toBe(true);
  });

  it('sin usuario no hay roles, y nadie pasa', () => {
    expect(rolesDe(null)).toEqual([]);
    expect(rolesDe(undefined)).toEqual([]);
    expect(tieneRol(null, 'gestor')).toBe(false);
  });
});

describe('lo que se guarda como rol añadido', () => {
  it('el principal no se repite dentro', () => {
    // Si no, la misma persona saldría con «gestor» dos veces y cualquier
    // recuento por rol la contaría doble.
    expect(limpiaRolesExtra(['gestor', 'tutor'], 'gestor')).toEqual(['tutor']);
  });

  it('superadmin NUNCA entra como añadido', () => {
    // Un rol de más que dé acceso total es justo la puerta que nadie
    // recordaría haber abierto. Se pone como principal o no se pone.
    expect(limpiaRolesExtra(['superadmin', 'tutor'], 'gestor')).toEqual(['tutor']);
  });

  it('sin repetidos', () => {
    expect(limpiaRolesExtra(['tutor', 'tutor', 'admin'], 'gestor')).toEqual(['tutor', 'admin']);
  });

  it('una lista vacía significa «quítaselos todos», no «déjalo como está»', () => {
    expect(limpiaRolesExtra([], 'gestor')).toEqual([]);
  });

  it('lo que no sea una lista se queda en nada', () => {
    expect(limpiaRolesExtra(null, 'gestor')).toEqual([]);
    expect(limpiaRolesExtra(undefined, 'gestor')).toEqual([]);
  });
});
