import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fecha } from './SupervisionTutores';

/*
  QA del 26/11: en America/Caracas (UTC-4) un vencimiento DATE «2026-12-15»
  salía «14 dic». La fecha sin hora debe leerse en el día local, sea cual sea
  la zona; la marca de tiempo completa sigue leyéndose con su instante.
*/
describe('fecha() de Supervisión de tutores', () => {
  const tzAntes = process.env.TZ;
  afterEach(() => { process.env.TZ = tzAntes; });

  for (const tz of ['America/Caracas', 'Europe/Madrid', 'Pacific/Honolulu', 'Asia/Tokyo']) {
    describe(tz, () => {
      beforeEach(() => { process.env.TZ = tz; });

      it('un DATE en texto sale en su día', () => {
        expect(fecha('2026-12-15')).toMatch(/^15 dic/);
        expect(fecha('2026-01-01')).toMatch(/^1 ene.* 2026$/);
      });
    });
  }

  it('en Caracas, una marca de tiempo se lee con su instante', () => {
    process.env.TZ = 'America/Caracas';
    // 02:00 UTC del 15 son las 22:00 del 14 en Caracas.
    expect(fecha('2026-12-15T02:00:00.000Z')).toMatch(/^14 dic/);
  });

  it('sin fecha, un guion', () => {
    expect(fecha(null)).toBe('—');
    expect(fecha(undefined)).toBe('—');
    expect(fecha('')).toBe('—');
  });
});
