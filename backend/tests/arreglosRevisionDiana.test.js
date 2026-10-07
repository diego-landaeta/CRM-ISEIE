import { describe, it, expect, vi, beforeEach } from 'vitest';
// Paso en MultiCRM (revisión del 07/10, #262); va igual en ISEIE por paridad.

// Los arreglos de la revisión de las PR #250 y #85 que van antes de la 2.1.0 (#262):
//   1. al cambiar el correo, el enlace de «poner contraseña» pendiente se anula;
//   2. el freno de tutores vale aunque el paso a tutor se haga en el mismo guardado;
//   3. la búsqueda del catálogo en Claude escapa bien «%», «_» y la barra.

const consultas = [];
let usuario;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: [] }; }),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/users/user.model.js', () => ({
  findById: vi.fn(async () => usuario),
  findByEmail: vi.fn(async () => null),
}));
vi.mock('../src/modules/auth/auth.model.js', () => ({
  revokeAllUserTokens: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
}));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/config/frenoTutores.js', () => ({ NO_ESCRIBIR_A_TUTORES: true }));

const { cambiarCorreo } = await import('../src/modules/users/user.service.js');
const brevo = await import('../src/shared/services/brevo.service.js');
const { comoTexto } = await import('../src/modules/mcp/mcp.model.js');

beforeEach(() => {
  consultas.length = 0;
  usuario = { id: 40, nombre: 'Laura', email: 'vieja@ejemplo.com', role: 'gestor' };
  vi.clearAllMocks();
});

describe('1 · el enlace pendiente no sobrevive al cambio de correo', () => {
  it('sin «Reenviar enlace», la UPDATE anula set_password_token y set_password_expires', async () => {
    await cambiarCorreo(40, 'nueva@ejemplo.com', { porUserId: 1 });
    const upd = consultas.find((q) => /UPDATE users SET email/.test(q.sql));
    expect(upd.sql).toMatch(/set_password_token = NULL/);
    expect(upd.sql).toMatch(/set_password_expires = NULL/);
  });
});

describe('2 · el freno de tutores mira también el rol con el que se guarda', () => {
  it('gestora que pasa a tutor en el mismo guardado: ningún correo', async () => {
    await cambiarCorreo(40, 'nueva@ejemplo.com', { reenviarEnlace: true, porUserId: 1, rolFinal: 'tutor' });
    expect(brevo.sendCorreoCambiadoEmail).not.toHaveBeenCalled();
    expect(brevo.sendWelcomeUserEmail).not.toHaveBeenCalled();
  });

  it('una gestora que sigue siendo gestora sí recibe los dos', async () => {
    await cambiarCorreo(40, 'nueva@ejemplo.com', { reenviarEnlace: true, porUserId: 1, rolFinal: 'gestor' });
    expect(brevo.sendCorreoCambiadoEmail).toHaveBeenCalledTimes(1);
    expect(brevo.sendWelcomeUserEmail).toHaveBeenCalledTimes(1);
  });
});

describe('3 · la búsqueda del catálogo escapa los comodines de LIKE', () => {
  it('«100% online_x\\» se busca tal cual', () => {
    expect(comoTexto('100% online_x\\')).toBe('100\\% online\\_x\\\\');
  });
  it('y no deja el texto literal «${c}» de antes', () => {
    expect(comoTexto('50%')).not.toContain('${c}');
  });
});
