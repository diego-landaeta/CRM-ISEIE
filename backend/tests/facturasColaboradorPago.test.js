import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202, segunda parte) · «Marcar pagada», las pestañas,
 * el coste por campus y el ZIP del mes.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js).
 * Del «Añadido 01/10 (tarde)»: la fecha, la forma de pago y, si se quiere, el
 * justificante; una o varias a la vez; solo un admin; se puede deshacer con motivo;
 * todo al registro; y el aviso al colaborador, con los correos apagados salvo que se
 * enciendan. La carrera «anular y pagar a la vez» (un candado de fila de Postgres) la
 * mira MultiCRM contra la base de verdad.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));
// El disco del servidor (sin R2), simulado.
const enDisco = new Map();
vi.mock('../src/shared/services/localStorage.service.js', () => ({
  saveLocal: vi.fn(async (k, b) => { enDisco.set(k, b); return k; }),
  getLocal: vi.fn(async (k) => ({ buffer: enDisco.get(k) ?? Buffer.from(`%PDF-1.4 ${k}`), size: 8 })),
}));
vi.mock('../src/shared/utils/presignedUrl.js', () => ({
  generatePresignedUrl: vi.fn(async (key) => `https://r2.test/${key}?firmado`),
}));

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, E, P, U, como, montarApp, sembrar } = await import('./facturasColaborador.app.js');
const { sendEmail } = await import('../src/shared/services/brevo.service.js');
const { uploadToR2, getFromR2 } = await import('../src/shared/services/r2.service.js');
const request = supertest(await montarApp());

const PERIODO = '2026-05-01';
const PDF = Buffer.from('%PDF-1.4\n% justificante de prueba\n');
const F = {};
let recepcion = 0;

/** Una factura de mayo; `recibida` = ya subida (con su número de recepción). */
function factura(clave, empresa, { recibida = true, importe = 636 } = {}) {
  const c = ++base.datos.sec.colaborador;
  base.datos.colaboradores.push({
    id: c, nombre: clave, email: `${clave.toLowerCase()}@test.local`, area: 'seo', nif: null, notas: null,
    user_id: null, activo: true, alta_desde: null, baja_desde: null, created_at: new Date(), updated_at: new Date(),
  });
  base.datos.ce.push({ colaborador_id: c, issuer_id: empresa, importe_acordado: null });
  const id = ++base.datos.sec.factura;
  base.datos.facturas.push({
    id, colaborador_id: c, issuer_id: empresa, periodo: PERIODO, importe_esperado: null,
    subida_at: recibida ? new Date() : null, numero_recepcion: recibida ? `REC-2026-05-${String(++recepcion).padStart(4, '0')}` : null,
    importe: recibida ? importe : null, numero_factura: recibida ? `F-${clave}` : null,
    enviado_at: null, abierto_at: null, anulada_at: null, caduca_at: null,
  });
  F[clave] = id;
}

const pagar = (clave, campos, archivo = null) => {
  const r = request.post(`${API}/facturas/pagar`).set(como(clave));
  for (const [k, v] of Object.entries(campos)) r.field(k, v);
  if (archivo) r.attach('justificante', archivo, 'justificante transferencia.pdf');
  return r;
};
const fila = (id) => {
  const f = base.factura(id);
  return { pagada_at: f.pagada_at ?? null, pagada_por: f.pagada_por ?? null, forma_pago: f.forma_pago ?? null, justificante: f.justificante ?? null, referencia_pago: f.referencia_pago ?? null };
};
const registro = (id, evento) => base.registroDe(id).filter((r) => r.evento === evento);
const binario = (res, cb) => { const t = []; res.on('data', (c) => t.push(c)); res.on('end', () => cb(null, Buffer.concat(t))); };

beforeAll(() => {
  sembrar(base);
  factura('laura', E.A);
  factura('ana', E.A);
  factura('sinSubir', E.A, { recibida: false });
  factura('deB', E.B);
  factura('aviso', E.A);
});

