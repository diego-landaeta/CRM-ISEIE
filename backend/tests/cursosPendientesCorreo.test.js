import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * El correo de «Cursos pendientes» (#336), contra la base de verdad y con Brevo
 * simulado: se defiende que sale a quien toca, solo con el interruptor
 * encendido, que cada persona lo puede apagar y que un fallo del correo no
 * tumba la notificación.
 *
 *   npx vitest run tests/cursosPendientesCorreo.test.js
 */

const enviados = [];
let fallar = false;
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendEmail: vi.fn(async (m) => {
    if (fallar) throw new Error('Brevo caído');
    enviados.push(m);
    return { sent: true };
  }),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { notificar, armarCorreo, correosActivos } = await import('../src/modules/cursos-pendientes/cursos-pendientes.correos.js');

const MARCA = `CPC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = [];
let TUTORA; let APAGADA; let INACTIVA;

async function persona(n, { active = true } = {}) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', $3) RETURNING id, nombre, email`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, active]);
  ids.push(u.id);
  return u;
}
const aviso = (extra = {}) => ({
  clave: `${MARCA}-clave`, targetUserIds: [TUTORA.id, APAGADA.id, INACTIVA.id], type: 'curso_pendiente_retrasado',
  title: `Retrasado: ${MARCA} Curso`, message: 'Campus A. Tenía que estar el 2026-10-01.', link_path: '/productos/pendientes?curso=7', ...extra,
});

beforeAll(async () => {
  TUTORA = await persona('TUTORA'); APAGADA = await persona('APAGADA'); INACTIVA = await persona('INACTIVA', { active: false });
  await q(`INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, 'cursos_pendientes')`, [APAGADA.id]);
}, 60000);

beforeEach(() => { enviados.length = 0; fallar = false; delete process.env.CURSOS_PENDIENTES_CORREOS_ACTIVOS; });

afterAll(async () => {
  await q(`DELETE FROM admin_notifications WHERE title LIKE $1`, [`%${MARCA}%`]);
  await q(`DELETE FROM avisos_apagados WHERE user_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids]);
  await pool.end();
}, 60000);

describe('el correo de cursos pendientes', () => {
  it('apagado por defecto: la notificación sale y no se llama a Brevo', async () => {
    expect(correosActivos()).toBe(false);
    const fila = await notificar(aviso());
    expect(fila).toBeTruthy();
    expect(enviados).toHaveLength(0);
  });

  it('encendido: solo a quien está activo y no lo apagó, con su clave', async () => {
    process.env.CURSOS_PENDIENTES_CORREOS_ACTIVOS = 'true';
    await notificar(aviso());
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toEqual([{ email: TUTORA.email, name: TUTORA.nombre }]);
    expect(enviados[0].subject).toBe(`Retrasado: ${MARCA} Curso`);
    expect(enviados[0].clave).toBe(`${MARCA}-clave-${TUTORA.id}`);
    expect(enviados[0].htmlContent).toContain('productos/pendientes?curso=7');
  });

  it('un fallo de Brevo no tumba el aviso ni lanza', async () => {
    process.env.CURSOS_PENDIENTES_CORREOS_ACTIVOS = '1';
    fallar = true;
    const fila = await notificar(aviso({ title: `Otro: ${MARCA} Curso` }));
    expect(fila).toBeTruthy();
  });

  it('el correo escapa lo que viene de la base', () => {
    const c = armarCorreo({ persona: { nombre: 'Ana' }, titulo: `Retrasado: <b>${MARCA}</b>`, mensaje: 'A & B', link_path: '/productos/pendientes' });
    expect(c.htmlContent).not.toContain(`<b>${MARCA}</b>`);
    expect(c.htmlContent).toContain('&lt;b&gt;');
  });
});
