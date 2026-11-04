import { describe, it, expect } from 'vitest';
import { pestanasDeEquipos, pestanaValida, TODOS_LOS_EQUIPOS } from '@/modules/tasks/lib/pestanasEquipo';

// Gemela de la de MultiCRM. Diego, 04/11/2026: quien lleva las colaboraciones ve sus dos tableros, cada uno
// en su pestaña; quien está en uno solo, sin pestañas.
const dev = { team_id: 1, team_name: 'Desarrollo y SEO', team_tipo: 'colaboradores', empresa: 'CEDIA Investigación y Desarrollo SL' };
const tut = { team_id: 2, team_name: 'Tutores', team_tipo: 'tutores', empresa: 'CEDIA Investigación y Desarrollo SL' };

describe('las pestañas por equipo de «Mi tablero»', () => {
  it('en dos equipos, una pestaña por equipo', () => {
    expect(pestanasDeEquipos([dev, tut]).map((p) => [p.value, p.label, p.tipo])).toEqual([
      ['1', 'Desarrollo y SEO', 'colaboradores'], ['2', 'Tutores', 'tutores'],
    ]);
  });
  it('en uno solo, o en ninguno, sin pestañas', () => {
    expect(pestanasDeEquipos([tut])).toEqual([]);
    expect(pestanasDeEquipos([])).toEqual([]);
    // El mismo equipo dos veces sigue siendo uno.
    expect(pestanasDeEquipos([tut, tut])).toEqual([]);
  });
  it('quien ve todo tiene además «Todos los equipos», la primera', () => {
    const p = pestanasDeEquipos([dev, tut], { conTodos: true });
    expect(p.map((x) => x.label)).toEqual([TODOS_LOS_EQUIPOS, 'Desarrollo y SEO', 'Tutores']);
    expect(p[0].value).toBe('');
  });
  it('dos equipos con el mismo nombre, con la empresa al lado', () => {
    const otra = { team_id: 3, team_name: 'Tutores', team_tipo: 'tutores', empresa: 'Otra Formación SL' };
    expect(pestanasDeEquipos([tut, otra]).map((p) => p.label)).toEqual(['Tutores · CEDIA', 'Tutores · Otra']);
  });
  it('sin una pestaña válida elegida, la primera; sin pestañas, lo que hubiera', () => {
    const p = pestanasDeEquipos([dev, tut]);
    expect(pestanaValida(p, '')).toBe('1');
    expect(pestanaValida(p, '2')).toBe('2');
    expect(pestanaValida([], 'sin')).toBe('sin');
  });
});
