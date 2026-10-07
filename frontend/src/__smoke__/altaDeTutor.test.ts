import { describe, it, expect } from 'vitest';
import { cursosParaElAlta, avisoDelAlta } from '@/modules/tutores/lib/colaboraciones';

/**
 * #206 · Alta de tutor: la formación elegida no se guardaba.
 *
 * Carlos, 01/10: «cuando se crea un tutor y se selecciona formación, NO SE
 * GUARDA». Dos fallos, los dos probados aquí:
 *
 *  1. El curso elegido en el buscador solo entraba pulsando «Añadir». Quien
 *     elegía uno y daba a «Dar de alta» lo perdía sin aviso.
 *  2. Si un curso no se podía asignar, el aviso rojo quedaba tapado por el
 *     verde de «Tutor dado de alta».
 */

const LISTA = [{ productId: 10, pct: 12, desde: '2026-09-01' }];

describe('los cursos que se guardan al dar de alta', () => {
  it('el elegido sin «Añadir» entra igual', () => {
    expect(cursosParaElAlta([], '55', '10', '2026-10-01')).toEqual([
      { productId: 55, pct: 10, desde: '2026-10-01' },
    ]);
  });

  it('se suma a los ya añadidos', () => {
    expect(cursosParaElAlta(LISTA, 55, '15', '2026-10-01')).toEqual([
      ...LISTA, { productId: 55, pct: 15, desde: '2026-10-01' },
    ]);
  });

  it('si ya estaba añadido no se repite', () => {
    expect(cursosParaElAlta(LISTA, 10, '15', '2026-10-01')).toEqual(LISTA);
  });

  it('sin nada elegido, solo los añadidos', () => {
    expect(cursosParaElAlta(LISTA, '', '15', '2026-10-01')).toEqual(LISTA);
    expect(cursosParaElAlta([], null, '15', '2026-10-01')).toEqual([]);
  });

  it('un porcentaje vacío o fuera de 0–100 toma el de por defecto', () => {
    expect(cursosParaElAlta([], 55, '', '2026-10-01', 8)[0].pct).toBe(8);
    expect(cursosParaElAlta([], 55, '140', '2026-10-01', 8)[0].pct).toBe(8);
    expect(cursosParaElAlta([], 55, '0', '2026-10-01', 8)[0].pct).toBe(0);
  });
});

describe('el aviso al terminar', () => {
  it('si todo entró, uno verde con cuántos cursos', () => {
    const a = avisoDelAlta(false, 2, []);
    expect(a.variant).toBe('default');
    expect(a.title).toBe('Tutor dado de alta');
    expect(a.description).toContain('Con 2 cursos asignados');
  });

  it('si uno falló, UN solo aviso, rojo, que dice cuál y por qué y no se va solo', () => {
    const a = avisoDelAlta(true, 1, [{ nombre: 'Máster en Logopedia', motivo: 'Esa formacion es de Fono Aprende y el tutor no está dado de alta ahí.' }]);
    expect(a.variant).toBe('destructive');
    expect(a.title).toBe('Tutor dado de alta, pero sin un curso');
    expect(a.description).toContain('«Máster en Logopedia»: Esa formacion es de Fono Aprende');
    expect(a.description).toContain('El otro sí se asignó');
    expect(a.duration).toBe(0);
  });

  it('varios fallidos, todos nombrados', () => {
    const a = avisoDelAlta(false, 0, [{ nombre: 'A', motivo: 'x' }, { nombre: 'B', motivo: 'y' }]);
    expect(a.title).toBe('Tutor dado de alta, pero sin 2 cursos');
    expect(a.description).toContain('«A»: x · «B»: y');
  });
});
