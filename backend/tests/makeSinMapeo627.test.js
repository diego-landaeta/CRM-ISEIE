import { describe, it, expect, vi, beforeEach } from 'vitest';

// #627: un webhook de Make en activo y sin `field_mapping` rechazaba el envío
// («field_mapping vacío en modo active») y el prospecto no entraba por ahí: 27
// envíos entre el 16/10 y el 02/11, en cinco campus, todos con correo y nombre
// (esa vez la ficha había entrado ya por el webhook de formularios). Ahora se
// reconocen los campos por su nombre habitual, se crea el prospecto y se avisa
// al admin.

const db = vi.hoisted(() => ({ avisoReciente: false }));
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (/FROM admin_notifications/.test(sql)) return { rows: db.avisoReciente ? [{ 1: 1 }] : [] };
    return { rows: [], rowCount: 0 };
  }),
}));

const HOOK = {
  id: 10, project_id: 4, slug: 'mk_prueba', label: 'FORMULARIO PRUEBA', secret: 'msk_secreto',
  mode: 'active', active: true, field_mapping: {},
};
vi.mock('../src/modules/make/make.model.js', () => ({
  findBySlug: vi.fn(async () => ({ ...HOOK })),
  saveSample: vi.fn(async () => {}),
  logDelivery: vi.fn(async () => {}),
  bumpCounter: vi.fn(async () => {}),
}));
vi.mock('../src/modules/leads/lead.service.js', () => ({
  createFromExternalWebhook: vi.fn(async () => ({ lead_id: 501, responsable_id: 7, duplicado: false })),
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyAdmins: vi.fn(async () => ({ id: 1 })),
}));

const svc = await import('../src/modules/make/make.service.js');
const model = await import('../src/modules/make/make.model.js');
const leadService = await import('../src/modules/leads/lead.service.js');
const notif = await import('../src/modules/notifications/notifications.service.js');
const { deducirMapeo } = await import('../src/modules/make/make.campos-habituales.js');

// La forma exacta de los envíos rechazados en producción, con datos inventados.
const ENVIO_ICTESS = {
  date: '28 de octubre de 2026', time: '11:39', ip: '203.0.113.7',
  email: 'persona.prueba@example.com', full_name: 'Persona de Prueba',
  phone_complete: '+34600000000', course: 'Curso de prueba',
  message: 'Quiero información', page_url: 'https://campus.example.com/cursos/curso-de-prueba/?utm_source=fb&utm_medium=paid',
  landing_url: '', source: 'PRO Elements', privacy_accepted: true,
  utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '',
};

const esperar = () => new Promise((r) => setTimeout(r, 0));
const llamar = (payload, extra = {}) => svc.handleIncoming({ slug: 'mk_prueba', secret: 'msk_secreto', payload, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
  db.avisoReciente = false;
  model.findBySlug.mockImplementation(async () => ({ ...HOOK }));
});

describe('deducirMapeo: los campos por su nombre habitual', () => {
  it('reconoce el envío de los formularios de Make', () => {
    expect(deducirMapeo(ENVIO_ICTESS)).toEqual({
      email: 'email', nombre: 'full_name', telefono: 'phone_complete',
      producto_interes: 'course', notas: 'message', landing_url: 'page_url',
    });
  });

  it('`source` es el nombre de la web, no el utm_source', () => {
    expect(deducirMapeo({ email: 'a@example.com', source: 'Isslogg' }).utm_source).toBeUndefined();
  });

  it('landing_url gana a page_url cuando trae valor; las UTM sueltas también', () => {
    const m = deducirMapeo({ ...ENVIO_ICTESS, landing_url: 'https://x.example.com/a', utm_source: 'ig', utm_medium: 'paid' });
    expect(m.landing_url).toBe('landing_url');
    expect(m.utm_source).toBe('utm_source');
    expect(m.utm_medium).toBe('utm_medium');
  });

  it('la asesora que manda Make (ICTESS US) y los campos anidados un nivel', () => {
    expect(deducirMapeo({ asesora_nombre: 'Gestora', asesora_email: 'g@example.com', email: 'a@example.com' }))
      .toMatchObject({ responsable_nombre: 'asesora_nombre', responsable_email: 'asesora_email' });
    expect(deducirMapeo({ data: { Correo: 'a@example.com', Nombre: 'Ana' } }))
      .toEqual({ email: 'data.Correo', nombre: 'data.Nombre' });
  });
});

