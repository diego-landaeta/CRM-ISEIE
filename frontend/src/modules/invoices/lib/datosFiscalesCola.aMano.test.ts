import { describe, it, expect } from 'vitest';
import { textoDatosFiscales, necesitaPersona } from './datosFiscalesCola';

// 25/11, venta 540: con la automática encendida, el cobro de una venta que ya
// se facturaba a mano no lo toma nadie. La cola lo dice, para no esperar en vano.
describe('cola · «a mano»', () => {
  const aMano = { estado: 'a_mano' as const, caduca_at: null, sale_sola: false, motivo_codigo: 'A_MANO', motivo: 'x', detalle: null };
  it('dice que no sale sola y que se emite desde la cola', () => {
    expect(textoDatosFiscales(aMano)).toBe('A mano: no sale sola, emítela desde aquí');
  });
  it('necesita a una persona', () => {
    expect(necesitaPersona(aMano)).toBe(true);
  });
});
