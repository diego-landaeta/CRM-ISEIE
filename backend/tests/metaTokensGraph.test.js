import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  inspeccionarTokenMeta, renovarTokenMeta, renovarTokenInstagram, appDeMeta,
} from '../src/shared/services/metaTokens.service.js';

/**
 * Las llamadas a la Graph API de la renovación de tokens (#471), con `fetch`
 * simulado: ninguna sale a la red.
 */

const APP = { appId: 'app-de-prueba', appSecret: 'secreto-de-prueba' };
const respuesta = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('Graph API de la renovación de tokens (#471)', () => {
  let fetchOriginal;
  beforeEach(() => { fetchOriginal = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    delete process.env.META_APP_ID; delete process.env.META_APP_SECRET;
    delete process.env.IG_APP_ID; delete process.env.IG_APP_SECRET;
  });

  it('Meta Ads: cambia el token con grant_type=fb_exchange_token', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(200, { access_token: 'token-nuevo', expires_in: 5184000 }));
    const r = await renovarTokenMeta({ token: 'token-viejo', ...APP });
    expect(r).toEqual({ ok: true, accessToken: 'token-nuevo', expiresIn: 5184000 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.hostname).toBe('graph.facebook.com');
    expect(url.pathname).toMatch(/\/oauth\/access_token$/);
    expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
    expect(url.searchParams.get('fb_exchange_token')).toBe('token-viejo');
    expect(url.searchParams.get('client_id')).toBe('app-de-prueba');
  });

  it('Instagram: renueva con grant_type=ig_refresh_token en graph.instagram.com', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(200, { access_token: 'ig-nuevo', token_type: 'bearer', expires_in: 5183944 }));
    const r = await renovarTokenInstagram({ token: 'ig-viejo' });
    expect(r).toEqual({ ok: true, accessToken: 'ig-nuevo', expiresIn: 5183944 });
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.origin).toBe('https://graph.instagram.com');
    expect(url.pathname).toBe('/refresh_access_token');
    expect(url.searchParams.get('grant_type')).toBe('ig_refresh_token');
    expect(url.searchParams.get('access_token')).toBe('ig-viejo');
  });

  it('debug_token: válido con fecha, y expires_at = 0 es «no caduca»', async () => {
    const exp = Math.floor(Date.now() / 1000) + 86400 * 30;
    globalThis.fetch = vi.fn(async () => respuesta(200, { data: { is_valid: true, expires_at: exp } }));
    const r = await inspeccionarTokenMeta({ token: 't', ...APP });
    expect(r.ok).toBe(true);
    expect(r.valido).toBe(true);
    expect(r.sinCaducidad).toBe(false);
    expect(r.expiresAt.getTime()).toBe(exp * 1000);
    const url = new URL(globalThis.fetch.mock.calls[0][0]);
    expect(url.searchParams.get('access_token')).toBe('app-de-prueba|secreto-de-prueba');

    globalThis.fetch = vi.fn(async () => respuesta(200, { data: { is_valid: true, expires_at: 0 } }));
    const s = await inspeccionarTokenMeta({ token: 't', ...APP });
    expect(s.sinCaducidad).toBe(true);
    expect(s.expiresAt).toBeNull();
  });

  it('el error de Meta vuelve como { ok:false, code, message }, sin lanzar', async () => {
    globalThis.fetch = vi.fn(async () => respuesta(400, {
      error: { message: 'Error validating access token: Session has expired', code: 190, error_subcode: 463 },
    }));
    const r = await renovarTokenInstagram({ token: 'ig-viejo' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('meta_190_463');
    expect(r.message).toContain('Session has expired');
    expect(r.message).not.toContain('ig-viejo');
  });

  it('fallo de red y respuesta sin access_token', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNRESET'); });
    expect(await renovarTokenMeta({ token: 't', ...APP })).toMatchObject({ ok: false, code: 'network_error' });
    globalThis.fetch = vi.fn(async () => respuesta(200, {}));
    expect(await renovarTokenMeta({ token: 't', ...APP })).toMatchObject({ ok: false, code: 'no_access_token' });
  });

  it('sin la app de Meta no se llama a nadie', async () => {
    globalThis.fetch = vi.fn();
    expect(await renovarTokenMeta({ token: 't', appId: '', appSecret: '' })).toMatchObject({ ok: false, code: 'missing_app_config' });
    expect(await inspeccionarTokenMeta({ token: 't', appId: '', appSecret: '' })).toMatchObject({ ok: false, code: 'missing_app_config' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('la app sale de META_APP_* y, si no, de IG_APP_*', () => {
    process.env.IG_APP_ID = 'ig-id'; process.env.IG_APP_SECRET = 'ig-sec';
    expect(appDeMeta()).toEqual({ appId: 'ig-id', appSecret: 'ig-sec' });
    process.env.META_APP_ID = 'meta-id'; process.env.META_APP_SECRET = 'meta-sec';
    expect(appDeMeta()).toEqual({ appId: 'meta-id', appSecret: 'meta-sec' });
  });
});
