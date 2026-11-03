import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Soporte de verdad (#38).
 *
 * La pantalla existía desde hacía meses y no tenía nada detrás: los tickets se
 * guardaban en el `localStorage` del navegador de quien los abría. Alguien
 * reportaba una avería, veía su ticket en la lista, y no lo recibía nadie.
 *
 * Lo que se fija aquí es lo que no se ve leyendo el código:
 *
 *   - QUIÉN ALCANZA QUÉ. Un ticket lleva pasos para reproducir, una URL del
 *     CRM y a menudo una captura con datos de un cliente. No es una lista
 *     pública, y el adjunto menos.
 *   - QUE EL ADJUNTO PIDA SESIÓN. En Matrículas la ruta equivalente se dejó
 *     fuera de `verifyToken` «porque la URL ya es no-guessable» —y la URL era
 *     un entero correlativo—, así que hoy se descargan DNI escaneados sin
 *     credencial. Aquí eso no puede repetirse sin que esto se ponga rojo.
 *   - LAS NOTAS INTERNAS. Si quien abrió el ticket las viera, dejarían de
 *     servir para lo único que sirven.
 */

const modelo = {
  crear: vi.fn(),
  porId: vi.fn(),
  listar: vi.fn(async () => ({ tickets: [], total: 0, page: 1, limit: 50, totalPages: 0 })),
  mensajesDe: vi.fn(async () => []),
  adjuntosDe: vi.fn(async () => []),
  responder: vi.fn(async () => 1),
  cambiarEstado: vi.fn(async () => ({ id: '1' })),
  guardarAdjunto: vi.fn(async () => ({ id: 1 })),
  adjuntoPorId: vi.fn(),
  tiempos: vi.fn(async () => ({ total: 0 })),
  proyectoExiste: vi.fn(async () => true),
  destinatariosDelAviso: vi.fn(async () => [1, 2]),
  clavesDeAdjuntos: vi.fn(async () => []),
  borrar: vi.fn(async () => true),
};
vi.mock('../src/modules/soporte/soporte.model.js', () => modelo);

const enviado = vi.fn(async () => ({ sent: true }));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendTicketNuevoEmail: (...a) => enviado(...a),
  sendEmail: vi.fn(), sendWelcomeUserEmail: vi.fn(), sendPasswordResetEmail: vi.fn(),
}));
const avisado = vi.fn(async () => {});
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: (...a) => avisado(...a),
}));
// Los campus de cada persona. El alcance real lo calcula ambito.js contra la base;
// aqui se simula su respuesta y se comprueba que el controlador la use.
const campus = vi.fn(async () => []);
vi.mock('../src/shared/utils/ambito.js', () => ({
  campusDeLaPersona: (...a) => campus(...a),
  veTodoElCrm: (u) => ['superadmin', 'soporte'].includes(u?.role),
}));
vi.mock('../src/shared/services/localStorage.service.js', () => ({
  saveLocal: vi.fn(), getLocal: vi.fn(async () => ({ buffer: Buffer.from('x') })), deleteLocal: vi.fn(),
}));

const ctrl = await import('../src/modules/soporte/soporte.controller.js');

function fingirRes() {
  const res = { codigo: 200, cuerpo: null, cabeceras: {} };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  res.setHeader = (k, v) => { res.cabeceras[k] = v; };
  res.send = (b) => { res.cuerpo = b; return res; };
  return res;
}

async function llamar(handler, req) {
  const res = fingirRes();
  let error = null;
  await handler(req, res, (e) => { error = e; });
  return { res, error };
}

const LAURA = { userId: 4, role: 'gestor', nombre: 'Laura' };
const ADMIN = { userId: 9, role: 'admin', nombre: 'Diego' };
const SUPER = { userId: 1, role: 'superadmin', nombre: 'Manuel' };
const SOPORTE = { userId: 2, role: 'soporte', nombre: 'Soporte' };

/** Un ticket de Laura. */
const DE_LAURA = { id: '1', autorId: 4, title: 'No carga el chat' };

