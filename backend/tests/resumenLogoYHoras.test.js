import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

// El resumen del día con el LOGO de la empresa y el TRAMO DE HORAS (Diego, 29/09):
// «pusiste el logo y sello, pon el logo en ambos» y «deberías de incluir el plazo
// de horas que salió eso».

const SELLO = 'https://iseie.com/wp-content/uploads/2026/07/sello.png';
let campus = [];
let marcas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_projects up')) return { rows: campus };
    if (sql.includes('FROM invoice_issuers')) {
      // Si se volviera a pedir la imagen de facturacion, aqui esta el sello.
      return { rows: [{ id: 6, razon_social: 'ISEIE Innovation School SL', logo_url: SELLO }, { id: 8, razon_social: 'CEDIA', logo_url: SELLO }] };
    }
    if (sql.includes('FROM projects p WHERE id = ANY')) return { rows: marcas };
    return { rows: [] };
  }),
}));

process.env.FEEDBACK_BASE_URL = 'https://crm.iseie.com';
const C = await import('../src/jobs/correosDelEquipo.js');
const { dibujarInsignia } = await import('../src/modules/feedback/cabecera.js');

beforeEach(() => {
  campus = [];
  marcas = [];
});

describe('el tramo de horas', () => {
  it('en verano el día de la base empieza a las 02:00 de España', () => {
    expect(C.tramoDeHoy(new Date('2026-09-29T19:04:00Z'))).toBe('de 02:00 a 21:04 (hora de España)');
  });

  it('en invierno, a la 01:00', () => {
    expect(C.tramoDeHoy(new Date('2026-12-01T19:30:00Z'))).toBe('de 01:00 a 20:30 (hora de España)');
  });
});

describe('el logo de cada empresa', () => {
  it('es el de su marca, dibujado; nunca la imagen de facturación (el sello)', async () => {
    campus = [{ id: 10, nombre: 'ISEIE', sociedad_id: 6 }];
    marcas = [{ id: 10, nombre: 'ISEIE', logo_url: 'https://iseie.com/logo-blanco.png', theme_color: '#1f4e79', color_cabecera: '#002a80' }];
    const [e] = await C.empresasDe({ id: 1, role: 'admin' });
    expect(e.nombre).toBe('ISEIE Innovation School SL');
    expect(e.logoUrl).toMatch(/^https:\/\/crm\.iseie\.com\/api\/f\/insignia\/10\?v=[0-9a-f]{10}$/);
    expect(e.logoUrl).not.toContain('sello');
  });

  it('una empresa de varios campus no toma el logo de ninguno', async () => {
    campus = [{ id: 1, nombre: 'ISEIH', sociedad_id: 8 }, { id: 2, nombre: 'Psiko Aprende', sociedad_id: 8 }];
    const [e] = await C.empresasDe({ id: 1, role: 'admin' });
    expect(e.campus).toHaveLength(2);
    expect(e.logoUrl).toBeNull();
  });

  it('un campus sin logo va sin imagen (con el filete de color)', async () => {
    campus = [{ id: 5, nombre: 'ACADEMIA IA', sociedad_id: 10 }];
    marcas = [{ id: 5, nombre: 'ACADEMIA IA', logo_url: null }];
    const [e] = await C.empresasDe({ id: 1, role: 'admin' });
    expect(e.logoUrl).toBeNull();
    expect(C.apartado(e.nombre, { logoUrl: e.logoUrl })).toContain('border-left:4px');
  });
});

describe('la insignia', () => {
  it('un logo blanco sale sobre el color de la marca, opaco y a 80 px de alto', async () => {
    const blanco = await sharp({ create: { width: 300, height: 90, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const fetchReal = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => blanco }));
    try {
      const png = await dibujarInsignia({ logo_url: 'https://iseie.com/logo-blanco.png', color_cabecera: '#002a80' });
      const meta = await sharp(png).metadata();
      expect(meta.height).toBe(80);
      expect(meta.hasAlpha).toBe(false);
      // La esquina es el azul de la marca, no blanco ni transparente.
      const { data } = await sharp(png).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      expect([...data]).toEqual([0, 42, 128]);
    } finally {
      globalThis.fetch = fetchReal;
    }
  });

  it('sin logo no dibuja nada', async () => {
    expect(await dibujarInsignia({ logo_url: null })).toBeNull();
  });
});
