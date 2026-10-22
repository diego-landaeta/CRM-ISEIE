import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #223 (gemela de MultiCRM #384) · Ver Diplomas (Certifex) sin ser admin: QUIEN pasa por cada ruta.
 *
 * Diego: «Adriana, Daniela, Yosbely, Dayana, Mireia y Ana deben de tener para
 * ver los de Certifex». VER: las lecturas de la pantalla Diplomas las pasa
 * admin/superadmin por su rol O quien tenga `diplomas.view`. Todo lo que
 * escribe sigue siendo de admin/superadmin, tenga quien tenga el permiso, y el
 * `roleGuard` general no se abre para nadie.
 *
 * Aquí se prueban los guardias de certifex.routes.js con los controladores
 * doblados (sin base ni Certifex): cada ruta contesta 200 si la alcanza. Que
 * lo que se ve sea solo de sus campus está en certifexDiplomasSoloLectura.test.js.
 */

const conPermiso = new Set();
vi.mock('../src/modules/permissions/permissions.service.js', () => ({
  resolvePermission: vi.fn(async (userId, _role, _custom, resource, action) =>
    conPermiso.has(`${userId}:${resource}.${action}`)),
}));
const alcanzado = vi.hoisted(() => []);
const handler = (nombre) => (req, res) => { alcanzado.push(nombre); res.json({ success: true, data: nombre }); };
vi.mock('../src/modules/certifex/certifex.controller.js', () => Object.fromEntries(
  ['recibir', 'recibirSolicitud', 'recibirCompletado', 'listar', 'actualizar'].map((n) => [n, handler(`ctrl.${n}`)])));
vi.mock('../src/modules/certifex/certifex.emisiones.js', () => Object.fromEntries(
  ['estado', 'centros', 'cursos', 'listar', 'decidir', 'emitir', 'diploma', 'logo'].map((n) => [n, handler(`emisiones.${n}`)])));
vi.mock('../src/modules/certifex/certifex.diplomas.js', () => Object.fromEntries(
  ['resumen', 'solicitudes', 'porAvisar', 'terminados', 'aprobarEmitir', 'emitir', 'rechazar', 'avisos', 'avisosRechazo',
    'revocar', 'corregir', 'editar', 'subirFirma', 'verFirma', 'nuevo', 'formaciones', 'sincronizarFormacion', 'diplomas',
    'pedir',
  ].map((n) => [n, handler(`diplomas.${n}`)])));

const { default: express } = await import('express');
const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: router } = await import('../src/modules/certifex/certifex.routes.js');

const app = express();
app.use(express.json());
app.use('/api/certifex', router);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, code: err.code }));
const request = supertest(app);

const token = (userId, role, roles_extra = []) =>
  jwt.sign({ userId, email: `u${userId}@prueba.test`, role, roles_extra }, process.env.JWT_SECRET, { expiresIn: '5m' });
const GESTORA = token(31, 'gestor');
const GESTORA_CON_PERMISO = token(32, 'gestor');
const ADMIN = token(33, 'admin');
const SUPER = token(34, 'superadmin');
const SOPORTE = token(35, 'soporte');
const GESTORA_ADMIN_DE_MAS = token(36, 'gestor', ['admin']);