beforeEach(() => {
  for (const f of Object.values(modelo)) f.mockClear?.();
  enviado.mockClear();
  avisado.mockClear();
  campus.mockReset();
  campus.mockResolvedValue([]);
  avisado.mockResolvedValue(undefined);
  modelo.listar.mockResolvedValue({ tickets: [], total: 0, page: 1, limit: 50, totalPages: 0 });
  modelo.porId.mockResolvedValue(DE_LAURA);
  modelo.mensajesDe.mockResolvedValue([]);
  modelo.adjuntosDe.mockResolvedValue([]);
});

describe('quién ve qué tickets', () => {
  it('una gestora solo pide los suyos', async () => {
    await llamar(ctrl.listar, { user: LAURA, query: {} });
    expect(modelo.listar).toHaveBeenCalledWith(expect.objectContaining({
      alcance: { userId: 4, projectIds: [] },
    }));
  });

  it('superadmin y soporte los ven todos', async () => {
    for (const user of [SUPER, SOPORTE]) {
      modelo.listar.mockClear();
      await llamar(ctrl.listar, { user, query: {} });
      expect(modelo.listar, user.role).toHaveBeenCalledWith(expect.objectContaining({ alcance: null }));
    }
  });

  it('un admin ve los suyos y los de SUS campus, no todos (#245)', async () => {
    // Antes veia todos los tickets del CRM: el admin de una empresa podia leer
    // los de otra, con sus pasos, su URL y sus capturas.
    campus.mockResolvedValue([1, 2]);
    await llamar(ctrl.listar, { user: ADMIN, query: {} });
    expect(modelo.listar).toHaveBeenCalledWith(expect.objectContaining({
      alcance: { userId: 9, projectIds: [1, 2] },
    }));
  });

  it('una gestora no abre el ticket de otra (404, como si no existiera)', async () => {
    modelo.porId.mockResolvedValue({ id: '1', autorId: 99 });
    const { error } = await llamar(ctrl.porId, { user: LAURA, params: { id: '1' }, query: {} });
    expect(error?.statusCode).toBe(404);
    expect(error?.code).toBe('NOT_FOUND');
  });

  it('un admin abre un ticket de uno de sus campus', async () => {
    campus.mockResolvedValue([1, 2]);
    modelo.porId.mockResolvedValue({ id: '1', autorId: 99, projectId: 2 });
    const { error } = await llamar(ctrl.porId, { user: ADMIN, params: { id: '1' }, query: {} });
    expect(error).toBeNull();
  });

  it('un admin NO abre el de otra empresa, ni uno sin proyecto que no es suyo', async () => {
    campus.mockResolvedValue([1, 2]);
    for (const t of [{ id: '1', autorId: 99, projectId: 7 }, { id: '1', autorId: 99, projectId: null }]) {
      modelo.porId.mockResolvedValue(t);
      const { error } = await llamar(ctrl.porId, { user: ADMIN, params: { id: '1' }, query: {} });
      expect(error?.statusCode, JSON.stringify(t)).toBe(404);
    }
  });

  it('pero un admin sí abre el que abrió él, sea del proyecto que sea', async () => {
    campus.mockResolvedValue([1]);
    modelo.porId.mockResolvedValue({ id: '1', autorId: 9, projectId: 7 });
    const { error } = await llamar(ctrl.porId, { user: ADMIN, params: { id: '1' }, query: {} });
    expect(error).toBeNull();
  });

  it('un admin tampoco responde ni cambia el estado de uno ajeno', async () => {
    campus.mockResolvedValue([1]);
    modelo.porId.mockResolvedValue({ id: '1', autorId: 99, projectId: 7 });
    const r = await llamar(ctrl.responder, { user: ADMIN, params: { id: '1' }, body: { body: 'hola' } });
    const e = await llamar(ctrl.cambiarEstado, { user: ADMIN, params: { id: '1' }, body: { status: 'closed' } });
    expect(r.error?.statusCode).toBe(404);
    expect(e.error?.statusCode).toBe(404);
    expect(modelo.responder).not.toHaveBeenCalled();
    expect(modelo.cambiarEstado).not.toHaveBeenCalled();
  });

  it('superadmin y soporte abren cualquiera', async () => {
    modelo.porId.mockResolvedValue({ id: '1', autorId: 99, projectId: 7 });
    for (const user of [SUPER, SOPORTE]) {
      const { error } = await llamar(ctrl.porId, { user, params: { id: '1' }, query: {} });
      expect(error, user.role).toBeNull();
    }
  });

  it('el suyo sí', async () => {
    const { error } = await llamar(ctrl.porId, { user: LAURA, params: { id: '1' }, query: {} });
    expect(error).toBeNull();
  });

  it('uno que no existe da 404, no 403', async () => {
    // Importa el orden: con 403 a lo inexistente, probando números se sabría
    // cuáles existen sin verlos.
    modelo.porId.mockResolvedValue(null);
    const { error } = await llamar(ctrl.porId, { user: LAURA, params: { id: '999' }, query: {} });
    expect(error?.statusCode).toBe(404);
  });
});

