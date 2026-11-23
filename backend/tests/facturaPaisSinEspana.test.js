import { describe, it, expect } from 'vitest';
import { phoneToCountryName } from '../src/shared/utils/countryPrefix.js';
import { createInvoiceSchema } from '../src/modules/invoices/invoices.validation.js';

/*
  Diego, 23/11/2026: la 2026/1008 de ISEIE (Mariano, Buenos Aires) acababa la
  dirección con «, España»; en el 360 había 66 facturas así. El país ya no se
  pone por defecto: el de la ficha, o el del prefijo del teléfono, o nada.
*/
describe('país por el teléfono', () => {
  it('reconoce los prefijos de los clientes que salían como España', () => {
    expect(phoneToCountryName('+5491136304440')).toBe('Argentina');
    expect(phoneToCountryName('+529931691177')).toBe('México');
    expect(phoneToCountryName('+56 9 6347 4769')).toBe('Chile');
    expect(phoneToCountryName('+593995557699')).toBe('Ecuador');
  });
  it('la República Dominicana no es Estados Unidos', () => {
    expect(phoneToCountryName('+18099123873')).toBe('República Dominicana');
    expect(phoneToCountryName('+18292571887')).toBe('República Dominicana');
    expect(phoneToCountryName('+13056902879')).toBe('Estados Unidos / Canadá');
  });
  it('sin «+» no adivina', () => {
    expect(phoneToCountryName('648018800')).toBeNull();
  });
});

describe('el país en la validación', () => {
  const base = {
    projectId: 1, clienteNombre: 'X', items: [{ descripcion: 'c', cantidad: 1, precio_unitario: 1 }],
    metodoPago: 'transferencia',
  };
  it('un borrador sin país pasa', () => {
    expect(createInvoiceSchema.safeParse({ ...base, borrador: true }).success).toBe(true);
  });
  it('una factura sin país no pasa: se pide, no se inventa', () => {
    const r = createInvoiceSchema.safeParse({ ...base, clienteNif: '1', clienteDireccion: 'd', clienteCiudad: 'c', clienteCp: '1' });
    expect(r.success).toBe(false);
    expect(r.error.issues.map((i) => i.path[0])).toContain('clientePais');
  });
});
