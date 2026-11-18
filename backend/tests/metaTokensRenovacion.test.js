import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

/**
 * Renovación diaria de los tokens de Meta e Instagram (#471), contra la base de
 * verdad y con la Graph API simulada (`fetch` falso: nada sale a la red).
 *
 *   · renueva el token y guarda el nuevo cifrado, con su caducidad;
 *   · si la renovación falla, avisa a los admins UNA vez (campana y correo);
 *   · si el token caduca en menos de 7 días, avisa (una vez por fecha);
 *   · apagada (sin META_TOKENS_RENOVACION_ACTIVA), no llama a Meta ni toca nada.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/metaTokensRenovacion.test.js
 */

const correos = vi.hoisted(() => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

const { default: pool } = await import('../src/shared/config/db.js');
const { vuelta, renovacionActiva, TIPO_AVISO } = await import('../src/jobs/metaTokensScheduler.js');
const { packToken, unpackToken } = await import('../src/modules/meta-ads/meta-ads.service.js');

const MARCA = `TOK471${Date.now().toString(36)}`;
const DIA = 86400 * 1000;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

let PROYECTO;
let CUENTA;
const TOKEN_VIEJO = 'token-de-prueba-viejo-0000000000000000';
const TOKEN_NUEVO = 'token-de-prueba-nuevo-1111111111111111';

// La Graph API de mentira: debug_token y fb_exchange_token, lo que diga cada prueba.
const graph = { debug: null, cambio: null };
const resp = (status, body) => ({ ok: status < 400, status, json: async () => body });
let fetchOriginal;

function fetchFalso() {
  return vi.fn(async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/debug_token')) return graph.debug(u.searchParams.get('input_token'));
    if (u.pathname.endsWith('/oauth/access_token')) return graph.cambio(u.searchParams.get('fb_exchange_token'));
    throw new Error(`llamada inesperada a ${u.hostname}${u.pathname}`);
  });
}

const debugQueCaduca = (enDias) => () => resp(200, {
  data: { is_valid: true, expires_at: Math.floor((Date.now() + enDias * DIA) / 1000) },
});

const avisos = async (motivo) => q(
  `SELECT * FROM admin_notifications
    WHERE type = $1 AND metadata->>'cuenta_id' = $2 AND metadata->>'tipo' = 'meta_ads'
      AND ($3::text IS NULL OR metadata->>'motivo' = $3)`,
  [TIPO_AVISO, String(CUENTA), motivo ?? null]
);
const correosDe = (motivo) => correos.sendEmail.mock.calls
  .filter(([a]) => String(a.clave || '').startsWith(`meta-token-${motivo}-meta_ads-${CUENTA}-`));
const estado = async () => (await q(
  `SELECT * FROM meta_tokens_renovacion WHERE tipo = 'meta_ads' AND cuenta_id = $1`, [CUENTA]))[0];
const tokenGuardado = async () => unpackToken((await q(
  `SELECT access_token_enc FROM meta_ad_accounts WHERE id = $1`, [CUENTA]))[0].access_token_enc);

beforeAll(async () => {
  [{ id: PROYECTO }] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]
  );
  // Un admin activo, para que haya a quién mandar el correo.
  await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin')`,
    [`${MARCA} Admin`, `admin@${MARCA.toLowerCase()}.test`]
  );
});

afterAll(async () => {
  await q(`DELETE FROM admin_notifications WHERE type = $1 AND metadata->>'project_id' = $2`, [TIPO_AVISO, String(PROYECTO)]);
  await q(`DELETE FROM meta_tokens_renovacion WHERE project_id = $1`, [PROYECTO]);
  await q(`DELETE FROM meta_ad_accounts WHERE project_id = $1`, [PROYECTO]);
  await q(`DELETE FROM users WHERE email = $1`, [`admin@${MARCA.toLowerCase()}.test`]);
  await q(`DELETE FROM projects WHERE id = $1`, [PROYECTO]);
});

