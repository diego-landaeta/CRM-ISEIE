import { describe, it, expect, vi, beforeEach } from 'vitest';

// 12/10: un correo que sale por la cuenta de Brevo de un campus lleva el nombre del
// campus en el remitente («Fono Aprende <no-responder@fonoaprende.com>»), no el del CRM.

const peticiones = [];
vi.mock('../src/shared/services/email-log.service.js', () => ({ yaSeEnvio: vi.fn(async () => false), registrar: vi.fn(async () => {}) }));
vi.mock('../src/modules/credentials/credentials.model.js', () => ({ getDecryptedValue: vi.fn(async (s, pid) => (pid === 3 ? 'clave-de-fono' : null)) }));
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, p) => (/remitente_no_contestar/.test(sql) && p[0] === 3
    ? { rows: [{ r: 'no-responder@fonoaprende.com', nombre: 'Fono Aprende' }] } : { rows: [] })),
}));
process.env.NODE_ENV = 'production';
process.env.BREVO_API_KEY = 'clave-del-crm-falsa';

beforeEach(() => {
  peticiones.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url, o) => { peticiones.push(JSON.parse(o.body)); return { ok: true, status: 201, json: async () => ({ messageId: 'm1' }), text: async () => '' }; }));
});

const { sendEmail } = await import('../src/shared/services/brevo.service.js');
const base = { to: 'alguien@ejemplo.com', subject: 'Hola', htmlContent: '<p>x</p>' };

describe('el remitente de la marca', () => {
  it('por la cuenta del campus: su «no responder» y su nombre', async () => {
    await sendEmail({ ...base, projectId: 3, clave: 'm-1' });
    expect(peticiones[0].sender).toEqual({ email: 'no-responder@fonoaprende.com', name: 'Fono Aprende' });
  });
  it('si quien llama pone un nombre, manda ese', async () => {
    await sendEmail({ ...base, projectId: 3, fromName: 'Tareas de Fono', clave: 'm-2' });
    expect(peticiones[0].sender.name).toBe('Tareas de Fono');
  });
  it('un campus sin cuenta propia sale por la del CRM, como siempre', async () => {
    await sendEmail({ ...base, projectId: 1, clave: 'm-3' });
    expect(peticiones[0].sender.email).not.toBe('no-responder@fonoaprende.com');
  });
});
