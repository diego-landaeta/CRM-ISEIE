import { describe, it, expect, vi, beforeEach } from 'vitest';

// #199 · tres fallos de la ficha de Matrículas, vistos en la prueba a mano del 12/10:
//   1. «Guardar campos» con el título o las notas en blanco daba «Datos invalidos»;
//   2. validar desde la ficha también (manda motivo_rechazo: null);
//   3. después de guardar, validar o subir un documento, la ficha se quedaba sin
//      el nombre de la persona: la respuesta no llevaba el JOIN del prospecto.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

const almacen = vi.hoisted(() => ({ deleteLocal: vi.fn(async () => {}) }));
const model = { findById: vi.fn(), update: vi.fn(), setEstado: vi.fn(), registrarEvento: vi.fn(), historial: vi.fn(), remove: vi.fn(),
  conTransaccion: vi.fn(async (fn) => fn('db-falso')) };
vi.mock('../src/modules/matriculas/matricula.model.js', () => model);
// Los campus de cada persona, para la comprobación del ámbito: Mireia es admin de CEDIA (campus 1).
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params = []) => (
    sql.includes('FROM user_projects WHERE user_id = $1 AND active = true')
      ? { rows: (({ 34: [1] })[params[0]] || []).map((project_id) => ({ project_id })) }
      : { rows: [] })),
}));
vi.mock('../src/shared/services/localStorage.service.js', () => ({
  getLocal: vi.fn(), saveLocal: vi.fn(async () => {}), deleteLocal: almacen.deleteLocal,
}));

const { updateSchema, setEstadoSchema } = await import('../src/modules/matriculas/matricula.validation.js');
const ctrl = await import('../src/modules/matriculas/matricula.controller.js');

const CON_NOMBRE = { id: 5, project_id: 1, lead_nombre: 'María López', estado: 'datos_validados' };

async function llamar(fn, req) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; return res; }, status() { return res; } };
  await fn({ user: { userId: 2, role: 'superadmin' }, query: {}, ...req }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => {
  vi.clearAllMocks();
  model.findById.mockResolvedValue(CON_NOMBRE);
  // Lo que devuelve un UPDATE … RETURNING *: la fila sin el nombre del prospecto.
  model.update.mockResolvedValue({ id: 5, project_id: 1 });
  model.setEstado.mockResolvedValue({ id: 5, project_id: 1, estado: 'datos_validados' });
  model.historial.mockResolvedValue([]);
});

describe('los campos vacíos de la ficha', () => {
  it('«Guardar campos» con el título y las notas en blanco (null) se acepta', () => {
    expect(updateSchema.safeParse({ dni: '11111111A', titulo: null, notas: null }).success).toBe(true);
  });

  it('validar manda motivo_rechazo: null, y se acepta', () => {
    expect(setEstadoSchema.safeParse({ estado: 'datos_validados', motivo_rechazo: null }).success).toBe(true);
  });

  it('rechazar sigue pidiendo el motivo', async () => {
    const { error } = await llamar(ctrl.setEstado, { params: { id: '5' }, body: { estado: 'rechazada', motivo_rechazo: null } });
    expect(error?.code).toBe('MOTIVO_REQUIRED');
  });
});

describe('la ficha no se queda sin nombre', () => {
  it('después de guardar los campos', async () => {
    const { salida } = await llamar(ctrl.update, { params: { id: '5' }, body: { dni: '11111111A', titulo: null, notas: null } });
    expect(salida.data.lead_nombre).toBe('María López');
  });

  it('después de validar', async () => {
    const { salida } = await llamar(ctrl.setEstado, { params: { id: '5' }, body: { estado: 'datos_validados', motivo_rechazo: null } });
    expect(salida.data.lead_nombre).toBe('María López');
  });

  it('después de subir un documento', async () => {
    const { salida } = await llamar(ctrl.uploadDoc, {
      params: { id: '5', tipo: 'dni' },
      file: { originalname: 'dni.jpg', buffer: Buffer.from('x') },
    });
    expect(salida.data.lead_nombre).toBe('María López');
  });
});

