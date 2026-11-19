import { describe, it, expect, vi, beforeEach } from 'vitest';

// El aviso «Nuevo prospecto» a la gestora trae lo que rellenó la persona.
//
// Yosbely (ICTESS, 19/11/2026): el correo solo decía nombre, correo, teléfono y
// campus. No decía por qué programa preguntaba ni qué había escrito («Precio»),
// y eso ya estaba en el CRM. Datos inventados.

let FILA = null;
let LEER_FALLA = false;

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (/FROM leads l/.test(sql)) {
      if (LEER_FALLA) throw new Error('base caída');
      return { rows: FILA ? [FILA] : [] };
    }
    if (/FROM users/.test(sql)) return { rows: [{ id: 11, nombre: 'Gestora Prueba', email: 'gestora@test.local' }] };
    if (/FROM projects/.test(sql)) return { rows: [{ id: 4, nombre: 'Campus Prueba', slug: 'campus' }] };
    return { rows: [], rowCount: 0 };
  }),
}));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: vi.fn(async () => ({ id: 1 })),
  notifyAdmins: vi.fn(async () => ({ id: 1 })),
}));
// El de verdad, salvo el envío: aquí no se manda ningún correo.
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendLeadAssignedEmail: vi.fn(async () => ({ sent: true })),
}));

const { avisarGestoraDelLeadNuevo } = await import('../src/modules/leads/aviso-gestora.js');
const { resumenParaElAviso } = await import('../src/modules/leads/aviso-formulario.js');
const { sendLeadAssignedEmail, componerAvisoDeProspecto } = await import('../src/shared/services/brevo.service.js');

const GESTORA = { id: 11, nombre: 'Gestora Prueba', email: 'gestora@test.local' };
const PROYECTO = { id: 4, nombre: 'Campus Prueba', slug: 'campus' };
const BASE = 'https://crm.example.com/crm';

const DEL_FORMULARIO = {
  id: 501,
  nombre: 'Ana Prueba',
  email: 'ana@example.com',
  telefono: '+34600000001',
  notas: 'Precio',
  custom_fields: {
    Date: 'noviembre 19, 2026',
    Time: '12:18 pm',
    form_id: 'abc1234',
    'Remote IP': '203.0.113.7',
    form_name: 'Solicitud',
    'Powered by': 'PRO Elements',
    'User Agent': 'Mozilla/5.0 (Android)',
    pais: 'España',
    '¿Qué nivel tengo?': 'Técnico',
    'Número de teléfono': '600000001',
    email: 'ana@example.com',
    _sin_nombre: false,
  },
  landing_url: 'https://campus.example.com/cursos/curso-de-prueba/?fbclid=XYZ&utm_source=fb&utm_medium=paid',
  whatsapp_usuario: null,
  programa: 'Curso de Prueba en Sensores',
  utm_source: 'webhook',
  utm_medium: 'api',
  canal_detectado: null,
  utm_landing_url: null,
  referrer: null,
};

async function avisoDe(fila, canal) {
  FILA = fila;
  await avisarGestoraDelLeadNuevo({
    lead: { id: fila?.id ?? 501, project_id: 4, nombre: fila?.nombre ?? 'Ana Prueba', email: 'ana@example.com', responsable_id: 11 },
    canal,
  });
  await vi.waitFor(() => expect(sendLeadAssignedEmail).toHaveBeenCalledTimes(1));
  const arg = sendLeadAssignedEmail.mock.calls[0][0];
  return { arg, correo: componerAvisoDeProspecto(arg) };
}

beforeEach(() => {
  vi.clearAllMocks();
  FILA = null;
  LEER_FALLA = false;
});

