import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El inicio de sesión OAuth para Claude (02/10).
 *
 * Diego, con su cuenta de Claude del plan gratuito: «Couldn't register with CRM
 * PRODUCCIÓN's sign-in service». El MCP contestaba bien; lo que faltaba era el
 * OAuth que esa cuenta exige al pulsar «Connect». Aquí se prueba el recorrido
 * entero, con la base simulada: la llave es la URL personal, y sin ella —o con
 * una anulada, o volviendo a una web que no es de Claude— no se entra.
 */

const LLAVE = `crm_mcp_${'a'.repeat(43)}`;
const ANULADA = `crm_mcp_${'b'.repeat(43)}`;

const model = {
  findTokenVivo: vi.fn(),
  findUserById: vi.fn(),
};
vi.mock('../src/modules/mcp/mcp.model.js', () => model);

// #326: `/token` ya no devuelve la llave de la URL, sino la de una conexión
// nueva de ese Claude (pendiente hasta que el dueño la autoriza).
const LLAVE_CONEXION = `crm_mcc_${'c'.repeat(43)}`;
const LLAVE_RENOVADA = `crm_mcc_${'d'.repeat(43)}`;
const conexiones = {
  crear: vi.fn(async () => ({ id: 9, llave: LLAVE_CONEXION, estado: 'pendiente' })),
  renovarLlave: vi.fn(async (id) => (id === 9 ? { id: 9, llave: LLAVE_RENOVADA } : null)),
};
vi.mock('../src/modules/mcp/mcp.conexiones.js', () => conexiones);
// «Usar el MCP» sale del catálogo (#230, gemela de CRM#423): el resolver de
// verdad, sin base, con el superadmin del token (id 2).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
(await import('./helpers/permisosSinBase.js')).registrar({ userId: 2, role: 'superadmin' });

const { huella } = await import('../src/modules/mcp/mcp.acceso.js');
const { default: oauth, secretoDe, vueltaPermitida, sellar } = await import('../src/modules/mcp/mcp.oauth.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/mcp/oauth', oauth);

const VUELTA = 'https://claude.ai/api/mcp/auth_callback';
const RECURSO = `https://360crm.tech/testeo/api/mcp/u/${LLAVE}`;
const verificador = crypto.randomBytes(32).toString('base64url');
const reto = crypto.createHash('sha256').update(verificador).digest('base64url');

beforeEach(() => {
  conexiones.crear.mockClear();
  conexiones.renovarLlave.mockClear();
  model.findTokenVivo.mockReset();
  model.findUserById.mockReset();
  model.findTokenVivo.mockImplementation(async (h) => (h === huella(LLAVE) ? { token_id: 7, user_id: 2, connector_id: null } : null));
  model.findUserById.mockResolvedValue({ id: 2, role: 'superadmin', active: true, usa_mcp: false });
});

const autorizar = (extra = {}) => request(app).get('/api/mcp/oauth/authorize').query({
  response_type: 'code', client_id: 'crm-x', redirect_uri: VUELTA, state: 'st1',
  code_challenge: reto, code_challenge_method: 'S256', resource: RECURSO, ...extra,
});

const codigoDe = (res) => new URL(res.headers.location).searchParams.get('code');