// Lo que pinta la pantalla Diplomas: estado, campus, formaciones del filtro,
// contadores, las cinco listas, el logo de cada campus y el PDF digital.
const LECTURAS = [
  '/emisiones/estado', '/emisiones/centros', '/emisiones/cursos?centro=ISEIE', '/emisiones/logo?ruta=/images/x.png',
  '/emisiones/diploma/CTF-2026-000001-AAAA',
  '/diplomas/resumen', '/diplomas/solicitudes', '/diplomas/por-avisar', '/diplomas/terminados', '/diplomas',
];
// Todo lo que escribe, y las lecturas que no son de esta pantalla.
const ESCRITURAS = [
  ['post', '/diplomas/aprobar-emitir'], ['post', '/diplomas/emitir'], ['post', '/diplomas/rechazar'],
  ['post', '/diplomas/avisos'], ['post', '/diplomas/avisos-rechazo'], ['post', '/diplomas/revocar'],
  ['post', '/diplomas/corregir'], ['post', '/diplomas/editar'], ['post', '/diplomas/firma'],
  ['post', '/diplomas/nuevo'], ['post', '/diplomas/formaciones/sincronizar'], ['post', '/diplomas/pedir'],
  ['post', '/emisiones/decisiones'], ['post', '/emisiones/emitir'], ['patch', '/consultas/7'],
];
const OTRAS_LECTURAS = ['/diplomas/formaciones?centro=ISEIE', '/diplomas/firma/7', '/emisiones', '/consultas'];

const pedir = (metodo, ruta, t) => request[metodo](`/api/certifex${ruta}`).set('Authorization', `Bearer ${t}`).send({});

beforeEach(() => {
  conPermiso.clear();
  conPermiso.add('32:diplomas.view');
  alcanzado.length = 0;
});

describe('las lecturas de Diplomas', () => {
  it('una gestora sin el permiso: 403 en todas, y no llega a ningún controlador', async () => {
    for (const ruta of LECTURAS) expect((await pedir('get', ruta, GESTORA)).status, ruta).toBe(403);
    expect(alcanzado).toEqual([]);
  });

  it('una gestora con diplomas.view: 200 en todas', async () => {
    for (const ruta of LECTURAS) expect((await pedir('get', ruta, GESTORA_CON_PERMISO)).status, ruta).toBe(200);
    expect(alcanzado).toHaveLength(LECTURAS.length);
  });

  it('admin y superadmin, por su rol, aunque no tengan el permiso a mano', async () => {
    for (const t of [ADMIN, SUPER, GESTORA_ADMIN_DE_MAS]) {
      for (const ruta of LECTURAS) expect((await pedir('get', ruta, t)).status, ruta).toBe(200);
    }
  });

  it('soporte, como antes: sin el permiso no ve Diplomas', async () => {
    for (const ruta of LECTURAS) expect((await pedir('get', ruta, SOPORTE)).status, ruta).toBe(403);
  });

  it('sin sesión, 401', async () => {
    expect((await request.get('/api/certifex/diplomas')).status).toBe(401);
  });
});

describe('lo que escribe sigue siendo de administración', () => {
  it('una gestora con diplomas.view: 403 en todo lo que escribe y en lo que no es de la pantalla', async () => {
    for (const [metodo, ruta] of ESCRITURAS) expect((await pedir(metodo, ruta, GESTORA_CON_PERMISO)).status, ruta).toBe(403);
    for (const ruta of OTRAS_LECTURAS) expect((await pedir('get', ruta, GESTORA_CON_PERMISO)).status, ruta).toBe(403);
    expect(alcanzado).toEqual([]);
  });

  it('el admin, todo como antes', async () => {
    for (const [metodo, ruta] of ESCRITURAS) expect((await pedir(metodo, ruta, ADMIN)).status, ruta).toBe(200);
    for (const ruta of OTRAS_LECTURAS) expect((await pedir('get', ruta, ADMIN)).status, ruta).toBe(200);
  });

  it('soporte: las consultas de la web sí (como antes), lo de Diplomas y Emisiones no', async () => {
    expect((await pedir('get', '/consultas', SOPORTE)).status).toBe(200);
    expect((await pedir('get', '/emisiones', SOPORTE)).status).toBe(403);
    expect((await pedir('post', '/diplomas/aprobar-emitir', SOPORTE)).status).toBe(403);
  });

  it('las entregas de Certifex siguen sin sesión (las protege su secreto, en el controlador)', async () => {
    for (const ruta of ['/consultas', '/solicitudes', '/completados']) {
      expect((await request.post(`/api/certifex${ruta}`).send({})).status, ruta).toBe(200);
    }
  });
});
