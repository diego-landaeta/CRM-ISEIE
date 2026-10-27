import { describe, it, expect } from 'vitest';
import { elegir, porQue } from '../src/modules/asignacion/asignacion.actividad.js';
import { accionDe } from '../src/shared/middleware/registrarActividad.js';
import { construirPayload, construirCorreo } from '../src/modules/asignacion/asignacion.service.js';
import { revisarDestino } from '../src/modules/asignacion/asignacion.validation.js';

/*
  Asignación de leads por actividad (CRM#513; Carlos y Diego, 27/10/2026): las
  reglas que no necesitan base de datos.

  «Si hay varias activas, la que menos leads tenga asignados hoy; si empatan, la
  que menos en total; y si no, por turno.»
*/

const cuentas = (o) => new Map(Object.entries(o).map(([id, c]) => [Number(id), c]));

describe('a quién le toca entre las activas', () => {
  it('la que menos lleva hoy', () => {
    const { elegida } = elegir([1, 2, 3], cuentas({ 1: { hoy: 3, total: 10 }, 2: { hoy: 1, total: 500 }, 3: { hoy: 2, total: 0 } }));
    expect(elegida.id).toBe(2);
  });
  it('si empatan hoy, la que menos lleva en total', () => {
    const { elegida } = elegir([1, 2], cuentas({ 1: { hoy: 0, total: 300 }, 2: { hoy: 0, total: 120 } }));
    expect(elegida.id).toBe(2);
  });
  it('si siguen empatadas, la que lleva más tiempo sin recibir uno (el turno)', () => {
    const { elegida } = elegir([1, 2], cuentas({
      1: { hoy: 0, total: 5, ultimo: '2026-10-27T10:00:00Z' },
      2: { hoy: 0, total: 5, ultimo: '2026-10-26T09:00:00Z' },
    }));
    expect(elegida.id).toBe(2);
  });
  it('quien no ha recibido nunca va antes que quien sí; y al final, el id', () => {
    expect(elegir([5, 4], cuentas({ 4: { hoy: 0, total: 0, ultimo: '2026-10-01T00:00:00Z' }, 5: { hoy: 0, total: 0 } })).elegida.id).toBe(5);
    expect(elegir([9, 7], cuentas({})).elegida.id).toBe(7);
  });
  it('sin activas, nadie (va al escenario 1)', () => {
    expect(elegir([], new Map()).elegida).toBeNull();
  });
  it('el porqué que ve la pantalla', () => {
    const ahora = new Date('2026-10-27T12:00:00Z');
    expect(porQue({ hoy: 2, total: 310 }, { ultima: '2026-10-27T11:56:00Z', que: 'estado' }, ahora))
      .toBe('activa hace 4 min (estado) · 2 hoy · 310 en total');
    expect(porQue(null)).toBe('Ninguna gestora activa');
  });
});

describe('lo que se apunta en actividad_crm (lo que no guarda su autor)', () => {
  it('crear un lead, una venta, un cobro, una matrícula, una factura o un paso del proceso', () => {
    expect(accionDe('POST', '/api/leads')).toBe('crear_lead');
    expect(accionDe('POST', '/api/leads/bulk')).toBe('crear_lead');
    expect(accionDe('POST', '/api/conversions/12/payments')).toBe('venta');
    expect(accionDe('PATCH', '/api/ventas/12')).toBe('venta');
    expect(accionDe('POST', '/api/matriculas')).toBe('matricula');
    expect(accionDe('POST', '/api/invoices/40/cobrar')).toBe('factura');
    expect(accionDe('POST', '/api/proceso/pasos/3/hecho')).toBe('proceso');
    expect(accionDe('POST', '/api/leads/55/send-email')).toBe('email');
  });
  it('lo que ya deja su rastro con autor no va aquí (ahí se aplican las reglas de Carlos)', () => {
    expect(accionDe('POST', '/api/leads/55/interactions')).toBeNull();
    expect(accionDe('PATCH', '/api/leads/55/status')).toBeNull();
    expect(accionDe('POST', '/api/leads/55/reminders')).toBeNull();
    expect(accionDe('PATCH', '/api/leads/55')).toBeNull();
  });
  it('mirar no es trabajar: GET, exportar, vista previa, buscar o «leído», no', () => {
    expect(accionDe('GET', '/api/leads')).toBeNull();
    expect(accionDe('POST', '/api/invoices/export')).toBeNull();
    expect(accionDe('POST', '/api/invoices/preview')).toBeNull();
    expect(accionDe('POST', '/api/leads/check-duplicate')).toBeNull();
    expect(accionDe('POST', '/api/tasks')).toBeNull();
  });
});

