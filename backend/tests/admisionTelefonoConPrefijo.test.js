import { describe, it, expect, vi, beforeEach } from 'vitest';

// La solicitud de admisión guarda el teléfono con su prefijo (17/11/2026).
//
// En producción, los dos únicos prospectos de una semana con el teléfono sin «+» los
// había creado la solicitud de admisión: `prospectoDe` pasaba el teléfono tal cual
// llegaba del formulario. Ahora va normalizado al prospecto y a la solicitud; lo que
// llegó, intacto, sigue en `datos_admision`. Teléfonos inventados.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));
vi.mock('../src/modules/leads/lead.model.js', () => ({
  findDuplicateByEmailOrPhone: vi.fn(async () => null),
  createLeadWithRoundRobin: vi.fn(async () => ({ id: 801 })),
}));
vi.mock('../src/modules/matriculas/matricula.model.js', () => ({
  findByDedupe: vi.fn(async () => null),
  create: vi.fn(async (d) => ({ id: 901, project_id: d.project_id })),
  update: vi.fn(async () => {}),
  conTransaccion: vi.fn(async (fn) => fn({})),
  registrarEvento: vi.fn(async () => {}),
}));
vi.mock('../src/modules/matriculas/admision.archivos.js', () => ({
  obtenerArchivo: vi.fn(async () => null),
  conArchivos: (body) => body,
}));
vi.mock('../src/modules/matriculas/admision.aviso.js', () => ({ avisarAdmision: vi.fn(async () => {}) }));
vi.mock('../src/modules/certifex/certifex.firma.js', () => ({ firmaTransparente: vi.fn(async (b) => b) }));
vi.mock('../src/modules/webhook-tokens/mapeo.js', () => ({ applyMapping: (b) => b }));

const { recibirAdmision } = await import('../src/modules/matriculas/admision.service.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const matriculaModel = await import('../src/modules/matriculas/matricula.model.js');

const TOKEN = { project_id: 9, field_mapping: {} };
const enviar = (telefono) => recibirAdmision(TOKEN, {
  nombre: 'Persona Prueba', email: `p${Math.random().toString(36).slice(2)}@example.com`, telefono,
}, [], { respuestaMs: 0, avisar: () => null });

beforeEach(() => { vi.clearAllMocks(); });

describe('la solicitud de admisión', () => {
  it('crea el prospecto con «56 912345678» como +56912345678', async () => {
    const r = await enviar('56 912345678');
    expect(r.status).toBe(200);
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ telefono: '+56912345678' }));
  });
  it('guarda la solicitud con el teléfono normalizado y el envío original intacto', async () => {
    await enviar('593 99999999');
    const datos = matriculaModel.create.mock.calls[0][0];
    expect(datos.telefono).toBe('+59399999999');
    expect(datos.datos_admision.telefono).toBe('593 99999999');
  });
  it('un teléfono que no se puede normalizar se guarda tal cual, no se pierde', async () => {
    await enviar('No suministrado');
    expect(matriculaModel.create.mock.calls[0][0].telefono).toBe('No suministrado');
  });
});