describe('las notas internas', () => {
  it('quien abrió el ticket NO las recibe', async () => {
    await llamar(ctrl.porId, { user: LAURA, params: { id: '1' }, query: {} });
    expect(modelo.mensajesDe).toHaveBeenCalledWith(1, { incluirInternas: false });
  });

  it('superadmin y soporte sí', async () => {
    await llamar(ctrl.porId, { user: SUPER, params: { id: '1' }, query: {} });
    expect(modelo.mensajesDe).toHaveBeenCalledWith(1, { incluirInternas: true });
  });

  it('una gestora no puede MARCAR una nota como interna', async () => {
    // Si pudiera, escribiría algo creyendo que el equipo lo lee y no lo leería
    // nadie del otro lado.
    await llamar(ctrl.responder, {
      user: LAURA, params: { id: '1' }, body: { body: 'hola', interna: true },
    });
    expect(modelo.responder).toHaveBeenCalledWith(1, 4, 'hola', false);
  });

  it('quien administra sí puede', async () => {
    await llamar(ctrl.responder, {
      user: SUPER, params: { id: '1' }, body: { body: 'es del puente', interna: true },
    });
    expect(modelo.responder).toHaveBeenCalledWith(1, 1, 'es del puente', true);
  });
});

describe('los adjuntos — la puerta que en Matrículas quedó abierta', () => {
  it('no se descarga el adjunto de un ticket ajeno', async () => {
    modelo.adjuntoPorId.mockResolvedValue({ id: 1, clave: 'k', abierto_por: 99 });
    const { error } = await llamar(ctrl.descargarAdjunto, {
      user: LAURA, params: { adjuntoId: '1' },
    });
    expect(error?.statusCode).toBe(404);
  });

  it('el del propio ticket sí', async () => {
    modelo.adjuntoPorId.mockResolvedValue({ id: 1, clave: 'k', abierto_por: 4, mime: 'image/png', nombre: 'a.png' });
    const { res, error } = await llamar(ctrl.descargarAdjunto, {
      user: LAURA, params: { adjuntoId: '1' },
    });
    expect(error).toBeNull();
    expect(res.cabeceras['Content-Type']).toBe('image/png');
  });

  it('superadmin alcanza cualquiera', async () => {
    modelo.adjuntoPorId.mockResolvedValue({ id: 1, clave: 'k', abierto_por: 99 });
    const { error } = await llamar(ctrl.descargarAdjunto, {
      user: SUPER, params: { adjuntoId: '1' },
    });
    expect(error).toBeNull();
  });

  it('no se adjunta a un ticket ajeno', async () => {
    modelo.porId.mockResolvedValue({ id: '1', autorId: 99 });
    const { error } = await llamar(ctrl.subirAdjunto, {
      user: LAURA, params: { id: '1' }, file: { originalname: 'x.png', buffer: Buffer.from('x'), mimetype: 'image/png', size: 1 },
    });
    expect(error?.statusCode).toBe(404);
    expect(modelo.guardarAdjunto).not.toHaveBeenCalled();
  });
});

