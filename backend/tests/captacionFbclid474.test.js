import { describe, it, expect, vi, beforeEach } from 'vitest';

// Captura de atribución de Meta en el lead (#474, gemela de CRM#474): IP,
// navegador, fbclid→fbc y la cookie _fbp en el formulario externo
// (Elementor/Make) y en el widget del CRM; lead_id/form_id de un Lead Ad
// explícito. Sin base: todo mockeado, igual que duplicadosFormulario.test.js.
//
//   cd backend && npx vitest run tests/captacionFbclid474.test.js

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const FORM_WIDGET = { id: 1, kind: 'form', destination: 'lead', project_id: 8, embed_id: 'widget474', url_match_enabled: false };
const FORM_WEBHOOK = {
  id: 2, kind: 'webhook', webhook_mode: 'json', awaiting_sample: false,
  project_id: 8, embed_id: 'webhook474', field_mapping: {}, config: {}, default_product_id: null,
};

vi.mock('../src/modules/forms/form.model.js', () => ({
  findByEmbed: vi.fn(async () => FORM_WIDGET),
  incrementSubmissions: vi.fn(async () => {}),
  logEvent: vi.fn(async () => {}),
  saveSample: vi.fn(async () => {}),
}));
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
const formModel = await import('../src/modules/forms/form.model.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const { extraerFbclid, fbclidAFbc, limpiarFbp } = await import('../src/modules/leads/canal.js');
const { idsMetaDelEnvio } = await import('../src/modules/leads/origen-meta.js');
const { applyMapping } = await import('../src/modules/make/make.service.js');

async function llamar(fn, { body = {}, headers = {}, ip = '203.0.113.5' } = {}) {
  let salida = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ params: {}, body, headers, ip }, res, (e) => { throw e; });
  return salida;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('fbclid → fbc (canal.js)', () => {
  it('saca el fbclid de la URL, con y sin más parámetros', () => {
    expect(extraerFbclid('https://web.test/x?fbclid=ABC123')).toBe('ABC123');
    expect(extraerFbclid('https://web.test/x?utm_source=fb&fbclid=XYZ&utm_medium=paid')).toBe('XYZ');
  });

  it('sin fbclid, o sin URL, devuelve null', () => {
    expect(extraerFbclid('https://web.test/x?utm_source=fb')).toBeNull();
    expect(extraerFbclid(null)).toBeNull();
    expect(extraerFbclid(undefined)).toBeNull();
  });

  it('arma el fbc en el formato exacto que pide Meta', () => {
    expect(fbclidAFbc('ABC123', 1700000000000)).toBe('fb.1.1700000000000.ABC123');
  });

  it('sin fbclid, no hay fbc', () => {
    expect(fbclidAFbc(null)).toBeNull();
    expect(fbclidAFbc(undefined, 123)).toBeNull();
  });
});

describe('limpiarFbp: el _fbp del formulario externo, antes de guardarlo (#474)', () => {
  it('con el formato de Meta, se guarda tal cual', () => {
    expect(limpiarFbp('fb.1.1699999999999.1234567890')).toBe('fb.1.1699999999999.1234567890');
  });

  it('más largo que la columna (255) o que no es el formato de Meta: null, no rompe el alta', () => {
    expect(limpiarFbp('x'.repeat(300))).toBeNull();
    expect(limpiarFbp('no-es-un-fbp')).toBeNull();
    expect(limpiarFbp(null)).toBeNull();
  });
});

describe('idsMetaDelEnvio: el lead y el formulario de un Lead Ad (#474)', () => {
  it('lee meta_lead_id/leadgen_id y meta_form_id explícitos, sueltos o en custom_fields', () => {
    const r1 = idsMetaDelEnvio({ meta_lead_id: '123456789012', meta_form_id: '987654321098' });
    expect(r1.explicitos.lead).toBe('123456789012');
    expect(r1.explicitos.form).toBe('987654321098');

    const r2 = idsMetaDelEnvio({ leadgen_id: '111122223333', custom_fields: { meta_form_id: '444455556666' } });
    expect(r2.explicitos.lead).toBe('111122223333');
    expect(r2.explicitos.form).toBe('444455556666');
  });

  it('un "form_id" suelto NO se confunde con el de Meta (es el id interno de Elementor)', () => {
    const r = idsMetaDelEnvio({ form_id: '123456789012', custom_fields: { form_id: '123456789013' } });
    expect(r.explicitos.form).toBeNull();
  });

  it('sin ningún dato de Meta, los dos quedan null (y no rompe nada)', () => {
    const r = idsMetaDelEnvio({ nombre: 'Juan', email: 'juan@test.com' });
    expect(r.explicitos).toEqual({ ad: null, adset: null, campaign: null, lead: null, form: null });
  });

  it('un meta_lead_id o meta_form_id con letras no es un id de Meta: queda null, no rompe nada', () => {
    const r = idsMetaDelEnvio({ meta_lead_id: 'abc123', meta_form_id: '12x456' });
    expect(r.explicitos.lead).toBeNull();
    expect(r.explicitos.form).toBeNull();
  });
});

