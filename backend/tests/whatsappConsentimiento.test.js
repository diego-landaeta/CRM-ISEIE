import { describe, it, expect, vi, beforeEach } from 'vitest';

// El aviso antes de enlazar un numero — tarea #45.
//
// Enlazar por esta via no es la forma oficial de WhatsApp: el numero puede
// acabar bloqueado, y quien lo pone es una persona con su telefono, no la
// empresa. La casilla de la pantalla no protege nada por si sola —se esquiva
// llamando al endpoint a mano—, asi que lo que se fija aqui es que el SERVIDOR
// se niegue, y que quede escrito quien acepto y de quien era la linea.
//
// La base se simula: lo que se prueba es el criterio, no que Postgres sepa
// insertar una fila.

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));

const evolution = await import('../src/modules/whatsapp/evolution.client.js');
const model = await import('../src/modules/whatsapp/chat.model.js');
const ctrl = await import('../src/modules/whatsapp/chat.controller.js');

function fingirRes() {
  const res = { codigo: 200, cuerpo: null };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  return res;
}

async function llamar(handler, req) {
  const res = fingirRes();
  let error = null;
  await handler(req, res, (e) => { error = e; });
  return { res, error };
}

const comoUsuario = (userId, role, body = {}) => ({
  user: { userId, role },
  params: {}, query: {}, body,
  ip: '127.0.0.1',
  get: () => 'navegador-de-prueba',
});

describe('sin aceptar el aviso no se entrega el codigo', () => {
  beforeEach(() => { query.mockReset(); });

  it('rechaza si no viene la aceptacion', async () => {
    const { error } = await llamar(ctrl.emparejar, comoUsuario(4, 'gestor', { modo: 'rapido' }));
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('FALTA_CONSENTIMIENTO');
  });

  it('exige true de verdad, no un texto que se le parezca', async () => {
    // «enterado: "si"» o «enterado: 1» no valen: si colara cualquier valor
    // blando, el aviso seria decorativo.
    for (const valor of ['si', 'true', 1, {}, [], 'on']) {
      const { error } = await llamar(ctrl.emparejar, comoUsuario(4, 'gestor', { enterado: valor }));
      expect(error?.code).toBe('FALTA_CONSENTIMIENTO');
    }
  });

  it('ni siquiera pregunta a la base antes de rechazar', async () => {
    await llamar(ctrl.emparejar, comoUsuario(4, 'gestor', {}));
    expect(query).not.toHaveBeenCalled();
  });
});

describe('queda escrito quien acepto y de quien es la linea', () => {
  beforeEach(() => { query.mockReset(); });

  it('guarda las dos personas por separado', async () => {
    query.mockResolvedValue({ rows: [] });
    await model.apuntarConsentimiento({
      userId: 4, aceptadoPor: 1, instancia: 'crm-u4',
      versionAviso: 3, ip: '10.0.0.1', navegador: 'Firefox',
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/wa_consentimientos/);
    // De quien es la linea, y quien pulso. Si un administrador enlaza el numero
    // de una gestora, ella NO leyo el aviso: esa diferencia tiene que verse.
    expect(params[0]).toBe(4);
    expect(params[1]).toBe(1);
    expect(params[2]).toBe('crm-u4');
    expect(params[3]).toBe(3);
  });

  it('no revienta si la migracion 129 todavia no esta aplicada', async () => {
    // Hasta que Diego la aplique, el aviso ya funciona; lo que falta es el
    // registro. Dejar WhatsApp inservible por eso seria peor.
    const err = new Error('relation "wa_consentimientos" does not exist');
    err.code = '42P01';
    query.mockRejectedValue(err);
    await expect(model.apuntarConsentimiento({
      userId: 4, aceptadoPor: 4, instancia: 'crm-u4',
    })).resolves.toBe(false);
  });

  it('un fallo de base que NO sea la tabla ausente si se propaga', async () => {
    // Tragarse cualquier error aqui esconderia que el registro dejo de
    // guardarse, que es justo lo que no puede pasar sin que nadie se entere.
    const err = new Error('connection terminated');
    err.code = '57P01';
    query.mockRejectedValue(err);
    await expect(model.apuntarConsentimiento({
      userId: 4, aceptadoPor: 4, instancia: 'crm-u4',
    })).rejects.toThrow(/connection terminated/);
  });
});

describe('cada quien acepta por su linea', () => {
  beforeEach(() => { query.mockReset(); });

  it('una gestora no puede enlazar el numero de otra persona', async () => {
    const req = comoUsuario(4, 'gestor', { enterado: true, usuarioId: 1 });
    const { error } = await llamar(ctrl.emparejar, req);
    expect(error?.statusCode).toBe(403);
    expect(error?.code).toBe('SOLO_EL_TUYO');
  });

  it('la instancia que se enlaza es la del objetivo, no la de quien pulsa', () => {
    // Un administrador enlazando el numero de la usuaria 4 tiene que tocar
    // crm-u4, no crm-u1. Si se colara la suya, le estaria enlazando su propio
    // movil creyendo que ayuda a otra persona.
    expect(evolution.instanciaDe(4)).toBe(`${evolution.PREFIJO}-u4`);
    expect(evolution.instanciaDe(4)).not.toBe(evolution.instanciaDe(1));
  });
});