describe('abrir un ticket', () => {
  it('se guarda y AVISA POR LA CAMPANA', async () => {
    // No por correo: no hay buzón de soporte —«nosotros somos el soporte»— y
    // mandarlo a una dirección inventada sería darlo por hecho sin que llegue.
    modelo.crear.mockResolvedValue({ id: '7', title: 'Algo' });
    const { res, error } = await llamar(ctrl.crear, {
      user: LAURA, body: { title: 'El chat no carga' },
    });
    expect(error).toBeNull();
    expect(res.codigo).toBe(201);
    expect(modelo.crear).toHaveBeenCalledWith(expect.objectContaining({ abiertoPor: 4 }));
    expect(avisado).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ticket_nuevo', link_path: '/soporte', targetUserIds: [1, 2],
    }));
  });

  it('sin nadie a quien avisar NO se llama a notifyUsers (vacio significaria «todos»)', async () => {
    modelo.crear.mockResolvedValue({ id: '7', title: 'Algo' });
    modelo.destinatariosDelAviso.mockResolvedValueOnce([]);
    const { res } = await llamar(ctrl.crear, { user: LAURA, body: { title: 'El chat no carga' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(res.codigo).toBe(201);
    expect(avisado).not.toHaveBeenCalled();
  });

  it('si la campana falla, el ticket queda guardado igual', async () => {
    modelo.crear.mockResolvedValue({ id: '7', title: 'Algo' });
    avisado.mockRejectedValue(new Error('sin base'));
    const { res, error } = await llamar(ctrl.crear, { user: LAURA, body: { title: 'No carga nada' } });
    expect(error).toBeNull();
    expect(res.codigo).toBe(201);
  });

  it('si el correo falla, el ticket queda guardado igual', async () => {
    // Es lo que de verdad importaba: antes no se guardaba en ningún sitio.
    modelo.crear.mockResolvedValue({ id: '7', title: 'Algo' });
    enviado.mockRejectedValue(new Error('Brevo caido'));
    const { res, error } = await llamar(ctrl.crear, { user: LAURA, body: { title: 'El chat no carga' } });
    expect(error).toBeNull();
    expect(res.codigo).toBe(201);
  });

  it('sin título no se guarda nada', async () => {
    const { error } = await llamar(ctrl.crear, { user: LAURA, body: { description: 'solo esto' } });
    expect(error?.statusCode).toBe(400);
    expect(modelo.crear).not.toHaveBeenCalled();
  });
});

describe('los tiempos', () => {
  it('solo para quien administra', async () => {
    const { error } = await llamar(ctrl.tiempos, { user: LAURA, query: {} });
    expect(error?.statusCode).toBe(403);
  });

  it('un admin sí', async () => {
    const { error } = await llamar(ctrl.tiempos, { user: ADMIN, query: {} });
    expect(error).toBeNull();
  });
});

describe('los tiempos y los adjuntos respetan el mismo alcance (#245)', () => {
  it('un admin mide SUS campus aunque no pida ninguno', async () => {
    campus.mockResolvedValue([1, 2]);
    await llamar(ctrl.tiempos, { user: ADMIN, query: {} });
    expect(modelo.tiempos).toHaveBeenCalledWith({ projectId: null, projectIds: [1, 2] });
  });

  it('y si pide un campus que no es suyo, 403', async () => {
    campus.mockResolvedValue([1, 2]);
    const { error } = await llamar(ctrl.tiempos, { user: ADMIN, query: { projectId: '7' } });
    expect(error?.statusCode).toBe(403);
    expect(modelo.tiempos).not.toHaveBeenCalled();
  });

  it('superadmin mide todo', async () => {
    await llamar(ctrl.tiempos, { user: SUPER, query: {} });
    expect(modelo.tiempos).toHaveBeenCalledWith({ projectId: null, projectIds: null });
  });

  it('el adjunto de un ticket de otra empresa no lo descarga un admin', async () => {
    campus.mockResolvedValue([1]);
    modelo.adjuntoPorId.mockResolvedValue({ id: 5, clave: 'tickets/1/a.png', nombre: 'a.png', abierto_por: 99, ticket_project_id: 7 });
    const { error } = await llamar(ctrl.descargarAdjunto, { user: ADMIN, params: { adjuntoId: '5' }, query: {} });
    expect(error?.statusCode).toBe(404);
  });

  it('el de uno de sus campus sí, y con nosniff', async () => {
    campus.mockResolvedValue([1]);
    modelo.adjuntoPorId.mockResolvedValue({ id: 5, clave: 'tickets/1/a.png', nombre: 'a.png', mime: 'image/png', abierto_por: 99, ticket_project_id: 1 });
    const { res, error } = await llamar(ctrl.descargarAdjunto, { user: ADMIN, params: { adjuntoId: '5' }, query: {} });
    expect(error).toBeNull();
    expect(res.cabeceras['X-Content-Type-Options']).toBe('nosniff');
  });
});