describe('Make: meta_lead_id y meta_form_id se pueden mapear como campo (#474)', () => {
  it('un admin puede mapear "Lead ID"/"Form ID" del payload a los campos de Meta', () => {
    const payload = { data: { leadgen_id: '555566667777', form_id: '888899990000' } };
    const mapeo = { meta_lead_id: 'data.leadgen_id', meta_form_id: 'data.form_id' };
    const out = applyMapping(payload, mapeo);
    expect(out.meta_lead_id).toBe('555566667777');
    expect(out.meta_form_id).toBe('888899990000');
    expect(out.custom_fields).toEqual({});
  });
});

describe('el widget (iframe) manda IP, navegador y fbc; nunca fbp (#474)', () => {
  beforeEach(() => { formModel.findByEmbed.mockResolvedValue(FORM_WIDGET); });

  it('con fbclid en la URL de entrada: fbc con el formato correcto, fbp siempre null', async () => {
    await llamar(forms.publicSubmit, {
      body: { nombre: 'Ana Prueba', email: 'ana@example.com', landing_url: 'https://cliente.test/pagina?fbclid=WIDGET123' },
      headers: { 'user-agent': 'WidgetBrowser/1.0' },
      ip: '198.51.100.7',
    });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({
      utms: expect.objectContaining({
        fbc: expect.stringMatching(/^fb\.1\.\d+\.WIDGET123$/),
        fbp: null,
        client_ip: '198.51.100.7',
        user_agent: 'WidgetBrowser/1.0',
      }),
    }));
  });

  it('sin fbclid ni referrer: el lead entra igual que hoy, solo que ahora con IP y navegador', async () => {
    await llamar(forms.publicSubmit, {
      body: { nombre: 'Beto Prueba', email: 'beto@example.com' },
      headers: { 'user-agent': 'OtroNavegador/2.0' },
      ip: '198.51.100.9',
    });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({
      utms: expect.objectContaining({ fbc: null, fbp: null, client_ip: '198.51.100.9', user_agent: 'OtroNavegador/2.0' }),
    }));
  });
});

describe('el webhook de formularios manda IP, navegador, fbc y fbp si lo trae (#474)', () => {
  beforeEach(() => { formModel.findByEmbed.mockResolvedValue(FORM_WEBHOOK); });

  it('con fbclid en la URL y _fbp explícito: los dos se guardan', async () => {
    await llamar(forms.publicWebhook, {
      body: {
        nombre: 'Carla Prueba', email: 'carla@example.com',
        landing_url: 'https://cliente.test/contacto?fbclid=HOOK456',
        fbp: 'fb.1.1699999999999.1234567890',
      },
      headers: { 'user-agent': 'FormularioExterno/3.0' },
      ip: '198.51.100.11',
    });
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({
      utms: expect.objectContaining({
        fbc: expect.stringMatching(/^fb\.1\.\d+\.HOOK456$/),
        fbp: 'fb.1.1699999999999.1234567890',
        client_ip: '198.51.100.11',
        user_agent: 'FormularioExterno/3.0',
      }),
    }));
  });

  it('un lead sin ningún dato de Meta entra igual que hoy (criterio de aceptación de la #474)', async () => {
    const salida = await llamar(forms.publicWebhook, {
      body: { nombre: 'Diego Prueba', email: 'diego@example.com' },
      headers: { 'user-agent': 'Normal/1.0' },
      ip: '198.51.100.13',
    });
    expect(salida.success).toBe(true);
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({
      utms: expect.objectContaining({ fbc: null, fbp: null, client_ip: '198.51.100.13', user_agent: 'Normal/1.0' }),
    }));
  });

  it('un fbp demasiado largo no rompe el alta: el prospecto se crea igual, con fbp null (#474)', async () => {
    const salida = await llamar(forms.publicWebhook, {
      body: { nombre: 'Elena Prueba', email: 'elena@example.com', fbp: 'x'.repeat(300) },
      headers: { 'user-agent': 'FormularioExterno/3.0' },
      ip: '198.51.100.15',
    });
    expect(salida.success).toBe(true);
    expect(leadModel.createLeadWithRoundRobin).toHaveBeenCalledWith(expect.objectContaining({
      utms: expect.objectContaining({ fbp: null }),
    }));
  });
});