afterAll(() => { delete process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS; });

describe('facturas de colaboradores (#202) · marcar pagada', () => {
  const datos = (ids) => ({ ids: ids.join(','), fecha: '2026-06-05', forma_pago: 'transferencia' });

  it('solo un admin: la gestora y el colaborador no pueden', async () => {
    expect((await pagar('gestora', datos([F.laura]))).status).toBe(403);
    expect((await pagar('colaborador', datos([F.laura]))).status).toBe(403);
    expect(fila(F.laura).pagada_at).toBeNull();
  });

  it('una o varias a la vez, con fecha, forma, referencia y justificante; todo al registro', async () => {
    uploadToR2.mockClear();
    const res = await pagar('adminA', { ...datos([F.laura, F.ana]), referencia_pago: 'TRF-0605' }, PDF);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    for (const id of [F.laura, F.ana]) {
      expect(fila(id)).toMatchObject({ pagada_at: '2026-06-05', pagada_por: U.adminA, forma_pago: 'transferencia', referencia_pago: 'TRF-0605' });
      const [r] = registro(id, 'pagada');
      expect(r.user_id).toBe(U.adminA);
      expect(r.detalle).toMatchObject({
        fecha: '2026-06-05', forma_pago: 'transferencia', referencia_pago: 'TRF-0605',
        justificante: 'justificante transferencia.pdf', importe: 636, junto_con: 2,
      });
    }
    // Un justificante para el pago entero, subido una vez.
    expect(uploadToR2).toHaveBeenCalledTimes(1);
    expect(fila(F.laura).justificante).toBe(fila(F.ana).justificante);
  });

  it('dos veces no: «Ya está pagada»', async () => {
    const res = await pagar('adminA', datos([F.laura]));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Ya está pagada');
    const dos = await pagar('adminA', datos([F.laura, F.ana]));
    expect(dos.status).toBe(409);
    expect(dos.body.error).toContain('Ya están pagadas');
  });

  it('solo se paga una factura recibida', async () => {
    const res = await pagar('adminA', datos([F.sinSubir]));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Solo se pagan facturas recibidas, y esta no lo está');
    expect(fila(F.sinSubir).pagada_at).toBeNull();
  });

  it('el admin de A no paga lo de B, ni junto a una suya', async () => {
    expect((await pagar('adminA', datos([F.deB]))).status).toBe(404);
    expect((await pagar('adminA', datos([F.deB, F.aviso]))).status).toBe(404);
    expect(fila(F.aviso).pagada_at).toBeNull();
  });

  it('lo que no vale se rechaza: fecha futura, forma inventada, archivo que no es PDF ni foto', async () => {
    const futura = await pagar('adminA', { ...datos([F.aviso]), fecha: '2099-01-01' });
    expect(futura.status).toBe(400);
    expect(JSON.stringify(futura.body)).toContain('posterior a hoy');
    expect((await pagar('adminA', { ...datos([F.aviso]), forma_pago: 'cheque' })).status).toBe(400);
    expect((await pagar('adminA', datos([F.aviso]), Buffer.from('hola, soy un texto'))).status).toBe(400);
    expect(fila(F.aviso).pagada_at).toBeNull();
  });

  it('el justificante, con enlace firmado; sin justificante, 404', async () => {
    const res = await request.get(`${API}/facturas/${F.laura}/justificante`).set(como('adminA'));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/^https:\/\/r2\.test\/facturas-colaborador\/pagos\/2026-06\//);
    expect((await request.get(`${API}/facturas/${F.sinSubir}/justificante`).set(como('adminA'))).status).toBe(404);
  });

  it('el admin de A no abre el justificante de B ni le deshace el pago', async () => {
    expect((await pagar('super', datos([F.deB]), PDF)).status).toBe(200);
    expect((await request.get(`${API}/facturas/${F.deB}/justificante`).set(como('adminA'))).status).toBe(404);
    expect((await request.post(`${API}/facturas/${F.deB}/deshacer-pago`).set(como('adminA')).send({ motivo: 'No es mía' })).status).toBe(404);
    expect(fila(F.deB).pagada_at).toBe('2026-06-05');
    // Se deja como estaba: por pagar (la usan las pestañas de abajo).
    expect((await request.post(`${API}/facturas/${F.deB}/deshacer-pago`).set(como('super')).send({ motivo: 'Era de prueba' })).status).toBe(200);
  });

  it('una pagada no se anula sin deshacer antes el pago', async () => {
    const res = await request.post(`${API}/facturas/${F.ana}/anular`).set(como('adminA')).send({ motivo: 'Se equivocó' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('deshaz el pago');
    expect(base.factura(F.ana).anulada_at).toBeFalsy();
  });

  it('se deshace con motivo: vuelve a «por pagar» y lo que había queda en el registro', async () => {
    expect((await request.post(`${API}/facturas/${F.ana}/deshacer-pago`).set(como('adminA')).send({})).status).toBe(400);
    const res = await request.post(`${API}/facturas/${F.ana}/deshacer-pago`).set(como('adminA')).send({ motivo: 'Era otra transferencia' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(fila(F.ana)).toMatchObject({ pagada_at: null, pagada_por: null, forma_pago: null, justificante: null, referencia_pago: null });
    const [r] = registro(F.ana, 'pago_deshecho');
    expect(r.detalle).toMatchObject({
      motivo: 'Era otra transferencia', antes: { fecha: '2026-06-05', forma_pago: 'transferencia', referencia_pago: 'TRF-0605' },
    });
    expect((await request.post(`${API}/facturas/${F.ana}/deshacer-pago`).set(como('adminA')).send({ motivo: 'otra vez' })).status).toBe(409);
  });

  it('el aviso al colaborador: encendido sale el de Diego, a él, con la marca de su empresa; apagado no sale', async () => {
    sendEmail.mockClear();
    process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS = 'true';
    try {
      expect((await pagar('adminA', datos([F.aviso]))).status).toBe(200);
      await vi.waitFor(() => expect(registro(F.aviso, 'aviso_pago')).toHaveLength(1));
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const correo = sendEmail.mock.calls[0][0];
      expect(correo.to).toEqual([{ email: 'aviso@test.local', name: 'aviso' }]);
      expect(correo.subject).toBe('Tu factura de mayo para Alfa está pagada · 636,00 € · transferencia del 05/06');
      // Sale por la cuenta y el remitente de un campus de su empresa (el que tiene «no contestar»).
      expect(correo.projectId).toBe(P.A);
      expect(correo.htmlContent).toContain('Campus Alfa');

      // Se deshace y se vuelve a pagar el mismo día (otra forma de pago): sale otro aviso, con otra clave.
      expect((await request.post(`${API}/facturas/${F.aviso}/deshacer-pago`).set(como('adminA')).send({ motivo: 'Era Bizum' })).status).toBe(200);
      expect((await pagar('adminA', { ...datos([F.aviso]), forma_pago: 'bizum' })).status).toBe(200);
      await vi.waitFor(() => expect(registro(F.aviso, 'aviso_pago')).toHaveLength(2));
      const [primero, segundo] = sendEmail.mock.calls.map((c) => c[0]);
      expect(segundo.subject).toContain('Bizum del 05/06');
      expect(segundo.clave).not.toBe(primero.clave);
    } finally { delete process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS; }

    // Apagados: no se llama a Brevo ni queda «aviso de pago» en el registro.
    sendEmail.mockClear();
    expect((await pagar('adminA', datos([F.ana]))).status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(sendEmail).not.toHaveBeenCalled();
    expect(registro(F.ana, 'aviso_pago')).toHaveLength(0);
  });
});

describe('facturas de colaboradores (#202) · Enviadas, Por pagar, Pagadas, Historial y coste por campus', () => {
  const vista = (clave, params) => request.get(`${API}/facturas`).query(params).set(como(clave));
  const ids = (res) => res.body.data.facturas.map((f) => f.id).sort((a, b) => a - b);
  const orden = (l) => [...l].sort((a, b) => a - b);

  beforeAll(() => {
    // Una recibida de A sin pagar, que además no cuadra, con dos líneas (una con campus).
    factura('porPagar', E.A, { importe: 500 });
    Object.assign(base.factura(F.porPagar), { cuadra: false, total: 480 });
    base.datos.lineas.push(
      { id: ++base.datos.sec.linea, factura_id: F.porPagar, orden: 1, concepto: 'Landing', project_id: P.A, horas: 10, tarifa: 30, importe: 300 },
      { id: ++base.datos.sec.linea, factura_id: F.porPagar, orden: 2, concepto: 'Soporte', project_id: null, horas: 5, tarifa: 30, importe: 150 },
    );
  });

  it('Por pagar: recibidas y sin pagar, de sus empresas, con el total pendiente', async () => {
    const res = await vista('adminA', { vista: 'por_pagar', periodo: '2026-05' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(ids(res)).toEqual([F.porPagar]);
    expect(res.body.data.resumen).toMatchObject({ total: 1, pendiente: 500 });
    expect(ids(await vista('super', { vista: 'por_pagar', periodo: '2026-05' }))).toEqual(orden([F.deB, F.porPagar]));
  });

  it('Pagadas, Enviadas e Historial', async () => {
    expect(ids(await vista('adminA', { vista: 'pagadas', periodo: '2026-05' }))).toEqual(orden([F.laura, F.ana, F.aviso]));
    expect(ids(await vista('adminA', { vista: 'enviadas', periodo: '2026-05' }))).toEqual(orden([F.laura, F.ana, F.aviso, F.porPagar]));
    // El historial lo lleva todo, también la que aún no ha llegado.
    expect(ids(await vista('adminA', { vista: 'historial', periodo: '2026-05' })))
      .toEqual(orden([F.laura, F.ana, F.sinSubir, F.aviso, F.porPagar]));
  });

  it('se filtra por colaborador y por estado («No cuadra» es de la factura)', async () => {
    const colaborador = base.factura(F.ana).colaborador_id;
    expect(ids(await vista('adminA', { vista: 'historial', colaboradorId: colaborador }))).toEqual([F.ana]);
    expect(ids(await vista('adminA', { vista: 'historial', periodo: '2026-05', estado: 'no_cuadra' }))).toEqual([F.porPagar]);
  });

  it('el admin de A no pide la lista de B; una pestaña inventada da 400', async () => {
    expect((await vista('adminA', { vista: 'pagadas', issuerId: E.B })).status).toBe(403);
    expect((await vista('adminA', { vista: 'todas' })).status).toBe(400);
    expect((await vista('gestora', { vista: 'pagadas' })).status).toBe(403);
  });

  it('el desglose de una factura, para administración: sus líneas con el campus y lo que calculó el CRM', async () => {
    const res = await request.get(`${API}/facturas/${F.porPagar}/desglose`).set(como('adminA'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ importe: 500, total: 480, cuadra: false });
    expect(res.body.data.lineas).toEqual([
      expect.objectContaining({ orden: 1, concepto: 'Landing', campus: 'Campus Alfa', horas: 10, tarifa: 30, importe: 300 }),
      expect.objectContaining({ orden: 2, concepto: 'Soporte', campus: null, horas: 5, importe: 150 }),
    ]);
    // Sin desglose (subida sin modalidad): sin líneas y sin «cuadra».
    expect((await request.get(`${API}/facturas/${F.laura}/desglose`).set(como('adminA'))).body.data).toMatchObject({ lineas: [], cuadra: null });
    expect((await request.get(`${API}/facturas/${F.deB}/desglose`).set(como('adminA'))).status).toBe(404);
    expect((await request.get(`${API}/facturas/${F.porPagar}/desglose`).set(como('gestora'))).status).toBe(403);
  });

  it('coste por campus: horas y base de las líneas del mes, juntas las que no tienen campus', async () => {
    const res = await request.get(`${API}/coste-por-campus`).query({ periodo: '2026-05' }).set(como('adminA'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.campus.find((c) => c.project_id === P.A)).toMatchObject({ campus: 'Campus Alfa', horas: 10, importe: 300, facturas: 1 });
    expect(res.body.data.campus.find((c) => c.project_id === null)).toMatchObject({ horas: 5, importe: 150 });
  });

  it('con todas las empresas, lo que no lleva campus no se suma entre empresas (Diego, 10/10: «son por EMPRESA»)', async () => {
    base.datos.lineas.push({ id: ++base.datos.sec.linea, factura_id: F.deB, orden: 1, concepto: 'Soporte', project_id: null, horas: 2, tarifa: 30, importe: 60 });
    const res = await request.get(`${API}/coste-por-campus`).query({ periodo: '2026-05' }).set(como('super'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const sinCampus = res.body.data.campus.filter((c) => c.project_id === null);
    expect(sinCampus.map((c) => [c.issuer_id, c.empresa, c.importe])).toEqual([
      [E.A, 'Alfa Formación SL', 150], [E.B, 'Beta Consultoría SL', 60],
    ]);
  });

  it('con desglose, la diferencia es la de su base: lo acordado es la base, no el total con IVA e IRPF', async () => {
    const recibido = async () => (await request.get(`${API}/mes`).query({ periodo: '2026-05', issuerId: E.A })
      .set(como('adminA'))).body.data.resumen.importe_recibido;
    const antes = await recibido();
    Object.assign(base.factura(F.porPagar), { base: 450, importe_esperado: 450 });
    const f = (await vista('adminA', { vista: 'por_pagar', periodo: '2026-05' })).body.data.facturas.find((x) => x.id === F.porPagar);
    // Importe 500 (el total de su factura), base 450 y 450 acordados: diferencia 0.
    expect(Number(f.diferencia)).toBe(0);
    // Y la cabecera de «Del mes» cuenta su base, no su total: 50 menos.
    expect(Math.round((antes - await recibido()) * 100) / 100).toBe(50);
    Object.assign(base.factura(F.porPagar), { base: null, importe_esperado: null });
  });

  it('el coste por campus sigue el filtro de empresa; un admin no pide el de otra', async () => {
    const deB = await request.get(`${API}/coste-por-campus`).query({ periodo: '2026-05', issuerId: E.B }).set(como('super'));
    expect(deB.status).toBe(200);
    expect(deB.body.data.campus.find((c) => c.project_id === P.A)).toBeUndefined();
    expect((await request.get(`${API}/coste-por-campus`).query({ periodo: '2026-05', issuerId: E.B }).set(como('adminA'))).status).toBe(403);
  });
});

describe('facturas de colaboradores (#202) · el ZIP del mes', () => {
  const nombre = (clave) => `2026-05_Alfa_${clave}_F-${clave}.pdf`;

  beforeAll(async () => {
    // ExcelJS y JSZip se cargan al pedir el ZIP (no al arrancar): la primera carga, en
    // frío, puede tardar más que el tope de una prueba. Se cargan aquí, con su tiempo.
    await Promise.all([import('exceljs'), import('jszip')]);
    getFromR2.mockImplementation(async (key) => ({
      body: { transformToByteArray: async () => new TextEncoder().encode(`%PDF-1.4 ${key}`) },
    }));
    for (const clave of ['laura', 'porPagar']) {
      Object.assign(base.factura(F[clave]), {
        archivo_key: `facturas-colaborador/2026-05/${F[clave]}-abc/${nombre(clave)}`, importe_esperado: 600,
      });
    }
  }, 120_000);

  it('las recibidas de la empresa, con su nombre, y el resumen con las columnas de la definición', async () => {
    const res = await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.A })
      .set(como('adminA')).buffer(true).parse(binario);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="facturas-colaboradores_2026-05_Alfa.zip"; filename*=UTF-8\'\'facturas-colaboradores_2026-05_Alfa.zip');

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(res.body);
    expect(Object.keys(zip.files).sort()).toEqual([nombre('laura'), nombre('porPagar'), 'resumen.xlsx'].sort());
    expect(await zip.file(nombre('laura')).async('string')).toContain(`%PDF-1.4 facturas-colaborador/2026-05/${F.laura}`);

    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await zip.file('resumen.xlsx').async('nodebuffer'));
    const hoja = libro.getWorksheet('Resumen');
    expect(hoja.getRow(1).values.slice(1)).toEqual([
      'Colaborador', 'Área', 'NIF', 'Número de factura', 'Importe', 'Acordado', 'Diferencia', 'Fecha de subida', 'Número de recepción',
    ]);
    const deLaura = [2, 3].map((n) => hoja.getRow(n).values.slice(1)).find((f) => f[0] === 'laura');
    expect(deLaura.slice(0, 7)).toEqual(['laura', 'SEO', '', 'F-laura', 636, 600, 36]);
    expect(deLaura[7]).toBeInstanceOf(Date);
    expect(deLaura[8]).toMatch(/^REC-2026-05-/);
  });

  it('la fecha de subida, en hora de Madrid; y dos con el mismo nombre no se pisan', async () => {
    // 10:44 UTC de un día de verano son las 12:44 en Madrid.
    base.factura(F.laura).subida_at = new Date('2026-06-01T10:44:00Z');
    base.factura(F.porPagar).archivo_key = `facturas-colaborador/2026-05/otra-carpeta/${nombre('laura')}`;
    const res = await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.A }).set(como('adminA')).buffer(true).parse(binario);
    expect(res.status).toBe(200);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(res.body);
    const pdfs = Object.keys(zip.files).filter((n) => n.endsWith('.pdf'));
    expect(pdfs).toHaveLength(2);
    expect(pdfs.some((n) => /_REC-2026-05-\d+\.pdf$/.test(n)), pdfs.join(' · ')).toBe(true);

    const { default: ExcelJS } = await import('exceljs');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await zip.file('resumen.xlsx').async('nodebuffer'));
    const deLaura = [2, 3].map((n) => libro.getWorksheet('Resumen').getRow(n).values.slice(1)).find((r) => r[0] === 'laura');
    expect(deLaura[7].toISOString()).toBe('2026-06-01T12:44:00.000Z');
    expect(zip.file(nombre('laura')).date.toISOString()).toBe('2026-06-01T12:44:00.000Z');
  });

  it('una razón social con «’» o «Ł» no rompe la descarga', async () => {
    const e = base.datos.issuers.find((x) => x.id === E.A);
    const antes = e.razon_social;
    e.razon_social = 'L’Łódź Empresa';
    try {
      const res = await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.A }).set(como('adminA')).buffer(true).parse(binario);
      expect(res.status).toBe(200);
      const nombreZip = 'facturas-colaboradores_2026-05_L’Łódź.zip';
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="${nombreZip.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nombreZip)}`);
    } finally { e.razon_social = antes; }
  });

  it('un admin, solo de sus empresas; sin recibidas, 404; la gestora, 403', async () => {
    expect((await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.B }).set(como('adminA'))).status).toBe(403);
    const vacio = await request.get(`${API}/zip`).query({ periodo: '2026-04', issuerId: E.A }).set(como('adminA'));
    expect(vacio.status).toBe(404);
    expect(vacio.body.error).toContain('No hay facturas recibidas de abril de 2026');
    expect((await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.A }).set(como('gestora'))).status).toBe(403);
  });
});

