import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
let anterior;

beforeAll(async () => {
  anterior = process.env.SOPORTE_EMAIL;
  process.env.SOPORTE_EMAIL = 'soporte@test-escapado.com';
  await pool.query('DELETE FROM email_envios WHERE asunto LIKE $1', [`%${ASUNTO}%`]);
});

afterAll(async () => {
  if (anterior === undefined) delete process.env.SOPORTE_EMAIL;
  else process.env.SOPORTE_EMAIL = anterior;
  await pool.query('DELETE FROM email_envios WHERE asunto LIKE $1', [`%${ASUNTO}%`]);
  await pool.end();
});

async function htmlDeLoQueSale(ticket, autor = { nombre: 'Laura' }) {
  await sendTicketNuevoEmail({ ticket, autor });
  const { rows } = await pool.query(
    `SELECT cuerpo_html FROM email_envios WHERE asunto LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`%${ASUNTO}%`]);
  return rows[0]?.cuerpo_html || '';
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
