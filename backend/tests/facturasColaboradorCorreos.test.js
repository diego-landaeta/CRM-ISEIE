import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202) · los correos.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js).
 * Ficha de Diego (07/10): con FACTURAS_COLABORADOR_CORREOS_ACTIVOS apagado, `sendEmail`
 * no se llama nunca; encendido (con `sendEmail` simulado), sale el correo correcto a la
 * persona correcta. En ISEIE, además: la plantilla común (`P.correo`) con la marca de
 * la empresa, y la de ISEIE si la empresa no tiene un campus activo con la suya.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
// Nada sale de verdad: Brevo y R2, simulados.
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, como, montarApp, sembrar, PDF, enlaceDelCorreo } = await import('./facturasColaborador.app.js');
const { sendEmail } = await import('../src/shared/services/brevo.service.js');
const { prepararYMandar, recordar, huella } = await import('../src/modules/facturas-colaborador/facturas.service.js');
const { runFacturasColaborador, enMadrid } = await import('../src/jobs/facturasColaboradorJob.js');
const request = supertest(await montarApp());

const PERIODO = '2026-07-01';
const EMPRESA = 3;          // con un campus con su logo y su remitente «no contestar»
const CAMPUS = 30;
const SIN_CAMPUS = 4;       // sin ningún campus activo: los correos salen con la marca de ISEIE
const laura = { nombre: 'Laura Gómez', email: 'laura@test.local' };
const marta = { nombre: 'Marta Ruiz', email: 'marta@test.local' };

const correosA = (email) => sendEmail.mock.calls.map((c) => c[0]).filter((c) => c.to[0].email === email);
const encender = () => { process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS = 'true'; };
const apagar = () => { delete process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS; };

function colaborador(persona, empresa, area) {
  const id = ++base.datos.sec.colaborador;
  base.datos.colaboradores.push({
    id, ...persona, area, nif: null, notas: null, user_id: null, activo: true,
    alta_desde: '2026-07-01', baja_desde: '2026-08-01', created_at: new Date(), updated_at: new Date(),
  });
  base.datos.ce.push({ colaborador_id: id, issuer_id: empresa, importe_acordado: 600 });
  return id;
}

beforeAll(() => {
  apagar();
  sembrar(base);
  base.empresa(EMPRESA, 'Gamma Formación, S.L.', { direccion: 'Calle Mayor, 1' });
  base.campus(CAMPUS, 'Campus Gamma', EMPRESA, { logo_url: 'https://logo.prueba/marca.png', remitente_no_contestar: 'noresponder@gamma.prueba' });
  base.empresa(SIN_CAMPUS, 'Delta Servicios SL');
  laura.id = colaborador(laura, EMPRESA, 'desarrollo');
  marta.id = colaborador(marta, SIN_CAMPUS, 'seo');
});

afterEach(() => apagar());
afterAll(() => apagar());

const fila = (colaboradorId = laura.id) => base.datos.facturas.find((f) => f.colaborador_id === colaboradorId
  && f.periodo === PERIODO && !f.anulada_at);

