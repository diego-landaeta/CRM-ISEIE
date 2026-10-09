import { describe, it, expect, vi, afterEach } from 'vitest';

// Diego, 09/10: el resumen del día de ISEIE salió tarde porque reinicié la API en
// la última media hora de las 21:00. La tarea solo miraba la hora cada 30
// minutos, y la primera vuelta tras el reinicio caía ya en la hora siguiente.

vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(async () => ({ rows: [] })), getClient: vi.fn() }));
const { vigilar, _internos } = await import('../src/jobs/latido.js');

afterEach(() => { vi.useRealTimers(); _internos?.tareas?.clear?.(); });

describe('una tarea puede dar una vuelta nada más arrancar', () => {
  it('con alArrancarMs da una vuelta a ese tiempo, y luego sigue con su intervalo', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => {});
    const reloj = vigilar('prueba_al_arrancar', 'Prueba', tick, 30 * 60 * 1000, { alArrancarMs: 60 * 1000 });
    await vi.advanceTimersByTimeAsync(59 * 1000);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 1000);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(tick).toHaveBeenCalledTimes(2);
    clearInterval(reloj);
  });

  it('sin la opción, como siempre: la primera vuelta llega con el intervalo', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => {});
    const reloj = vigilar('prueba_sin_arrancar', 'Prueba', tick, 30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(tick).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(tick).toHaveBeenCalledTimes(1);
    clearInterval(reloj);
  });
});

describe('el resumen del día y el reporte semanal la usan', () => {
  it('los dos piden su vuelta al arrancar', async () => {
    const fs = await import('node:fs');
    for (const f of ['resumenDiarioScheduler.js', 'reporteSemanalScheduler.js']) {
      const src = fs.readFileSync(new URL(`../src/jobs/${f}`, import.meta.url), 'utf8');
      expect(src, f).toMatch(/vigilar\([^)]*\{ alArrancarMs: AL_ARRANCAR_MS \}\)/);
    }
  });
});