// El historial completo: cada cambio, con quién y cuándo (ideas de Diego del 01/10:
// «Recibida por el formulario el 01/10 a las 09:12», «Datos validados por Mireia…»).
describe('el historial de cada matrícula', () => {
  it('cada cambio de estado queda apuntado, con quién', async () => {
    await llamar(ctrl.setEstado, { params: { id: '5' }, body: { estado: 'datos_validados', motivo_rechazo: null } });
    expect(model.registrarEvento).toHaveBeenCalledWith({ matriculaId: 5, evento: 'estado', estado: 'datos_validados', motivo: null, userId: 2, db: 'db-falso' });
  });

  it('un rechazo queda con su motivo', async () => {
    model.setEstado.mockResolvedValue({ id: 5, project_id: 1, estado: 'rechazada' });
    await llamar(ctrl.setEstado, { params: { id: '5' }, body: { estado: 'rechazada', motivo_rechazo: 'El DNI no se lee' } });
    expect(model.registrarEvento).toHaveBeenCalledWith(expect.objectContaining({ evento: 'estado', estado: 'rechazada', motivo: 'El DNI no se lee' }));
  });

  it('cada documento subido queda apuntado, y si sustituye a otro', async () => {
    model.findById.mockResolvedValue({ ...CON_NOMBRE, dni_doc_key: 'matriculas/1/viejo.jpg' });
    await llamar(ctrl.uploadDoc, { params: { id: '5', tipo: 'dni' }, file: { originalname: 'dni.jpg', buffer: Buffer.from('x') } });
    expect(model.registrarEvento).toHaveBeenCalledWith({ matriculaId: 5, evento: 'documento', documento: 'dni', reemplazo: true, userId: 2, db: 'db-falso' });
  });

  it('la ficha trae el historial', async () => {
    model.historial.mockResolvedValue([{ evento: 'recibida', creado_at: '2026-10-01T07:12:00Z' }]);
    const { salida } = await llamar(ctrl.getById, { params: { id: '5' } });
    expect(salida.data.historial).toEqual([{ evento: 'recibida', creado_at: '2026-10-01T07:12:00Z' }]);
  });
});

// Los cinco documentos de Diego: también el DNI por detrás y la foto (migración 212).
describe('el DNI por detrás y la foto', () => {
  it.each([['dni_dorso', 'dni_dorso_key', 'dni_dorso_url'], ['foto', 'foto_key', 'foto_url']])('%s se puede subir', async (tipo, clave, url) => {
    const { error } = await llamar(ctrl.uploadDoc, { params: { id: '5', tipo }, file: { originalname: 'x.png', buffer: Buffer.from('x') } });
    expect(error).toBeNull();
    const guardado = model.update.mock.calls[0][1];
    expect(guardado[clave]).toMatch(new RegExp(`^matriculas/1/m-5-${tipo}-[0-9a-f]+\\.png$`));
    expect(guardado[url]).toMatch(new RegExp(`^/api/matriculas/5/doc/${tipo}`));
  });

  it('la ficha los firma igual que los demás', async () => {
    model.findById.mockResolvedValue({ ...CON_NOMBRE, foto_key: 'matriculas/1/foto.png', dni_dorso_key: 'matriculas/1/dorso.pdf' });
    const { salida } = await llamar(ctrl.getById, { params: { id: '5' } });
    expect(salida.data.foto_url).toMatch(/^\/api\/matriculas\/5\/doc\/foto\?exp=\d+&sig=/);
    expect(salida.data.documentos_formato).toEqual({ dni_dorso: 'pdf', foto: 'imagen' });
  });
});

// Cada uno, solo las de sus campus: antes, sabiendo el número, se abría o se
// validaba una matrícula de otro campus.
describe('la ficha, solo dentro de tus campus', () => {
  const MIREIA = { userId: 34, role: 'admin' };
  const DE_ICTESS = { ...CON_NOMBRE, project_id: 4 };

  it.each([
    ['abrirla', 'getById', {}],
    ['guardar campos', 'update', { body: { notas: 'x' } }],
    ['cambiar el estado', 'setEstado', { body: { estado: 'validada', motivo_rechazo: null } }],
    ['subir un documento', 'uploadDoc', { params: { id: '5', tipo: 'dni' }, file: { originalname: 'a.jpg', buffer: Buffer.from('x') } }],
    ['borrarla', 'remove', {}],
  ])('una admin de CEDIA no puede %s en una de ICTESS: 403 y nada cambia', async (_que, fn, extra) => {
    model.findById.mockResolvedValue(DE_ICTESS);
    const { error } = await llamar(ctrl[fn], { user: MIREIA, params: { id: '5' }, ...extra });
    expect(error?.statusCode).toBe(403);
    expect(model.update).not.toHaveBeenCalled();
    expect(model.setEstado).not.toHaveBeenCalled();
    expect(model.remove).not.toHaveBeenCalled();
  });

  it('en una de su campus, sí', async () => {
    const { error, salida } = await llamar(ctrl.getById, { user: MIREIA, params: { id: '5' } });
    expect(error).toBeNull();
    expect(salida.data.lead_nombre).toBe('María López');
  });
});

