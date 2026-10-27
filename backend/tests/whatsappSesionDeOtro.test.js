import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

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
      // `role` hace falta desde que se comprueba quien puede tener WhatsApp
      // (tarea #68): sin el, el guardia lo toma por un rol desconocido y lo
      // rechaza. El 76 es un tutor, para probar justo eso.
      return { rows: [{
        id: objetivo,
        nombre: 'Dayana',
        active: true,
        role: objetivo === 76 ? 'tutor' : 'gestor',
        gestor_colaboraciones: false,
        comparten: objetivo !== 77,
      }] };
    }
    // La casilla «usa el WhatsApp del CRM» (#128). El 95 la tiene apagada.
    if (sql.includes('usa_whatsapp')) {
      return { rows: [{ usa: params[0] !== 95 }] };
    }
    return { rows: [] };
  }),
}));

vi.mock('../src/modules/whatsapp/chat.model.js', () => ({
  listar: vi.fn(async ({ instancia }) => [{ instancia }]),
  // Las etiquetas de WhatsApp de esas conversaciones (#128). La lista las pide
  // en una sola consulta para las 50 filas; aqui no se prueban, pero sin ella
  // el controlador se cae antes de llegar a lo que SI se prueba.
  etiquetasDeConversaciones: vi.fn(async () => new Map()),
  porId: vi.fn(), mensajes: vi.fn(), actividad: vi.fn(),
  // Queda escrito quien entra a mirar la sesion de otra persona. Lo que se
  // prueba aqui es QUIEN puede entrar; que se apunte tiene su propio fichero.
  apuntarMirada: vi.fn(async () => true),
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
// Los permisos se recuerdan medio minuto (también «Usar su WhatsApp», #423).
const { olvidarPermisos: olvidarTodo } = await import('../src/modules/permissions/permissions.service.js');
const modelo = await import('../src/modules/whatsapp/chat.model.js');

function pedir(user, query = {}) {
  const req = { user: registrar(user), query, body: {} };
  const res = { json: vi.fn((x) => x) };
  const next = vi.fn();
  return { req, res, next };
}

// La casilla se recuerda medio minuto entre peticiones, asi que entre prueba y
// prueba hay que olvidarla: si no, la segunda leeria la respuesta de la primera.
beforeEach(() => { consultas.length = 0; olvidarTodo(); });

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

  it('pedir la suya por su propio identificador vale, y la base no se toca', async () => {
    // Antes esto exigia CERO consultas, y era la propiedad correcta: el rol
    // viaja en el testigo de sesion y con eso bastaba.
    //
    // Desde el #128 hace falta un dato mas —si tiene encendida la casilla— y ese
    // no puede ir en el testigo, que dura ocho horas: apagar a alguien tiene que
    // notarse hoy, no manana. Lo que se sigue exigiendo es lo que motivaba la
    // prueba: que el chat, que pregunta cada tres segundos, NO se traiga una
    // consulta por vuelta.
    //
    // Desde #423 la casilla es el permiso «Usar su WhatsApp» del catálogo, y el
    // chat lo lee del mapa recordado medio minuto (`explicarPermisosRecordados`,
    // permissions.service.js): aquí, ninguna consulta propia.
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = pedir({ userId: 7, role: 'gestor' }, { usuarioId: '7' });
      await chats(req, res, next);
      expect(next).not.toHaveBeenCalled();
    }
    expect(consultas.length).toBe(0);
  });

  it('con la casilla apagada no se abre ni la suya', async () => {
    // Apagar no es solo dejar de salir en la lista: es dejar de usarlo. Si solo
    // se escondiera, la gestora seguiria trabajando por una pantalla que quien
    // manda cree cerrada.
    // La casilla apagada es ahora «Usar su WhatsApp» quitado (#423).
    const { req, res, next } = pedir({ userId: 95, role: 'gestor', excepciones: { 'whatsapp.usar': false } });
    await chats(req, res, next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('SIN_WHATSAPP');
    // Y se dice donde se enciende, que es lo unico accionable.
    expect(err.message).toMatch(/ficha de usuario/i);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('un superadmin abre la de cualquiera', async () => {
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' }, { usuarioId: '7' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data[0].instancia).toBe('crm-u7');
  });

  it('la de un TUTOR no se abre, ni siendo superadmin', async () => {
    // No es que no salga en la lista: es que tampoco se puede entrar acertando
    // el identificador. La regla vive en `roles.js` y se aplica en el guardia
    // central, no en cada endpoint.
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' }, { usuarioId: '76' });
    await chats(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('SIN_WHATSAPP');
  });

  it('quien no puede tener WhatsApp tampoco abre LA SUYA', async () => {
    // El hueco que casi se queda: la sesion propia se devolvia antes de
    // comprobar nada, asi que un tutor entraba a la suya sin salir en ninguna
    // lista.
    const { req, res, next } = pedir({ userId: 5, role: 'tutor' }, {});
    await chats(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].code).toBe('SIN_WHATSAPP');
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

  it('un intento RECHAZADO no queda como que entro a mirar', async () => {
    // Se apunta DESPUES de comprobar los permisos, no antes. Si no, en el
    // registro saldria «entro a ver a Fulana» de alguien a quien se le nego el
    // paso — y eso es peor que no tener registro: acusa de algo que no paso.
    modelo.apuntarMirada.mockClear();
    const { req, res, next } = pedir({ userId: 9, role: 'admin' }, { usuarioId: '77' });
    await chats(req, res, next);
    expect(next.mock.calls[0][0].code).toBe('FUERA_DE_TUS_PROYECTOS');
    expect(modelo.apuntarMirada).not.toHaveBeenCalled();
  });

  it('pero una mirada permitida SI queda', async () => {
    modelo.apuntarMirada.mockClear();
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' }, { usuarioId: '7' });
    await chats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(modelo.apuntarMirada).toHaveBeenCalledWith(
      expect.objectContaining({ quienMira: 1, aQuien: 7 }),
    );
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
  // La de las personas es la ULTIMA: antes va la de los campus de quien pide
  // (ambito.js, #245), que no es lo que se prueba aqui.
  const laDeLasPersonas = () => consultas[consultas.length - 1].sql;

  it('a una gestora solo se le ofrece ella misma', async () => {
    const { req, res, next } = pedir({ userId: 7, role: 'gestor' });
    await usuarios(req, res, next);
    expect(laDeLasPersonas()).toContain('WHERE u.id = $1');
  });

  it('a un superadmin, todo el equipo', async () => {
    const { req, res, next } = pedir({ userId: 1, role: 'superadmin' });
    await usuarios(req, res, next);
    expect(laDeLasPersonas()).toContain('gestor_colaboraciones');
    expect(laDeLasPersonas()).not.toContain('WHERE u.id = $1');
  });

  it('a un admin, solo los de sus proyectos', async () => {
    const { req, res, next } = pedir({ userId: 9, role: 'admin' });
    await usuarios(req, res, next);
    expect(laDeLasPersonas()).toContain('user_projects');
  });
});
