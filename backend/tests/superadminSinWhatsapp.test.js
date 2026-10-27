import { describe, it, expect } from 'vitest';
import { resolverPermisos } from '../src/modules/permissions/resolver.js';
import { excepcionesDeCasillas } from '../src/modules/permissions/casillas.js';
import { ACCIONES } from '../src/modules/permissions/catalogo.js';

// Diego, 26/10/2026: «Carlos y Vladys SIGUEN SIN WhatsApp aunque sean superadmin».
// Antes de #423 los apagaba la casilla «Usa WhatsApp» de su ficha; ahora es una
// excepción por persona, y es lo ÚNICO que le resta algo al superadmin.
describe('superadmin con su WhatsApp quitado por persona', () => {
  const claves = ACCIONES.map((x) => x.clave);

  it('la casilla apagada del superadmin pasa a ser «whatsapp.usar = no»', () => {
    expect(excepcionesDeCasillas({ role: 'superadmin', usa_whatsapp: false })).toEqual({ 'whatsapp.usar': false });
    expect(excepcionesDeCasillas({ role: 'superadmin', usa_whatsapp: true })).toEqual({});
  });

  it('con «whatsapp.usar = no», no usa su WhatsApp; el resto sigue en sí', () => {
    const { mapa, origenes } = resolverPermisos({ role: 'superadmin', excepciones: { 'whatsapp.usar': false } });
    expect(mapa['whatsapp.usar']).toBe(false);
    expect(origenes['whatsapp.usar']).toEqual({ tipo: 'excepcion' });
    for (const k of claves.filter((c) => c !== 'whatsapp.usar')) expect(mapa[k], k).toBe(true);
  });

  it('una excepción en «no» fuera de WhatsApp NO le quita nada al superadmin', () => {
    const { mapa } = resolverPermisos({ role: 'superadmin', excepciones: { 'leads.delete': false, 'users.manage': false } });
    for (const k of claves) expect(mapa[k], k).toBe(true);
  });

  it('una excepción en «sí» no cambia nada, y sin excepciones lo tiene todo', () => {
    expect(Object.values(resolverPermisos({ role: 'superadmin', excepciones: { 'whatsapp.usar': true } }).mapa).every(Boolean)).toBe(true);
    expect(Object.values(resolverPermisos({ role: 'superadmin' }).mapa).every(Boolean)).toBe(true);
  });
});
