import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

/**
 * El bloque «link de pago» de las secuencias de correo (gemela de CRM#983, #658; Diego, 21/11/2026).
 *
 *   · `{{link_pago}}` en una plantilla o en el cuerpo de un paso es un botón
 *     «Pagar ahora» con el link del curso de interés del prospecto;
 *   · si el prospecto ya tiene un link vivo de ese curso se reutiliza; si no, se
 *     crea al precio del catálogo, a nombre de su responsable;
 *   · sin curso, sin precio o sin responsable, el correo NO sale y se apunta por qué;
 *   · la vista previa enseña un botón de muestra y no crea nada.
 *
 * Stripe y Brevo son de mentira.
 *
 *   npx vitest run tests/linksPagoSecuencia658.test.js
 */

process.env.LOG_LEVEL = 'silent';
const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
const avances = [];
vi.mock('../src/modules/email-sequences/sequence.model.js', () => ({
  advanceRun: vi.fn(async (id, nota) => { avances.push({ id, nota }); }),
  findDueRuns: vi.fn(async () => []),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const integrationsModel = await import('../src/modules/integrations/integrations.model.js');
const sec = await import('../src/modules/links-pago/links-pago.secuencia.js');
const { _internos } = await import('../src/jobs/emailSequenceScheduler.js');
const { TEMPLATE_VARIABLES, renderTemplate } = await import('../src/modules/email-templates/email-templates.service.js');

let preparadas = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = vi.fn(async (url, opciones = {}) => {
  const metodo = (opciones.method || 'GET').toUpperCase();
  const u = new URL(String(url));
  const r = preparadas.find(([m, ruta]) => m === metodo && u.pathname === ruta);
  if (!r) throw new Error(`Stripe de mentira: sin respuesta para ${metodo} ${u.pathname}`);
  return { ok: r[2] < 400, status: r[2], json: async () => (typeof r[3] === 'function' ? r[3]() : r[3]) };
});
let n = 0;
const stripeCreaBien = () => {
  preparadas = [
    ['POST', '/v1/prices', 200, () => ({ id: `price_983_${++n}` })],
    ['POST', '/v1/payment_links', 200, () => ({ id: `plink_983_${Date.now()}_${n}`, url: `https://buy.stripe.com/test_983_${n}` })],
  ];
};

const MARCA = `LP983${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], products: [] };
let A; let gestora; let curso; let gratis;

async function nuevoLead({ producto = curso, responsable = gestora?.id ?? null, email = true } = {}) {
  const l = await one('INSERT INTO leads (project_id, nombre, email, responsable_id, producto_interes_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [A, 'Laura Pruebas', email ? `laura${ids.leads.length}@${MARCA.toLowerCase()}.test` : null, responsable, producto]);
  ids.leads.push(l.id);
  return l.id;
}

beforeAll(async () => {
  A = (await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} a`, `${MARCA.toLowerCase()}-a`, `${MARCA}-k`])).id;
  ids.projects.push(A);
  gestora = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', \'gestor\') RETURNING id',
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`]);
  ids.users.push(gestora.id);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [gestora.id, A]);
  curso = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, 750, \'EUR\') RETURNING id', [A, `${MARCA} Psicopedagogía`])).id;
  gratis = (await one('INSERT INTO products (project_id, nombre, precio, moneda) VALUES ($1, $2, NULL, \'EUR\') RETURNING id', [A, `${MARCA} sin precio`])).id;
  ids.products.push(curso, gratis);
  const e = encrypt('rk_' + 'test_EscrituraDeMentira983');
  await integrationsModel.upsert({ projectId: A, provider: 'stripe_links', active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {} });
}, 60_000);

afterAll(async () => {
  for (const [sql, lista] of [
    ['DELETE FROM payment_links WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM products WHERE id = ANY($1)', ids.products],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1)', ids.projects],
    ['DELETE FROM leads WHERE id = ANY($1)', ids.leads],
    ['DELETE FROM user_projects WHERE user_id = ANY($1)', ids.users],
    ['DELETE FROM users WHERE id = ANY($1)', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1)', ids.projects],
  ]) {
    try { await q(sql, [lista]); } catch { /* sigue */ }
  }
  globalThis.fetch = fetchOriginal;
});

beforeEach(() => { correos.length = 0; avances.length = 0; preparadas = []; });

describe('el hueco y el bloque', () => {
  it('está en la lista de variables del editor', () => {
    expect(TEMPLATE_VARIABLES.map((v) => v.token)).toContain('{{link_pago}}');
  });

  it('el párrafo del hueco pasa a ser el botón y lo demás queda igual', () => {
    const html = renderTemplate(sec.conMarca('<p>Hola {{lead.nombre}}</p><p>{{ link_pago }}</p><p>Un saludo</p>'), { lead: { nombre: 'Laura' } });
    const fin = sec.ponerBloque(html, '<div>BOTON</div>');
    expect(fin).toBe('<p>Hola Laura</p><div>BOTON</div><p>Un saludo</p>');
    expect(sec.tieneHueco('<p>{{link_pago}}</p>')).toBe(true);
    expect(sec.tieneHueco('<p>{{lead.nombre}}</p>')).toBe(false);
  });
});

describe('el link del prospecto', () => {
  it('crea uno al precio del catálogo, a nombre del responsable; la segunda vez reutiliza el vivo', async () => {
    const lead = await nuevoLead();
    stripeCreaBien();
    const uno = await sec.linkDelProspecto(lead);
    expect(uno.nuevo).toBe(true);
    expect(Number(uno.link.importe)).toBe(750);
    expect(uno.link.created_by).toBe(gestora.id);
    expect(uno.link.lead_id).toBe(lead);
    preparadas = [];
    const dos = await sec.linkDelProspecto(lead);
    expect(dos.nuevo).toBe(false);
    expect(dos.link.id).toBe(uno.link.id);
  });

  it('sin curso de interés, sin precio o sin responsable: no hay link y dice por qué', async () => {
    await expect(sec.linkDelProspecto(await nuevoLead({ producto: null }))).rejects.toThrow(/no tiene curso de interés/);
    await expect(sec.linkDelProspecto(await nuevoLead({ producto: gratis }))).rejects.toThrow(/no tiene precio/);
    await expect(sec.linkDelProspecto(await nuevoLead({ responsable: null }))).rejects.toThrow(/no tiene responsable/);
  });
});

describe('el paso de la secuencia', () => {
  it('con el hueco, el correo sale con el botón y el link', async () => {
    const lead = await nuevoLead();
    stripeCreaBien();
    await _internos.processOne({
      id: 1, sequence_id: 1, project_id: A, lead_id: lead, current_step: 0, lead_email: 'laura@x.test',
      steps: [{ subject: 'Tu matrícula', body: '<p>Hola</p><p>{{link_pago}}</p>' }],
    });
    expect(correos).toHaveLength(1);
    expect(correos[0].htmlContent).toMatch(/https:\/\/buy\.stripe\.com\/test_983_\d+/);
    expect(correos[0].htmlContent).toContain('Pagar ahora');
    expect(correos[0].htmlContent).not.toContain('{{link_pago}}');
    expect(avances).toEqual([{ id: 1, nota: null }]);
  });

  it('sin link posible, el correo no sale y queda apuntado', async () => {
    const lead = await nuevoLead({ producto: null });
    await _internos.processOne({
      id: 2, sequence_id: 1, project_id: A, lead_id: lead, current_step: 0, lead_email: 'laura@x.test',
      steps: [{ subject: 'Tu matrícula', body: '<p>{{link_pago}}</p>' }],
    });
    expect(correos).toHaveLength(0);
    expect(avances[0].nota).toMatch(/^sin link de pago: el prospecto no tiene curso de interés/);
  });

  it('sin el hueco, nada cambia', async () => {
    await _internos.processOne({
      id: 3, sequence_id: 1, project_id: A, lead_id: await nuevoLead(), current_step: 0, lead_email: 'laura@x.test',
      steps: [{ subject: 'Hola', body: '<p>Sin link</p>' }],
    });
    expect(correos[0].htmlContent).toBe('<p>Sin link</p>');
  });
});
