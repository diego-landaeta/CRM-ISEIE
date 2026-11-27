import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Avisar al tutor» desde Comisiones (CRM#165 / CRM-ISEIE#188, Diego 25/11).
 * La misma prueba en los dos CRM.
 *
 *   «botón "Avisar al tutor" que le manda el correo de facturación (con la
 *    plantilla P.correo y la marca del campus, como todos los correos), con el
 *    detalle de lo que se le debe y lo que tiene que facturar. Queda anotado
 *    quién y cuándo lo mandó, y avisa si ya se le mandó ese mes. Permiso del
 *    catálogo.»
 *
 * Sin base y SIN MANDAR NADA: `sendEmail` está doblado, y lo que se comprueba es
 * con qué se le llama. El permiso va con el resolver de verdad (permisosSinBase).
 */

vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

const h = vi.hoisted(() => ({
  freno: false,
  resumen: [],
  lineas: [],
  empresas: [],
  avisos: [],
  marca: null,
  enviado: { sent: true, messageId: '<msg-1@brevo>' },
  cliente: null,
}));

const sendEmail = vi.fn(async () => h.enviado);
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: (...a) => sendEmail(...a) }));
vi.mock('../src/shared/config/frenoTutores.js', () => ({
  get NO_ESCRIBIR_A_TUTORES() { return h.freno; },
}));

// La base: lo que lee el aviso, según la consulta.
const query = vi.fn(async (sql) => {
  const s = String(sql);
  if (s.includes('FROM tutor_avisos_comisiones')) return { rows: h.avisos };
  if (s.includes('invoice_issuers')) return { rows: h.empresas };
  return { rows: [] };
});
const consultasDelCliente = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: (...a) => query(...a),
  getClient: vi.fn(async () => h.cliente),
}));

vi.mock('../src/modules/tutores/tutor.model.js', () => ({
  resumenComisiones: vi.fn(async () => h.resumen),
  comisiones: vi.fn(async () => h.lineas),
  tieneAlgunCampus: vi.fn(async () => true),
  esGestorColaboraciones: vi.fn(async () => false),
  ESTADOS_COMISION: [],
}));
vi.mock('../src/shared/services/marca.service.js', async () => {
  const real = await vi.importActual('../src/shared/services/marca.service.js');
  return { ...real, marcaDeLosCampus: vi.fn(async () => h.marca) };
});
vi.mock('../src/modules/users/user.service.js', () => ({}));
vi.mock('../src/modules/dossiers/dossier.service.js', () => ({}));
vi.mock('../src/shared/utils/ambito.js', () => ({
  proyectosDelAmbito: vi.fn(async (req) => ({
    projectId: req.query?.projectId ? Number(req.query.projectId) : null, projectIds: null,
  })),
  veTodoElCrm: (u) => u.role === 'superadmin',
  campusDeLaPersona: vi.fn(async () => [5]),
}));

const aviso = await import('../src/modules/tutores/avisarTutor.js');
const ctrl = await import('../src/modules/tutores/tutor.controller.js');
const { puede } = await import('../src/shared/middleware/permissions.js');
const { POR_CLAVE } = await import('../src/modules/permissions/catalogo.js');

const CEDIA = {
  project_id: 5, issuer_id: 1, razon_social: 'CEDIA Investigación y Desarrollo SL', alias: null,
  nif: 'B93806404', direccion: 'Av. Aragón 30', cp: '46021', ciudad: 'Valencia', pais: 'España',
  email: 'facturacion@cediaidsl.com',
};
const ICTESS = {
  project_id: 8, issuer_id: 2, razon_social: 'Ictess Ingeniería e Innovación SL', alias: null,
  nif: 'PENDIENTE-CIF-ICTESS', direccion: null, cp: null, ciudad: null, pais: 'España', email: 'admin@ictess.com',
};
const MARCA = { id: 5, nombre: 'Psiko Aprende', slug: 'psiko-aprende', logo_url: null, emoji: null };

const linea = (o) => ({
  id: 1, periodo: '2026-10', estado: 'pendiente', importe: '17.82', formacion: 'Máster en Neuropsicología',
  project_id: 5, proyecto: 'Psiko Aprende', tutor_id: 3, ...o,
});

function unMes() {
  h.resumen = [{
    periodo: '2026-10', tutor_id: 3, tutor: 'Lola Hernández', tutor_email: 'lola@prueba.local',
    tutor_iban: null, pendiente: '17.82',
  }];
  h.lineas = [
    linea({ id: 11, importe: '6.40' }),
    linea({ id: 12, importe: '11.42', estado: 'notificada', formacion: 'Curso de Psicodrama' }),
    linea({ id: 13, importe: '30.00', estado: 'pagada', formacion: 'Ya pagado' }),
  ];
  h.empresas = [CEDIA];
  h.marca = MARCA;
}

