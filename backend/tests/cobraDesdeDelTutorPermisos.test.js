import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * PATCH /api/tutores/:id/cobra-desde — quien puede y con que fecha.
 *
 * Mover la fecha desde la que cobra un tutor es mover dinero. Los mismos
 * permisos que editar una colaboracion (`exigirGestion`: admin, superadmin o la
 * casilla `gestor_colaboraciones`) y el recorte por campus de su ficha (#245).
 * El propio tutor NO: su perfil si lo toca, pero esto no.
 *
 * El modelo esta en cobraDesdeDelTutor.test.js; aqui va doblado.
 */

const esGestor = vi.fn(async () => false);
const tieneCampus = vi.fn(async () => true);
const cambiar = vi.fn(async (id, desde) => ({ desde, total: 0, cambiadas: [], noCambiadas: [], sinCambio: 0 }));

vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(async () => ({ rows: [] })), getClient: vi.fn() }));
vi.mock('../src/modules/tutores/tutor.model.js', () => ({
  esGestorColaboraciones: (...a) => esGestor(...a),
  tieneAlgunCampus: (...a) => tieneCampus(...a),
  cambiarCobraDesde: (...a) => cambiar(...a),
  ESTADOS_COMISION: [],
}));
vi.mock('../src/modules/users/user.service.js', () => ({}));
vi.mock('../src/modules/dossiers/dossier.service.js', () => ({}));
vi.mock('../src/shared/utils/ambito.js', () => ({
  proyectosDelAmbito: vi.fn(),
  veTodoElCrm: (u) => u.role === 'superadmin',
  campusDeLaPersona: vi.fn(async () => [5]),
}));

const ctrl = await import('../src/modules/tutores/tutor.controller.js');

const llamar = async (req) => {
  let error = null; let cuerpo = null;
  await ctrl.cambiarCobraDesde(req, { json: (b) => { cuerpo = b; }, status() { return this; } }, (e) => { error = e; });
  return { error, cuerpo };
};

const pedir = (user, body = { desde: '2025-10-20' }, id = '21') => llamar({ params: { id }, body, user: registrar(user) });

beforeEach(() => {
  esGestor.mockReset().mockResolvedValue(false);
  tieneCampus.mockReset().mockResolvedValue(true);
  cambiar.mockClear();
});

describe('quien puede', () => {
  it('un admin lo cambia y se le devuelve el resultado', async () => {
    const { error, cuerpo } = await pedir({ userId: 1, role: 'admin' });
    expect(error).toBeNull();
    expect(cambiar).toHaveBeenCalledWith(21, '2025-10-20');
    expect(cuerpo.success).toBe(true);
  });

  it('quien tiene «Gestionar colaboraciones» (antes, la casilla), tambien', async () => {
    const { error } = await pedir({ userId: 9, role: 'gestor', excepciones: { 'tutores.gestionar': true } });
    expect(error).toBeNull();
    expect(cambiar).toHaveBeenCalled();
  });

  it('una gestora sin la casilla, no (403)', async () => {
    const { error } = await pedir({ userId: 9, role: 'gestor' });
    expect(error?.statusCode).toBe(403);
    expect(cambiar).not.toHaveBeenCalled();
  });

  it('el propio tutor, no: la fecha desde la que cobra no la decide el', async () => {
    const { error } = await pedir({ userId: 21, role: 'tutor' });
    expect(error?.statusCode).toBe(403);
    expect(cambiar).not.toHaveBeenCalled();
  });

  it('un tutor de otro campus no existe para quien lo pide (404, #245)', async () => {
    tieneCampus.mockResolvedValue(false);
    const { error } = await pedir({ userId: 1, role: 'admin' });
    expect(error?.statusCode).toBe(404);
    expect(cambiar).not.toHaveBeenCalled();
  });
});

describe('la fecha', () => {
  it('una que no existe se rechaza antes de llegar a la base', async () => {
    const { error } = await pedir({ userId: 1, role: 'admin' }, { desde: '2026-02-30' });
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toMatch(/no existe/);
    expect(cambiar).not.toHaveBeenCalled();
  });

  it('sin fecha o con otro formato, 400', async () => {
    for (const body of [{}, { desde: '20/10/2025' }, { desde: null }]) {
      const { error } = await pedir({ userId: 1, role: 'admin' }, body);
      expect(error?.statusCode).toBe(400);
    }
    expect(cambiar).not.toHaveBeenCalled();
  });

  it('un identificador que no es un numero, 400', async () => {
    const { error } = await pedir({ userId: 1, role: 'admin' }, { desde: '2025-10-20' }, 'abc');
    expect(error?.statusCode).toBe(400);
    expect(cambiar).not.toHaveBeenCalled();
  });
});
