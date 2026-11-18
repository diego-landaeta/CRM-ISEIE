import { describe, it, expect, beforeAll, vi } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#422 (gemela de CRM#710) · Las vendedoras con su factura del mes.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js):
 * - la ficha de vendedora es de una gestora o comercial (nunca un super admin), una
 *   por persona, y le da a ELLA «Subir su factura» por excepción, con su registro;
 * - «Vendedoras / Colaboradores» filtra las listas y los totales;
 * - Diego, 18/11: «la gestora pone su monto y luego la empresa valida y hace el
 *   pago». Solo se paga una validada; «Por pagar» enseña solo las validadas.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));
vi.mock('../src/shared/services/localStorage.service.js', () => ({
  saveLocal: vi.fn(async (k) => k),
  getLocal: vi.fn(async (k) => ({ buffer: Buffer.from(`%PDF-1.4 ${k}`), size: 8 })),
}));
vi.mock('../src/shared/utils/presignedUrl.js', () => ({
  generatePresignedUrl: vi.fn(async (key) => `https://r2.test/${key}?firmado`),
}));

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, E, U, como, montarApp, sembrar } = await import('./facturasColaborador.app.js');
const { registrar } = await import('./helpers/permisosSinBase.js');
const { armarCorreoDelMes, conceptoSugerido } = await import('../src/modules/facturas-colaborador/facturas.emails.js');
const request = supertest(await montarApp());

const PERIODO = '2026-04-01';

