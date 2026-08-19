import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cada usuario, su propia sesion de WhatsApp.
//
// Esto empezo siendo UNA sesion compartida por todo el CRM: quien enlazaba su
// numero dejaba sus conversaciones privadas —y sus grupos— a la vista de
// cualquiera que entrase en la pantalla del chat. La correccion fue darle a
// cada usuario su instancia, y estos tests fijan las dos mitades de esa
// correccion para que no se deshaga sin querer:
//
//   1. de donde sale el nombre de la instancia, y
//   2. que abrir una conversacion ajena no cuele por teclear su numero.
//
// La base se simula: lo que se prueba es el criterio, no que Postgres sepa
// hacer un JOIN. Asi el fichero corre sin contenedor levantado.

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));

const evolution = await import('../src/modules/whatsapp/evolution.client.js');
const ctrl = await import('../src/modules/whatsapp/chat.controller.js');

/** Un `res` de mentira que apunta lo que le mandan. */
function fingirRes() {
  const res = { codigo: 200, cuerpo: null };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  res.setHeader = () => res;
  res.send = (c) => { res.cuerpo = c; return res; };
  return res;
}

/** Llama al controlador y devuelve lo que salio: respuesta o error. */
async function llamar(handler, req) {
  const res = fingirRes();
  let error = null;
  await handler(req, res, (e) => { error = e; });
  return { res, error };
}

const comoUsuario = (userId, extra = {}) => ({
  user: { userId, role: 'gestor' }, params: {}, query: {}, body: {}, ...extra,
});

describe('la instancia sale del usuario, no de lo que mande el cliente', () => {
  it('cada usuario tiene un nombre de instancia distinto', () => {
    expect(evolution.instanciaDe(1)).not.toBe(evolution.instanciaDe(2));
  });

  it('el nombre lleva dentro el id, que es lo que evita una tabla nueva', () => {
    expect(evolution.instanciaDe(7)).toBe(`${evolution.PREFIJO}-u7`);
    expect(evolution.usuarioDeInstancia(evolution.instanciaDe(7))).toBe(7);
  });

  it('no se deja colar un id que no es un numero', () => {
    // Acaba siendo nombre de carpeta en el puente: si pasara tal cual, un id
    // con barras escribiria fuera de su sitio.
    expect(evolution.instanciaDe('3; drop')).toBe(`${evolution.PREFIJO}-u3`);
  });

  it('la instancia vieja compartida no pertenece a nadie', () => {
    // Importa: si `crm` a secas siguiera contando como instancia valida, las
    // conversaciones de cuando era compartido las veria cualquiera.
    expect(evolution.usuarioDeInstancia('crm')).toBeNull();
  });

  it('la lista de chats se pide con la instancia de quien pregunta', async () => {
    query.mockResolvedValue({ rows: [] });
    await llamar(ctrl.chats, comoUsuario(9));
    // El primer parametro de la consulta es la instancia.
    expect(query.mock.calls[0][1][0]).toBe(evolution.instanciaDe(9));
  });
});

describe('no se puede abrir la conversacion de otro', () => {
  beforeEach(() => { query.mockReset(); });

  // porId() devuelve la conversacion con su instancia; es lo unico que hace
  // falta simular para estos casos.
  const conversacionDe = (instancia) => ({
    rows: [{ id: 55, instancia, jid: '34600111222@s.whatsapp.net', lead_id: null }],
  });

  it('deja abrir la propia', async () => {
    query.mockResolvedValueOnce(conversacionDe(evolution.instanciaDe(4)))  // porId
         .mockResolvedValueOnce({ rows: [] })                              // mensajes
         .mockResolvedValue({ rows: [] });                                 // marcarLeida
    const { res, error } = await llamar(ctrl.chat, comoUsuario(4, { params: { id: '55' } }));
    expect(error).toBeNull();
    expect(res.cuerpo?.success).toBe(true);
  });

  it('no deja abrir la de otro, aunque se acierte el numero', async () => {
    query.mockResolvedValue(conversacionDe(evolution.instanciaDe(4)));
    const { error } = await llamar(ctrl.chat, comoUsuario(5, { params: { id: '55' } }));
    expect(error?.statusCode).toBe(404);
  });

  it('dice «no encontrada» y no «no tienes permiso»', async () => {
    // Un 403 confirmaria que ese chat existe. Con un 404 no se filtra nada.
    query.mockResolvedValue(conversacionDe(evolution.instanciaDe(4)));
    const { error } = await llamar(ctrl.chat, comoUsuario(5, { params: { id: '55' } }));
    expect(error.statusCode).toBe(404);
    expect(error.message).toMatch(/no encontrada/i);
  });

  it('tampoco deja ESCRIBIR en la de otro', async () => {
    query.mockResolvedValue(conversacionDe(evolution.instanciaDe(4)));
    const { error } = await llamar(ctrl.enviar,
      comoUsuario(5, { params: { id: '55' }, body: { texto: 'hola' } }));
    expect(error?.statusCode).toBe(404);
  });

  it('tampoco deja marcarla como «no escribir»', async () => {
    query.mockResolvedValue(conversacionDe(evolution.instanciaDe(4)));
    const { error } = await llamar(ctrl.noEscribir,
      comoUsuario(5, { params: { id: '55' }, body: { motivo: 'x' } }));
    expect(error?.statusCode).toBe(404);
  });

  it('un id que no es un numero no llega ni a preguntar a la base', async () => {
    const { error } = await llamar(ctrl.chat, comoUsuario(5, { params: { id: 'abc' } }));
    expect(error?.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('una conversacion que no existe tambien es un 404', async () => {
    query.mockResolvedValue({ rows: [] });
    const { error } = await llamar(ctrl.chat, comoUsuario(5, { params: { id: '55' } }));
    expect(error?.statusCode).toBe(404);
  });
});

describe('los mensajes que llegan se atribuyen a su sesion', () => {
  beforeEach(() => { query.mockReset(); });

  it('un aviso sin instancia no se guarda', async () => {
    // Antes se caia al nombre generico: el mensaje acababa en una sesion de
    // nadie, no lo veria nunca ningun usuario, y encima ensuciaba la base.
    const { recibir } = await import('../src/modules/whatsapp/chat.service.js');
    const r = await recibir({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '34600111222@s.whatsapp.net', id: 'X1', fromMe: false },
        message: { conversation: 'hola' },
        messageTimestamp: '1700000000',
      },
    });
    expect(r).toEqual({ ignorado: 'sin instancia' });
    expect(query).not.toHaveBeenCalled();
  });
});
