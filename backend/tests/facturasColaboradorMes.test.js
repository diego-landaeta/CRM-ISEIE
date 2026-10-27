import { describe, it, expect, beforeAll, vi } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202) · el mes, el enlace y la subida.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js).
 * Laura factura a las empresas A y B; Pedro, solo a B. Se prepara septiembre, cada
 * uno sube por su enlace y administración lo ve. La carrera de «dos anulaciones a la
 * vez» la mira MultiCRM contra Postgres: aquí no hay concurrencia de verdad.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
// R2 simulado: estas pruebas no suben nada a ningún almacén.
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));
vi.mock('../src/shared/utils/presignedUrl.js', () => ({
  generatePresignedUrl: vi.fn(async (key) => `https://r2.prueba/${key}?firma=15min`),
}));

// R2 «configurado» con valores de prueba: así almacen.js usa el R2 simulado de
// arriba. El camino del disco lo prueba facturasColaboradorRevision.test.js.
process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, E, U, como, montarApp, sembrar, PDF } = await import('./facturasColaborador.app.js');
const { uploadToR2 } = await import('../src/shared/services/r2.service.js');
const { prepararMes, huella } = await import('../src/modules/facturas-colaborador/facturas.service.js');
const request = supertest(await montarApp());

const PERIODO = '2026-09-01';
const TEXTO = Buffer.from('esto no es una factura');
const C = {};
const enlace = {}; // 'laura-A', 'laura-B', 'pedro-B' → token en claro

const subir = (t, { archivo = PDF, nombre = 'factura.pdf', importe = '600', numero = 'F-2026-09' } = {}) => {
  const r = request.post(`${API}/enlace/${t}`).field('importe', importe).field('numero_factura', numero);
  return archivo ? r.attach('archivo', archivo, nombre) : r;
};

/** Un colaborador solo de septiembre, con lo acordado con cada empresa. */
function colaborador(nombre, empresas) {
  const id = ++base.datos.sec.colaborador;
  base.datos.colaboradores.push({
    id, nombre, email: `${nombre.toLowerCase()}@test.local`, area: 'seo', nif: null, notas: null, user_id: null,
    activo: true, alta_desde: '2026-09-01', baja_desde: '2026-10-01', created_at: new Date(), updated_at: new Date(),
  });
  for (const [issuer, importe] of empresas) {
    base.datos.ce.push({ colaborador_id: id, issuer_id: issuer, importe_acordado: importe });
  }
  return { id };
}

/** El id de la fila viva de un colaborador y una empresa ese mes. */
const filaViva = (c, e) => base.datos.facturas.find((f) => f.colaborador_id === c.id && f.issuer_id === e
  && f.periodo === PERIODO && !f.anulada_at).id;

/** Pone a una fila un enlace conocido (en la base, solo su huella). */
function enlaceConocido(facturaId) {
  const t = `prueba${facturaId}`.padEnd(43, 'x');
  base.factura(facturaId).token_hash = huella(t);
  return t;
}

beforeAll(() => {
  sembrar(base);
  C.laura = colaborador('Laura', [[E.A, 600], [E.B, null]]);
  C.pedro = colaborador('Pedro', [[E.B, 300]]);
});

describe('facturas de colaboradores (#202) · preparar el mes', () => {
  it('una fila y un enlace por colaborador y empresa; en la base, solo la huella', async () => {
    const preparados = await prepararMes(PERIODO);
    expect(preparados).toHaveLength(3);
    for (const p of preparados) {
      const clave = `${p.colaboradorId === C.laura.id ? 'laura' : 'pedro'}-${p.issuerId === E.A ? 'A' : 'B'}`;
      enlace[clave] = p.token;
      const fila = base.factura(p.facturaId);
      expect(fila.token_hash).toBe(huella(p.token));
      expect(fila.token_hash).not.toContain(p.token);
      expect(fila.token_semilla).toMatch(/^[0-9a-f]{64}$/);
      const dias = (new Date(fila.caduca_at) - Date.now()) / 86400000;
      expect(Math.round(dias)).toBe(60);
    }
    expect(Object.keys(enlace).sort()).toEqual(['laura-A', 'laura-B', 'pedro-B']);
  });

  it('prepararlo dos veces no duplica nada', async () => {
    expect(await prepararMes(PERIODO)).toHaveLength(0);
  });

  it('fuera de sus meses (alta en septiembre, baja en octubre) no se le prepara nada', async () => {
    expect(await prepararMes('2026-08-01')).toHaveLength(0);
    expect(await prepararMes('2026-10-01')).toHaveLength(0);
  });
});

