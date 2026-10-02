import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Los documentos de una matrícula no se bajan contando (#160 · seguridad).
 *
 * LO QUE HABÍA: la ruta `/api/matriculas/:id/doc/:tipo` estaba fuera de
 * `verifyToken` con este comentario al lado —
 *
 *     // Doc download es publico (la URL ya es no-guessable)
 *
 * — y la URL es `/api/matriculas/1/doc/dni`. El 1 es la matrícula; la
 * siguiente es la 2. No había nada que adivinar: se contaba. Cualquiera sin
 * cuenta en el CRM se bajaba los DNI escaneados de todas las matrículas.
 * Comprobado contra el servidor local: HTTP 200 sin mandar una credencial.
 *
 * POR QUÉ NO SE ARREGLA CON `verifyToken`: el botón de la pantalla es un
 * `<a href>`, y una etiqueta `<a>` no puede mandar una cabecera. Poniendo el
 * candado a secas, el botón deja de funcionar para todo el mundo. Así que la
 * credencial va EN la dirección, firmada y caducando — como los enlaces
 * pre-firmados de R2 que este CRM ya usa para los dossiers.
 *
 * Esto fija las cuatro cosas que tienen que seguir siendo verdad:
 *
 *   1. sin firma no se sirve nada;
 *   2. una firma inventada tampoco;
 *   3. la firma de UNA matrícula no vale para OTRA — que es lo que mataba el
 *      «cuento 1, 2, 3»;
 *   4. y caduca.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'secreto-de-pruebas';

// Los dobles van AQUI y no dentro de un `describe`: `vi.mock` se eleva al
// principio del fichero, asi que no puede usar nada declarado mas abajo.
const model = { findById: vi.fn(), update: vi.fn() };
vi.mock('../src/modules/matriculas/matricula.model.js', () => model);
vi.mock('../src/shared/services/localStorage.service.js', () => ({
  getLocal: vi.fn(async () => ({ buffer: Buffer.from('imagen') })),
  saveLocal: vi.fn(), deleteLocal: vi.fn(),
}));

const { urlFirmada, firmaValida } = await import('../src/shared/utils/firmaDeDocumento.js');
const ctrl = await import('../src/modules/matriculas/matricula.controller.js');

/** Los trozos de una dirección firmada, para poder manipularlos. */
function partes(url) {
  const [ruta, query] = url.split('?');
  const p = new URLSearchParams(query);
  const [, id, tipo] = ruta.match(/matriculas\/(\d+)\/doc\/(\w+)/);
  return { id: Number(id), tipo, exp: p.get('exp'), sig: p.get('sig') };
}

describe('la firma de un documento', () => {
  it('la recién hecha vale', () => {
    expect(firmaValida(partes(urlFirmada(7, 'dni')))).toBe(true);
  });

  it('sin firma no vale', () => {
    expect(firmaValida({ id: 7, tipo: 'dni', exp: null, sig: null })).toBe(false);
    expect(firmaValida({ id: 7, tipo: 'dni', exp: '9999999999', sig: '' })).toBe(false);
  });

  it('una firma inventada no vale', () => {
    const p = partes(urlFirmada(7, 'dni'));
    expect(firmaValida({ ...p, sig: 'me-la-invento' })).toBe(false);
  });

  it('LA DE UNA MATRÍCULA NO VALE PARA OTRA', () => {
    // Es el corazón del asunto: sin esto se sigue contando 1, 2, 3.
    const p = partes(urlFirmada(7, 'dni'));
    expect(firmaValida({ ...p, id: 8 })).toBe(false);
    expect(firmaValida({ ...p, id: 6 })).toBe(false);
  });

  it('la de un tipo de documento no vale para otro', () => {
    const p = partes(urlFirmada(7, 'dni'));
    expect(firmaValida({ ...p, tipo: 'titulo' })).toBe(false);
  });

  it('caduca', () => {
    const p = partes(urlFirmada(7, 'dni'));
    // Dieciséis minutos después: la validez son quince.
    expect(firmaValida(p, Date.now() + 16 * 60 * 1000)).toBe(false);
  });

  it('mover la caducidad hacia adelante no sirve: la firma la incluye', () => {
    // El intento obvio de quien tenga un enlace viejo.
    const p = partes(urlFirmada(7, 'dni'));
    expect(firmaValida({ ...p, exp: String(Number(p.exp) + 86400 * 365) })).toBe(false);
  });

  it('una caducidad que no es un número no cuela', () => {
    const p = partes(urlFirmada(7, 'dni'));
    expect(firmaValida({ ...p, exp: 'manana' })).toBe(false);
  });

  it('dos documentos de la misma matrícula llevan firmas distintas', () => {
    const a = partes(urlFirmada(7, 'dni'));
    const b = partes(urlFirmada(7, 'titulo'));
    expect(a.sig).not.toBe(b.sig);
  });
});

/*
  LO QUE NO SE PRUEBA AQUÍ, Y POR QUÉ.

  `firmaParaUrl` revienta si falta `JWT_SECRET` —firmar con una clave vacía
  dejaría que cualquiera calculase la firma—. Había una prueba para eso que
  borraba la variable del entorno y la reponía.

  Se ha quitado: Vitest comparte `process.env` entre los hilos que corren los
  ficheros a la vez, así que durante ese instante `leads.test.js` no podía
  verificar sus tokens y se caían once pruebas suyas. Aisladas pasaban todas;
  juntas, no. Un fichero de pruebas que rompe otro es peor que una línea sin
  cubrir.

  La comprobación sigue en el código (`clave()` lanza), y el arranque del
  servidor ya exige `JWT_SECRET` para todo lo demás.
*/

describe('la ruta, de punta a punta', () => {
  beforeEach(() => {
    model.findById.mockReset();
    model.findById.mockResolvedValue({ id: 7, project_id: 1, dni_doc_key: 'matriculas/1/m-7-dni-abc.png' });
  });

  function fingirRes() {
    const res = { codigo: 200, cuerpo: null, cabeceras: {} };
    res.status = (c) => { res.codigo = c; return res; };
    res.json = (c) => { res.cuerpo = c; return res; };
    res.setHeader = (k, v) => { res.cabeceras[k] = v; };
    res.send = (b) => { res.cuerpo = b; return res; };
    res.end = () => res;
    return res;
  }

  async function pedir(query) {
    const res = fingirRes();
    let error = null;
    await ctrl.getDoc({ params: { id: '7', tipo: 'dni' }, query }, res, (e) => { error = e; });
    return { res, error };
  }

  it('sin firma: 403, y NO se toca el disco', async () => {
    const { error } = await pedir({});
    expect(error?.statusCode).toBe(403);
    expect(error?.code).toBe('FIRMA_INVALIDA');
    // Ni siquiera se busca la matrícula: probando números no se puede saber
    // cuáles existen.
    expect(model.findById).not.toHaveBeenCalled();
  });

  it('con la firma de otra matrícula: 403', async () => {
    const p = partes(urlFirmada(99, 'dni'));
    const { error } = await pedir({ exp: p.exp, sig: p.sig });
    expect(error?.statusCode).toBe(403);
  });

  it('con su firma: se sirve', async () => {
    const p = partes(urlFirmada(7, 'dni'));
    const { res, error } = await pedir({ exp: p.exp, sig: p.sig });
    expect(error).toBeNull();
    expect(res.cabeceras['Content-Type']).toBe('image/png');
    expect(res.cuerpo.toString()).toBe('imagen');
  });

  it('al subir, la respuesta ya lleva el enlace firmado: la ficha la pinta tal cual', async () => {
    // Sin esto, «Ver documento» daba 403 justo después de subirlo, hasta
    // volver a abrir la ficha.
    model.update.mockImplementation(async (id, campos) => ({ id, project_id: 1, ...campos }));
    const res = fingirRes();
    let error = null;
    await ctrl.uploadDoc(
      { params: { id: '7', tipo: 'dni' }, file: { originalname: 'dni.png', buffer: Buffer.from('x') } },
      res, (e) => { error = e; }
    );
    expect(error).toBeNull();
    const url = res.cuerpo.data.dni_doc_url;
    expect(url).toMatch(/[?&]sig=/);
    expect(firmaValida(partes(url))).toBe(true);
  });
});