// Prueba a mano del 15/10: al subir un documento, la ficha se quedaba en «Sin
// movimientos», porque la respuesta no traía el historial y la pantalla la pinta tal cual.
describe('todas las respuestas de la ficha traen su historial', () => {
  const HISTORIAL = [{ evento: 'recibida', creado_at: '2026-10-01T07:12:00Z' }, { evento: 'documento', documento: 'dni_dorso', creado_at: '2026-10-15T23:18:00Z' }];
  beforeEach(() => { model.historial.mockResolvedValue(HISTORIAL); });

  it.each([
    ['subir un documento', 'uploadDoc', { params: { id: '5', tipo: 'dni_dorso' }, file: { originalname: 'd.png', buffer: Buffer.from('x') } }],
    ['guardar campos', 'update', { params: { id: '5' }, body: { notas: 'x' } }],
    ['cambiar el estado', 'setEstado', { params: { id: '5' }, body: { estado: 'validada', motivo_rechazo: null } }],
  ])('después de %s', async (_que, fn, req) => {
    const { salida, error } = await llamar(ctrl[fn], req);
    expect(error).toBeNull();
    expect(salida.data.historial).toEqual(HISTORIAL);
    expect(salida.data.lead_nombre).toBe('María López');
  });
});

// Revisión final del 15/10: crear también, solo en tus campus.
describe('crear una matrícula, solo en tus campus', () => {
  const MIREIA = { userId: 34, role: 'admin' };
  beforeEach(() => { model.create = vi.fn(async (d) => ({ id: 9, ...d })); model.findByConversion = vi.fn(async () => null); });

  it('una admin de CEDIA no crea una en ICTESS: 403 y no se crea', async () => {
    const { error } = await llamar(ctrl.create, { user: MIREIA, body: { project_id: 4 } });
    expect(error?.statusCode).toBe(403);
    expect(model.create).not.toHaveBeenCalled();
  });

  it('en su campus, sí, y con quién la crea para el historial', async () => {
    const { error } = await llamar(ctrl.create, { user: MIREIA, body: { project_id: 1 } });
    expect(error).toBeNull();
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ project_id: 1, user_id: 34 }));
  });
});

// Revisión independiente del 15/10: el documento viejo no se pierde si falla el guardado.
describe('reemplazar un documento sin perder el viejo', () => {
  beforeEach(() => { almacen.deleteLocal.mockClear(); });

  it('si todo va bien, se borra el viejo (después de apuntar el nuevo)', async () => {
    model.findById.mockResolvedValue({ ...CON_NOMBRE, dni_doc_key: 'matriculas/1/viejo.jpg' });
    const { error } = await llamar(ctrl.uploadDoc, { params: { id: '5', tipo: 'dni' }, file: { originalname: 'dni.jpg', buffer: Buffer.from('x') } });
    expect(error).toBeNull();
    expect(almacen.deleteLocal).toHaveBeenCalledWith('matriculas/1/viejo.jpg');
  });

  it('si falla el guardado, el viejo se queda y el nuevo se quita', async () => {
    model.findById.mockResolvedValue({ ...CON_NOMBRE, dni_doc_key: 'matriculas/1/viejo.jpg' });
    model.conTransaccion.mockRejectedValueOnce(new Error('se cayó la base'));
    const { error } = await llamar(ctrl.uploadDoc, { params: { id: '5', tipo: 'dni' }, file: { originalname: 'dni.jpg', buffer: Buffer.from('x') } });
    expect(error?.message).toBe('se cayó la base');
    expect(almacen.deleteLocal).not.toHaveBeenCalledWith('matriculas/1/viejo.jpg');
    expect(almacen.deleteLocal).toHaveBeenCalledWith(expect.stringMatching(/^matriculas\/1\/m-5-dni-[0-9a-f]+\.jpg$/));
  });

  it('el cambio de estado y su historial van en la misma transacción', async () => {
    await llamar(ctrl.setEstado, { params: { id: '5' }, body: { estado: 'validada', motivo_rechazo: null } });
    expect(model.conTransaccion).toHaveBeenCalled();
    expect(model.setEstado.mock.calls[0][4]).toBe('db-falso');
    expect(model.registrarEvento.mock.calls[0][0].db).toBe('db-falso');
  });
});
