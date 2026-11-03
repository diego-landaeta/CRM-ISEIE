import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pool from '../src/shared/config/db.js';
import { sendTicketNuevoEmail } from '../src/shared/services/brevo.service.js';

/**
 * El correo de «ticket nuevo» escapa lo que escribe quien abre el ticket (#38).
 *
 * Titulo, descripcion, pasos y URL son texto libre y llegan a un buzon interno,
 * donde el equipo confia en lo que ve. Sin escapar, un titulo con HTML mete
 * enlaces o contenido ajeno dentro de ese correo.
 *
 * Fuera de produccion el freno de pruebas no manda nada pero SI anota el HTML en
 * `email_envios`: ahi se lee lo que habria salido, que es lo que se comprueba.
 */

const ASUNTO = '[test-escapado] ';

// En ISEIE `email_envios` no guarda el cuerpo del correo (en MultiCRM sí, desde la
// pantalla Correos). Aquí se mira lo que se le MANDARÍA a Brevo: con una clave de
// pega, el destino en la lista blanca del freno y `fetch` simulado, nada sale.
const ENV = ['SOPORTE_EMAIL', 'BREVO_API_KEY', 'EMAIL_LISTA_BLANCA'];
const antes = {};
const enviados = [];

beforeAll(async () => {
  for (const k of ENV) antes[k] = process.env[k];
  process.env.SOPORTE_EMAIL = 'soporte@test-escapado.com';
  process.env.BREVO_API_KEY = 'clave-de-pega-para-la-prueba';
  process.env.EMAIL_LISTA_BLANCA = 'soporte@test-escapado.com';
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    enviados.push(JSON.parse(init.body));
    return { ok: true, status: 201, json: async () => ({ messageId: 'prueba' }), text: async () => '' };
  }));
  await pool.query('DELETE FROM email_envios WHERE asunto LIKE $1', [`%${ASUNTO}%`]);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  for (const k of ENV) {
    if (antes[k] === undefined) delete process.env[k];
    else process.env[k] = antes[k];
  }
  await pool.query('DELETE FROM email_envios WHERE asunto LIKE $1', [`%${ASUNTO}%`]);
  await pool.end();
});

async function htmlDeLoQueSale(ticket, autor = { nombre: 'Laura' }) {
  enviados.length = 0;
  await sendTicketNuevoEmail({ ticket, autor });
  return enviados.at(-1)?.htmlContent || '';
}

const base = {
  id: 7, kind: 'bug', severity: 'high', title: `${ASUNTO}normal`, description: 'texto normal',
  steps: '', expected: '', actual: '', whyItMatters: '', url: '', projectName: null,
};

describe('el correo de ticket nuevo', () => {
  it('con un ticket normal lleva su titulo y su descripcion', async () => {
    const html = await htmlDeLoQueSale(base);
    expect(html).toContain('normal');
    expect(html).toContain('texto normal');
  });

  it('NO deja pasar HTML en el titulo', async () => {
    const html = await htmlDeLoQueSale({ ...base, title: `${ASUNTO}<img src=x onerror=alert(1)>` });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('ni en la descripcion, los pasos, lo esperado, lo observado o por que importa', async () => {
    const html = await htmlDeLoQueSale({
      ...base,
      description: '<a href="https://phishing.test">entra aqui</a>',
      steps: '<script>x()</script>',
      expected: '<b>negrita</b>',
      actual: '<iframe src="https://x.test"></iframe>',
      whyItMatters: '<u>subrayado</u>',
    });
    for (const crudo of ['<a href="https://phishing', '<script>', '<b>negrita', '<iframe', '<u>subrayado']) {
      expect(html, crudo).not.toContain(crudo);
    }
  });

  it('ni en la URL, el proyecto o el nombre de quien lo abre', async () => {
    const html = await htmlDeLoQueSale(
      { ...base, url: 'http://x.test/"><script>y()</script>', projectName: '<i>Proyecto</i>' },
      { nombre: '<b>Laura</b>' });
    expect(html).not.toContain('<script>y()');
    expect(html).not.toContain('<i>Proyecto</i>');
    expect(html).not.toContain('<b>Laura</b>');
  });

  it('los saltos de linea siguen saliendo como saltos', async () => {
    const html = await htmlDeLoQueSale({ ...base, steps: 'uno\ndos' });
    expect(html).toContain('uno<br>dos');
  });
});
