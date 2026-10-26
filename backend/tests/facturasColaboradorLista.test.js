import { describe, it, expect, vi, beforeAll } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202) · la lista de colaboradores.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js)
 * en vez de Postgres. Dos empresas (A y B), un campus de cada una y una persona de
 * cada rol. El admin de A solo ve a quien factura a A, y de él solo lo de A; el super
 * admin lo ve todo; gestora y colaborador no entran. Son POR EMPRESA (Diego, 10/10),
 * y la empresa de cada campus es `projects.sociedad_emisora_id`.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));

const { base } = await import('./facturasColaborador.base.js');
const { API, E, U, como, montarApp, sembrar } = await import('./facturasColaborador.app.js');
const request = supertest(await montarApp());

const alta = (clave, body) => request.post(`${API}/colaboradores`).set(como(clave)).send(body);

beforeAll(() => sembrar(base));

describe('facturas de colaboradores (#202) · quién entra', () => {
  it('una gestora no ve la lista', async () => {
    expect((await request.get(`${API}/colaboradores`).set(como('gestora'))).status).toBe(403);
  });

  it('un colaborador no ve la lista de administración', async () => {
    expect((await request.get(`${API}/colaboradores`).set(como('colaborador'))).status).toBe(403);
  });

  it('sin sesión, 401', async () => {
    expect((await request.get(`${API}/colaboradores`)).status).toBe(401);
  });
});

