import { describe, it, expect, beforeAll, vi } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202) · «Mi factura», el colaborador con usuario.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js).
 * Laura y Pedro tienen usuario con el rol colaborador; cada uno ve y sube solo lo
 * suyo. El permiso es `facturas_colaborador.subir`, que solo tiene ese rol.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));
vi.mock('../src/shared/utils/presignedUrl.js', () => ({
  generatePresignedUrl: vi.fn(async (key) => `https://r2.prueba/${key}?firma=15min`),
}));

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, E, U, como, montarApp, sembrar, PDF } = await import('./facturasColaborador.app.js');
const { prepararMes } = await import('../src/modules/facturas-colaborador/facturas.service.js');
const request = supertest(await montarApp());

const PERIODO = '2026-08-01';

const subir = (clave, id, numero = 'F-1', nombre = 'factura.pdf') => request.post(`${API}/mias/${id}`).set(como(clave))
  .field('importe', '450').field('numero_factura', numero).attach('archivo', PDF, nombre);

beforeAll(async () => {
  sembrar(base);
  for (const [nombre, userId] of [['Laura', U.colaborador], ['Pedro', U.colaborador2]]) {
    const id = ++base.datos.sec.colaborador;
    base.datos.colaboradores.push({
      id, nombre, email: `${nombre.toLowerCase()}@test.local`, area: 'seo', nif: null, notas: null, user_id: userId,
      activo: true, alta_desde: '2026-08-01', baja_desde: '2026-09-01', created_at: new Date(), updated_at: new Date(),
    });
    base.datos.ce.push({ colaborador_id: id, issuer_id: E.A, importe_acordado: 450 });
  }
  await prepararMes(PERIODO);
});

describe('facturas de colaboradores (#202) · «Mi factura»', () => {
  let deLaura;
  let dePedro;

  it('cada colaborador ve sus meses, y no los de otro', async () => {
    const res = await request.get(`${API}/mias`).set(como('colaborador'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ periodo: '2026-08', estado: 'sin_enviar', importe_acordado: 450 });
    deLaura = res.body.data[0].id;
    // Su enlace (ficha de Diego: «sus meses, su enlace…»), y es el que vale.
    const codigo = res.body.data[0].enlace.match(/factura-colaborador\/([A-Za-z0-9_-]{43})$/)[1];
    expect((await request.get(`${API}/enlace/${codigo}`)).body.data.periodo).toBe('2026-08');
    dePedro = (await request.get(`${API}/mias`).set(como('colaborador2'))).body.data[0].id;
    expect(dePedro).not.toBe(deLaura);
  });

  it('no puede subir la factura de otro colaborador, ni ver su archivo', async () => {
    expect((await subir('colaborador', dePedro)).status).toBe(404);
    expect((await request.get(`${API}/mias/${dePedro}/archivo`).set(como('colaborador'))).status).toBe(404);
  });

  it('sube la suya desde «Mi factura», una sola vez', async () => {
    const res = await subir('colaborador', deLaura, 'F-1', 'Factura_Peña.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Con su ñ: multer lo lee como Latin-1 y llegaba «PeÃ±a».
    expect(res.body.data.recibida.archivo).toBe('Factura_Peña.pdf');
    expect(res.body.data.estado).toBe('recibida');
    expect(res.body.data.recibida.numero_recepcion).toBe('REC-2026-08-0001');

    const otra = await subir('colaborador', deLaura, 'F-2');
    expect(otra.status).toBe(409);
    expect(otra.body.error).toMatch(/Ya subiste la factura de agosto de 2026/);

    const reg = base.registroDe(deLaura).find((r) => r.evento === 'recibida');
    expect(reg.user_id).toBe(U.colaborador);
    // Ya subida, su enlace ya no se le ofrece.
    expect((await request.get(`${API}/mias`).set(como('colaborador'))).body.data[0].enlace).toBeNull();
  });

  it('ve su archivo con un enlace firmado', async () => {
    const res = await request.get(`${API}/mias/${deLaura}/archivo`).set(como('colaborador'));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/firma=15min$/);
  });

  it('ve el estado del pago de cada mes, sin el justificante ni quién lo marcó (segunda parte)', async () => {
    expect((await request.get(`${API}/mias`).set(como('colaborador'))).body.data[0].pago).toBeNull();
    Object.assign(base.factura(deLaura), {
      pagada_at: '2026-09-05', forma_pago: 'transferencia', pagada_por: U.adminA,
      justificante: 'facturas-colaborador/pagos/secreto.pdf', referencia_pago: 'TRF-1',
    });
    const res = await request.get(`${API}/mias`).set(como('colaborador'));
    expect(res.body.data[0].pago).toEqual({ pagada_at: '2026-09-05', forma_pago: 'transferencia' });
    expect(JSON.stringify(res.body)).not.toContain('secreto.pdf');
  });

  it('con el rol colaborador, lo de administración da 403', async () => {
    for (const ruta of ['/mes?periodo=2026-08', '/colaboradores', '/empresas', `/facturas/${deLaura}/archivo`]) {
      expect((await request.get(`${API}${ruta}`).set(como('colaborador'))).status, ruta).toBe(403);
    }
  });

  it('una gestora y un admin no tienen «Mi factura»', async () => {
    expect((await request.get(`${API}/mias`).set(como('gestora'))).status).toBe(403);
    expect((await request.get(`${API}/mias`).set(como('adminA'))).status).toBe(403);
  });
});

