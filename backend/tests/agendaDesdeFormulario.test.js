import { describe, it, expect, vi, beforeEach } from 'vitest';

// Lo que entra por un formulario del CRM tambien entra en el proceso comercial.
//
// Diego, 06/10: «los leads despues del 29 no estan en ese proceso y no entiendo
// por que». El webhook de formularios (Elementor, correo y el incrustado) creaba
// el prospecto sin escribir su agenda, y sin agenda no hay cola del dia ni pasos.
// ACADEMIA IA recibe todos sus prospectos por aqui.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const FORM = {
  id: 1, kind: 'webhook', webhook_mode: 'json', awaiting_sample: false,
  project_id: 5, embed_id: 'academia', field_mapping: {}, config: {},
};

vi.mock('../src/modules/forms/form.model.js', () => ({
  findByEmbed: vi.fn(async () => FORM),
  incrementSubmissions: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
vi.mock('../src/modules/leads/lead.model.js', () => ({
  createLeadWithRoundRobin: vi.fn(async () => ({ id: 77 })),
}));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({
  planificarPasosDeLead: vi.fn(async () => 4),
}));

const ctrl = await import('../src/modules/forms/form.controller.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const proceso = await import('../src/modules/proceso/proceso.model.js');

async function llamar(fn, { params = { embedId: 'academia' }, body = {} } = {}) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ params, body, headers: {}, ip: '127.0.0.1' }, res, (e) => { error = e; });
  return { salida, error };
}

const ELEMENTOR = {
  form_id: 'abc', form_name: 'Contacto',
  fields: { nombre: { value: 'Ana Prueba' }, email: { value: 'ana@example.com' }, telefono: { value: '+34600000000' } },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('la agenda del proceso, al entrar por un formulario', () => {
  it('el webhook (Elementor) crea el prospecto Y le escribe la agenda', async () => {
    const { salida } = await llamar(ctrl.publicWebhook, { body: ELEMENTOR });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledTimes(1);
    expect(proceso.planificarPasosDeLead).toHaveBeenCalledWith(77);
    expect(salida.data.lead_id).toBe(77);
  });

  it('el formulario incrustado, igual', async () => {
    const { salida } = await llamar(ctrl.publicSubmit, { body: { nombre: 'Luis', email: 'luis@example.com' } });
    expect(proceso.planificarPasosDeLead).toHaveBeenCalledWith(77);
    expect(salida.data.lead_id).toBe(77);
  });

  it('si la agenda falla, el prospecto se da de alta igual', async () => {
    proceso.planificarPasosDeLead.mockRejectedValueOnce(new Error('se cayo la base'));
    const { salida, error } = await llamar(ctrl.publicSubmit, { body: { nombre: 'Luis', email: 'luis@example.com' } });
    expect(error).toBeNull();
    expect(salida.success).toBe(true);
    expect(salida.data.lead_id).toBe(77);
  });
});
