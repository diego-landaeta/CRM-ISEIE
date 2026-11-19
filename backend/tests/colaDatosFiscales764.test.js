import { describe, it, expect } from 'vitest';

/**
 * CRM#764 (gemela CRM-ISEIE#452) · probado en /testeo el 18/11.
 *
 * La emisión automática se paró por «posible duplicada» y la cola decía
 * «Datos del alumno: sale sola». La etiqueta ahora dice si sale sola o no y,
 * si no, el motivo real. Sin base: es la regla, pura.
 */

const { comoVaEnLaCola, motivoDelError } = await import('../src/modules/factura-automatica/factura-automatica.service.js');

const fila = (extra = {}) => ({
  estado: 'respondido', caduca_at: '2026-11-25T00:00:00Z', motivo_revision: null, ultimo_error: null, ...extra,
});
const DUPLICADA_18_11 = 'Ya existe la factura 2026/0035 de este cliente por el mismo importe (100,00 €) el día '
  + '18/11/2026. Si de verdad es otra factura, confírmalo para emitirla igualmente.';

describe('CRM#764 · por qué no salió sola', () => {
  it('el código va delante del texto', () => {
    expect(motivoDelError('[FACTURACION_PAUSADA] La facturación está pausada…'))
      .toEqual({ codigo: 'FACTURACION_PAUSADA', texto: 'La facturación está pausada…' });
    expect(motivoDelError(null)).toEqual({ codigo: null, texto: null });
  });

  it('los anotados antes del código (la venta 557 de /testeo) se reconocen por su texto', () => {
    expect(motivoDelError(DUPLICADA_18_11).codigo).toBe('POSIBLE_DUPLICADA');
    expect(motivoDelError('Espera su turno en la cola: hay cobros anteriores sin facturar').codigo).toBe('HAY_ANTERIORES');
    expect(motivoDelError('La sociedad emisora del campus no tiene el CIF puesto').codigo).toBe('EMISOR_SIN_CIF');
    expect(motivoDelError('algo raro').codigo).toBeNull();
  });
});

describe('CRM#764 · la etiqueta de la cola', () => {
  it('parada por posible duplicada → NO sale sola, y dice por qué', () => {
    const r = comoVaEnLaCola(fila({ ultimo_error: DUPLICADA_18_11 }));
    expect(r).toMatchObject({ estado: 'respondido', sale_sola: false, motivo_codigo: 'POSIBLE_DUPLICADA' });
    expect(r.motivo).toMatch(/posible duplicada/);
    expect(r.detalle).toBe(DUPLICADA_18_11);
  });

  it('posible duplicada vista en vivo, aunque aún no se haya intentado', () => {
    expect(comoVaEnLaCola(fila(), { posibleDuplicada: true }))
      .toMatchObject({ sale_sola: false, motivo_codigo: 'POSIBLE_DUPLICADA' });
  });

  it('con la facturación pausada por la auditoría → no sale sola', () => {
    expect(comoVaEnLaCola(fila(), { pausada: true }))
      .toMatchObject({ sale_sola: false, motivo_codigo: 'FACTURACION_PAUSADA', motivo: 'facturación pausada por la auditoría' });
  });

  it('esperando su turno → sí sale sola, cuando le toque', () => {
    expect(comoVaEnLaCola(fila({ ultimo_error: '[HAY_ANTERIORES] Espera su turno…' })))
      .toMatchObject({ sale_sola: true, motivo_codigo: 'HAY_ANTERIORES' });
  });

  it('un error cualquiera → no sale sola', () => {
    expect(comoVaEnLaCola(fila({ estado: 'ficha', ultimo_error: '[TOTAL_CORTO] Esta venta ya tiene…' })))
      .toMatchObject({ sale_sola: false, motivo_codigo: 'TOTAL_CORTO' });
    expect(comoVaEnLaCola(fila({ ultimo_error: 'algo raro' })))
      .toMatchObject({ sale_sola: false, motivo_codigo: 'OTRO', motivo: 'no se pudo emitir', detalle: 'algo raro' });
  });

  it('sin error → sale sola; pendiente y revisión, como siempre', () => {
    expect(comoVaEnLaCola(fila())).toMatchObject({ sale_sola: true, motivo_codigo: null });
    expect(comoVaEnLaCola(fila({ estado: 'pendiente' }))).toMatchObject({ estado: 'pendiente', sale_sola: true });
    expect(comoVaEnLaCola(fila({ estado: 'revision', motivo_revision: 'falta el NIF' })))
      .toMatchObject({ sale_sola: false, detalle: 'falta el NIF' });
    expect(comoVaEnLaCola(null)).toBeNull();
  });
});