describe('facturas de colaboradores (#202) · correos apagados (por defecto)', () => {
  it('se prepara el mes, pero no se llama a Brevo y queda «sin enviar»', async () => {
    sendEmail.mockClear();
    await prepararYMandar(PERIODO);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fila().enviado_at).toBeNull();
    const reenviar = await request.post(`${API}/facturas/${fila().id}/reenviar`).set(como('super'));
    expect(reenviar.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('el recordatorio no se manda, ni cambia el enlace', async () => {
    const antes = fila().token_hash;
    expect((await recordar(PERIODO)).recordados).toBe(0);
    expect(fila().token_hash).toBe(antes);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('facturas de colaboradores (#202) · correos encendidos', () => {
  let enlace;

  it('reenviar manda el enlace nuevo a la persona correcta, y queda «enviado»', async () => {
    encender();
    sendEmail.mockClear();
    const f = fila();
    expect((await request.post(`${API}/facturas/${f.id}/reenviar`).set(como('super'))).status).toBe(200);

    const [c] = correosA(laura.email);
    expect(c.to).toEqual([{ email: laura.email, name: laura.nombre }]);
    expect(c.subject).toBe('Tu factura de julio para Gamma · 600,00 €');
    expect(c.fromName).toBe('Gamma · Facturación');
    expect(c.htmlContent).toContain('Servicios de desarrollo web · julio 2026');
    expect(c.htmlContent).toContain('Calle Mayor, 1');
    expect(c.htmlContent).toContain('Subir mi factura de julio');
    // Con la marca de la empresa: su logo en la cabecera y su campus para el remitente de Brevo.
    expect(c.projectId).toBe(CAMPUS);
    expect(c.htmlContent).toContain('https://logo.prueba/marca.png');
    // La plantilla común del CRM (P.correo): su pie y su versión en texto plano, con el botón.
    expect(c.htmlContent).toContain('Te lo manda el');
    expect(c.textContent).toContain('factura-colaborador/');

    // El enlace del correo es el que vale: su huella es la de la fila.
    enlace = enlaceDelCorreo(c.htmlContent);
    expect(fila().token_hash).toBe(huella(enlace));
    // En la base no está el enlace: ni la semilla ni la huella lo son.
    expect([fila().token_semilla, fila().token_hash]).not.toContain(enlace);
    expect(fila().enviado_at).not.toBeNull();
    expect((await request.get(`${API}/enlace/${enlace}`)).body.data.estado).toBe('abierto');
  });

  it('una empresa sin campus activo con su marca: el correo sale con la de ISEIE', async () => {
    encender();
    sendEmail.mockClear();
    expect((await request.post(`${API}/facturas/${fila(marta.id).id}/reenviar`).set(como('super'))).status).toBe(200);
    const [c] = correosA(marta.email);
    expect(c.subject).toBe('Tu factura de julio para Delta · 600,00 €');
    expect(c.projectId).toBeNull();
    expect(c.htmlContent).toContain('ISEIE');
    expect(c.htmlContent).toContain('iseie-icon-192.png');
  });

  it('el recordatorio del día 5 lleva el mismo enlace, y no se repite', async () => {
    encender();
    sendEmail.mockClear();
    await recordar(PERIODO);
    expect(correosA(laura.email)).toHaveLength(1);
    const [c] = correosA(laura.email);
    expect(c.subject).toBe('Falta tu factura de julio para Gamma');
    expect(enlaceDelCorreo(c.htmlContent)).toBe(enlace);
    expect((await request.get(`${API}/enlace/${enlace}`)).status).toBe(200);

    sendEmail.mockClear();
    await recordar(PERIODO);
    expect(correosA(laura.email)).toHaveLength(0);
  });

  it('al subir la factura le llega el acuse, con la copia adjunta', async () => {
    encender();
    sendEmail.mockClear();
    const res = await request.post(`${API}/enlace/${enlace}`)
      .field('importe', '600').field('numero_factura', 'F-2026-07').attach('archivo', PDF, 'factura-julio.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // Sale justo después de responder (revisión del 10/10): se espera a que llegue.
    await vi.waitFor(() => expect(correosA(laura.email)).toHaveLength(1));
    const [c] = correosA(laura.email);
    expect(c.subject).toBe('Factura recibida · julio 2026 · Gamma');
    expect(c.htmlContent).toContain(res.body.data.recibida.numero_recepcion);
    expect(c.attachment).toHaveLength(1);
    expect(Buffer.from(c.attachment[0].content, 'base64').equals(PDF)).toBe(true);
  });

  it('si Brevo falla, la factura queda «no enviado»', async () => {
    encender();
    // La de julio ya está recibida: se anula para tener una nueva que mandar.
    // Brevo no lanza un error: contesta {sent:false} (así lo hace sendEmail de verdad).
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'HTTP_400' });
    const res = await request.post(`${API}/facturas/${fila().id}/anular`).set(como('super')).send({ motivo: 'Prueba de fallo de envío' });
    expect(res.status).toBe(200);
    const estado = await request.get(`${API}/mes?periodo=2026-07`).set(como('super'));
    const nueva = estado.body.data.facturas.find((x) => x.id === res.body.data.nueva);
    expect(nueva.estado).toBe('no_enviado');
    expect(base.registroDe(nueva.id).find((r) => r.evento === 'no_enviado').detalle.motivo).toBe('HTTP_400');
  });

  it('el freno de los entornos de pruebas no cuenta como fallo', async () => {
    encender();
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'FRENO_DE_PRUEBAS' });
    const antes = base.registroDe(fila().id).filter((r) => r.evento === 'no_enviado').length;
    expect((await request.post(`${API}/facturas/${fila().id}/reenviar`).set(como('super'))).status).toBe(200);
    expect(base.registroDe(fila().id).filter((r) => r.evento === 'no_enviado')).toHaveLength(antes);
  });

  it('y si el envío lanza un error, también', async () => {
    encender();
    sendEmail.mockRejectedValueOnce(new Error('Brevo caído'));
    expect((await request.post(`${API}/facturas/${fila().id}/reenviar`).set(como('super'))).status).toBe(200);
    const lineas = base.registroDe(fila().id).filter((r) => r.evento === 'no_enviado');
    expect(lineas[lineas.length - 1].detalle.motivo).toBe('Brevo caído');
  });

  it('tras un «No enviado», reenviar con los correos apagados lo deja «sin enviar»', async () => {
    apagar();
    const f = fila();
    expect((await request.post(`${API}/facturas/${f.id}/reenviar`).set(como('super'))).status).toBe(200);
    const estado = await request.get(`${API}/mes?periodo=2026-07`).set(como('super'));
    expect(estado.body.data.facturas.find((x) => x.id === f.id).estado).toBe('sin_enviar');
  });

  it('un recordatorio que Brevo no aceptó no se reintenta en cada vuelta', async () => {
    encender();
    sendEmail.mockClear();
    sendEmail.mockResolvedValueOnce({ sent: false, reason: 'HTTP_500' });
    await recordar(PERIODO);
    expect(correosA(laura.email)).toHaveLength(1);
    expect(base.registroDe(fila().id).some((r) => r.evento === 'no_enviado' && r.detalle.recordatorio === true)).toBe(true);
    sendEmail.mockClear();
    await recordar(PERIODO);
    expect(correosA(laura.email)).toHaveLength(0);
  });

  it('las del mes preparadas con los correos apagados salen en cuanto se encienden', async () => {
    // Un colaborador nuevo de julio: se prepara con los correos apagados…
    apagar();
    const ana = { nombre: 'Ana Sanz', email: 'ana@test.local' };
    ana.id = colaborador(ana, EMPRESA, 'contenido');
    await prepararYMandar(PERIODO);
    expect(fila(ana.id).enviado_at).toBeNull();
    // …y en la vuelta siguiente, ya encendidos, le llega su enlace (una vez).
    encender();
    sendEmail.mockClear();
    const r = await prepararYMandar(PERIODO);
    expect(r.pendientes_enviados).toBeGreaterThanOrEqual(1);
    expect(correosA(ana.email)).toHaveLength(1);
    expect(fila(ana.id).enviado_at).not.toBeNull();
  });
});

describe('facturas de colaboradores (#202) · la tarea del mes', () => {
  it('las 10:00 de Madrid, también en horario de verano y de invierno', () => {
    expect(enMadrid(new Date('2026-07-31T08:00:00Z'))).toMatchObject({ dia: 31, hora: 10 });
    expect(enMadrid(new Date('2026-12-05T09:00:00Z'))).toMatchObject({ dia: 5, hora: 10 });
  });

  it('el último día del mes a las 10:00 prepara el mes; a otra hora u otro día, nada', async () => {
    expect((await runFacturasColaborador({ ahora: new Date('2026-07-31T07:00:00Z') })).omitido).toBe('fuera de hora');
    expect((await runFacturasColaborador({ ahora: new Date('2026-07-30T08:00:00Z') })).omitido).toBe('no toca hoy');
    expect((await runFacturasColaborador({ ahora: new Date('2026-07-31T08:00:00Z') })).tarea).toBe('mes');
    // Si el servidor arrancó a las 10:45, la vuelta de las 10:45 lo hace igual.
    expect((await runFacturasColaborador({ ahora: new Date('2026-07-31T08:45:00Z') })).tarea).toBe('mes');
  });

  it('el día 5 a las 10:00 toca el recordatorio del mes anterior', async () => {
    expect((await runFacturasColaborador({ ahora: new Date('2026-08-05T08:00:00Z') })).tarea).toBe('recordatorio');
  });
});