function clienteDoblado() {
  consultasDelCliente.length = 0;
  h.cliente = {
    query: vi.fn(async (sql, params) => {
      consultasDelCliente.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO tutor_avisos_comisiones')) {
        return { rows: [{ id: 77, enviado_at: '2026-11-25T09:20:00.000Z' }] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

const llamar = async (fn, req) => {
  let error = null; let cuerpo = null;
  await fn(req, { json: (b) => { cuerpo = b; }, status() { return this; } }, (e) => { error = e; });
  return { error, cuerpo };
};
const ADMIN = { userId: 1, role: 'admin', nombre: 'Vanessa' };

beforeEach(() => {
  vi.clearAllMocks();
  h.freno = false;
  h.avisos = [];
  h.enviado = { sent: true, messageId: '<msg-1@brevo>' };
  delete process.env.AVISO_TUTOR_FROM;
  delete process.env.AVISO_TUTOR_FROM_NAME;
  unMes();
  clienteDoblado();
});

describe('el permiso, del catálogo', () => {
  const accion = POR_CLAVE['tutores.avisar'];

  it('«Avisar de comisiones» (`tutores.avisar`) está en el catálogo', () => {
    expect(accion).toBeTruthy();
    expect(accion.nombre).toBe('Avisar de comisiones');
    expect(accion.roles).toEqual(expect.arrayContaining(['admin']));
  });

  it('la ruta lo pide: a quien se le quita, 403 aunque sea admin', async () => {
    const mw = puede('tutores.avisar');
    const conEl = await new Promise((ok) => mw({ user: registrar({ userId: 1, role: 'admin' }) }, {}, ok));
    expect(conEl).toBeUndefined();
    const sinEl = await new Promise((ok) => mw(
      { user: registrar({ userId: 2, role: 'admin', excepciones: { 'tutores.avisar': false } }) }, {}, ok));
    expect(sinEl?.statusCode).toBe(403);
  });

  it('y además hay que gestionar colaboraciones: una gestora sin eso, 403 y no sale nada', async () => {
    const { error } = await llamar(ctrl.avisarTutor, {
      user: registrar({ userId: 9, role: 'gestor' }), body: { tutorId: 3, periodo: '2026-10' },
    });
    expect(error?.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('Zod: sin mes válido no se prepara nada', async () => {
    const { error } = await llamar(ctrl.previoDelAviso, {
      user: registrar(ADMIN), query: { tutorId: '3', periodo: '2026-13' },
    });
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('el correo que se arma', () => {
  it('con la plantilla común y la marca del campus', async () => {
    const p = await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' });
    expect(p.html).toMatch(/^<!DOCTYPE html>/);                 // la envoltura de P.correo
    expect(p.html).toContain('Psiko Aprende');                   // la marca en la cabecera
    expect(p.html).toContain('equipo de facturación de <strong class="txt">Psiko Aprende</strong>');
    expect(p.asunto).toBe('Tus comisiones de octubre de 2026 · Psiko Aprende');
    expect(p.texto).not.toMatch(/<[^>]+>/);
  });

  it('lo que se le debe: solo lo no pagado, también lo ya «notificado»', async () => {
    const p = await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' });
    expect(p.pendiente).toBe(17.82);
    expect(p.comisiones).toEqual([11, 12]);
    expect(p.html).toContain('Máster en Neuropsicología');
    expect(p.html).toContain('Curso de Psicodrama');              // estaba en «notificada»
    expect(p.html).not.toContain('Ya pagado');
  });

  it('y lo que tiene que facturar, al céntimo, a nombre de su empresa', async () => {
    const p = await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' });
    expect(p.cuenta).toEqual({ base: 17.82, iva: 3.74, retencion: 2.67, total: 18.89 });
    expect(p.html).toContain('Total a facturar');
    expect(p.html).toContain('18,89');
    expect(p.html).toContain('CEDIA Investigación y Desarrollo SL');
    expect(p.html).toContain('NIF: B93806404');
    expect(p.texto.replace(/\u00a0/g, ' ')).toContain('Total a facturar: 18,89 €');
    expect(p.texto).toContain('- Máster en Neuropsicología');
  });

  it('sin IBAN se lo pide', async () => {
    const p = await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' });
    expect(p.html).toContain('Envíanos tu IBAN');
    h.resumen[0].tutor_iban = 'ES0000000000000000000000';
    expect((await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' })).html).not.toContain('Envíanos tu IBAN');
  });

  it('dos empresas son dos facturas, cada una con su cuenta, y sin inventar datos fiscales', async () => {
    h.resumen[0].pendiente = '27.82';
    h.lineas = [linea({ id: 11, importe: '17.82' }),
      linea({ id: 21, importe: '10.00', project_id: 8, proyecto: 'ICTESS', formacion: 'Curso de Ingeniería' })];
    h.empresas = [CEDIA, ICTESS];
    h.marca = null;                                              // mezclan empresas: la del CRM
    const p = await aviso.previsualizar({ tutorId: 3, periodo: '2026-10' });
    expect(p.grupos.map((g) => g.empresa.id)).toEqual([1, 2]);
    expect(p.grupos[1].cuenta).toEqual({ base: 10, iva: 2.1, retencion: 1.5, total: 10.6 });
    expect(p.cuenta.total).toBe(29.49);
    expect(p.html).toContain('2 facturas');
    expect(p.html).toContain('Factura a CEDIA');
    expect(p.html).toContain('Factura a Ictess');
    expect(p.html).not.toContain('PENDIENTE-CIF');
    expect(p.html).toContain('Sus datos fiscales no están completos');
  });

  it('la nota se escapa y no puede colar HTML', () => {
    const datos = { mes: 'octubre de 2026', nombre: 'Lola', pendiente: 1, tieneIban: true, marca: MARCA,
      grupos: [{ empresa: null, campus: [], formaciones: [], comisiones: [], cuenta: aviso.cuentaAFacturar(1) }],
      cuenta: aviso.cuentaAFacturar(1) };
    const c = aviso.componerCorreo({ datos, nota: 'Ojo <script>alert(1)</script>\nsegunda línea' });
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;');
    expect(c.html).toContain('segunda línea');
  });
});

describe('el envío: a quién, desde dónde y sin repetir sin querer', () => {
  it('sale al tutor, por la cuenta de la marca y desde el buzón de facturación de su empresa', async () => {
    const { error, cuerpo } = await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10', projectId: 5 },
    });
    expect(error).toBeNull();
    expect(cuerpo.data).toMatchObject({ enviado: true, a: 'lola@prueba.local', total: 18.89, repetido: false });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const m = sendEmail.mock.calls[0][0];
    expect(m.to).toEqual({ email: 'lola@prueba.local', name: 'Lola Hernández' });
    expect(m.projectId).toBe(5);
    expect(m.fromEmail).toBe('facturacion@cediaidsl.com');
    expect(m.replyTo).toBe('facturacion@cediaidsl.com');
    expect(m.fromName).toBe('Psiko Aprende · Facturación');
    expect(m.htmlContent).toContain('Psiko Aprende');
    expect(m.clave).toBeUndefined();                             // se puede reenviar a propósito
  });

  it('de fuera solo entra el asunto y la nota: el destinatario no', async () => {
    await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN),
      body: { tutorId: 3, periodo: '2026-10', asunto: 'Comisiones de octubre', nota: 'Hubo una devolución.', to: 'otro@x.com' },
    });
    const m = sendEmail.mock.calls[0][0];
    expect(m.subject).toBe('Comisiones de octubre');
    expect(m.htmlContent).toContain('Hubo una devolución.');
    expect(m.to.email).toBe('lola@prueba.local');
  });

  it('queda anotado quién y cuándo, y sus líneas pasan a «notificada»', async () => {
    await llamar(ctrl.avisarTutor, { user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10' } });
    const sqls = consultasDelCliente.map((c) => c.sql.trim().split(/\s+/)[0]);
    expect(sqls).toEqual(['BEGIN', 'INSERT', 'UPDATE', 'COMMIT']);
    const ins = consultasDelCliente[1].params;
    expect(ins.slice(0, 4)).toEqual([3, '2026-10', 1, 'lola@prueba.local']);   // tutor, mes, QUIÉN, a dónde
    expect(ins[5]).toBe(18.89);
    expect(ins[8]).toEqual([11, 12]);
    expect(ins[9]).toBe('<msg-1@brevo>');
    const upd = consultasDelCliente[2];
    expect(upd.sql).toContain("'notificada'");
    expect(upd.params).toEqual([[11, 12], '2026-11-25T09:20:00.000Z', 1]);      // CUÁNDO y QUIÉN
    expect(h.cliente.release).toHaveBeenCalled();
  });

  it('si ya se le mandó el de ese mes, 409 y no sale nada', async () => {
    h.avisos = [{ id: 4, enviado_at: '2026-11-12T09:20:00.000Z', enviado_por: 'Vanessa', email: 'lola@prueba.local', total: '18.89' }];
    const { error } = await llamar(ctrl.avisarTutor, { user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10' } });
    expect(error?.statusCode).toBe(409);
    expect(error?.code).toBe('YA_AVISADO');
    expect(error.message).toMatch(/Ya se le mandó el aviso de octubre de 2026 el 12\/11\/2026 a las 10:20 \(Vanessa\)/);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(consultasDelCliente).toHaveLength(0);
  });

  it('la vista previa ya lo dice, para pedir la confirmación antes', async () => {
    h.avisos = [{ id: 4, enviado_at: '2026-11-12T09:20:00.000Z', enviado_por: 'Vanessa', email: 'lola@prueba.local', total: '18.89' }];
    const { cuerpo } = await llamar(ctrl.previoDelAviso, { user: registrar(ADMIN), query: { tutorId: '3', periodo: '2026-10' } });
    expect(cuerpo.data.avisos).toEqual([{ id: 4, enviadoAt: '2026-11-12T09:20:00.000Z', enviadoPor: 'Vanessa', email: 'lola@prueba.local', total: 18.89 }]);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('con la confirmación (`repetir`), sí, y se anota otra vez', async () => {
    h.avisos = [{ id: 4, enviado_at: '2026-11-12T09:20:00.000Z', enviado_por: 'Vanessa' }];
    const { error, cuerpo } = await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10', repetir: true },
    });
    expect(error).toBeNull();
    expect(cuerpo.data.repetido).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(consultasDelCliente.some((c) => c.sql.includes('INSERT INTO tutor_avisos_comisiones'))).toBe(true);
  });

  // QA del 26/11: `repetir: "true"` contestaba en inglés «Expected boolean,
  // received string». En texto vale igual; lo que no es sí o no, en español.
  it('`repetir` también en texto («true», «1»), y «false» es que no', async () => {
    h.avisos = [{ id: 4, enviado_at: '2026-11-12T09:20:00.000Z', enviado_por: 'Vanessa' }];
    const si = await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10', repetir: 'true' },
    });
    expect(si.error).toBeNull();
    expect(si.cuerpo.data.repetido).toBe(true);

    const no = await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10', repetir: 'false' },
    });
    expect(no.error?.code).toBe('YA_AVISADO');
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('`repetir` que no es sí o no: 400 en español, sin mandar nada', async () => {
    const { error } = await llamar(ctrl.avisarTutor, {
      user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10', repetir: 'quizá' },
    });
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('«repetir» tiene que ser sí o no (true o false)');
    expect(error.message).not.toMatch(/Expected|received/);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('el «ya se le mandó» se pide con los campus de lo que se va a mandar', async () => {
    await llamar(ctrl.previoDelAviso, { user: registrar(ADMIN), query: { tutorId: '3', periodo: '2026-10' } });
    const llamada = query.mock.calls.find(([sql]) => String(sql).includes('FROM tutor_avisos_comisiones'));
    expect(String(llamada[0])).toMatch(/a\.project_ids && \$3::int\[\]/);
    expect(llamada[1]).toEqual([3, '2026-10', [5]]);
  });

  it('con el freno de tutores puesto, 423: se ve la vista previa pero no sale nada', async () => {
    h.freno = true;
    const { error } = await llamar(ctrl.avisarTutor, { user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10' } });
    expect(error?.statusCode).toBe(423);
    expect(sendEmail).not.toHaveBeenCalled();
    const { error: e2 } = await llamar(ctrl.previoDelAviso, { user: registrar(ADMIN), query: { tutorId: '3', periodo: '2026-10' } });
    expect(e2).toBeNull();
  });

  it('si Brevo (o el freno de staging) no lo deja salir, se dice por qué y NO se anota', async () => {
    h.enviado = { sent: false, reason: 'FRENO_DE_PRUEBAS' };
    const { error } = await llamar(ctrl.avisarTutor, { user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10' } });
    expect(error?.statusCode).toBe(502);
    expect(error.message).toMatch(/EMAIL_LISTA_BLANCA/);
    expect(consultasDelCliente).toHaveLength(0);
  });

  it('AVISO_TUTOR_FROM, si está, manda sobre el buzón de la empresa', async () => {
    process.env.AVISO_TUTOR_FROM = 'facturas@otra.test';
    await llamar(ctrl.avisarTutor, { user: registrar(ADMIN), body: { tutorId: 3, periodo: '2026-10' } });
    expect(sendEmail.mock.calls[0][0].fromEmail).toBe('facturas@otra.test');
    expect(sendEmail.mock.calls[0][0].replyTo).toBe('facturas@otra.test');
  });
});