/** La gestora tal como la ve el servidor después de su ficha: con la excepción que le da la ficha. */
function comoGestoraConFicha() {
  const excepciones = Object.fromEntries(base.datos.overrides
    .filter((o) => o.user_id === U.gestora).map((o) => [`${o.resource}.${o.action}`, o.allowed]));
  registrar({ userId: U.gestora, role: 'gestor', excepciones });
  const t = jwt.sign({ userId: U.gestora, email: 'g@test.local', role: 'gestor', roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { Authorization: `Bearer ${t}` };
}

const ficha = (userId, extra = {}) => ({
  nombre: 'Gestora', email: 'gestora@test.local', tipo: 'vendedora', user_id: userId,
  // Variable (Diego, 18/11): sin modalidad ni importe acordado; lo pone su factura.
  empresas: [{ issuer_id: E.A }],
  ...extra,
});

/** Una factura de abril ya subida, sin validar. */
function recibida(colaboradorId, importe) {
  const id = ++base.datos.sec.factura;
  base.datos.facturas.push({
    id, colaborador_id: colaboradorId, issuer_id: E.A, periodo: PERIODO, importe_esperado: null,
    subida_at: new Date(), numero_recepcion: `REC-2026-04-${String(id).padStart(4, '0')}`, importe, numero_factura: 'F-1',
    enviado_at: null, abierto_at: null, anulada_at: null, caduca_at: null, moneda: 'EUR',
  });
  return id;
}

let fichaGestora;
let externo;

beforeAll(() => {
  sembrar(base);
  externo = ++base.datos.sec.colaborador;
  base.datos.colaboradores.push({
    id: externo, nombre: 'Externo', email: 'externo@test.local', area: 'seo', tipo: 'colaborador', nif: null, notas: null,
    user_id: null, activo: true, alta_desde: null, baja_desde: null, created_at: new Date(), updated_at: new Date(),
  });
  base.datos.ce.push({ colaborador_id: externo, issuer_id: E.A, importe_acordado: null });
});

describe('la ficha de la vendedora (CRM-ISEIE#422)', () => {
  it('una gestora sin ficha no tiene «Mi factura»', async () => {
    expect((await request.get(`${API}/mias`).set(como('gestora'))).status).toBe(403);
  });

  it('un super admin no puede ser vendedora (las excepciones no tienen sección de factura), ni un colaborador', async () => {
    const r1 = await request.post(`${API}/colaboradores`).set(como('super')).send(ficha(U.super));
    expect(r1.status, JSON.stringify(r1.body)).toBe(400);
    expect(r1.body.error).toContain('gestora o una comercial');
    expect((await request.post(`${API}/colaboradores`).set(como('super')).send(ficha(U.colaborador))).status).toBe(400);
  });

  it('con su ficha, ella recibe «Subir su factura» por excepción, con su registro', async () => {
    const res = await request.post(`${API}/colaboradores`).set(como('adminA')).send(ficha(U.gestora));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    fichaGestora = res.body.data.id;
    expect(res.body.data.tipo).toBe('vendedora');
    expect(res.body.data.empresas[0]).toMatchObject({ issuer_id: E.A, modalidad: null, importe_acordado: null });
    expect(base.datos.overrides).toEqual([expect.objectContaining({ user_id: U.gestora, resource: 'facturas_colaborador', action: 'subir', allowed: true })]);
    expect(base.datos.permisos_registro).toEqual([expect.objectContaining({ usuario_id: U.gestora, quien_id: U.adminA, origen: 'ficha_vendedora' })]);
    expect((await request.get(`${API}/mias`).set(comoGestoraConFicha())).status).toBe(200);
  });

  it('una sola ficha de vendedora por persona', async () => {
    expect((await request.post(`${API}/colaboradores`).set(como('adminA')).send(ficha(U.gestora, { nombre: 'Otra' }))).status).toBe(409);
  });
});

describe('«Vendedoras / Colaboradores» en las listas y los totales', () => {
  let deLaVendedora;
  let delExterno;
  beforeAll(() => {
    deLaVendedora = recibida(fichaGestora, 300);
    delExterno = recibida(externo, 500);
  });

  it('la lista de fichas', async () => {
    const solo = async (tipo) => (await request.get(`${API}/colaboradores`).query({ tipo }).set(como('adminA'))).body.data.map((c) => c.id);
    expect(await solo('vendedora')).toEqual([fichaGestora]);
    expect(await solo('colaborador')).toEqual([externo]);
  });

  it('«Del mes», con sus totales', async () => {
    const mes = async (tipo) => (await request.get(`${API}/mes`).query({ periodo: '2026-04', issuerId: E.A, ...(tipo ? { tipo } : {}) }).set(como('adminA'))).body.data;
    const v = await mes('vendedora');
    expect(v.facturas.map((f) => f.id)).toEqual([deLaVendedora]);
    expect(v.facturas[0].tipo).toBe('vendedora');
    expect(v.resumen.importe_recibido).toBe(300);
    expect((await mes('colaborador')).facturas.map((f) => f.id)).toEqual([delExterno]);
    expect((await mes()).resumen.importe_recibido).toBe(800);
  });

  it('las pestañas', async () => {
    const r = await request.get(`${API}/facturas`).query({ vista: 'historial', tipo: 'vendedora' }).set(como('adminA'));
    expect(r.body.data.facturas.map((f) => f.id)).toEqual([deLaVendedora]);
    expect((await request.get(`${API}/facturas`).query({ vista: 'historial', tipo: 'gestora' }).set(como('adminA'))).status).toBe(400);
  });
});

describe('validar antes de pagar (Diego, 18/11)', () => {
  let id;
  const pagar = (ids) => request.post(`${API}/facturas/pagar`).set(como('adminA'))
    .field('ids', ids.join(',')).field('fecha', '2026-05-05').field('forma_pago', 'transferencia');
  const vista = async (v) => (await request.get(`${API}/facturas`).query({ vista: v, tipo: 'vendedora' }).set(como('adminA')))
    .body.data.facturas.map((f) => f.id);

  beforeAll(() => { id = base.datos.facturas.find((f) => f.colaborador_id === fichaGestora).id; });

  it('recibida y sin validar: «Por validar», no «Por pagar», y no se puede pagar', async () => {
    expect(await vista('por_validar')).toEqual([id]);
    expect(await vista('por_pagar')).toEqual([]);
    const res = await pagar([id]);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NO_VALIDADA');
  });

  it('una gestora no valida', async () => {
    expect((await request.post(`${API}/facturas/${id}/validar`).set(como('gestora'))).status).toBe(403);
  });

  it('la empresa la valida: pasa a «Por pagar», queda en el registro y ya se paga', async () => {
    const res = await request.post(`${API}/facturas/${id}/validar`).set(como('adminA'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(base.factura(id).validada_por).toBe(U.adminA);
    expect(base.registroDe(id).map((r) => r.evento)).toContain('validada');
    expect(await vista('por_validar')).toEqual([]);
    expect(await vista('por_pagar')).toEqual([id]);
    expect((await request.post(`${API}/facturas/${id}/validar`).set(como('adminA'))).status).toBe(409);
    expect((await pagar([id])).status).toBe(200);
    const mia = (await request.get(`${API}/mias`).set(comoGestoraConFicha())).body.data.find((f) => f.id === id);
    expect(mia).toMatchObject({ validada: true, pago: { pagada_at: '2026-05-05', forma_pago: 'transferencia' } });
  });
});

describe('los correos de la vendedora', () => {
  it('el concepto sugerido es el de una comercial', () => {
    expect(conceptoSugerido('otra', '2026-04-01', 'vendedora')).toBe('Servicios comerciales · abril 2026');
  });

  it('la factura devuelta lleva el motivo en el correo del enlace nuevo', () => {
    const f = { periodo: '2026-04-01', razon_social: 'ISEIE Innovation School SL', colaborador_nombre: 'Lucía', area: 'otra', tipo: 'vendedora', importe_esperado: null, caduca_at: null };
    const c = armarCorreoDelMes({ f, token: 'x'.repeat(43), nuevo: true, devuelta: 'El NIF no es el de la empresa' });
    expect(c.htmlContent).toContain('El NIF no es el de la empresa');
    expect(c.htmlContent).not.toContain('Importe acordado');
  });
});