/*
  El tablero (#210) limita a quien solo es colaborador a una lista de rutas
  (`RUTAS_DEL_COLABORADOR`, comprobada en `verifyToken`): sin «Mi factura» en
  ella, el colaborador recibiría 403 aunque tenga el permiso `subir`. Las de
  arriba ya pasan por ese control (la API va con su `verifyToken` de verdad);
  aquí se mira la lista y lo que queda fuera.
*/
describe('facturas de colaboradores (#202) · el colaborador entra en «Mi factura» (control del tablero)', () => {
  it('sus tres rutas están en la lista; las de administración, no', async () => {
    const { colaboradorPuede } = await import('../src/shared/utils/roles.js');
    for (const ruta of [`${API}/mias`, `${API}/mias/7`, `${API}/mias/7/archivo`, `${API}/mias?x=1`]) {
      expect(colaboradorPuede(ruta), ruta).toBe(true);
    }
    for (const ruta of [`${API}/colaboradores`, `${API}/mes`, `${API}/facturas`, `${API}/empresas`, `${API}/zip`, `${API}/miasx`]) {
      expect(colaboradorPuede(ruta), ruta).toBe(false);
    }
  });

  it('el corte lo hace `verifyToken` por la dirección: «Mi factura» pasa y lo de administración no', async () => {
    const { verifyToken } = await import('../src/shared/middleware/auth.js');
    const pasa = (originalUrl) => new Promise((resolve) => {
      // Express deja las cabeceras en minúsculas.
      const headers = { authorization: como('colaborador').Authorization };
      verifyToken({ headers, originalUrl }, {}, (err) => resolve(err ? err.statusCode : 'sigue'));
    });
    expect(await pasa(`${API}/mias`)).toBe('sigue');
    expect(await pasa(`${API}/mias/1/archivo`)).toBe('sigue');
    expect(await pasa(`${API}/mes?periodo=2026-08`)).toBe(403);
    expect(await pasa('/api/leads')).toBe(403);
  });

  it('el enlace público del correo no lleva sesión ni pasa por ese control: funciona igual con la sesión de un colaborador', async () => {
    const { prepararMes: preparar } = await import('../src/modules/facturas-colaborador/facturas.service.js');
    const id = ++base.datos.sec.colaborador;
    base.datos.colaboradores.push({
      id, nombre: 'Sin usuario', email: 'sin@test.local', area: 'seo', nif: null, notas: null, user_id: null,
      activo: true, alta_desde: '2026-07-01', baja_desde: '2026-08-01', created_at: new Date(), updated_at: new Date(),
    });
    base.datos.ce.push({ colaborador_id: id, issuer_id: E.A, importe_acordado: 100 });
    const [p] = await preparar('2026-07-01');
    expect((await request.get(`${API}/enlace/${p.token}`)).status).toBe(200);
    expect((await request.get(`${API}/enlace/${p.token}`).set(como('colaborador'))).status).toBe(200);
  });
});
