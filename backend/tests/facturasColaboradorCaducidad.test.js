import { describe, it, expect } from 'vitest';
import { caducidad } from '../src/modules/facturas-colaborador/facturas.service.js';
import { armarCorreoDelMes } from '../src/modules/facturas-colaborador/facturas.emails.js';

/*
  Facturas de colaboradores (#202) · cuándo caduca el enlace. Diego, 30/10:
  «uno manda la factura el 31, por ejemplo, y el 6 del mes siguiente se vence el
  enlace». Se sube hasta el día 5 a las 23:59 de Madrid. Si administración
  reenvía (o anula) después del día 6, el enlace nuevo vale 6 días enteros.

  Sin base: las horas van en UTC y se comprueban contra Madrid (UTC+1 en
  invierno, UTC+2 en verano).
*/

const t = (iso) => new Date(iso);

describe('facturas de colaboradores (#202) · el enlace del mes caduca el día 6', () => {
  it('la de octubre, enviada el 31, se sube hasta el 5 de noviembre a las 23:59 de Madrid', () => {
    const caduca = caducidad('2026-10-01', t('2026-10-31T09:00:00Z'));
    expect(caduca.toISOString()).toBe('2026-11-05T23:00:00.000Z'); // 06/11 00:00 en Madrid (invierno)
    expect(t('2026-11-05T22:59:59Z') < caduca).toBe(true); // 05/11 23:59:59: todavía vale
    expect(t('2026-11-05T23:00:00Z') < caduca).toBe(false); // 06/11 00:00: caducado
  });

  it('en verano, con Madrid a UTC+2', () => {
    expect(caducidad('2026-05-01', t('2026-05-31T08:00:00Z')).toISOString()).toBe('2026-06-05T22:00:00.000Z');
  });

  it('la de diciembre caduca el 6 de enero del año siguiente', () => {
    expect(caducidad('2026-12-01', t('2026-12-31T09:00:00Z')).toISOString()).toBe('2027-01-05T23:00:00.000Z');
  });

  it('si la tarea recupera el mes del día 1 al 4, el enlace caduca igual el 6', () => {
    expect(caducidad('2026-10-01', t('2026-11-03T09:00:00Z')).toISOString()).toBe('2026-11-05T23:00:00.000Z');
  });
});

describe('facturas de colaboradores (#202) · reenviar o anular después del día 6', () => {
  it('antes del día 6, el enlace reenviado caduca también el 6', () => {
    expect(caducidad('2026-10-01', t('2026-11-04T15:00:00Z')).toISOString()).toBe('2026-11-05T23:00:00.000Z');
  });

  it('después del día 6, vale 6 días enteros: reenviado el 10, hasta el 16 a las 23:59', () => {
    expect(caducidad('2026-10-01', t('2026-11-10T14:00:00Z')).toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });

  it('justo al caducar (06/11 00:00), cuenta desde el 6', () => {
    expect(caducidad('2026-10-01', t('2026-11-05T23:00:00Z')).toISOString()).toBe('2026-11-12T23:00:00.000Z');
  });

  it('el día de Madrid, no el de UTC: el 10 a las 00:30 de Madrid todavía es el 9 en UTC', () => {
    expect(caducidad('2026-10-01', t('2026-11-09T23:30:00Z')).toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });

  it('con el cambio de hora por medio (25/10/2026)', () => {
    // Reenviado el 18/10 (verano): hasta el 24/10, caduca el 25/10 a las 00:00, todavía en verano.
    expect(caducidad('2026-09-01', t('2026-10-18T10:00:00Z')).toISOString()).toBe('2026-10-24T22:00:00.000Z');
    // Reenviado el 20/10 (verano): caduca el 27/10 a las 00:00, ya en invierno.
    expect(caducidad('2026-09-01', t('2026-10-20T10:00:00Z')).toISOString()).toBe('2026-10-26T23:00:00.000Z');
  });

  it('a fin de mes pasa al mes siguiente', () => {
    expect(caducidad('2026-10-01', t('2026-11-28T10:00:00Z')).toISOString()).toBe('2026-12-04T23:00:00.000Z');
  });
});

describe('facturas de colaboradores (#202) · el correo dice hasta qué día se puede subir', () => {
  it('«Puedes subirla hasta el 05/11», no el día que caduca', () => {
    const f = {
      periodo: '2026-10-01', razon_social: 'CEDIA Investigación y Desarrollo SL', colaborador_nombre: 'Laura',
      importe_esperado: null, area: 'seo', caduca_at: '2026-11-05T23:00:00.000Z',
    };
    const { htmlContent, textContent } = armarCorreoDelMes({ f, token: 'abc' });
    expect(htmlContent).toMatch(/Puedes subirla hasta el 0?5\/11\./);
    expect(textContent).toMatch(/Puedes subirla hasta el 0?5\/11\./);
    expect(htmlContent).not.toMatch(/0?6\/11/);
  });
});
