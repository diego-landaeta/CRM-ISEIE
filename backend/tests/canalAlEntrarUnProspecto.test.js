import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';

/**
 * El origen de un prospecto, de punta a punta (#48): lo que manda la web o Make
 * por el webhook, el canal que deduce el CRM y lo que queda guardado.
 *
 * La regla en sí (cada fila de la tabla) está en canalDeOrigen.test.js; aquí se
 * comprueba que el alta la usa, que guarda el referrer y que un canal puesto a
 * mano sigue ganando.
 */

const request = supertest(app);
// Un campus propio de la prueba: la base de ISEIE (y la de la CI) no trae el
// «psiko-aprende» de los datos de ejemplo de MultiCRM.
const PROJECT_SLUG = `origen-${Date.now().toString(36)}`;
let projectId;
const DOMINIO = 'test-origen.com';
let apiKey;
let n = 0;

beforeAll(async () => {
  const { rows } = await pool.query(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $1, $2) RETURNING id, webhook_api_key',
    [PROJECT_SLUG, `${PROJECT_SLUG}-key`]);
  projectId = rows[0].id;
  apiKey = rows[0].webhook_api_key;
});

afterAll(async () => {
  const ids = `(SELECT id FROM leads WHERE email LIKE '%@${DOMINIO}')`;
  for (const t of ['lead_utms', 'lead_interactions', 'lead_reminders', 'lead_status_history']) {
    await pool.query(`DELETE FROM ${t} WHERE lead_id IN ${ids}`);
  }
  await pool.query(`DELETE FROM leads WHERE email LIKE '%@${DOMINIO}'`);
  // Lo que haya colgado del campus (registros de reparto…) no debe tumbar la limpieza.
  await pool.query('DELETE FROM projects WHERE id = $1', [projectId]).catch(() => {});
  await pool.end();
});

/** Da de alta un prospecto con lo que se pase y devuelve la respuesta y lo guardado. */
async function entra(extra) {
  n += 1;
  const res = await request.post(`/api/leads/webhooks/${PROJECT_SLUG}`).set('X-API-Key', apiKey).send({
    nombre: `Origen ${n}`, email: `origen${n}-${Date.now()}@${DOMINIO}`, telefono: `+3460000${String(1000 + n)}`, ...extra,
  });
  const guardado = res.status === 201
    ? (await pool.query(`SELECT canal_detectado, referrer, utm_source, landing_url FROM lead_utms WHERE lead_id = $1`, [res.body.data.lead_id])).rows[0]
    : null;
  return { res, guardado };
}

describe('ChatGPT, por las dos pistas', () => {
  it('solo con referrer', async () => {
    const { res, guardado } = await entra({ referrer: 'https://chatgpt.com/', landing_url: 'https://psikoaprende.com/curso/' });
    expect(res.status).toBe(201);
    expect(res.body.data.canal).toBe('chatgpt_ia');
    expect(guardado).toMatchObject({ canal_detectado: 'chatgpt_ia', referrer: 'https://chatgpt.com/' });
  });

  it('solo con utm_source=chatgpt.com, sin referrer', async () => {
    const { res, guardado } = await entra({ utm_source: 'chatgpt.com', landing_url: 'https://psikoaprende.com/curso/?utm_source=chatgpt.com' });
    expect(res.body.data.canal).toBe('chatgpt_ia');
    expect(guardado).toMatchObject({ canal_detectado: 'chatgpt_ia', utm_source: 'chatgpt.com', referrer: null });
  });

  it('con la utm dentro de la dirección que manda Make, sin campo suelto', async () => {
    const { res } = await entra({ landing_url: 'https://psikoaprende.com/curso/?utm_source=chatgpt.com' });
    expect(res.body.data.canal).toBe('chatgpt_ia');
  });
});

describe('el resto de la tabla, por el alta', () => {
  it('fbclid en la dirección, sin utm → meta_ads', async () => {
    expect((await entra({ landing_url: 'https://psikoaprende.com/curso/?fbclid=IwAR0' })).res.body.data.canal).toBe('meta_ads');
  });

  it('gclid → google_ads', async () => {
    expect((await entra({ landing_url: 'https://psikoaprende.com/curso/?gclid=EAIa' })).res.body.data.canal).toBe('google_ads');
  });

  it('un buscador como referrer → organico', async () => {
    expect((await entra({ referrer: 'https://www.google.com/', landing_url: 'https://psikoaprende.com/curso/' })).res.body.data.canal).toBe('organico');
  });

  it('otra web como referrer → referido', async () => {
    expect((await entra({ referrer: 'https://un-blog.example/post', landing_url: 'https://psikoaprende.com/curso/' })).res.body.data.canal).toBe('referido');
  });

  it('sin ninguna pista → directo (y se guarda, como siempre)', async () => {
    const { res, guardado } = await entra({});
    expect(res.body.data.canal).toBe('directo');
    expect(guardado.canal_detectado).toBe('directo');
  });

  it('un canal puesto a mano sigue ganando a lo deducido', async () => {
    const { res } = await entra({ canal: 'whatsapp', referrer: 'https://chatgpt.com/' });
    expect(res.body.data.canal).toBe('whatsapp');
  });
});

describe('el referrer', () => {
  it('se acepta hasta 2.000 caracteres y no más', async () => {
    expect((await entra({ referrer: `https://x.example/${'a'.repeat(1900)}` })).res.status).toBe(201);
    const demasiado = await entra({ referrer: `https://x.example/${'a'.repeat(2100)}` });
    expect(demasiado.res.status).toBe(400);
  });
});