describe('facturas de colaboradores (#202) · el enlace', () => {
  it('sin enlace, o con uno inventado, no se ve nada', async () => {
    expect((await request.get(`${API}/enlace/`)).status).toBe(404);
    expect((await request.get(`${API}/enlace/${'x'.repeat(43)}`)).status).toBe(404);
    // Con un código que no tiene el formato ni se lee el archivo.
    expect((await subir('corto')).status).toBe(404);
  });

  it('el colaborador ve su mes, la empresa y lo acordado, y queda «abierto»', async () => {
    const res = await request.get(`${API}/enlace/${enlace['laura-A']}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      estado: 'abierto', periodo: '2026-09', mes: 'septiembre de 2026', importe_acordado: 600,
      empresa: { razon_social: 'Alfa Formación SL', direccion: 'Calle Mayor 1' },
    });
    // Nada de huellas, claves de archivo ni correos.
    expect(JSON.stringify(res.body)).not.toMatch(/token_hash|archivo_key|@test\.local/);
    expect(base.registroDe(filaViva(C.laura, E.A)).map((r) => r.evento)).toEqual(['abierto']);
  });

  it('sin archivo, con un archivo que no es PDF ni foto, o de más de 10 MB, se rechaza', async () => {
    expect((await subir(enlace['laura-A'], { archivo: null })).status).toBe(400);
    const otro = await subir(enlace['laura-A'], { archivo: TEXTO, nombre: 'factura.pdf' });
    expect(otro.status).toBe(400);
    expect(otro.body.error).toMatch(/PDF o una foto/);
    const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await subir(enlace['laura-A'], { archivo: grande })).status).toBe(400);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it('sube la factura: queda recibida con su número de recepción', async () => {
    const res = await subir(enlace['laura-A'], { importe: '600,00' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.estado).toBe('recibida');
    expect(res.body.data.recibida).toMatchObject({ importe: 600, numero_factura: 'F-2026-09' });
    expect(res.body.data.recibida.numero_recepcion).toBe('REC-2026-09-0001');

    expect(uploadToR2).toHaveBeenCalledTimes(1);
    const [key, , mime] = uploadToR2.mock.calls[0];
    expect(mime).toBe('application/pdf');
    // 2026-09_<empresa>_<colaborador>_<n.º de factura>.pdf, sin tildes ni símbolos.
    expect(key).toMatch(/^facturas-colaborador\/2026-09\/\d+-[0-9a-f]{8}\/2026-09_Alfa_Laura_F-2026-09\.pdf$/);
  });

  it('a administración le llega el aviso en la campana: al admin de esa empresa y al super admin', async () => {
    // Sale justo después de responder (revisión del 10/10): se espera a que esté.
    const id = filaViva(C.laura, E.A);
    const aviso = await vi.waitFor(() => {
      const a = base.datos.notificaciones.find((n) => n.type === 'factura_colaborador' && n.metadata.factura_id === id);
      expect(a).toBeTruthy();
      return a;
    });
    expect(aviso.title).toBe('Factura recibida: Laura');
    // En ISEIE, Finanzas vive en /accounting.
    expect(aviso.link_path).toBe('/accounting/facturas-colaboradores?periodo=2026-09');
    expect(aviso.target_user_ids).toEqual(expect.arrayContaining([U.adminA, U.super]));
    expect(aviso.target_user_ids).not.toContain(U.gestora);
    expect(aviso.target_user_ids).not.toContain(U.adminB);
  });

  it('una segunda factura del mismo mes se rechaza, con un mensaje claro', async () => {
    const res = await subir(enlace['laura-A']);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Ya subiste la factura de septiembre de 2026/);
  });

  it('un enlace caducado no sirve', async () => {
    base.factura(filaViva(C.laura, E.B)).caduca_at = new Date(Date.now() - 86400000);
    const ver = await request.get(`${API}/enlace/${enlace['laura-B']}`);
    expect(ver.body.data.estado).toBe('caducado');
    expect((await subir(enlace['laura-B'])).status).toBe(410);
    // Queda en el registro, una sola vez aunque se intente varias.
    expect(base.registroDe(filaViva(C.laura, E.B)).filter((r) => r.evento === 'caducado')).toHaveLength(1);
  });
});

describe('facturas de colaboradores (#202) · administración', () => {
  it('gestora y colaborador no ven la lista del mes', async () => {
    expect((await request.get(`${API}/mes?periodo=2026-09`).set(como('gestora'))).status).toBe(403);
    expect((await request.get(`${API}/mes?periodo=2026-09`).set(como('colaborador'))).status).toBe(403);
  });

  it('el admin de A ve solo lo de A: quién la ha mandado y cuánto', async () => {
    const res = await request.get(`${API}/mes?periodo=2026-09`).set(como('adminA'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.facturas.map((f) => [f.colaborador_nombre, f.empresa, f.estado])).toEqual([
      ['Laura', 'Alfa Formación SL', 'recibida'],
    ]);
    expect(Number(res.body.data.facturas[0].diferencia)).toBe(0);
    expect(res.body.data.resumen).toMatchObject({ total: 1, recibidas: 1, importe_recibido: 600, importe_acordado: 600 });
    expect((await request.get(`${API}/mes?periodo=2026-09&issuerId=${E.B}`).set(como('adminA'))).status).toBe(403);
  });

  it('el super admin ve las tres y quién falta', async () => {
    const res = await request.get(`${API}/mes?periodo=2026-09`).set(como('super'));
    expect(res.body.data.facturas.map((f) => f.estado).sort()).toEqual(['caducado', 'recibida', 'sin_enviar']);
  });

  it('con una empresa elegida solo llegan sus facturas (Diego, 10/10: «son por EMPRESA»)', async () => {
    for (const [k, nombre] of [['A', 'Alfa Formación SL'], ['B', 'Beta Consultoría SL']]) {
      const res = await request.get(`${API}/mes?periodo=2026-09&issuerId=${E[k]}`).set(como('super'));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.facturas.length).toBeGreaterThan(0);
      expect(new Set(res.body.data.facturas.map((f) => f.empresa))).toEqual(new Set([nombre]));
    }
  });

  it('el archivo se abre con un enlace firmado, y no el de otra empresa', async () => {
    const res = await request.get(`${API}/facturas/${filaViva(C.laura, E.A)}/archivo`).set(como('adminA'));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/firma=15min$/);
    expect((await request.get(`${API}/facturas/${filaViva(C.pedro, E.B)}/archivo`).set(como('adminA'))).status).toBe(404);
  });

  it('anular deja la factura (con motivo) y abre otra del mismo mes que se puede subir', async () => {
    const vieja = filaViva(C.laura, E.A);
    expect((await request.post(`${API}/facturas/${vieja}/anular`).set(como('adminA')).send({ motivo: '' })).status).toBe(400);

    const res = await request.post(`${API}/facturas/${vieja}/anular`).set(como('adminA')).send({ motivo: 'Subió la de agosto' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).not.toHaveProperty('token');

    const anulada = base.factura(vieja);
    expect(anulada.anulada_por).toBe(U.adminA);
    expect(anulada.motivo_anulacion).toBe('Subió la de agosto');
    expect(anulada.archivo_key).toBeTruthy(); // el archivo no se borra

    // El enlace viejo ya no deja subir…
    expect((await subir(enlace['laura-A'])).status).toBe(409);
    // …y el nuevo sí.
    const nueva = filaViva(C.laura, E.A);
    expect(nueva).toBe(res.body.data.nueva);
    const otraVez = await subir(enlaceConocido(nueva), { numero: 'F-2026-09-B' });
    expect(otraVez.status, JSON.stringify(otraVez.body)).toBe(201);
  });

  it('reenviar cambia el enlace: el viejo deja de valer y no se devuelve el nuevo', async () => {
    const pedroB = filaViva(C.pedro, E.B);
    const res = await request.post(`${API}/facturas/${pedroB}/reenviar`).set(como('super'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/token/);
    expect((await request.get(`${API}/enlace/${enlace['pedro-B']}`)).status).toBe(404);
    expect((await subir(enlace['pedro-B'])).status).toBe(404);

    const reg = await request.get(`${API}/facturas/${pedroB}/registro`).set(como('super'));
    expect(reg.body.data.map((r) => r.evento)).toEqual(['reenviado']);
  });

  it('el admin de A no anula ni reenvía lo de B', async () => {
    const pedroB = filaViva(C.pedro, E.B);
    expect((await request.post(`${API}/facturas/${pedroB}/anular`).set(como('adminA')).send({ motivo: 'No es mía' })).status).toBe(404);
    expect((await request.post(`${API}/facturas/${pedroB}/reenviar`).set(como('adminA'))).status).toBe(404);
  });
});
