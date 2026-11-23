import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';

/**
 * Cambiar la contraseña PROPIA (POST /auth/change-password, «Mi perfil») deja
 * su apunte en `user_activity_log`, como cuando la cambia otra persona
 * (`usuario.cambiar_contrasena`): acción `password_changed`, sin la contraseña
 * (ni la vieja ni la nueva, ni su hash). Errores de producción del 23/11.
 *
 * Contra la base de verdad, llamando al controlador tal cual.
 */

const { default: pool } = await import('../src/shared/config/db.js');
const authController = await import('../src/modules/auth/auth.controller.js');

const MARCA = `CCP${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ACTUAL = 'Clave-de-prueba-1';
const NUEVA = 'Otra-clave-de-prueba-2';
let YO;

const llamar = async (req) => {
  let error = null; let cuerpo = null;
  await authController.changePassword(
    { ip: '1.1.1.1', headers: {}, socket: {}, params: {}, ...req },
    { json: (b) => { cuerpo = b; }, status() { return this; } },
    (e) => { error = e; },
  );
  return { error, cuerpo };
};
const apuntes = () => q(
  `SELECT action, details, details::text AS texto FROM user_activity_log WHERE user_id = $1 ORDER BY id`, [YO]);

beforeAll(async () => {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, $3, 'gestor') RETURNING id`,
    [`${MARCA} Ana`, `ana@${MARCA}.test`, await bcrypt.hash(ACTUAL, 4)]);
  YO = u.id;
}, 60000);

afterAll(async () => {
  await q('DELETE FROM user_activity_log WHERE user_id = $1', [YO]);
  await q('DELETE FROM users WHERE id = $1', [YO]);
  await pool.end();
});

describe('cambiar la contraseña propia queda en el registro', () => {
  it('con la actual mal, no cambia nada ni apunta nada', async () => {
    const r = await llamar({ user: { userId: YO }, body: { currentPassword: 'No-es-esta-9', newPassword: NUEVA, confirmPassword: NUEVA } });
    expect(r.error?.code).toBe('INVALID_CURRENT_PASSWORD');
    expect(await apuntes()).toEqual([]);
  });

  it('con la actual bien: la cambia y apunta «password_changed», sin la contraseña', async () => {
    const r = await llamar({ user: { userId: YO }, body: { currentPassword: ACTUAL, newPassword: NUEVA, confirmPassword: NUEVA } });
    expect(r.error).toBeNull();
    expect(r.cuerpo?.success).toBe(true);

    const [{ password_hash: hash }] = await q('SELECT password_hash FROM users WHERE id = $1', [YO]);
    expect(await bcrypt.compare(NUEVA, hash)).toBe(true);

    const filas = await apuntes();
    expect(filas.map((f) => f.action)).toEqual(['password_changed']);
    expect(filas[0].details).toEqual({ propia: true });
    for (const secreto of [ACTUAL, NUEVA, hash]) expect(filas[0].texto).not.toContain(secreto);
  });
});
