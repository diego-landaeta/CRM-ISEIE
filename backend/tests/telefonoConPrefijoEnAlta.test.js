import { describe, it, expect, vi, beforeEach } from 'vitest';

// El teléfono de un prospecto nuevo se guarda siempre con su prefijo (17/11/2026).
//
// En producción entraban prospectos con «56 912345678» o «593 99999999», sin el «+»:
// el webhook de formularios (un formulario que llama directo al CRM), el de tokens y
// la solicitud de admisión pasaban el teléfono tal cual al alta. Sin «+» fallan el
// botón de WhatsApp, la llamada y la detección de duplicados por móvil. Ahora lo
// normaliza `createLeadWithRoundRobin`, por donde pasan todas las altas, y la
// admisión también lo guarda así en la solicitud. Teléfonos inventados.

const consultas = [];
const cliente = {
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/FROM project_queue_state/.test(sql)) return { rows: [{ id: 1, last_assigned_index: -1 }] };
    if (/INSERT INTO leads/.test(sql)) return { rows: [{ id: 501, project_id: params[0], telefono: params[3] }] };
    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(async () => cliente),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));
vi.mock('../src/modules/leads/reparto.js', () => ({ gestoresDelReparto: vi.fn(async () => []) }));
vi.mock('../src/modules/leads/pais.js', () => ({ paisDeEntrada: vi.fn(async () => null), sqlPaisDelLead: () => 'NULL' }));

const { telefonoParaGuardar } = await import('../src/shared/utils/normalizePhone.js');
const leadModel = await import('../src/modules/leads/lead.model.js');

const telefonoInsertado = () => consultas.find((c) => /INSERT INTO leads/.test(c.sql)).params[3];
const alta = (telefono) => leadModel.createLeadWithRoundRobin({
  projectId: 4, nombre: 'Persona Prueba', email: 'persona@example.com', telefono,
  productoInteresId: null, notas: null, landingUrl: null, duplicadoDe: null,
  utms: { utm_source: 'webhook', utm_medium: 'api' }, customFields: {},
});

beforeEach(() => { consultas.length = 0; vi.clearAllMocks(); });

describe('telefonoParaGuardar', () => {
  it('pone el «+» a un número con su prefijo de país sin él', () => {
    expect(telefonoParaGuardar('56 912345678')).toBe('+56912345678');
    expect(telefonoParaGuardar('593 99999999')).toBe('+59399999999');
    expect(telefonoParaGuardar('0034 600 111 222')).toBe('+34600111222');
  });
  it('un móvil español sin prefijo es +34', () => {
    expect(telefonoParaGuardar('611 222 333')).toBe('+34611222333');
  });
  it('deja igual el que ya viene bien', () => {
    expect(telefonoParaGuardar('+52 55 1234 5678')).toBe('+525512345678');
  });
  it('lo que no es un número no se pierde: se guarda tal cual', () => {
    expect(telefonoParaGuardar('No suministrado')).toBe('No suministrado');
    expect(telefonoParaGuardar('12 34')).toBe('12 34');
  });
  it('vacío es null', () => {
    expect(telefonoParaGuardar(null)).toBeNull();
    expect(telefonoParaGuardar(undefined)).toBeNull();
    expect(telefonoParaGuardar('   ')).toBeNull();
  });
});

describe('createLeadWithRoundRobin guarda el teléfono con prefijo', () => {
  it('«56 912345678» (formulario que llama directo al CRM) entra como +56912345678', async () => {
    const lead = await alta('56 912345678');
    expect(telefonoInsertado()).toBe('+56912345678');
    expect(lead.telefono).toBe('+56912345678');
  });
  it('«593 99999999» entra como +59399999999', async () => {
    await alta('593 99999999');
    expect(telefonoInsertado()).toBe('+59399999999');
  });
  it('sin teléfono, null', async () => {
    await alta(null);
    expect(telefonoInsertado()).toBeNull();
  });
});
