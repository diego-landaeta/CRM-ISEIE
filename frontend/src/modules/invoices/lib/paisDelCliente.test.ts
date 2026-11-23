import { describe, it, expect } from 'vitest';
import { paisDelCliente, paisPorTelefono } from './paisDelCliente';

// Diego, 23/11/2026: la 2026/1008 de ISEIE (Mariano, Buenos Aires) decía «, España».
describe('el país del cliente de una factura', () => {
  it('el de la ficha manda', () => {
    expect(paisDelCliente('Chile', '+5491136304440')).toBe('Chile');
  });
  it('sin país en la ficha, el del prefijo; nunca España por defecto', () => {
    expect(paisDelCliente('', '+5491136304440')).toBe('Argentina');
    expect(paisDelCliente(null, '+52 1 686 201 4801')).toBe('México');
    expect(paisDelCliente('—', '0056990569391')).toBe('Chile');
    expect(paisDelCliente('', '+18099123873')).toBe('República Dominicana');
    expect(paisDelCliente('', '+34 600 000 000')).toBe('España');
  });
  it('sin prefijo o sin teléfono, vacío (se pide), no España', () => {
    expect(paisDelCliente('', '648018800')).toBe('');
    expect(paisDelCliente(undefined, null)).toBe('');
    expect(paisPorTelefono('+922670458740')).toBeNull();
  });
});