describe('lo que recibe cada escenario', () => {
  const dec = (escenario, extra = {}) => ({
    id: 1, escenario, uid: 'f-1', prueba: false, lead_id: escenario === 2 ? 77 : null,
    datos: { uid: 'f-1', nombre: 'Ana Pérez', email: 'ana@x.com', telefono: '+34600111222', producto_interes: 'Máster', responsable_email: 'trampa@x.com', ...extra },
  });
  const campus = { id: 3, nombre: 'ISEIE', slug: 'iseie' };
  const gestora = { id: 9, nombre: 'Dayana', email: 'dayana@x.com' };

  it('escenario 2: los mismos campos de la web, más la gestora (también en plano)', () => {
    const p = construirPayload(dec(2), campus, gestora);
    expect(p).toMatchObject({
      evento: 'lead.asignacion', escenario: 2, uid: 'f-1', lead_id: 77,
      nombre: 'Ana Pérez', email: 'ana@x.com', producto_interes: 'Máster',
      gestora: { id: 9, nombre: 'Dayana', email: 'dayana@x.com' },
      responsable_id: 9, responsable_email: 'dayana@x.com', responsable_nombre: 'Dayana',
      campus: { id: 3, nombre: 'ISEIE', slug: 'iseie' },
    });
  });
  it('escenario 1: sin gestora, y lo que mandó la entrada como «responsable» no pasa', () => {
    const p = construirPayload(dec(1), campus, null);
    expect(p.gestora).toBeNull();
    expect(p.responsable_email).toBeUndefined();
    expect(p.datos.responsable_email).toBeUndefined();
  });
  it('por mailhook: el correo original tal cual y, con gestora, sus datos arriba', () => {
    const p = construirPayload(dec(2, { original: { asunto: 'Nuevo formulario del Máster', html: '<p>Nombre Ana</p>', texto: 'Nombre Ana' } }), campus, gestora);
    const c = construirCorreo(p);
    expect(c.subject).toBe('Nuevo formulario del Máster');
    expect(c.htmlContent).toMatch(/^<p><b>GESTORA ASIGNADA:<\/b> Dayana · dayana@x\.com · id 9 · lead 77<\/p><hr><p>Nombre Ana<\/p>$/);
    expect(c.textContent).toBe('GESTORA ASIGNADA: Dayana · dayana@x.com · id 9 · lead 77\n\nNombre Ana');
  });
  it('sin correo original, una tabla con los campos', () => {
    const c = construirCorreo(construirPayload(dec(1), campus, null));
    expect(c.subject).toBe('Nuevo formulario · ISEIE');
    expect(c.htmlContent).toContain('<td><b>email</b></td><td>ana@x.com</td>');
  });
});

describe('los destinos', () => {
  it('mailhook = un correo; webhook = una URL https', () => {
    expect(revisarDestino('mailhook', 'abc123@hook.eu2.make.com')).toBeNull();
    expect(revisarDestino('mailhook', 'https://hook.eu2.make.com/x')).toMatch(/correo/);
    expect(revisarDestino('webhook', 'https://hook.eu2.make.com/abc')).toBeNull();
    expect(revisarDestino('webhook', 'http://hook.eu2.make.com/abc')).toBeTruthy();
  });
});