describe('webhook de Make en activo sin mapeo', () => {
  it('ya no rechaza: crea el prospecto con los campos reconocidos', async () => {
    const r = await llamar(ENVIO_ICTESS);
    expect(r.lead_id).toBe(501);
    expect(r.sin_mapeo).toBe(true);
    expect(leadService.createFromExternalWebhook).toHaveBeenCalledTimes(1);
    const [projectId, datos] = leadService.createFromExternalWebhook.mock.calls[0];
    expect(projectId).toBe(4);
    expect(datos).toMatchObject({
      email: 'persona.prueba@example.com', nombre: 'Persona de Prueba', telefono: '+34600000000',
      producto_interes: 'Curso de prueba', notas: 'Quiero información',
    });
    expect(datos.landing_url).toContain('/cursos/curso-de-prueba/');
    expect(datos.utm_source).toBeUndefined();   // ni `source` ni la UTM vacía
    const entrega = model.logDelivery.mock.calls[0][0];
    expect(entrega.result).toBe('accepted');
    expect(entrega.error_message).toContain('Sin mapeo');
  });

  it('avisa a los admins de que falta el mapeo, con el enlace al webhook', async () => {
    await llamar(ENVIO_ICTESS);
    await esperar(); await esperar();
    expect(notif.notifyAdmins).toHaveBeenCalledTimes(1);
    const aviso = notif.notifyAdmins.mock.calls[0][0];
    expect(aviso.type).toBe('make_sin_mapeo');
    expect(aviso.link_path).toBe('/make-webhooks/10');
    expect(aviso.metadata.webhook_id).toBe('10');
  });

  it('como mucho un aviso al día por webhook', async () => {
    db.avisoReciente = true;
    await llamar(ENVIO_ICTESS);
    await esperar(); await esperar();
    expect(notif.notifyAdmins).not.toHaveBeenCalled();
    expect(leadService.createFromExternalWebhook).toHaveBeenCalledTimes(1);
  });

  it('la asesora por cabecera sigue mandando sobre lo del cuerpo', async () => {
    await llamar({ ...ENVIO_ICTESS, asesora_email: 'otra@example.com' }, { overrides: { responsable_email: 'gestora@example.com' } });
    expect(leadService.createFromExternalWebhook.mock.calls[0][1].responsable_email).toBe('gestora@example.com');
  });

  it('sin correo ni nombre reconocibles, rechaza como antes y avisa', async () => {
    await expect(llamar({ campo1: 'x', campo2: 'y' })).rejects.toMatchObject({ code: 'NO_MAPPING' });
    expect(leadService.createFromExternalWebhook).not.toHaveBeenCalled();
    expect(model.logDelivery.mock.calls[0][0].result).toBe('rejected');
    await esperar(); await esperar();
    expect(notif.notifyAdmins).toHaveBeenCalledTimes(1);
  });

  it('con mapeo guardado no cambia nada: usa el suyo y no avisa', async () => {
    model.findBySlug.mockImplementationOnce(async () => ({ ...HOOK, field_mapping: { email: 'correo_raro', nombre: 'quien' } }));
    const r = await llamar({ correo_raro: 'b@example.com', quien: 'Bea', email: 'no-este@example.com' });
    expect(r.sin_mapeo).toBeUndefined();
    expect(leadService.createFromExternalWebhook.mock.calls[0][1]).toMatchObject({ email: 'b@example.com', nombre: 'Bea' });
    expect(model.logDelivery.mock.calls[0][0].error_message).toBeNull();
    await esperar();
    expect(notif.notifyAdmins).not.toHaveBeenCalled();
  });

  it('en modo test sigue sin crear nada', async () => {
    model.findBySlug.mockImplementationOnce(async () => ({ ...HOOK, mode: 'test' }));
    const r = await llamar(ENVIO_ICTESS);
    expect(r.mode).toBe('test');
    expect(leadService.createFromExternalWebhook).not.toHaveBeenCalled();
  });
});