describe('facturas de colaboradores (#202) · la lista', () => {
  let laura;   // factura a A y a B
  let pedro;   // solo a B

  it('el super admin da de alta a quien factura a dos empresas, y queda en el registro', async () => {
    const res = await alta('super', {
      nombre: 'Laura Pérez', email: ' Laura@Prueba.LOCAL ', area: 'seo',
      empresas: [{ issuer_id: E.A, importe_acordado: 600 }, { issuer_id: E.B, importe_acordado: 300 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    laura = res.body.data;
    expect(laura.email).toBe('laura@prueba.local');
    expect(laura.empresas.map((e) => e.issuer_id).sort()).toEqual([E.A, E.B]);

    const reg = base.datos.registro.filter((r) => r.colaborador_id === laura.id).map((r) => ({ evento: r.evento, user_id: r.user_id }));
    expect(reg).toEqual([{ evento: 'alta', user_id: U.super }]);
  });

  it('sin ninguna empresa no se puede dar de alta', async () => {
    expect((await alta('super', { nombre: 'Sin empresa', email: 'sin@prueba.local', area: 'seo', empresas: [] })).status).toBe(400);
  });

  it('el admin de A ve a Laura, pero de sus empresas solo A', async () => {
    const res = await request.get(`${API}/colaboradores`).set(como('adminA'));
    expect(res.status).toBe(200);
    const ella = res.body.data.find((c) => c.id === laura.id);
    expect(ella.empresas.map((e) => e.issuer_id)).toEqual([E.A]);
    // Y se le avisa antes: también factura a una empresa que este admin no lleva.
    expect(ella.compartido).toBe(true);
    const comoSuper = (await request.get(`${API}/colaboradores/${laura.id}`).set(como('super'))).body.data;
    expect(comoSuper.compartido).toBe(false);
  });

  it('las empresas que puede elegir cada uno: el admin, las de sus campus; el super admin, todas', async () => {
    const delAdmin = await request.get(`${API}/empresas`).set(como('adminA'));
    expect(delAdmin.body.data.map((e) => e.id)).toEqual([E.A]);
    const delSuper = await request.get(`${API}/empresas`).set(como('super'));
    expect(delSuper.body.data.map((e) => e.id)).toEqual([E.A, E.B]);
    expect((await request.get(`${API}/empresas`).set(como('gestora'))).status).toBe(403);
  });

  it('el admin de A no puede dar de alta a nadie en la empresa B', async () => {
    const res = await alta('adminA', { nombre: 'Pedro', email: 'pedro@prueba.local', area: 'desarrollo', empresas: [{ issuer_id: E.B }] });
    expect(res.status).toBe(403);
  });

  it('el admin de A no ve a quien solo factura a B, ni por su id', async () => {
    const res = await alta('super', { nombre: 'Pedro', email: 'pedro@prueba.local', area: 'desarrollo', empresas: [{ issuer_id: E.B }] });
    expect(res.status).toBe(201);
    pedro = res.body.data;

    const lista = await request.get(`${API}/colaboradores`).set(como('adminA'));
    expect(lista.body.data.some((c) => c.id === pedro.id)).toBe(false);
    expect((await request.get(`${API}/colaboradores/${pedro.id}`).set(como('adminA'))).status).toBe(404);
    expect((await request.patch(`${API}/colaboradores/${pedro.id}`).set(como('adminA')).send({ notas: 'x' })).status).toBe(404);
    expect((await request.get(`${API}/colaboradores?issuerId=${E.B}`).set(como('adminA'))).status).toBe(403);
  });

  it('con una empresa elegida, solo quienes le facturan (Diego, 10/10: «son por EMPRESA»)', async () => {
    const deB = await request.get(`${API}/colaboradores?issuerId=${E.B}`).set(como('super'));
    expect(deB.status).toBe(200);
    expect(deB.body.data.map((c) => c.id)).toContain(pedro.id);
    expect(deB.body.data.every((c) => c.empresas.some((e) => e.issuer_id === E.B))).toBe(true);
    const deA = await request.get(`${API}/colaboradores?issuerId=${E.A}`).set(como('super'));
    expect(deA.body.data.some((c) => c.id === pedro.id)).toBe(false);
  });

  it('si el admin de A cambia las empresas de Laura, la B se queda como estaba', async () => {
    const res = await request.patch(`${API}/colaboradores/${laura.id}`).set(como('adminA'))
      .send({ empresas: [{ issuer_id: E.A, importe_acordado: 650 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const filas = base.datos.ce.filter((x) => x.colaborador_id === laura.id)
      .map((x) => ({ issuer_id: x.issuer_id, importe: Number(x.importe_acordado) })).sort((a, b) => a.issuer_id - b.issuer_id);
    expect(filas).toEqual([{ issuer_id: E.A, importe: 650 }, { issuer_id: E.B, importe: 300 }]);

    const cambio = base.datos.registro.find((r) => r.colaborador_id === laura.id && r.evento === 'cambio');
    // Solo la de A (la B no es suya). Desde la segunda parte lleva también cómo cobra.
    expect(cambio.detalle.empresas.despues).toMatchObject([{ issuer_id: E.A, importe_acordado: 650 }]);
  });

  it('nadie se queda sin empresa: quitarle la única da error, y no se queda a medias', async () => {
    const solo = await alta('adminA', { nombre: 'Ana', email: 'ana@prueba.local', area: 'contenido', empresas: [{ issuer_id: E.A }] });
    expect(solo.status).toBe(201);
    const res = await request.patch(`${API}/colaboradores/${solo.body.data.id}`).set(como('adminA')).send({ empresas: [] });
    expect(res.status).toBe(400);
    expect(base.datos.ce.filter((x) => x.colaborador_id === solo.body.data.id)).toHaveLength(1);
  });

  it('Laura factura también a B: el admin de A no cambia sus datos ni la da de baja', async () => {
    const correo = await request.patch(`${API}/colaboradores/${laura.id}`).set(como('adminA')).send({ email: 'otra@prueba.local' });
    expect(correo.status).toBe(403);
    expect(correo.body.error).toMatch(/los cambia el super admin/);
    expect((await request.post(`${API}/colaboradores/${laura.id}/baja`).set(como('adminA')).send({ desde: '2026-11' })).status).toBe(403);

    // La pantalla manda la ficha entera: si los datos llegan igual, solo cambia lo de su empresa.
    const ficha = await request.patch(`${API}/colaboradores/${laura.id}`).set(como('adminA')).send({
      nombre: laura.nombre, email: laura.email, area: 'seo', empresas: [{ issuer_id: E.A, importe_acordado: 660 }],
    });
    expect(ficha.status, JSON.stringify(ficha.body)).toBe(200);
    expect(base.colaborador(laura.id).email).toBe('laura@prueba.local');
  });

  it('el usuario del CRM que se le pone tiene que tener el rol colaborador', async () => {
    const mal = await request.patch(`${API}/colaboradores/${laura.id}`).set(como('super')).send({ user_id: U.gestora });
    expect(mal.status).toBe(400);
    // Colaborador solo como rol añadido tampoco: el servidor le daría 403 en «Mi factura».
    base.datos.users.find((u) => u.id === U.gestora).roles_extra = ['colaborador'];
    expect((await request.patch(`${API}/colaboradores/${laura.id}`).set(como('super')).send({ user_id: U.gestora })).status).toBe(400);
    const bien = await request.patch(`${API}/colaboradores/${laura.id}`).set(como('super')).send({ user_id: U.colaborador });
    expect(bien.status, JSON.stringify(bien.body)).toBe(200);
    expect(bien.body.data.user_id).toBe(U.colaborador);
  });

  it('una baja para un mes que no ha llegado no lo quita todavía; no se repite, y se puede volver', async () => {
    const res = await request.post(`${API}/colaboradores/${laura.id}/baja`).set(como('super')).send({ desde: '2099-01' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ activo: true, baja_desde: '2099-01' });

    expect((await request.post(`${API}/colaboradores/${laura.id}/baja`).set(como('super')).send({ desde: '2099-02' })).status).toBe(409);

    const vuelve = await request.post(`${API}/colaboradores/${laura.id}/alta`).set(como('super')).send({ desde: '2026-12' });
    expect(vuelve.status, JSON.stringify(vuelve.body)).toBe(200);
    expect(vuelve.body.data).toMatchObject({ activo: true, baja_desde: null, alta_desde: '2026-12' });

    // Y una baja desde un mes ya pasado, sí, en el acto.
    const ya = await request.post(`${API}/colaboradores/${laura.id}/baja`).set(como('super')).send({ desde: '2026-01' });
    expect(ya.body.data.activo).toBe(false);
  });

  it('el historial, al admin de A, sin lo acordado con la empresa B', async () => {
    const deLaFicha = (filas) => filas.filter((r) => ['alta', 'baja', 'cambio'].includes(r.evento));
    const ficha = deLaFicha((await request.get(`${API}/colaboradores/${laura.id}/registro`).set(como('adminA'))).body.data);
    expect(ficha.map((r) => r.evento)).toEqual(['baja', 'alta', 'baja', 'cambio', 'cambio', 'cambio', 'alta']);
    expect(ficha[ficha.length - 1].detalle.empresas.map((e) => e.issuer_id)).toEqual([E.A]);

    const todo = deLaFicha((await request.get(`${API}/colaboradores/${laura.id}/registro`).set(como('super'))).body.data);
    expect(todo[todo.length - 1].detalle.empresas.map((e) => e.issuer_id).sort()).toEqual([E.A, E.B]);
  });

  it('la búsqueda con «%» o «_» busca ese carácter, no cualquier cosa', async () => {
    await alta('super', { nombre: 'SEO 100% local', email: 'cien@prueba.local', area: 'seo', empresas: [{ issuer_id: E.A }] });
    const res = await request.get(`${API}/colaboradores?estado=todos&q=${encodeURIComponent('%')}`).set(como('super'));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.nombre)).toEqual(['SEO 100% local']);
  });
});

// Segunda parte (#202, «Añadido 01/10 (tarde)»): cómo cobra de cada empresa.
describe('facturas de colaboradores (#202) · cómo cobra cada uno', () => {
  const ficha = (nombre, empresas) => ({
    nombre, email: `${nombre.toLowerCase().replace(/\W/g, '')}@test.local`, area: 'seo', alta_desde: '2030-01', empresas,
  });

  it('fijo, por hora y por proyecto, con su IVA e IRPF', async () => {
    const res = await alta('super', ficha('Modalidades', [
      { issuer_id: E.A, modalidad: 'fijo', importe_fijo: 600, iva_pct: 21, irpf_pct: 15 },
      { issuer_id: E.B, modalidad: 'hora', tarifa_hora: 22, iva_pct: 0, irpf_pct: 0 },
    ]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [a, b] = [E.A, E.B].map((i) => res.body.data.empresas.find((e) => e.issuer_id === i));
    expect(a).toMatchObject({ modalidad: 'fijo', importe_fijo: 600, tarifa_hora: null, iva_pct: 21, irpf_pct: 15 });
    // El 0 vale: «0 % si factura desde fuera».
    expect(b).toMatchObject({ modalidad: 'hora', tarifa_hora: 22, importe_fijo: null, iva_pct: 0, irpf_pct: 0 });
  });

  it('con modalidad, sin IVA o IRPF, o sin su importe o tarifa, no se guarda', async () => {
    const casos = [
      [{ modalidad: 'fijo', importe_fijo: 600, irpf_pct: 15 }, 'IVA'],
      [{ modalidad: 'fijo', importe_fijo: 600, iva_pct: 21 }, 'IRPF'],
      [{ modalidad: 'fijo', iva_pct: 21, irpf_pct: 15 }, 'importe fijo'],
      [{ modalidad: 'hora', iva_pct: 21, irpf_pct: 15 }, 'tarifa'],
      [{ modalidad: 'proyecto', iva_pct: 21, irpf_pct: 15 }, 'tarifa'],
      [{ modalidad: 'mensual', iva_pct: 21, irpf_pct: 15 }, 'Modalidad'],
      [{ modalidad: 'hora', tarifa_hora: 22, iva_pct: 121, irpf_pct: 15 }, 'porcentaje'],
    ];
    for (const [cobra, texto] of casos) {
      const res = await alta('super', ficha('Mal', [{ issuer_id: E.A, ...cobra }]));
      expect(res.status, JSON.stringify(cobra)).toBe(400);
      expect(JSON.stringify(res.body), JSON.stringify(cobra)).toContain(texto);
    }
  });

  it('solo se guarda lo de su modalidad, y sin modalidad nada (como en la primera parte)', async () => {
    const res = await alta('super', ficha('Limpia', [
      { issuer_id: E.A, modalidad: 'proyecto', importe_fijo: 999, tarifa_hora: 30, iva_pct: 21, irpf_pct: 15 },
      { issuer_id: E.B, importe_acordado: 250, importe_fijo: 999, iva_pct: 21 },
    ]));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [a, b] = [E.A, E.B].map((i) => res.body.data.empresas.find((e) => e.issuer_id === i));
    expect(a).toMatchObject({ modalidad: 'proyecto', tarifa_hora: 30, importe_fijo: null });
    expect(b).toMatchObject({ modalidad: null, importe_fijo: null, tarifa_hora: null, iva_pct: null, irpf_pct: null, importe_acordado: 250 });
  });

  it('el admin cambia cómo cobra de su empresa, aunque también facture a otra, y queda en el historial', async () => {
    const c = (await alta('super', ficha('Compartida', [
      { issuer_id: E.A, modalidad: 'hora', tarifa_hora: 20, iva_pct: 21, irpf_pct: 15 },
      { issuer_id: E.B, modalidad: 'fijo', importe_fijo: 300, iva_pct: 21, irpf_pct: 15 },
    ]))).body.data;
    const res = await request.patch(`${API}/colaboradores/${c.id}`).set(como('adminA')).send({
      empresas: [{ issuer_id: E.A, modalidad: 'hora', tarifa_hora: 25, iva_pct: 21, irpf_pct: 15 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // La de B, que no es suya, sigue igual.
    const todas = (await request.get(`${API}/colaboradores/${c.id}`).set(como('super'))).body.data.empresas;
    expect(todas.find((e) => e.issuer_id === E.A).tarifa_hora).toBe(25);
    expect(todas.find((e) => e.issuer_id === E.B)).toMatchObject({ modalidad: 'fijo', importe_fijo: 300 });

    const reg = (await request.get(`${API}/colaboradores/${c.id}/registro`).set(como('adminA'))).body.data;
    const cambio = reg.find((l) => l.evento === 'cambio');
    expect(cambio.detalle.empresas.antes[0].tarifa_hora).toBe(20);
    expect(cambio.detalle.empresas.despues[0].tarifa_hora).toBe(25);
  });
});

describe('facturas de colaboradores (#202) · el ámbito sale de los campus (ISEIE)', () => {
  it('«las empresas de sus campus» es `projects.sociedad_emisora_id` de sus `user_projects` activos', async () => {
    await request.get(`${API}/colaboradores`).set(como('adminA'));
    const { consultas } = await import('./facturasColaborador.base.js');
    const ambito = consultas.find((c) => c.sql.includes('FROM user_projects up'));
    expect(ambito.sql).toMatch(/up\.active = true/);
    expect(ambito.sql).toMatch(/p\.sociedad_emisora_id/);
    expect(ambito.params).toEqual([U.adminA]);
  });

  it('un admin sin campus no ve ninguna empresa (lista vacía, nunca «todas»)', async () => {
    base.persona(30, { nombre: 'Admin sin campus', role: 'admin' });
    (await import('./helpers/permisosSinBase.js')).registrar({ userId: 30, role: 'admin' });
    const { default: jwt } = await import('jsonwebtoken');
    const t = jwt.sign({ userId: 30, role: 'admin', roles_extra: [], customRoleId: null }, process.env.JWT_SECRET);
    const r = await request.get(`${API}/colaboradores`).set({ Authorization: `Bearer ${t}` });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect((await request.get(`${API}/empresas`).set({ Authorization: `Bearer ${t}` })).body.data).toEqual([]);
  });
});
