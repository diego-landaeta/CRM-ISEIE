import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Ficha del tutor (#850): «Responder en su nombre — ICTESS: falta su token» salía aunque
 * ICTESS va por el plugin y la respuesta desde el CRM ya sale en su nombre sin su token.
 * `GET /api/consultas/tutores/:id/tokens` dice ahora, por campus, si responde por el plugin
 * (`por_plugin`), con la misma regla que el envío: el plugin activo en ese campus y el
 * interruptor PLUGIN_MOODLE_EN_PRODUCCION. Apagado, como antes: hace falta su token.
 *
 * Sin base: `query` es de mentira; ICTESS (7) tiene el plugin activo y ISEIE Madrid (1), no.
 */

const query = vi.fn(async (sql, params = []) => {
  const s = String(sql);
  if (/FROM moodle_plugin_campus WHERE project_id = \$1 AND activo/.test(s)) {
    return { rows: params[0] === 7 ? [{ '?column?': 1 }] : [] };
  }
  if (/token_cifrado IS NOT NULL/.test(s)) return { rows: [{ project_id: 7, tiene: false }, { project_id: 1, tiene: true }] };
  throw new Error(`SQL sin preparar en el test: ${s.slice(0, 80)}`);
});
vi.mock('../src/shared/config/db.js', () => ({
  query: (...a) => query(...a),
  getClient: vi.fn(async () => ({ query: (...a) => query(...a), release: () => {} })),
}));
vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  campusDelTutor: vi.fn(async () => [
    { project_id: 7, campus: 'ICTESS', estado: 'activa' },
    { project_id: 1, campus: 'ISEIE Madrid', estado: 'activa' },
  ]),
}));

const { tokensDelTutor } = await import('../src/modules/consultas/consultas.controller.js');

async function pedir() {
  const res = { json: vi.fn() };
  const next = vi.fn();
  await tokensDelTutor({ params: { tutorId: '173' }, user: { userId: 1, role: 'superadmin' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res.json.mock.calls[0][0].data;
}

const envAntes = { ...process.env };
afterEach(() => { process.env = { ...envAntes }; });

describe('Tokens del tutor: campus por el plugin (#850)', () => {
  it('con el plugin activo en el campus, por_plugin: no le hace falta su token', async () => {
    const data = await pedir();
    expect(data.find((t) => t.project_id === 7)).toMatchObject({ campus: 'ICTESS', tiene_token: false, por_plugin: true });
    expect(data.find((t) => t.project_id === 1)).toMatchObject({ tiene_token: true, por_plugin: false });
  });

  it('con el interruptor apagado en producción, la respuesta va con su token: por_plugin false', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.PLUGIN_MOODLE_EN_PRODUCCION;
    process.env.CRM_BASE_URL = 'https://crm.ejemplo/crm';
    const data = await pedir();
    expect(data.every((t) => t.por_plugin === false)).toBe(true);
  });
});