describe('facturas de colaboradores (#202) · el justificante y el ZIP, en el disco del servidor', () => {
  const sinR2 = () => {
    const antes = { ...process.env };
    delete process.env.CLOUDFLARE_R2_ACCOUNT_ID; delete process.env.CLOUDFLARE_R2_ACCESS_KEY; delete process.env.CLOUDFLARE_R2_BUCKET;
    return () => Object.assign(process.env, {
      CLOUDFLARE_R2_ACCOUNT_ID: antes.CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY: antes.CLOUDFLARE_R2_ACCESS_KEY,
      CLOUDFLARE_R2_BUCKET: antes.CLOUDFLARE_R2_BUCKET,
    });
  };

  it('el justificante se guarda en el disco y se abre con su enlace, que no abre la factura (ni al revés)', async () => {
    factura('enDisco', E.A);
    const volver = sinR2();
    try {
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      const res = await pagar('adminA', { ids: String(F.enDisco), fecha: '2026-06-05', forma_pago: 'bizum' }, jpg);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(fila(F.enDisco).justificante).toMatch(/^local:facturas-colaborador\/pagos\/2026-06\/.+\.jpg$/);

      const { url } = (await request.get(`${API}/facturas/${F.enDisco}/justificante`).set(como('adminA'))).body.data;
      expect(url).toMatch(new RegExp(`^/facturas-colaborador/justificante-local/${F.enDisco}\\?exp=\\d+&sig=`));
      const bajada = await request.get(`/api${url}`).buffer(true).parse(binario);
      expect(bajada.status).toBe(200);
      expect(bajada.headers['content-type']).toBe('image/jpeg');
      expect(Buffer.from(bajada.body).equals(jpg)).toBe(true);

      // La firma del justificante no abre la factura, ni la de la factura el justificante.
      const firma = url.split('?')[1];
      expect((await request.get(`${API}/archivo-local/${F.enDisco}?${firma}`)).status).toBe(403);
      expect((await request.get(`${API}/justificante-local/${F.enDisco}?exp=9999999999&sig=inventada`)).status).toBe(403);
    } finally { volver(); }
  });

  it('el ZIP lee también las facturas guardadas en el disco', async () => {
    base.factura(F.enDisco).archivo_key = 'local:facturas-colaborador/2026-05/x/2026-05_En-disco.pdf';
    const res = await request.get(`${API}/zip`).query({ periodo: '2026-05', issuerId: E.A }).set(como('adminA')).buffer(true).parse(binario);
    expect(res.status).toBe(200);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(res.body);
    expect(await zip.file('2026-05_En-disco.pdf').async('string')).toContain('%PDF-1.4 facturas-colaborador/2026-05/x/2026-05_En-disco.pdf');
  });
});

