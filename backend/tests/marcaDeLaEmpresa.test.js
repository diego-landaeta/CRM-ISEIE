import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 11/11: «el correo de CEDIA y eso salen y que Fono Aprende, eso no es
// correcto». La bienvenida a quien trabaja para los ocho campus de CEDIA llegaba
// «al CRM de Fono Aprende», con su logo y desde no-responder@fonoaprende.com: se
// cogía el primer campus de la persona con remitente, y en CEDIA es Fono Aprende.
// Un correo de una EMPRESA lleva la marca de la empresa: su nombre corto y su
// logo si lo tiene; nunca el de un campus. El de UN campus sigue con su campus.
// Caso real del 11/11 a las 17:44: dos altas de «Tutor redactor» con los ocho
// campus de CEDIA recibieron «Bienvenida al CRM de Fono Aprende».

const EMPRESAS = {
  8: { id: 8, razon_social: 'CEDIA Investigación y Desarrollo SL', alias: null, logo_url: null, con_logo_subido: false },
  9: { id: 9, razon_social: 'Ictess Ingeniería e Innovación SL', alias: null, logo_url: 'https://ictess.example/logo.png', con_logo_subido: false },
  6: { id: 6, razon_social: 'ISEIE Innovation School SL', alias: null, logo_url: 'https://iseie.example/sello.png', con_logo_subido: false },
  11: { id: 11, razon_social: 'Ictess Ingeniería e Innovación SL', alias: 'Solvenic', logo_url: null, con_logo_subido: true },
};
const CAMPUS = [
  { id: 1, nombre: 'ISEIH', slug: 'iseih', logo_url: 'https://iseih.example/logo.png', emoji: null, sociedad_id: 8 },
  { id: 3, nombre: 'Fono Aprende', slug: 'fono-aprende', logo_url: 'https://fonoaprende.example/LOGOTIPO.webp', emoji: null, sociedad_id: 8 },
  { id: 4, nombre: 'ICTESS', slug: 'ictess', logo_url: null, emoji: null, sociedad_id: 9 },
  { id: 13, nombre: 'ICTESS US', slug: 'ictess-us', logo_url: null, emoji: null, sociedad_id: 9 },
  { id: 10, nombre: 'ISEIE', slug: 'iseie', logo_url: 'https://iseie.example/logo.png', emoji: null, sociedad_id: 6 },
];
const DE_LA_PERSONA = {
  'cedia@ejemplo.com': [1, 3],
  'fono@ejemplo.com': [3],
  'mezcla@ejemplo.com': [1, 3, 4],
};
const EQUIPOS = { 5: 8, 6: 9 };

vi.mock('../src/shared/services/email-log.service.js', () => ({ yaSeEnvio: vi.fn(async () => false), registrar: vi.fn(async () => {}) }));
vi.mock('../src/modules/credentials/credentials.model.js', () => ({ getDecryptedValue: vi.fn(async (s, pid) => (pid === 3 ? 'clave-de-fono' : null)) }));
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, p = []) => {
    if (/FROM invoice_issuers i WHERE i\.id = \$1/.test(sql)) return { rows: EMPRESAS[p[0]] ? [EMPRESAS[p[0]]] : [] };
    if (/p\.sociedad_emisora_id = \$1/.test(sql)) return { rows: CAMPUS.filter((c) => c.sociedad_id === p[0]) };
    if (/p\.id = ANY\(\$1::int\[\]\)/.test(sql)) return { rows: CAMPUS.filter((c) => p[0].includes(c.id)) };
    if (/JOIN user_projects up/.test(sql)) {
      const ids = typeof p[0] === 'string' ? (DE_LA_PERSONA[p[0]] || []) : [];
      return { rows: ids.map((id) => ({ project_id: id })) };
    }
    if (/remitente_no_contestar/.test(sql) && p[0] === 3) return { rows: [{ r: 'no-responder@fonoaprende.com', nombre: 'Fono Aprende' }] };
    if (/FROM projects WHERE id = \$1/.test(sql)) return { rows: CAMPUS.filter((c) => c.id === p[0]) };
    if (/FROM task_teams WHERE id = \$1/.test(sql)) return { rows: EQUIPOS[p[0]] ? [{ issuer_id: EQUIPOS[p[0]] }] : [] };
    return { rows: [] };
  }),
}));
process.env.NODE_ENV = 'production';
process.env.BREVO_API_KEY = 'clave-del-crm-falsa';
process.env.TAREAS_CORREOS_ACTIVOS = 'true';
process.env.CRM_BASE_URL = 'https://crm.example/crm';

const peticiones = [];
beforeEach(() => {
  peticiones.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, o) => { peticiones.push(JSON.parse(o.body)); return { ok: true, status: 201, json: async () => ({ messageId: 'm1' }), text: async () => '' }; }));
});

const M = await import('../src/shared/services/marca.service.js');
const { sendWelcomeUserEmail } = await import('../src/shared/services/brevo.service.js');
const T = await import('../src/modules/tasks/tasks.emails.js');
const C = await import('../src/jobs/correosDelEquipo.js');