describe('el aviso de prospecto nuevo trae lo que rellenó en el formulario', () => {
  it('con programa, mensaje y campos: los lleva, sin claves técnicas ni duplicados', async () => {
    const { arg, correo } = await avisoDe(DEL_FORMULARIO, 'webhook');

    expect(arg.lead.programa).toBe('Curso de Prueba en Sensores');
    expect(arg.lead.mensaje).toBe('Precio');
    expect(arg.lead.pagina).toBe('https://campus.example.com/cursos/curso-de-prueba');
    expect(arg.lead.entrada).toBe('Formulario de la web «Solicitud» · anuncio de Meta (Facebook o Instagram)');
    expect(arg.lead.campos).toEqual([
      { etiqueta: 'Pais', valor: 'España' },
      { etiqueta: '¿Qué nivel tengo?', valor: 'Técnico' },
    ]);
    expect(arg.lead.soloTelefono).toBe(false);

    expect(correo.subject).toBe('Nuevo prospecto: Ana Prueba · Curso de Prueba en Sensores');
    const html = correo.htmlContent;
    expect(html).toContain('Programa que le interesa');
    expect(html).toContain('Curso de Prueba en Sensores');
    expect(html).toContain('Su mensaje');
    expect(html).toContain('Precio');
    expect(html).toContain('Desde la página');
    expect(html).toContain('https://campus.example.com/cursos/curso-de-prueba');
    expect(html).toContain('Por dónde entró');
    expect(html).toContain('Pais: <strong>España</strong>');
    expect(html).toContain('¿Qué nivel tengo?: <strong>Técnico</strong>');
    for (const tecnico of ['203.0.113.7', 'Mozilla', 'abc1234', 'PRO Elements', 'fbclid', '12:18 pm']) {
      expect(html).not.toContain(tecnico);
    }
    expect(correo.textContent).toContain('Precio');
    expect(correo.textContent).toContain('Curso de Prueba en Sensores');
  });

  it('sin notas, el campo de mensaje del formulario es «Su mensaje» y no se repite abajo', async () => {
    const { arg } = await avisoDe({
      ...DEL_FORMULARIO, notas: null, custom_fields: { form_name: 'Contacto', '¿Qué deseas saber?': 'Horarios y precio' },
    }, 'formulario');
    expect(arg.lead.mensaje).toBe('Horarios y precio');
    expect(arg.lead.campos).toEqual([]);
    expect(arg.lead.entrada).toMatch(/^Formulario de la web «Contacto»/);
  });

  it('escapa todo lo que llega del formulario', () => {
    const { htmlContent, subject } = componerAvisoDeProspecto({
      gestor: GESTORA,
      proyecto: PROYECTO,
      baseUrl: BASE,
      lead: {
        id: 9,
        nombre: 'Eva <b>Prueba</b>',
        email: 'eva@example.com',
        programa: 'Curso <i>X</i>',
        mensaje: '<script>alert(1)</script>\nsegunda línea',
        pagina: 'javascript:alert(1)',
        entrada: 'Formulario de la web',
        campos: [{ etiqueta: '<img src=x onerror=alert(1)>', valor: '"comillas" & <tag>' }],
      },
    });
    expect(htmlContent).not.toContain('<script>');
    expect(htmlContent).not.toContain('<img src=x');
    expect(htmlContent).not.toContain('<i>X</i>');
    expect(htmlContent).toContain('&lt;script&gt;alert(1)&lt;/script&gt;<br>segunda línea');
    expect(htmlContent).toContain('&quot;comillas&quot; &amp; &lt;tag&gt;');
    // Una dirección que no es http(s) no se enlaza.
    expect(htmlContent).not.toContain('javascript:alert');
    expect(subject).toBe('Nuevo prospecto: Eva <b>Prueba</b> · Curso <i>X</i>');
  });

  it('un lead sin nada más que nombre y correo no rompe ni pinta líneas vacías', async () => {
    const { arg, correo } = await avisoDe(null, 'formulario');
    expect(arg.lead.nombre).toBe('Ana Prueba');
    expect(correo.subject).toBe('Nuevo prospecto: Ana Prueba');
    const html = correo.htmlContent;
    expect(html).toContain('Ana Prueba');
    for (const linea of ['Programa que le interesa', 'Su mensaje', 'Desde la página', 'Lo demás que rellenó', 'solo tenemos su teléfono']) {
      expect(html).not.toContain(linea);
    }
    // Y la función pura, con una fila vacía o sin fila.
    expect(() => resumenParaElAviso()).not.toThrow();
    expect(() => resumenParaElAviso(null)).not.toThrow();
    expect(() => componerAvisoDeProspecto({ gestor: GESTORA, lead: { id: 1 }, proyecto: null, baseUrl: BASE })).not.toThrow();
  });

  it('solo con teléfono (Make desde WhatsApp, «S/N»): lo dice claro', async () => {
    const { arg, correo } = await avisoDe({
      id: 502, nombre: 'S/N', email: null, telefono: '+34600000002', notas: null, custom_fields: {},
      landing_url: null, whatsapp_usuario: null, programa: null, utm_source: null, utm_medium: null,
      canal_detectado: 'whatsapp', utm_landing_url: null, referrer: null,
    }, 'whatsapp');
    expect(arg.lead.soloTelefono).toBe(true);
    expect(arg.lead.entrada).toBe('WhatsApp');
    expect(correo.subject).toBe('Nuevo prospecto: Sin nombre (+34600000002)');
    expect(correo.htmlContent).toContain('Contacto de WhatsApp: solo tenemos su teléfono.');
  });

  it('si no se puede leer el lead, el correo sale igual con lo básico', async () => {
    LEER_FALLA = true;
    const { arg, correo } = await avisoDe(DEL_FORMULARIO, 'formulario');
    expect(arg.lead.id).toBe(501);
    expect(arg.lead.nombre).toBe('Ana Prueba');
    expect(correo.htmlContent).toContain('Ana Prueba');
  });
});
