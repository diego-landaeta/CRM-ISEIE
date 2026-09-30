import { describe, it, expect } from 'vitest';
import { entroEnElProceso } from '../shared/lib/enElProceso';

// La barra de vencidos de Prospectos cuenta desde el 01/09 (Diego, 30/09: «los
// atrasados y eso también que sean a partir de esa fecha»; la fecha, septiembre).

describe('quién cuenta en la barra de vencidos', () => {
  it('el que pidió información desde el 01/09 a medianoche de Madrid, sí', () => {
    expect(entroEnElProceso({ fecha_solicitud: '2026-08-31T22:46:39Z' })).toBe(true); // 00:46 del 01/09 en Madrid
    expect(entroEnElProceso({ fecha_solicitud: '2026-09-30T10:00:00Z' })).toBe(true);
  });

  it('el de antes, no', () => {
    expect(entroEnElProceso({ fecha_solicitud: '2026-08-31T20:55:07Z' })).toBe(false); // 22:55 del 31/08 en Madrid
    expect(entroEnElProceso({ fecha_solicitud: '2026-08-11T10:00:00Z' })).toBe(false);
  });

  it('manda la solicitud, no el alta: uno cargado hoy que pidió en agosto es de agosto', () => {
    expect(entroEnElProceso({ fecha_solicitud: '2026-08-15T10:00:00Z', created_at: '2026-09-30T10:00:00Z' })).toBe(false);
  });

  it('sin solicitud, cuenta el alta', () => {
    expect(entroEnElProceso({ fecha_solicitud: null, created_at: '2026-09-30T10:00:00Z' })).toBe(true);
  });

  it('sin ninguna fecha, o con una rota, no cuenta', () => {
    expect(entroEnElProceso({})).toBe(false);
    expect(entroEnElProceso({ fecha_solicitud: 'no es una fecha' })).toBe(false);
  });
});
