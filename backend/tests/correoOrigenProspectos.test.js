import { describe, it, expect, vi } from 'vitest';

// Diego, 29/10: «WhatsApp es que toquen el widget, y tocan y ellas cargan». En el
// «Resumen del día», «Prospectos» lo sumaba todo y Carlos no podía saber si los 15
// de una gestora se los había dado el reparto o los había dado de alta ella.

vi.mock('../src/shared/config/db.js', () => ({ getClient: vi.fn(), query: vi.fn(async () => ({ rows: [] })) }));

const C = await import('../src/jobs/correosDelEquipo.js');

describe('de dónde llegan los prospectos de cada gestora', () => {
  it('separa formulario, WhatsApp y a mano debajo del total', () => {
    const celda = C.prospectosConOrigen({ leads: 15, formularios: 2, whatsapp: 12 });
    expect(celda.startsWith('15')).toBe(true);
    expect(celda).toContain('2 formulario');
    expect(celda).toContain('12 WhatsApp');
    expect(celda).toContain('1 a mano');
  });

  it('no enseña los orígenes que no tiene', () => {
    const celda = C.prospectosConOrigen({ leads: 3, formularios: 3, whatsapp: 0 });
    expect(celda).toContain('3 formulario');
    expect(celda).not.toContain('WhatsApp');
    expect(celda).not.toContain('a mano');
  });

  it('la leyenda dice qué es cada uno', () => {
    expect(C.LEYENDA_ORIGEN).toMatch(/WhatsApp: pulsó el botón de la web/);
  });
});