describe('la marca de una empresa', () => {
  it('varios campus de CEDIA: «CEDIA», sin logo (no tiene) y sin campus', async () => {
    expect(await M.marcaDeLosCampus([1, 3])).toEqual({ id: null, nombre: 'CEDIA', logo_url: null, empresa_id: 8, de_empresa: true });
  });
  it('ICTESS, con el suyo', async () => {
    expect(await M.marcaDeLosCampus([4, 13])).toMatchObject({ id: null, nombre: 'Ictess', logo_url: 'https://ictess.example/logo.png' });
  });
  it('el alias es el nombre corto, y el logo subido se sirve desde el CRM', async () => {
    expect(await M.marcaDeLaEmpresa(11)).toMatchObject({ nombre: 'Solvenic', logo_url: expect.stringMatching(/\/api\/invoices\/issuers\/11\/logo$/) });
  });
  it('una empresa de un solo campus es ese campus (ISEIE: su logo, nunca el sello)', async () => {
    const m = await M.marcaDeLaEmpresa(6);
    expect(m).toMatchObject({ id: 10, nombre: 'ISEIE', logo_url: 'https://iseie.example/logo.png' });
    expect(JSON.stringify(m)).not.toContain('sello');
  });
  it('un campus suelto, el suyo; empresas mezcladas, la del CRM', async () => {
    expect(await M.marcaDeLosCampus([3])).toMatchObject({ id: 3, nombre: 'Fono Aprende' });
    expect(await M.marcaDeLosCampus([1, 3, 4])).toBeNull();
    expect(await M.marcaDeLosCampus([])).toBeNull();
  });
});

describe('la bienvenida', () => {
  it('a quien trabaja para CEDIA: «CEDIA», por la cuenta del CRM, sin nada de Fono Aprende', async () => {
    await sendWelcomeUserEmail({ nombre: 'Ana', email: 'cedia@ejemplo.com', setPasswordToken: 't', baseUrl: 'https://crm.example/crm' });
    const c = peticiones[0];
    expect(c.subject).toBe('Bienvenida al CRM de CEDIA: crea tu contraseña');
    expect(c.sender.name).toBe('CEDIA');
    expect(c.sender.email).not.toContain('fonoaprende');
    expect(c.htmlContent).not.toMatch(/Fono Aprende|fonoaprende/);
    expect(c.htmlContent).toContain('CEDIA');
  });
  it('a quien solo tiene Fono Aprende, sigue siendo Fono Aprende', async () => {
    await sendWelcomeUserEmail({ nombre: 'Bea', email: 'fono@ejemplo.com', setPasswordToken: 't', baseUrl: 'https://crm.example/crm' });
    expect(peticiones[0].subject).toBe('Bienvenida al CRM de Fono Aprende: crea tu contraseña');
    expect(peticiones[0].sender).toEqual({ email: 'no-responder@fonoaprende.com', name: 'Fono Aprende' });
  });
  it('con campus de dos empresas, la del CRM', async () => {
    await sendWelcomeUserEmail({ nombre: 'Cris', email: 'mezcla@ejemplo.com', setPasswordToken: 't', baseUrl: 'https://crm.example/crm' });
    expect(peticiones[0].subject).toBe('Bienvenida al CRM: crea tu contraseña');
    expect(peticiones[0].htmlContent).not.toMatch(/Fono Aprende|fonoaprende/);
  });
});

describe('los avisos de una tarea', () => {
  const persona = { id: 3, nombre: 'Diego', email: 'diego@ejemplo.com' };
  const quien = { nombre: 'Manuel' };
  it('sin campus, de un equipo de CEDIA: la marca de CEDIA', async () => {
    await T.enviarCorreoAsignada({ persona, quien, tarea: { id: 70, title: 'Vídeo en la portada (ISEIH, Psiko y Fono)', priority: 'media', project_id: null, team_id: 5 } });
    expect(peticiones[0].sender.name).toBe('CEDIA');
    expect(peticiones[0].htmlContent).toContain('CRM de CEDIA');
    expect(peticiones[0].htmlContent).not.toMatch(/fonoaprende/);
  });
  it('de un campus, la del campus (como siempre)', async () => {
    await T.enviarCorreoAsignada({ persona, quien, tarea: { id: 71, title: 'Precios', priority: 'media', project_id: 3, team_id: 5 } });
    expect(peticiones[0].sender).toEqual({ email: 'no-responder@fonoaprende.com', name: 'Fono Aprende' });
  });
});

describe('los resúmenes al equipo', () => {
  it('la cabecera sin imagen lleva el nombre y el logo de la empresa', () => {
    const h = C.envoltorio({ marca: { nombre: 'Ictess', logo_url: 'https://ictess.example/logo.png' }, preTitulo: 'X', titulo: 'Y', contenido: 'Z' });
    expect(h).toContain('https://ictess.example/logo.png');
    expect(h).toContain('>Ictess</span>');
    expect(h).not.toMatch(/>MultiCRM</);
  });
});
