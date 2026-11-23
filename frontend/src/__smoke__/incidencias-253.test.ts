import { describe, it, expect } from 'vitest';
import {
  enlaceDe, comoHoraLocal, desdeHoraLocal, fechaHora, nombreDelMes, TIPOS, ORDEN_TIPOS, ESTADOS, GRAVEDADES,
} from '@/modules/incidencias/lib/incidencias';

/**
 * Incidencias (#253), lo que hace la pantalla por su cuenta.
 *
 *   - «Sobre qué» lleva a la ficha: prospecto y venta, a la suya; factura y
 *     usuario no tienen ficha con dirección y van a su pantalla.
 *   - La hora se escribe y se lee en hora de Madrid, también si el navegador
 *     está en otra zona, y con el desfase de ESE día (+01:00 o +02:00).
 */

describe('el enlace a la ficha', () => {
  it('prospecto y venta, a su ficha', () => {
    expect(enlaceDe('lead', 4033)).toBe('/leads/4033');
    expect(enlaceDe('venta', 569)).toBe('/ventas/569');
  });

  it('sin número no hay ficha a la que ir', () => {
    expect(enlaceDe('lead', null)).toBeNull();
    expect(enlaceDe('venta', null)).toBeNull();
  });

  it('factura y usuario sin lo que da el servidor, a su pantalla; «otra cosa» y nada, a ningún sitio', () => {
    expect(enlaceDe('factura', 86)).toBe('/accounting/facturas');
    expect(enlaceDe('usuario', 7)).toBe('/configuracion');
    expect(enlaceDe('otro', 1)).toBeNull();
    expect(enlaceDe(null, 1)).toBeNull();
  });

  // Como el buscador (Ctrl K, #591): no tienen ficha propia.
  // En ISEIE Configuración abre en Usuarios y no busca por dirección.
  it('la factura, a su venta; el usuario, a Configuración', () => {
    expect(enlaceDe('factura', 86, { ventaId: 569 })).toBe('/ventas/569');
    expect(enlaceDe('usuario', 7, { nombre: 'Laura García' })).toBe('/configuracion');
  });
});

describe('la hora, en hora de Madrid', () => {
  it('en verano (+02:00): las 15:10 de Madrid son las 13:10 UTC, y vuelven a leerse como 15:10', () => {
    const iso = desdeHoraLocal('2026-10-06T15:10');
    expect(iso).toBe('2026-10-06T13:10:00.000Z');
    expect(comoHoraLocal(iso)).toBe('2026-10-06T15:10');
  });

  it('en invierno (+01:00): las 23:30 del 31/10 son las 22:30 UTC', () => {
    const iso = desdeHoraLocal('2026-10-31T23:30');
    expect(iso).toBe('2026-10-31T22:30:00.000Z');
    expect(comoHoraLocal(iso)).toBe('2026-10-31T23:30');
  });

  it('la noche del cambio de hora: 29/03 a las 01:30 es aún invierno (+01:00); 25/10 a las 01:30, aún verano (+02:00)', () => {
    expect(desdeHoraLocal('2026-03-29T01:30')).toBe('2026-03-29T00:30:00.000Z');
    expect(desdeHoraLocal('2026-03-29T03:30')).toBe('2026-03-29T01:30:00.000Z');
    expect(desdeHoraLocal('2026-10-25T01:30')).toBe('2026-10-24T23:30:00.000Z');
    expect(comoHoraLocal(desdeHoraLocal('2026-03-29T01:30'))).toBe('2026-03-29T01:30');
  });

  it('se enseña con día, mes, año y hora', () => {
    expect(fechaHora('2026-10-06T13:10:00.000Z')).toMatch(/06\/10\/2026.*15:10/);
    expect(fechaHora(null)).toBe('');
  });

  it('el mes de las cifras se lee en castellano', () => {
    expect(nombreDelMes('2026-10')).toMatch(/oct/);
  });
});

describe('las etiquetas', () => {
  it('los cuatro tipos de la issue, en su orden', () => {
    expect(ORDEN_TIPOS).toEqual(['capa8', 'fallo_crm', 'dato_mal', 'externo']);
    expect(ORDEN_TIPOS.map((t) => TIPOS[t].label)).toEqual(['Capa 8', 'Fallo del CRM', 'Dato mal cargado', 'Externo']);
  });

  it('gravedad y estado, los de Soporte', () => {
    expect(Object.keys(ESTADOS)).toEqual(['open', 'in_review', 'resolved', 'closed']);
    expect(Object.keys(GRAVEDADES)).toEqual(['low', 'medium', 'high', 'critical']);
  });

  it('con tokens, sin colores sueltos (#32)', () => {
    const clases = [...Object.values(ESTADOS), ...Object.values(GRAVEDADES)].map((x) => x.clase).join(' ');
    expect(clases).not.toMatch(/\b(red|amber|blue|emerald|zinc|green|yellow)-\d/);
  });
});
