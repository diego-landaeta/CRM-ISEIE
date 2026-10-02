import { describe, it, expect } from 'vitest';
import { tramosDeSalud, totalDeLaCola, fraseDeSalud } from '@/modules/proceso/lib/salud';

/*
  Cómo va la cola del día (repaso de Diego, 15/09: «no hay gráficas de cómo va,
  ni la salud»).

  No se inventa ninguna cifra: son las cuatro de `GET /proceso/cola/resumen`
  puestas de forma que se lean juntas. Lo que se prueba aquí es el reparto y la
  frase, que es lo que de verdad se lee.
*/

const resumen = (x = {}) => ({ atrasados: 0, hoy: 0, manana: 0, esta_semana: 0, ...x });

describe('el reparto de la barra', () => {
  it('va en el orden en que se vive el día', () => {
    const t = tramosDeSalud(resumen({ atrasados: 1, hoy: 2, manana: 3, esta_semana: 4 }));
    expect(t.map((x) => x.clave)).toEqual(['atrasados', 'hoy', 'manana', 'semana']);
  });

  it('reparte cien entre los cuatro', () => {
    const t = tramosDeSalud(resumen({ atrasados: 25, hoy: 25, manana: 25, esta_semana: 25 }));
    expect(t.map((x) => x.porcentaje)).toEqual([25, 25, 25, 25]);
  });

  it('con la cola vacía no reparte NaN', () => {
    // Un NaN en un `width` deja la barra a lo ancho de la pantalla.
    const t = tramosDeSalud(resumen());
    for (const x of t) expect(Number.isNaN(x.porcentaje)).toBe(false);
    expect(t.every((x) => x.porcentaje === 0)).toBe(true);
  });

  it('sin resumen no hay barra que pintar', () => {
    expect(tramosDeSalud(null)).toEqual([]);
    expect(tramosDeSalud(undefined)).toEqual([]);
    expect(totalDeLaCola(null)).toBe(0);
  });

  it('lo atrasado va en rojo y lo de hoy en ámbar, no al revés', () => {
    const t = tramosDeSalud(resumen({ atrasados: 1, hoy: 1 }));
    expect(t[0].tono).toBe('destructive');
    expect(t[1].tono).toBe('warning');
  });
});

describe('la frase, que es lo que se lee', () => {
  it('con atrasos dice cuántos de cuántos, y avisa', () => {
    const f = fraseDeSalud(resumen({ atrasados: 12, hoy: 20, manana: 10, esta_semana: 5 }));
    expect(f.texto).toBe('12 de 47 llegan tarde.');
    expect(f.alerta).toBe(true);
  });

  it('un solo atraso se dice en singular', () => {
    expect(fraseDeSalud(resumen({ atrasados: 1, hoy: 3 })).texto).toBe('1 de 4 llega tarde.');
  });

  it('sin atrasos no alarma, y dice lo de hoy', () => {
    const f = fraseDeSalud(resumen({ hoy: 5, manana: 2 }));
    expect(f.alerta).toBe(false);
    expect(f.texto).toContain('5 pasos para hoy');
  });

  it('sin atrasos y sin nada hoy, mira hacia delante', () => {
    const f = fraseDeSalud(resumen({ manana: 3, esta_semana: 4 }));
    expect(f.alerta).toBe(false);
    expect(f.texto).toBe('Nada llega tarde. 7 pasos por delante.');
  });

  it('con la cola vacía lo dice y no cuenta nada', () => {
    const f = fraseDeSalud(resumen());
    expect(f.texto).toBe('No queda nada pendiente en la cola.');
    expect(f.alerta).toBe(false);
  });

  it('no mete porcentajes: esto se lee de pie, no es un informe', () => {
    for (const r of [{ atrasados: 12, hoy: 20 }, { hoy: 5 }, {}]) {
      expect(fraseDeSalud(resumen(r)).texto).not.toContain('%');
    }
  });
});
