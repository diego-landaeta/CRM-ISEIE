import { describe, it, expect } from 'vitest';

/*
  25/11 · Ana y la venta 540. Cuando el turno para una emisión de la cola
  (HAY_ANTERIORES), el aviso decía «hay cobros anteriores sin facturar» sin
  decir cuál: nadie sabía qué cobro lo paraba ni dónde ir a facturarlo. Ahora
  sale el primero, con su venta, su fecha y su importe. Sin base.
*/
const { primeroAnterior, textoDelCobro, datosDelCobro, A_MANO_EN_COLA } = await import('../src/modules/invoices/invoices.service.js');

const cola = [
  { payment_id: 999, conversion_id: 720, fecha: '2026-11-22', importe: '395.00', cliente: 'Alumna A' },
  { payment_id: 1000, conversion_id: 721, fecha: '2026-11-23', importe: '380.00', cliente: 'Alumna B' },
  { payment_id: 1008, conversion_id: 540, fecha: '2026-11-24', importe: '91.66', cliente: 'Alumna C' },
];

describe('HAY_ANTERIORES dice qué cobro para el turno', () => {
  it('el primero de la cola que va antes, por fecha', () => {
    expect(primeroAnterior(cola, cola[2])?.payment_id).toBe(999);
    expect(primeroAnterior(cola, cola[1])?.payment_id).toBe(999);
    expect(primeroAnterior(cola, cola[0])).toBeNull();
  });

  it('a igual fecha, el de id más bajo; y nunca él mismo', () => {
    const mismoDia = [
      { payment_id: 5, conversion_id: 1, fecha: '2026-11-24', importe: 10 },
      { payment_id: 7, conversion_id: 2, fecha: '2026-11-24', importe: 10 },
    ];
    expect(primeroAnterior(mismoDia, mismoDia[1])?.payment_id).toBe(5);
    expect(primeroAnterior(mismoDia, mismoDia[0])).toBeNull();
  });

  it('con fechas como Date (como las devuelve pg), igual', () => {
    const conDate = cola.map((p) => ({ ...p, fecha: new Date(`${p.fecha}T00:00:00`) }));
    expect(primeroAnterior(conDate, conDate[2])?.payment_id).toBe(999);
    expect(datosDelCobro(conDate[0]).fecha).toBe('2026-11-22');
  });

  it('el texto: importe, fecha, cliente, venta y cobro', () => {
    expect(textoDelCobro(cola[0])).toBe('395,00 € del 22/11/2026 de Alumna A (venta 720, cobro 999)');
    expect(datosDelCobro(cola[0])).toEqual({ payment_id: 999, conversion_id: 720, fecha: '2026-11-22', importe: 395, cliente: 'Alumna A' });
  });
});

describe('la etiqueta «a mano» de la cola', () => {
  it('no sale sola y necesita a una persona', () => {
    expect(A_MANO_EN_COLA).toMatchObject({ estado: 'a_mano', sale_sola: false, motivo_codigo: 'A_MANO' });
  });
});