describe('facturas de colaboradores (#202) · el aviso de pago, si se deshace antes de que salga', () => {
  const datos = (ids) => ({ ids: ids.join(','), fecha: '2026-06-05', forma_pago: 'transferencia' });

  it('pagadas dos a la vez: si la segunda se deshace mientras sale el aviso de la primera, el de la segunda no sale', async () => {
    factura('avisoPrimera', E.A);
    factura('avisoSegunda', E.A);
    let seguir;
    const esperar = new Promise((r) => { seguir = r; });
    sendEmail.mockClear();
    // El primer aviso se queda «en Brevo» hasta que se deshaga el pago de la segunda.
    sendEmail.mockImplementationOnce(async () => { await esperar; return { sent: true }; });
    process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS = 'true';
    try {
      expect((await pagar('adminA', datos([F.avisoPrimera, F.avisoSegunda]))).status).toBe(200);
      await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1));
      expect((await request.post(`${API}/facturas/${F.avisoSegunda}/deshacer-pago`).set(como('adminA'))
        .send({ motivo: 'Se pagó por error' })).status).toBe(200);
      seguir();
      await vi.waitFor(() => expect(registro(F.avisoPrimera, 'aviso_pago')).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 200));
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect(registro(F.avisoSegunda, 'aviso_pago')).toHaveLength(0);
    } finally { delete process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS; }
  });
});