beforeEach(async () => {
  process.env.META_TOKENS_RENOVACION_ACTIVA = '1';
  process.env.META_APP_ID = 'app-de-prueba';
  process.env.META_APP_SECRET = 'secreto-de-prueba';
  correos.sendEmail.mockClear();
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = fetchFalso();
  // Una cuenta nueva en cada prueba: así el estado y los avisos empiezan de cero.
  await q(`DELETE FROM meta_tokens_renovacion WHERE project_id = $1`, [PROYECTO]);
  await q(`DELETE FROM meta_ad_accounts WHERE project_id = $1`, [PROYECTO]);
  [{ id: CUENTA }] = await q(
    `INSERT INTO meta_ad_accounts (project_id, ad_account_id, access_token_enc, ad_account_nombre)
     VALUES ($1, $2, $3, 'Cuenta de prueba') RETURNING id`,
    [PROYECTO, `act_${MARCA}`, packToken(TOKEN_VIEJO)]
  );
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.META_TOKENS_RENOVACION_ACTIVA;
  delete process.env.META_APP_ID;
  delete process.env.META_APP_SECRET;
});

describe('Renovación diaria de tokens de Meta (#471)', () => {
  it('renueva el token que caduca pronto y guarda el nuevo cifrado con su caducidad', async () => {
    graph.debug = debugQueCaduca(15);
    graph.cambio = (viejo) => (viejo === TOKEN_VIEJO
      ? resp(200, { access_token: TOKEN_NUEVO, token_type: 'bearer', expires_in: 60 * 86400 })
      : resp(400, { error: { message: 'token desconocido', code: 190 } }));

    const r = await vuelta({ proyectoId: PROYECTO });
    expect(r).toMatchObject({ revisadas: 1, renovadas: 1, fallidas: 0, avisos: 0 });

    expect(await tokenGuardado()).toBe(TOKEN_NUEVO);
    const fila = (await q(`SELECT access_token_enc FROM meta_ad_accounts WHERE id = $1`, [CUENTA]))[0];
    expect(fila.access_token_enc).not.toContain(TOKEN_NUEVO); // cifrado, no en claro

    const e = await estado();
    expect(e.estado).toBe('ok');
    expect(e.renovado_at).not.toBeNull();
    const dias = (new Date(e.expires_at).getTime() - Date.now()) / DIA;
    expect(dias).toBeGreaterThan(59);
    expect(dias).toBeLessThan(61);
    expect(await avisos()).toHaveLength(0);
    expect(correos.sendEmail).not.toHaveBeenCalled();
  });

  it('con más de 40 días por delante no lo toca (solo apunta la caducidad)', async () => {
    graph.debug = debugQueCaduca(50);
    graph.cambio = vi.fn();
    const r = await vuelta({ proyectoId: PROYECTO });
    expect(r).toMatchObject({ revisadas: 1, renovadas: 0, fallidas: 0 });
    expect(graph.cambio).not.toHaveBeenCalled();
    expect(await tokenGuardado()).toBe(TOKEN_VIEJO);
    expect((await estado()).expires_at).not.toBeNull();
  });

  it('un token que no caduca (usuario del sistema) no se renueva ni avisa', async () => {
    graph.debug = () => resp(200, { data: { is_valid: true, expires_at: 0 } });
    graph.cambio = vi.fn();
    await vuelta({ proyectoId: PROYECTO });
    expect(graph.cambio).not.toHaveBeenCalled();
    const e = await estado();
    expect(e.estado).toBe('sin_caducidad');
    expect(e.sin_caducidad).toBe(true);
    expect(await avisos()).toHaveLength(0);
  });

  it('si la renovación falla, avisa a los admins una sola vez (campana y correo)', async () => {
    graph.debug = debugQueCaduca(20);
    graph.cambio = () => resp(400, { error: { message: 'Error validating access token: session invalidated', code: 190, error_subcode: 460 } });

    const r1 = await vuelta({ proyectoId: PROYECTO });
    expect(r1).toMatchObject({ revisadas: 1, renovadas: 0, fallidas: 1, avisos: 1 });
    await vuelta({ proyectoId: PROYECTO });
    await vuelta({ proyectoId: PROYECTO });

    const campana = await avisos('fallo');
    expect(campana).toHaveLength(1);
    expect(campana[0].link_path).toBe('/meta-ads');
    expect(campana[0].title).toContain('No se pudo renovar');
    expect(correosDe('fallo')).toHaveLength(1);
    const [correo] = correosDe('fallo')[0];
    expect(correo.to).toContain(`admin@${MARCA.toLowerCase()}.test`);
    expect(correo.htmlContent).toContain('session invalidated');
    expect(correo.htmlContent).not.toContain(TOKEN_VIEJO);

    const e = await estado();
    expect(e.estado).toBe('error');
    expect(e.ultimo_error).toContain('meta_190_460');
    expect(e.aviso_fallo_at).not.toBeNull();
    expect(await tokenGuardado()).toBe(TOKEN_VIEJO); // el viejo sigue ahí

    // Vuelve a ir bien: se olvida el aviso, y un fallo nuevo avisaría otra vez.
    graph.cambio = () => resp(200, { access_token: TOKEN_NUEVO, expires_in: 60 * 86400 });
    await vuelta({ proyectoId: PROYECTO });
    expect((await estado()).aviso_fallo_at).toBeNull();
    graph.debug = () => resp(200, { data: { is_valid: false, expires_at: 0, error: { message: 'token revocado' } } });
    await vuelta({ proyectoId: PROYECTO });
    expect(await avisos('fallo')).toHaveLength(2);
  });

  it('si el token caduca en menos de 7 días, avisa (una vez por fecha)', async () => {
    // Meta no siempre alarga un token largo: devuelve otro con la misma fecha.
    graph.debug = debugQueCaduca(3);
    graph.cambio = () => resp(200, { access_token: TOKEN_NUEVO, expires_in: 3 * 86400 });

    const r = await vuelta({ proyectoId: PROYECTO });
    expect(r).toMatchObject({ revisadas: 1, renovadas: 1, fallidas: 0, avisos: 1 });

    const campana = await avisos('caduca');
    expect(campana).toHaveLength(1);
    expect(campana[0].title).toContain('caduca pronto');
    expect(campana[0].message).toContain(`${MARCA} Campus`);
    expect(await avisos('fallo')).toHaveLength(0);
    expect(correosDe('caduca')).toHaveLength(1);
    const e = await estado();
    expect(e.estado).toBe('ok');
    expect(new Date(e.aviso_caduca_para).getTime()).toBe(new Date(e.expires_at).getTime());
  });

  it('a punto de caducar con la misma fecha: un solo aviso aunque se repita la vuelta', async () => {
    const exp = Math.floor((Date.now() + 2 * DIA) / 1000);
    graph.debug = () => resp(200, { data: { is_valid: true, expires_at: exp } });
    // Meta contesta sin expires_in: la fecha sale de preguntar por el nuevo, que es la misma.
    graph.cambio = () => resp(200, { access_token: TOKEN_NUEVO });
    await vuelta({ proyectoId: PROYECTO });
    await vuelta({ proyectoId: PROYECTO });
    await vuelta({ proyectoId: PROYECTO });
    expect(await avisos('caduca')).toHaveLength(1);
    expect(correosDe('caduca')).toHaveLength(1);
    expect(new Date((await estado()).expires_at).getTime()).toBe(exp * 1000);
  });

  it('apagada no llama a Meta ni toca la base', async () => {
    delete process.env.META_TOKENS_RENOVACION_ACTIVA;
    expect(renovacionActiva()).toBe(false);
    graph.debug = vi.fn(); graph.cambio = vi.fn();

    const r = await vuelta();
    expect(r).toEqual({ apagado: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(await estado()).toBeUndefined();
    expect(await tokenGuardado()).toBe(TOKEN_VIEJO);
    expect(await avisos()).toHaveLength(0);
    expect(correos.sendEmail).not.toHaveBeenCalled();

    process.env.META_TOKENS_RENOVACION_ACTIVA = '0';
    expect(await vuelta()).toEqual({ apagado: true });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sin la tabla de Instagram (#465 aún no está) la vuelta sigue con Meta Ads', async () => {
    const [{ hay }] = await q(`SELECT to_regclass('public.ig_accounts') IS NOT NULL AS hay`);
    graph.debug = debugQueCaduca(50);
    graph.cambio = vi.fn();
    const r = await vuelta({ proyectoId: PROYECTO });
    if (!hay) expect(r.revisadas).toBe(1);
    expect(r.fallidas).toBe(0);
  });
});
