import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Emitir diplomas sin ser admin (`diplomas.emit`): QUIEN pasa por cada ruta.
 *
 * Diego, 22/10/2026: «que Dayana pueda emitir, no la dejan; puede hacerlo». La misma
 * clave y las mismas rutas que en MultiCRM (paridad): hasta ahora quien no era admin veia
 * Diplomas por `diplomas.view` (#223) y emitir era solo de admin.
 * Con `diplomas.emit` hace el recorrido de emitir (revisar, aprobar y emitir,
 * reintentar, enviar el diploma al alumno y «Nuevo diploma») y ademas VE Diplomas, sin
 * necesitar tambien `diplomas.view`. Lo que sigue siendo de administracion no se le
 * abre: rechazar, el aviso de rechazo, revocar, corregir, la firma, sincronizar el
 * temario y todo /emisiones/*.
 *
 * Aqui se prueban los guardias de certifex.routes.js con los controladores doblados
 * (sin base ni Certifex): cada ruta contesta 200 si la alcanza. Que lo haga solo en sus
 * campus esta en certifexEmitirAlcance.test.js.
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
const GESTORA = token(51, 'gestor');
const GESTORA_SOLO_VE = token(52, 'gestor');
const GESTORA_EMITE = token(53, 'gestor'); // emitir, y nada mas
const ADMIN = token(54, 'admin');
const SUPER = token(55, 'superadmin');

// El recorrido de emitir: lo que pasa con `diplomas.emit`.
const EMITIR = [
  ['post', '/diplomas/editar'], ['post', '/diplomas/aprobar-emitir'], ['post', '/diplomas/emitir'],
  ['post', '/diplomas/avisos'], ['post', '/diplomas/nuevo'], ['get', '/diplomas/formaciones?centro=ICTESS'],
];
// Lo que sigue siendo solo de administracion, aunque se emita.
const SOLO_ADMIN = [
  ['post', '/diplomas/rechazar'], ['post', '/diplomas/avisos-rechazo'], ['post', '/diplomas/revocar'],
  ['post', '/diplomas/corregir'], ['post', '/diplomas/firma'], ['get', '/diplomas/firma/7'],
  ['post', '/diplomas/formaciones/sincronizar'],
  ['get', '/emisiones'], ['post', '/emisiones/decisiones'], ['post', '/emisiones/emitir'],
  ['get', '/consultas'], ['patch', '/consultas/7'],
];
// Lo que pinta la pantalla Diplomas.
const LECTURAS = [
  '/emisiones/estado', '/emisiones/centros', '/emisiones/cursos?centro=ICTESS', '/emisiones/logo?ruta=/images/x.png',
  '/emisiones/diploma/CTF-2026-000001-AAAA',
  '/diplomas/resumen', '/diplomas/solicitudes', '/diplomas/por-avisar', '/diplomas/terminados', '/diplomas',
];

const pedir = (metodo, ruta, t) => request[metodo](`/api/certifex${ruta}`).set('Authorization', `Bearer ${t}`).send({});

beforeEach(() => {
  conPermiso.clear();
  conPermiso.add('52:diplomas.view');
  conPermiso.add('53:diplomas.emit');
  alcanzado.length = 0;
});

describe('emitir diplomas: el recorrido', () => {
  it('una gestora sin permisos: 403 en todo, y no llega a ningún controlador', async () => {
    for (const [metodo, ruta] of EMITIR) expect((await pedir(metodo, ruta, GESTORA)).status, ruta).toBe(403);
    expect(alcanzado).toEqual([]);
  });

  it('una gestora que solo VE (diplomas.view): 403 al aprobar, emitir, editar, enviar y crear', async () => {
    for (const [metodo, ruta] of EMITIR) expect((await pedir(metodo, ruta, GESTORA_SOLO_VE)).status, ruta).toBe(403);
    expect(alcanzado).toEqual([]);
  });

  it('una gestora con diplomas.emit: llega a cada paso del recorrido', async () => {
    for (const [metodo, ruta] of EMITIR) expect((await pedir(metodo, ruta, GESTORA_EMITE)).status, ruta).toBe(200);
    expect(alcanzado).toEqual([
      'diplomas.editar', 'diplomas.aprobarEmitir', 'diplomas.emitir', 'diplomas.avisos', 'diplomas.nuevo', 'diplomas.formaciones',
    ]);
  });

  it('con diplomas.emit también VE la pantalla, sin necesitar además diplomas.view', async () => {
    for (const ruta of LECTURAS) expect((await pedir('get', ruta, GESTORA_EMITE)).status, ruta).toBe(200);
  });

  it('admin y superadmin, por su rol, como antes', async () => {
    for (const t of [ADMIN, SUPER]) {
      for (const [metodo, ruta] of EMITIR) expect((await pedir(metodo, ruta, t)).status, ruta).toBe(200);
    }
  });
});

describe('lo que sigue siendo de administración', () => {
  it('una gestora con diplomas.emit: 403 al rechazar, avisar del rechazo, revocar, corregir, la firma, el temario y Emisiones', async () => {
    for (const [metodo, ruta] of SOLO_ADMIN) expect((await pedir(metodo, ruta, GESTORA_EMITE)).status, ruta).toBe(403);
    expect(alcanzado).toEqual([]);
  });

  it('el admin, todo como antes', async () => {
    for (const [metodo, ruta] of SOLO_ADMIN) expect((await pedir(metodo, ruta, ADMIN)).status, ruta).toBe(200);
  });
});
