import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { seleccionar, VENTANAS } from '@/shared/lib/vencimientos';

/*
  Qué entra en una lista de vencimientos y en qué orden.

  El fallo que da nombre a este fichero: «Próximos cobros» ordenaba por atraso
  y se quedaba con cinco, así que cinco deudas viejas tapaban siempre lo que
  venía. Diego, 15/09: «dice "venció hace 285 días", que es mirar atrás».
*/

// Hoy congelado: si no, la prueba de «285 días» caduca mañana.
const HOY = new Date(2026, 8, 16); // 16/09/2026

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOY); });
afterEach(() => { vi.useRealTimers(); });

/** Una fecha a N días de hoy, en el formato del servidor. */
function dia(n) {
  const d = new Date(2026, 8, 16 + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CASO = [
  { id: 'vieja', fecha: dia(-285) },
  { id: 'vencida', fecha: dia(-3) },
  { id: 'hoy', fecha: dia(0) },
  { id: 'manana', fecha: dia(1) },
  { id: 'en5', fecha: dia(5) },
  { id: 'en20', fecha: dia(20) },
  { id: 'sinFecha', fecha: null },
];

describe('«¿qué viene ahora?» — proximidad', () => {
  it('no enseña lo vencido: para eso está el contador', () => {
    const { filas, vencidasFuera } = seleccionar(CASO, { orden: 'proximidad', ventanaDias: 7 });
    expect(filas.map((f) => f.id)).toEqual(['hoy', 'manana', 'en5']);
    expect(vencidasFuera).toBe(2);
  });

  it('lo más cercano primero, no lo más atrasado', () => {
    const { filas } = seleccionar(CASO, { orden: 'proximidad', ventanaDias: 30 });
    expect(filas[0].id).toBe('hoy');
    expect(filas.map((f) => f.id)).not.toContain('vieja');
  });

  it('la ventana recorta por delante', () => {
    expect(seleccionar(CASO, { orden: 'proximidad', ventanaDias: 1 }).filas.map((f) => f.id))
      .toEqual(['hoy', 'manana']);
    expect(seleccionar(CASO, { orden: 'proximidad', ventanaDias: 30 }).filas.map((f) => f.id))
      .toEqual(['hoy', 'manana', 'en5', 'en20']);
  });

  it('con mucho vencido y nada por venir, la lista sale vacía y el contador lo dice', () => {
    const soloViejas = [{ id: 'a', fecha: dia(-285) }, { id: 'b', fecha: dia(-100) }];
    const { filas, vencidasFuera } = seleccionar(soloViejas, { orden: 'proximidad', ventanaDias: 7 });
    expect(filas).toEqual([]);
    expect(vencidasFuera).toBe(2);
  });
});

describe('«¿por dónde empiezo?» — urgencia', () => {
  it('sigue siendo lo más atrasado primero, que es lo correcto en Prospectos', () => {
    const { filas, vencidasFuera } = seleccionar(CASO, { orden: 'urgencia', ventanaDias: 7 });
    expect(filas.map((f) => f.id)).toEqual(['vieja', 'vencida', 'hoy', 'manana', 'en5']);
    // Aquí lo vencido ES la lista, así que no hay nada «fuera».
    expect(vencidasFuera).toBe(0);
  });

  it('es el comportamiento por defecto: quien no pida orden no cambia', () => {
    expect(seleccionar(CASO).filas.map((f) => f.id))
      .toEqual(seleccionar(CASO, { orden: 'urgencia', ventanaDias: 7 }).filas.map((f) => f.id));
  });
});

describe('las vencidas, cuando se piden', () => {
  it('solo las vencidas, de la más vieja a la más reciente', () => {
    const { filas } = seleccionar(CASO, { orden: 'vencidas' });
    expect(filas.map((f) => f.id)).toEqual(['vieja', 'vencida']);
  });

  it('lo que no cabe se cuenta', () => {
    const muchas = Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, fecha: dia(-10 - i) }));
    const { filas, vencidasFuera } = seleccionar(muchas, { orden: 'vencidas', maximo: 5 });
    expect(filas).toHaveLength(5);
    expect(vencidasFuera).toBe(3);
  });
});

describe('lo que nunca entra', () => {
  it('una fila sin fecha no se cuela como si venciera hoy', () => {
    for (const orden of ['urgencia', 'proximidad', 'vencidas']) {
      const { filas } = seleccionar(CASO, { orden, ventanaDias: 30 });
      expect(filas.map((f) => f.id)).not.toContain('sinFecha');
    }
  });

  it('sin nada que mirar no se rompe', () => {
    expect(seleccionar([], { orden: 'proximidad' })).toEqual({ filas: [], vencidasFuera: 0 });
    expect(seleccionar(null, { orden: 'proximidad' })).toEqual({ filas: [], vencidasFuera: 0 });
  });
});

describe('las ventanas que se ofrecen', () => {
  it('están las dos que pidió Diego: mañana y «en X días»', () => {
    const claves = VENTANAS.map((v) => v.clave);
    expect(claves).toContain('manana');
    expect(claves).toContain('semana');
    expect(claves).toContain('mes');
    expect(VENTANAS.find((v) => v.clave === 'manana').dias).toBe(1);
  });

  it('«Vencidas» es la única que mira atrás', () => {
    for (const v of VENTANAS) {
      expect(v.orden).toBe(v.clave === 'vencidas' ? 'vencidas' : 'proximidad');
    }
  });
});
