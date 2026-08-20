import { describe, it, expect, vi, beforeEach } from 'vitest';

// Quien puede abrir el WhatsApp de otra persona.
//
// Es la regla mas delicada del modulo: al otro lado hay conversaciones privadas
// de clientes y el numero personal de alguien. Se prueba aqui y no a mano
// porque el dia que se anada un endpoint nuevo, esto avisa.

const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    // La comprobacion de «comparten proyecto» y de que existe.
    if (sql.includes('comparten')) {
      const objetivo = params[1];
      if (objetivo === 99) return { rows: [] };                                  // no existe
      if (objetivo === 98) return { rows: [{ id: 98, active: false }] };          // desactivada
      return { rows: [{ id: objetivo, nombre: 'Dayana', active: true, comparten: objetivo !== 77 }] };
    }
    return { rows: [] };
  }),
}));

vi.mock('../src/modules/whatsapp/chat.model.js', () => ({
  listar: vi.fn(async ({ instancia }) => [{ instancia }]),
  porId: vi.fn(), mensajes: vi.fn(), actividad: vi.fn(),
}));
vi.mock('../src/modules/whatsapp/chat.service.js', () => ({}));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({}));
vi.mock('../src/modules/whatsapp/media.firma.js', () => ({ firma: () => '' }));
vi.mock('../src/modules/whatsapp/evolution.client.js', () => ({
  instanciaDe: (id) => `crm-u${id}`,
  configurado: () => false,
  instancias: vi.fn(),
}));

const { chats, usuarios } = await import('../src/modules/whatsapp/chat.controller.js');

function pedir(user, query = {}) {
  const req = { user, query, body: {} };
  const res = { json: vi.fn((x) => x) };
  const next = vi.fn();
  return { req, res, next };
}

beforeEach(() => { consultas.length = 0; });

describe('de quien es la sesion que se abre', () => {
  it('sin pedir nada, cada uno ve la suya', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0].instancia).toBe('crm-u7');
  });

  it('una gestora NO puede abrir la de otra', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' }, { usuarioId: '6' });
    await chats(req, res, next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('SOLO_EL_TUYO');
    expect(res.json).not.toHaveBeenCalled();
  });

  it('pedir la suya por su propio identificador vale, y no consulta la base', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' }, { usuarioId: '7' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(consultas.length).toBe(0);
  });

  it('un superadmin abre la de cualquiera', async () => {
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' }, { usuarioId: '7' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0].instancia).toBe('crm-u7');
  });

  it('un admin abre la de quien comparte proyecto con el', async () => {
    const { req, res, next } = pedir({ userId: 9, role: 'admin' }, { usuarioId: '7' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0].instancia).toBe('crm-u7');
  });

  it('pero NO la de una gestora de otra marca', async () => {
    const { req, res, next } = pedir({ userId: 9, role: 'admin' }, { usuarioId: '77' });
    await chats(req, res, next);
    expect(next.mock.calls[0][0].code).toBe('FUERA_DE_TUS_PROYECTOS');
  });

  it('ni la de alguien que no existe o esta desactivado', async () => {
    for (const id of ['99', '98']) {
      const { req, res, next } = pedir({ userId: 1, role: 'superadmin' }, { usuarioId: id });
      await chats(req, res, next);
      expect(next.mock.calls[0][0].code).toBe('NO_EXISTE');
    }
  });

  it('un identificador con letras se ignora: se usa la propia', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' }, { usuarioId: 'no-soy-un-numero' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0].instancia).toBe('crm-u7');
  });
});

describe('a quien se puede elegir en el panel', () => {
  it('a una gestora solo se le ofrece ella misma', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' });
    await usuarios(req, res, next);
    expect(consultas[0].sql).toContain('WHERE id = $1');
  });

  it('a un superadmin, todo el equipo', async () => {
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' });
    await usuarios(req, res, next);
    expect(consultas[0].sql).toContain('gestor_colaboraciones');
    expect(consultas[0].sql).not.toContain('WHERE id = $1');
  });

  it('a un admin, solo los de sus proyectos', async () => {
    const { req, res, next } = pedir({ userId: 9, role: 'admin' });
    await usuarios(req, res, next);
    expect(consultas[0].sql).toContain('user_projects');
  });
});