describe('lo que Claude busca para iniciar sesión', () => {
  it('los datos del recurso, con el prefijo del entorno', async () => {
    const r = await request(app).get(`/api/mcp/oauth/recurso/mcp/u/${LLAVE}`)
      .set('X-Forwarded-Prefix', '/testeo').set('X-Forwarded-Proto', 'https').set('Host', '360crm.tech');
    expect(r.status).toBe(200);
    expect(r.body.resource).toBe(RECURSO);
    expect(r.body.authorization_servers).toEqual(['https://360crm.tech/testeo/api/mcp/oauth']);
  });

  it('los datos del servidor, con PKCE S256 y sin secreto de cliente', async () => {
    const r = await request(app).get('/api/mcp/oauth/metadatos')
      .set('X-Forwarded-Prefix', '/crm').set('X-Forwarded-Proto', 'https').set('Host', '360crm.tech');
    expect(r.body.issuer).toBe('https://360crm.tech/crm/api/mcp/oauth');
    expect(r.body.token_endpoint).toBe('https://360crm.tech/crm/api/mcp/oauth/token');
    expect(r.body.code_challenge_methods_supported).toEqual(['S256']);
    expect(r.body.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  it('el registro acepta a Claude y rechaza otras webs', async () => {
    const bien = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: [VUELTA], client_name: 'Claude' });
    expect(bien.status).toBe(201);
    expect(bien.body.client_id).toMatch(/^crm-/);
    const mal = await request(app).post('/api/mcp/oauth/register').send({ redirect_uris: ['https://evil.example/cb'] });
    expect(mal.status).toBe(400);
  });
});

describe('el recorrido entero', () => {
  it('con la URL personal válida: código, y el código por la llave', async () => {
    const a = await autorizar();
    expect(a.status).toBe(302);
    expect(a.headers.location.startsWith(VUELTA)).toBe(true);
    expect(new URL(a.headers.location).searchParams.get('state')).toBe('st1');
    const codigo = codigoDe(a);
    // El código va cifrado: la llave no se lee en él.
    expect(codigo).not.toContain(LLAVE);

    const t = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'authorization_code', code: codigo, code_verifier: verificador, redirect_uri: VUELTA, client_id: 'crm-x',
    });
    expect(t.status).toBe(200);
    // #326: la llave de una conexión nueva de este Claude, nunca la de la URL.
    expect(t.body.access_token).toBe(LLAVE_CONEXION);
    expect(t.body.access_token).not.toBe(LLAVE);
    expect(conexiones.crear).toHaveBeenCalledWith({ secreto: LLAVE, vuelta: VUELTA });
    expect(t.body.token_type).toBe('Bearer');

    // Y el refresco da la llave de ESA conexión (la misma, ver mcp.conexiones.js) mientras la URL siga viva.
    const r = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token', refresh_token: t.body.refresh_token,
    });
    expect(r.body.access_token).toBe(LLAVE_RENOVADA);
    expect(conexiones.renovarLlave).toHaveBeenCalledWith(9);
    expect(conexiones.crear).toHaveBeenCalledTimes(1);
  });

  it('un refresco de antes de la #326 (sin conexión) crea una conexión nueva, que queda pendiente', async () => {
    const viejo = sellar({ t: 'refresco', s: LLAVE, exp: Date.now() + 60000 });
    const r = await request(app).post('/api/mcp/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: viejo });
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBe(LLAVE_CONEXION);
    expect(conexiones.crear).toHaveBeenCalledWith({ secreto: LLAVE, vuelta: '' });
  });

  it('el refresco de una conexión que ya no existe: hay que volver a conectar', async () => {
    const huerfano = sellar({ t: 'refresco', s: LLAVE, x: 99, exp: Date.now() + 60000 });
    const r = await request(app).post('/api/mcp/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: huerfano });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_grant');
  });

  it('sin el verificador PKCE correcto no se canjea', async () => {
    const codigo = codigoDe(await autorizar());
    const t = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'authorization_code', code: codigo, code_verifier: 'otro'.repeat(12), redirect_uri: VUELTA,
    });
    expect(t.status).toBe(400);
    expect(t.body.error).toBe('invalid_grant');
  });

  it('un código manipulado no vale', async () => {
    const codigo = codigoDe(await autorizar());
    const t = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'authorization_code', code: `${codigo.slice(0, -4)}AAAA`, code_verifier: verificador,
    });
    expect(t.body.error).toBe('invalid_grant');
  });

  it('una URL anulada se rechaza al autorizar', async () => {
    const a = await autorizar({ resource: `https://360crm.tech/crm/api/mcp/u/${ANULADA}` });
    expect(new URL(a.headers.location).searchParams.get('error')).toBe('access_denied');
  });

  it('si la URL se anula después, el refresco deja de funcionar', async () => {
    const codigo = codigoDe(await autorizar());
    const t = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'authorization_code', code: codigo, code_verifier: verificador,
    });
    model.findTokenVivo.mockResolvedValue(null);
    const r = await request(app).post('/api/mcp/oauth/token').type('form').send({
      grant_type: 'refresh_token', refresh_token: t.body.refresh_token,
    });
    expect(r.body.error).toBe('invalid_grant');
  });

  it('un tutor no entra, aunque tenga URL', async () => {
    model.findUserById.mockResolvedValue({ id: 9, role: 'tutor', active: true, usa_mcp: true });
    const a = await autorizar();
    expect(new URL(a.headers.location).searchParams.get('error')).toBe('access_denied');
  });

  it('nunca se devuelve el código a una web que no es de Claude', async () => {
    const a = await autorizar({ redirect_uri: 'https://evil.example/cb' });
    expect(a.status).toBe(400);
    expect(a.headers.location).toBeUndefined();
  });

  it('sin PKCE S256 no hay código', async () => {
    const a = await autorizar({ code_challenge_method: 'plain' });
    expect(new URL(a.headers.location).searchParams.get('error')).toBe('invalid_request');
    expect(new URL(a.headers.location).searchParams.get('code')).toBeNull();
  });
});

describe('piezas', () => {
  it('saca la llave de la URL personal y de nada más', () => {
    expect(secretoDe(RECURSO)).toBe(LLAVE);
    expect(secretoDe(`https://crm.iseie.com/api/mcp/u/${LLAVE}`)).toBe(LLAVE);
    expect(secretoDe('https://360crm.tech/crm/api/mcp')).toBeNull();
    expect(secretoDe('https://360crm.tech/crm/api/mcp/u/corta')).toBeNull();
  });

  it('las vueltas permitidas', () => {
    expect(vueltaPermitida('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(vueltaPermitida('https://claude.com/api/mcp/auth_callback')).toBe(true);
    expect(vueltaPermitida('http://localhost:33418/callback')).toBe(true);
    expect(vueltaPermitida('https://claude.ai.evil.example/cb')).toBe(false);
    expect(vueltaPermitida('https://evil.example/https://claude.ai/')).toBe(false);
  });
});
