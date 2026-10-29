import { describe, it, expect, vi, beforeEach } from 'vitest';

// Duplicados en las altas por formulario y por webhook con token.
//
// Diego, 29/10: «en ISECD las personas llegan duplicadas y no dice nada de que son
// duplicados». ISECD, ISEF e ISSLOGG mandan su formulario al webhook de formularios,
// que creaba el lead sin mirar si ya estaba: la misma persona, tres envíos, tres leads
// sueltos con tres gestoras. Ahora, la misma regla que el webhook de leads.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const FORM = {
  id: 1, kind: 'webhook', webhook_mode: 'json', awaiting_sample: false,
  project_id: 8, embed_id: 'isecd', field_mapping: {}, config: {}, default_product_id: 10109,
};
const TOKEN = { id: 3, kind: 'leads', project_id: 8, token: 'tok_isecd_123456789012345', field_mapping: {}, awaiting_sample: false };

vi.mock('../src/modules/forms/form.model.js', () => ({
  findByEmbed: vi.fn(async () => FORM),
  incrementSubmissions: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
vi.mock('../src/modules/webhook-tokens/token.model.js', () => ({
  findByToken: vi.fn(async () => TOKEN),
  recordUse: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
vi.mock('../src/modules/webhook-tokens/mapeo.js', () => ({ applyMapping: (b) => b }));
vi.mock('../src/modules/leads/lead.model.js', () => ({
  createLeadWithRoundRobin: vi.fn(async (d) => ({ id: 90, project_id: d.projectId, nombre: d.nombre })),
  findDuplicateByEmailOrPhone: vi.fn(async () => null),
  createInteraction: vi.fn(async () => {}),
}));
vi.mock('../src/modules/leads/dup-queue.service.js', () => ({ enqueue: vi.fn(async () => null) }));
vi.mock('../src/modules/leads/lead-products.service.js', () => ({ autoAddFromReincidente: vi.fn(async () => {}) }));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({ planificarPasosDeLead: vi.fn(async () => 0) }));
vi.mock('../src/modules/asignacion/asignacion.service.js', () => ({
  decidirFormulario: vi.fn(async () => null),
  apuntarFormulario: vi.fn(async () => {}),
}));

const forms = await import('../src/modules/forms/form.controller.js');
const tokens = await import('../src/modules/webhook-tokens/token.controller.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const dupQueue = await import('../src/modules/leads/dup-queue.service.js');
const asignacion = await import('../src/modules/asignacion/asignacion.service.js');

async function llamar(fn, { params = { embedId: 'isecd', token: TOKEN.token }, body = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ params, body, headers: {}, ip: '127.0.0.1' }, res, (e) => { error = e; });
  return { salida, error };
}
const hace = (s) => new Date(Date.now() - s * 1000).toISOString();
const anterior = (extra = {}) => ({ id: 70, producto_interes_id: 10109, created_at: hace(3600), match_by_email: true, match_by_phone: false, ...extra });
const ENVIO = { nombre: 'Jaime Prueba', email: 'jaime@example.com', telefono: '+34600111222', producto_interes_id: 10109, notas: 'Quiero información' };

beforeEach(() => { vi.clearAllMocks(); });

describe('formulario incrustado', () => {
  it('una persona nueva: lead normal, sin duplicado', async () => {
    const { salida } = await llamar(forms.publicSubmit, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ duplicadoDe: null, reincidente: false }));
    expect(dupQueue.enqueue).not.toHaveBeenCalled();
    expect(salida.data.lead_id).toBe(90);
  });

  it('ya estaba (hace una hora, mismo curso): duplicado y reincidente, con nota en los dos y a la cola de revisión', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior());
    await llamar(forms.publicSubmit, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ duplicadoDe: 70, reincidente: true }));
    expect(leadModel.createInteraction).toHaveBeenCalledWith(90, 'nota', expect.stringMatching(/duplicado del lead #70/), null, null);
    expect(leadModel.createInteraction).toHaveBeenCalledWith(70, 'nota', expect.stringMatching(/nuevo lead duplicado #90/), null, null);
    expect(dupQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ leadId: 90, originalLeadId: 70, projectId: 8 }));
  });

  it('el mismo formulario otra vez a los 20 segundos: no hay lead nuevo, se apunta en el que ya había', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior({ created_at: hace(20) }));
    const { salida } = await llamar(forms.publicSubmit, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).not.toHaveBeenCalled();
    expect(leadModel.createInteraction).toHaveBeenCalledWith(70, 'nota', expect.stringMatching(/Re-envío del mismo formulario/), null, null);
    expect(salida.data.lead_id).toBe(70);
  });

  it('a los 20 segundos pero OTRO curso: es un lead nuevo, enlazado y no reincidente', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior({ created_at: hace(20), producto_interes_id: 555 }));
    await llamar(forms.publicSubmit, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ duplicadoDe: 70, reincidente: false }));
  });
});

describe('webhook de formularios (el de ISECD, ISEF e ISSLOGG)', () => {
  it('ya estaba: el lead nace enlazado al anterior', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior());
    const { salida } = await llamar(forms.publicWebhook, { body: { nombre: 'Jaime Prueba', email: 'jaime@example.com', telefono: '+34600111222' } });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ duplicadoDe: 70 }));
    expect(salida.data.lead_id).toBe(90);
  });

  it('reenvío inmediato: no crea otro lead', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior({ created_at: hace(30) }));
    const { salida } = await llamar(forms.publicWebhook, { body: { nombre: 'Jaime Prueba', email: 'jaime@example.com' } });
    expect(leadModel.createLeadWithRoundRobin).not.toHaveBeenCalled();
    expect(salida.data).toMatchObject({ lead_id: 70, reenvio: true });
  });
});

describe('webhook con token', () => {
  it('ya estaba: duplicado enlazado; reenvío inmediato: sin lead nuevo', async () => {
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior());
    const a = await llamar(tokens.publicReceive, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ duplicadoDe: 70, reincidente: true }));
    expect(a.salida.data.action).toBe('created_duplicate');
    leadModel.findDuplicateByEmailOrPhone.mockResolvedValueOnce(anterior({ created_at: hace(10) }));
    const b = await llamar(tokens.publicReceive, { body: ENVIO });
    expect(b.salida.data).toMatchObject({ lead_id: 70, action: 'resent' });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledTimes(1);
  });
});

describe('asignación por actividad en los formularios directos al CRM (29/10)', () => {
  it('con alguien activa: el lead es para ella y queda en el registro', async () => {
    const decision = { elegida: { id: 47 }, config: { id: 5 }, motivo: { texto: 'activa hace 2 min' } };
    asignacion.decidirFormulario.mockResolvedValueOnce(decision);
    await llamar(forms.publicWebhook, { body: { nombre: 'Jaime Prueba', email: 'jaime@example.com' } });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ forcedResponsableId: 47 }));
    expect(asignacion.apuntarFormulario).toHaveBeenCalledWith(decision, expect.objectContaining({ id: 90 }), expect.objectContaining({ origen: 'formulario' }));
  });

  it('sin nadie activa (o asignación apagada): sigue el turno de siempre', async () => {
    await llamar(forms.publicSubmit, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ forcedResponsableId: null }));
  });

  it('el webhook con token, igual', async () => {
    asignacion.decidirFormulario.mockResolvedValueOnce({ elegida: { id: 6 }, config: { id: 5 }, motivo: {} });
    await llamar(tokens.publicReceive, { body: ENVIO });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({ forcedResponsableId: 6 }));
  });
});
