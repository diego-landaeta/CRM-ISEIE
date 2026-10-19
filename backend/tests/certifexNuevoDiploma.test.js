import { describe, it, expect } from 'vitest';
import { nuevoDiplomaSchema } from '../src/modules/certifex/certifex.validation.js';

// «Nuevo diploma» (Diego, 19/10: «Academia IA está sin Moodle, así que tiene que crear el
// diploma desde 0, seleccionando el cliente; igual para los demás»). La validación de lo que
// manda el panel: campus, cliente, formación y, opcional, el nombre que se imprimirá. Sin base.

const ok = { centro: 'academiaia', leadId: 12, productoId: 345 };

describe('nuevo diploma · validación', () => {
  it('acepta campus, cliente y formación, con o sin el nombre del diploma', () => {
    expect(nuevoDiplomaSchema.safeParse(ok).success).toBe(true);
    const r = nuevoDiplomaSchema.safeParse({ ...ok, nombre: '  María   José García ' });
    expect(r.success).toBe(true);
    expect(r.data.nombre).toBe('María José García');
  });

  it('exige el cliente y la formación como ids', () => {
    for (const malo of [{ ...ok, leadId: undefined }, { ...ok, leadId: 0 }, { ...ok, productoId: 'x' }, { ...ok, productoId: -1 }]) {
      expect(nuevoDiplomaSchema.safeParse(malo).success, JSON.stringify(malo)).toBe(false);
    }
  });

  it('el campus con su formato y el nombre con la regla del diploma', () => {
    expect(nuevoDiplomaSchema.safeParse({ ...ok, centro: 'campus con espacios' }).success).toBe(false);
    expect(nuevoDiplomaSchema.safeParse({ ...ok, nombre: 'Diego (pruebas)' }).success).toBe(false);
    expect(nuevoDiplomaSchema.safeParse({ ...ok, nombre: 'Ana' }).success).toBe(false);
  });
});
