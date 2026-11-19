import { describe, it, expect, vi, beforeEach } from 'vitest';

// El lead que entra por el webhook de FORMULARIOS o por el webhook con token
// también avisa a su gestora: la campana y el correo, como el que entra por Make.
//
// Revisión del reparto (Diego, 18/11/2026: «revisa la asignación de leads, al
// parecer está fallando»). En ICTESS el formulario de la web entra por el
// webhook de formularios y, unos segundos después, por Make, que se junta con el
// lead ya creado. El de formularios no avisaba a nadie: en 14 días, 21 prospectos
// de ICTESS sin campana y 18 sin correo, más los de ISECD, ISSLOGG y Academia IA.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (/FROM users/.test(sql)) return { rows: [{ id: 11, nombre: 'Gestora Prueba', email: 'gestora@test.local' }] };
    if (/FROM projects/.test(sql)) return { rows: [{ id: 4, nombre: 'Campus', slug: 'campus' }] };
    return { rows: [], rowCount: 0 };
  }),
}));

const FORM = {
  id: 1, kind: 'webhook', webhook_mode: 'json', awaiting_sample: false,
  project_id: 4, embed_id: 'campus', field_mapping: {}, config: {},
};

vi.mock('../src/modules/forms/form.model.js', () => ({
  findByEmbed: vi.fn(async () => FORM),
  incrementSubmissions: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
const LEAD = { id: 77, project_id: 4, nombre: 'Ana Prueba', email: 'ana@example.com', telefono: null, responsable_id: 11 };
vi.mock('../src/modules/leads/lead.model.js', () => ({
  createLeadWithRoundRobin: vi.fn(async () => ({ ...LEAD })),
  findDuplicateByEmailOrPhone: vi.fn(async () => null),
  createInteraction: vi.fn(async () => {}),
}));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({
  planificarPasosDeLead: vi.fn(async () => 4),
}));
vi.mock('../src/modules/asignacion/asignacion.service.js', () => ({
  decidirFormulario: vi.fn(async () => null),
  apuntarFormulario: vi.fn(async () => {}),
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: vi.fn(async () => ({ id: 1 })),
  notifyAdmins: vi.fn(async () => ({ id: 1 })),
}));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendLeadAssignedEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/modules/webhook-tokens/token.model.js', () => ({
  findByToken: vi.fn(),
  recordUse: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
vi.mock('../src/modules/matriculas/admision.service.js', () => ({ recibirAdmision: vi.fn() }));

const forms = await import('../src/modules/forms/form.controller.js');
const tokens = await import('../src/modules/webhook-tokens/token.controller.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const { notifyUsers } = await import('../src/modules/notifications/notifications.service.js');
const { sendLeadAssignedEmail } = await import('../src/shared/services/brevo.service.js');

async function llamar(fn, req) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ headers: {}, ip: '127.0.0.1', ...req }, res, (e) => { error = e; });
  return { salida, error };
}

const ELEMENTOR = {
  form_id: 'abc', form_name: 'Contacto',
  fields: { nombre: { value: 'Ana Prueba' }, email: { value: 'ana@example.com' } },
};

function avisoALaGestora() {
  expect(notifyUsers).toHaveBeenCalledWith(expect.objectContaining({
    targetUserIds: [11], type: 'lead_asignado', link_path: '/prospectos/77',
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('un lead que entra por formulario avisa a su gestora', () => {
  it('webhook de formularios (Elementor): campana y correo', async () => {
    const { salida } = await llamar(forms.publicWebhook, { params: { embedId: 'campus' }, body: ELEMENTOR });
    expect(salida.data.lead_id).toBe(77);
    avisoALaGestora();
    await vi.waitFor(() => expect(sendLeadAssignedEmail).toHaveBeenCalledTimes(1));
    const arg = sendLeadAssignedEmail.mock.calls[0][0];
    expect(arg.gestor.id).toBe(11);
    expect(arg.lead.id).toBe(77);
    expect(arg.proyecto.id).toBe(4);
  });

  it('formulario incrustado: campana y correo', async () => {
    await llamar(forms.publicSubmit, { params: { embedId: 'campus' }, body: { nombre: 'Luis', email: 'luis@example.com' } });
    avisoALaGestora();
    await vi.waitFor(() => expect(sendLeadAssignedEmail).toHaveBeenCalledTimes(1));
  });

  it('webhook con token: campana y correo', async () => {
    const tok = { id: 3, kind: 'leads', project_id: 4, token: 'tok_prueba_123456789012345', awaiting_sample: false, field_mapping: { nombre: 'nombre', email: 'email' } };
    const { salida, error } = await llamar(tokens.publicReceive, { params: { token: tok.token }, webhookToken: tok, body: { nombre: 'Ana Prueba', email: 'ana@example.com' } });
    expect(error).toBeNull();
    expect(salida.data.lead_id).toBe(77);
    avisoALaGestora();
    await vi.waitFor(() => expect(sendLeadAssignedEmail).toHaveBeenCalledTimes(1));
  });

  it('sin gestora no se avisa a nadie (y el alta sigue)', async () => {
    leadModel.createLeadWithRoundRobin.mockResolvedValueOnce({ ...LEAD, responsable_id: null });
    const { salida } = await llamar(forms.publicSubmit, { params: { embedId: 'campus' }, body: { nombre: 'Luis', email: 'luis@example.com' } });
    expect(salida.data.lead_id).toBe(77);
    expect(notifyUsers).not.toHaveBeenCalled();
    expect(sendLeadAssignedEmail).not.toHaveBeenCalled();
  });

  it('si el correo falla, el alta no se entera', async () => {
    sendLeadAssignedEmail.mockRejectedValueOnce(new Error('Brevo caído'));
    const { salida, error } = await llamar(forms.publicSubmit, { params: { embedId: 'campus' }, body: { nombre: 'Luis', email: 'luis@example.com' } });
    expect(error).toBeNull();
    expect(salida.success).toBe(true);
  });
});
