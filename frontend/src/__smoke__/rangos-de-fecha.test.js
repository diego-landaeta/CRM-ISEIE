import { describe, it, expect } from 'vitest';
import { iso, ATAJOS, rangoPorDefecto, atajoDe } from '@/shared/lib/rangosDeFecha';

// Martes 8 de septiembre de 2026. Se fija el día para que las pruebas no
// dependan de cuándo se ejecuten.
const MARTES = new Date(2026, 8, 8);
const calc = (clave, hoy = MARTES) => ATAJOS.find((a) => a.clave === clave).calcular(hoy);

describe('rangos de fecha', () => {
  it('escribe la fecha del día que se ve, no la de UTC', () => {
    // El 1 de enero a las 00:00 seguía siendo el 1 de enero: con
    // `toISOString()` desde España se convertía en el 31 de diciembre.
    expect(iso(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(iso(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('arranca en el mes en curso, no en el año', () => {
    expect(rangoPorDefecto(MARTES)).toEqual({ from: '2026-09-01', to: '2026-09-08' });
  });

  it('«ayer» es un solo día', () => {
    expect(calc('ayer')).toEqual({ from: '2026-09-07', to: '2026-09-07' });
  });

  it('«esta semana» va del lunes a hoy', () => {
    expect(calc('esta_semana')).toEqual({ from: '2026-09-07', to: '2026-09-08' });
  });

  it('«la semana pasada» es lunes a domingo, no los 7 días anteriores', () => {
    // Los 7 días anteriores serían 01–07; la semana pasada es 31 ago – 06 sept.
    expect(calc('semana_pasada')).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });

  it('el domingo pertenece a la semana que acaba, no a la que empieza', () => {
    const domingo = new Date(2026, 8, 13);
    expect(calc('esta_semana', domingo)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(calc('semana_pasada', domingo)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });

  it('«el mes pasado» acaba el último día del mes, sea cual sea', () => {
    expect(calc('mes_pasado')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    // Marzo → febrero de un año que no es bisiesto.
    expect(calc('mes_pasado', new Date(2026, 2, 15))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    // Y de uno que sí lo es.
    expect(calc('mes_pasado', new Date(2024, 2, 15))).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    // Enero → diciembre del año anterior.
    expect(calc('mes_pasado', new Date(2026, 0, 10))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('reconoce qué atajo es un rango, y cuándo es a medida', () => {
    expect(atajoDe({ from: '2026-09-01', to: '2026-09-08' }, MARTES)).toBe('este_mes');
    expect(atajoDe({ from: '2026-08-31', to: '2026-09-06' }, MARTES)).toBe('semana_pasada');
    expect(atajoDe({ from: '2026-04-03', to: '2026-05-19' }, MARTES)).toBeNull();
    expect(atajoDe({ from: '', to: '' }, MARTES)).toBeNull();
  });
});
