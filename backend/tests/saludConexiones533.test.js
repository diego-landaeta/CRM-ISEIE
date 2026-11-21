import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CRM#533 · La salud de las conexiones de cada campus, sin base y sin red: la
 * base es un modelo simulado y Stripe, Brevo, Moodle y la tienda son funciones
 * de pega. Lo que importa:
 *
 *   · cada conexión dice bien / atención / caída con su última señal y el motivo;
 *   · el caso que lo pidió: el token de Moodle de FONO no vale → rojo con el
 *     motivo, y al arreglarlo → verde;
 *   · el webhook de Stripe desactivado se dice, sin pintar la casilla de rojo;
 *   · ni una clave en la respuesta, ni en los motivos;
 *   · «Comprobar ahora» usa las pruebas de siempre, apunta el resultado y no
 *     repite lo comprobado hace menos de un minuto.
 *
 *   npx vitest run tests/saludConexiones533.test.js
 */

const base = vi.hoisted(() => ({
  campus: [], integraciones: [], claves: [], stripe: [], recepciones: [], comprobaciones: [], plugin: [],
  woo: [], credWoo: {}, meta: [], admision: [], transferencias: [], correos: {}, guardadas: [], tarjetas: [],
}));

vi.mock('../src/modules/integrations/salud.model.js', () => ({
  existeTabla: async () => true,
  campus: async (ids) => base.campus.filter((c) => ids.includes(c.id)),
  integraciones: async (ids) => base.integraciones.filter((i) => ids.includes(i.project_id)),
  credenciales: async (ids) => base.claves.filter((k) => (k.project_id == null ? k.service === 'brevo' : ids.includes(k.project_id))),
  stripe: async () => base.stripe,
  recepciones: async () => base.recepciones,
  comprobaciones: async (ids) => base.comprobaciones.filter((x) => ids.includes(x.project_id)),
  guardarComprobacion: async (fila) => {
    base.guardadas.push(fila);
    const previa = base.comprobaciones.find((x) => x.project_id === fila.projectId && x.conexion === fila.conexion);
    const ahora = new Date().toISOString();
    const nueva = { project_id: fila.projectId, conexion: fila.conexion, ok: fila.ok, mensaje: fila.mensaje, comprobado_at: ahora, ultimo_ok_at: fila.ok ? ahora : previa?.ultimo_ok_at ?? null };
    base.comprobaciones = [...base.comprobaciones.filter((x) => x !== previa), nueva];
  },
  pluginMoodle: async () => base.plugin,
  wooCommerce: async () => base.woo,
  credencialesWoo: async (pid) => base.credWoo[pid] || null,
  meta: async () => base.meta,
  correosDelCrm: async () => base.correos,
  admision: async () => base.admision,
  transferencias: async () => base.transferencias,
}));

vi.mock('../src/modules/integrations/integrations.model.js', () => ({
  recordTestResult: async (fila) => {
    base.tarjetas.push(fila);
    const i = base.integraciones.find((x) => x.project_id === fila.projectId && x.provider === fila.provider);
    if (i) Object.assign(i, { last_test_status: fila.status, last_test_message: fila.message, last_test_at: new Date().toISOString() });
  },
  // CRM#925: «Comprobar ahora» guarda en la tarjeta de Moodle qué funciones tiene el servicio.
  fundirConfigPublica: async () => {},
}));

const { encrypt } = await import('../src/shared/utils/crypto.js');
const S = await import('../src/modules/integrations/salud.service.js');

// Las claves de pega se arman en trozos: con su forma entera, el escáner de
// secretos de GitHub las toma por claves de verdad y rechaza el push.
const SK_LIVE = ['sk', 'live', ''].join('_');
const XKEY = ['xkey', 'sib-'].join('');
const WHSEC = ['wh', 'sec_'].join('');

const AHORA = Date.parse('2026-11-17T12:00:00Z');
const antes = (horas) => new Date(AHORA - horas * 3600000).toISOString();

const CLAVE_STRIPE = `${SK_LIVE}51AbCdEfGhIjKlMnOpQrStUv`;
const TOKEN_MOODLE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
function conClave(project_id, provider, valor, extra = {}) {
  const e = encrypt(valor);
  return { project_id, provider, active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: {}, last_test_status: null, last_test_message: null, last_test_at: null, ...extra };
}

beforeEach(() => {
  Object.assign(base, {
    campus: [], integraciones: [], claves: [], stripe: [], recepciones: [], comprobaciones: [], plugin: [],
    woo: [], credWoo: {}, meta: [], admision: [], transferencias: [], correos: {}, guardadas: [], tarjetas: [],
  });
  S._internos.reiniciar();
  delete process.env.BREVO_API_KEY;
});

describe('#533 · cada conexión, su color', () => {
  it('Stripe: sin clave, clave rota, sincronización con error y al día', () => {
    expect(S.evaluarStripe({}, AHORA).estado).toBe('sin_configurar');

    const rota = { ...conClave(1, 'stripe', CLAVE_STRIPE), auth_tag: '00'.repeat(16) };
    const c1 = S.evaluarStripe({ integ: rota, descifrable: false, secreto: 'sin' }, AHORA);
    expect(c1.estado).toBe('caida');
    expect(c1.resumen).toMatch(/no se puede descifrar/);

    const integ = conClave(1, 'stripe', CLAVE_STRIPE);
    const c2 = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync: { last_sync_at: antes(30), last_error: `Stripe /v1/charges HTTP 401: Invalid API Key provided: ${SK_LIVE}****abcd` } }, AHORA);
    expect(c2.estado).toBe('caida');
    expect(c2.motivo).toContain('HTTP 401');
    expect(c2.ultimaSenal).toBe(antes(30));

    const c3 = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync: { last_sync_at: antes(0.1), ultimo_cobro: antes(5) } }, AHORA);
    expect(c3.estado).toBe('bien');
    expect(c3.resumen).toMatch(/Cobros al día/);
    expect(c3.datos.ultimoCargo).toBe(antes(5));

    const c4 = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync: { last_sync_at: antes(5) } }, AHORA);
    expect(c4.estado).toBe('atencion');
    expect(c4.resumen).toMatch(/Sin sincronizar desde hace 5 h/);
  });

  it('el webhook de Stripe desactivado se dice sin pintar de rojo; uno rechazado pone ámbar', () => {
    const integ = conClave(1, 'stripe', CLAVE_STRIPE);
    const sync = { last_sync_at: antes(0.05) };
    const sinAvisos = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync }, AHORA);
    expect(sinAvisos.estado).toBe('bien');
    expect(sinAvisos.datos.webhook.estado).toBe('desactivado');
    expect(sinAvisos.datos.webhook.texto).toMatch(/Webhook desactivado/);

    const sinSecreto = S.evaluarStripe({ integ, descifrable: true, secreto: 'sin', sync }, AHORA);
    expect(sinSecreto.datos.webhook.estado).toBe('sin_secreto');
    expect(sinSecreto.estado).toBe('bien');

    const activo = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync, recepcion: { ultimo_at: antes(1), resultado: 'aceptado', ultimo_aceptado_at: antes(1) } }, AHORA);
    expect(activo.datos.webhook.estado).toBe('activo');

    const rechazado = S.evaluarStripe({ integ, descifrable: true, secreto: 'con', sync, recepcion: { ultimo_at: antes(2), resultado: 'rechazado', motivo: 'firma invalida', ultimo_aceptado_at: null } }, AHORA);
    expect(rechazado.estado).toBe('atencion');
    expect(rechazado.motivo).toMatch(/firma invalida/);
  });

  it('Moodle (el caso de FONO): token que no vale → rojo con el motivo; arreglado → verde', () => {
    const integ = conClave(2, 'moodle', TOKEN_MOODLE, {
      config_public: { url: 'https://fono.example/campus' },
      last_test_status: 'error', last_test_message: 'El token del campus no vale (caducado o mal copiado).', last_test_at: antes(1),
    });
    const roja = S.evaluarMoodle({ integ, descifrable: true }, AHORA);
    expect(roja.estado).toBe('caida');
    expect(roja.motivo).toBe('El token del campus no vale (caducado o mal copiado).');

    const arreglada = S.evaluarMoodle({ integ, descifrable: true, comprobacion: { ok: true, mensaje: 'Conexión OK con FONO.', comprobado_at: antes(0.01), ultimo_ok_at: antes(0.01) } }, AHORA);
    expect(arreglada.estado).toBe('bien');
    expect(arreglada.ultimaSenal).toBe(antes(0.01));

    expect(S.evaluarMoodle({}, AHORA).estado).toBe('sin_configurar');
    const plugin = S.evaluarMoodle({ integ: { ...integ, last_test_status: 'success' }, descifrable: true, plugin: { activo: true, sincronizacion_error: 'HTTP 500', version_plugin: '1.10.2' } }, AHORA);
    expect(plugin.estado).toBe('atencion');
    expect(plugin.datos.plugin.version).toBe('1.10.2');
  });

  it('WooCommerce, Meta, admisión y transferencias', () => {
    expect(S.evaluarWooCommerce({}, AHORA).estado).toBe('sin_configurar');
    const wc = { active: true, tiene_clave: true, run_estado: 'error', run_error: 'WC fetch 401', run_inicio: antes(3), run_fin: antes(3) };
    expect(S.evaluarWooCommerce({ wc }, AHORA).estado).toBe('caida');
    expect(S.evaluarWooCommerce({ wc, comprobacion: { ok: true, comprobado_at: antes(1) } }, AHORA).estado).toBe('atencion');
    expect(S.evaluarWooCommerce({ wc: { ...wc, run_estado: 'success', ultimo_run_ok: antes(3) } }, AHORA)).toMatchObject({ estado: 'bien', ultimaSenal: antes(3) });

    expect(S.evaluarMeta(null, AHORA).estado).toBe('sin_configurar');
    expect(S.evaluarMeta({ cuentas: 1, con_error: 1, motivo: 'token caducado', ultimo: antes(30) }, AHORA)).toMatchObject({ estado: 'caida', motivo: 'token caducado' });
    expect(S.evaluarMeta({ cuentas: 2, con_error: 0, ultimo: antes(1) }, AHORA).estado).toBe('bien');

    expect(S.evaluarAdmision(null, AHORA).estado).toBe('sin_configurar');
    expect(S.evaluarAdmision({ activos: 1, ultimo: null, usos: 0 }, AHORA).estado).toBe('sin_datos');
    expect(S.evaluarAdmision({ activos: 1, ultimo: antes(5), usos: 12 }, AHORA)).toMatchObject({ estado: 'bien', ultimaSenal: antes(5) });

    const c = { id: 3, sociedad_emisora_id: 9 };
    const webhooks = [
      { id: 1, ambito: 'empresa', issuer_id: 9, estado: 'fallido', error: 'HTTP 500', cuando: antes(1), ultimo_ok: antes(48) },
      { id: 2, ambito: 'empresa', issuer_id: 8, estado: 'enviado', cuando: antes(1) },
      { id: 3, ambito: 'campus', project_id: 4, estado: 'enviado', cuando: antes(1) },
    ];
    const suyos = S.webhooksDelCampus(webhooks, c);
    expect(suyos.map((w) => w.id)).toEqual([1]);
    expect(S.evaluarTransferencias(suyos, AHORA)).toMatchObject({ estado: 'caida', motivo: 'HTTP 500', ultimaSenal: antes(48) });
    expect(S.evaluarTransferencias([], AHORA).estado).toBe('sin_configurar');
  });

  it('Brevo: clave propia o la cuenta del CRM', () => {
    expect(S.evaluarBrevo({ delCrm: { configurada: false } }, AHORA).estado).toBe('sin_configurar');
    expect(S.evaluarBrevo({ delCrm: { configurada: true, correos: { ok_24h: 0, fallos_24h: 3 } } }, AHORA).estado).toBe('caida');
    expect(S.evaluarBrevo({ delCrm: { configurada: true, correos: { ok_24h: 9, fallos_24h: 0, ultimo_ok: antes(1) } } }, AHORA).estado).toBe('bien');
    const propia = conClave(1, 'brevo', `${XKEY}abcdef0123456789`, { last_test_status: 'error', last_test_message: 'API key inválida (401 Unauthorized)', last_test_at: antes(2) });
    expect(S.evaluarBrevo({ integ: propia, descifrable: true }, AHORA)).toMatchObject({ estado: 'caida', motivo: 'API key inválida (401 Unauthorized)' });
  });

  it('el motivo nunca lleva una clave ni un correo', () => {
    const sucio = `Invalid API Key provided: ${SK_LIVE}51AbCdEf; ${WHSEC}abc123; https://t.es/wp-json?consumer_key=ck_0123456789abcdef0123&consumer_secret=cs_x; wstoken=abc Bearer abc.def ana@ejemplo.com ${XKEY}123-abc`;
    const limpio = S.limpiarMotivo(sucio);
    for (const no of [`${SK_LIVE}51`, `${WHSEC}abc`, 'ck_0123', 'cs_x', 'wstoken=abc', 'abc.def', 'ana@ejemplo.com', `${XKEY}123`]) {
      expect(limpio).not.toContain(no);
    }
    expect(limpio).toContain('[clave]');
  });

  it('la fila de un campus manda por su peor casilla', () => {
    expect(S.peorDe({ a: { estado: 'bien' }, b: { estado: 'sin_configurar' } })).toBe('bien');
    expect(S.peorDe({ a: { estado: 'bien' }, b: { estado: 'atencion' }, c: { estado: 'caida' } })).toBe('caida');
  });
});

describe('#533 · ver el panel (sin red)', () => {
  it('una fila por campus, una casilla por conexión, y ni una clave en la respuesta', async () => {
    base.campus = [{ id: 1, nombre: 'Psiko', type: 'crm', sociedad_emisora_id: 9 }, { id: 2, nombre: 'Fono', type: 'crm', sociedad_emisora_id: 9 }];
    const stripe = conClave(1, 'stripe', CLAVE_STRIPE, { last_test_status: 'success', last_test_at: antes(1) });
    const w = encrypt(`${WHSEC}superSecreto123`);
    stripe.config_public = { webhook_secret_encrypted: w.encrypted, webhook_secret_iv: w.iv, webhook_secret_auth_tag: w.authTag, webhook_secret_preview: 'whse....123' };
    base.integraciones = [
      stripe,
      conClave(2, 'moodle', TOKEN_MOODLE, { config_public: { url: 'https://fono.example/campus' }, last_test_status: 'error', last_test_message: 'El token del campus no vale (caducado o mal copiado).', last_test_at: antes(1) }),
    ];
    base.stripe = [{ project_id: 1, last_sync_at: new Date().toISOString(), last_error: null, ultimo_cobro: antes(3) }];

    const r = await S.saludDeLosCampus([1, 2]);
    expect(r.conexiones.map((c) => c.clave)).toEqual(['stripe', 'moodle', 'woocommerce', 'brevo', 'meta', 'admision', 'transferencias']);
    expect(r.campus.map((c) => c.nombre)).toEqual(['Psiko', 'Fono']);
    const psiko = r.campus[0];
    expect(psiko.casillas.stripe.estado).toBe('bien');
    expect(psiko.casillas.stripe.datos.webhook.estado).toBe('desactivado');
    const fono = r.campus[1];
    expect(fono.peor).toBe('caida');
    expect(fono.casillas.moodle).toMatchObject({ estado: 'caida', motivo: 'El token del campus no vale (caducado o mal copiado).' });

    const texto = JSON.stringify(r);
    for (const no of [CLAVE_STRIPE, TOKEN_MOODLE, `${WHSEC}`, stripe.encrypted_value, stripe.iv, stripe.auth_tag, 'fono.example', 'encrypted']) {
      expect(texto).not.toContain(no);
    }
  });

  it('sin campus, una lista vacía (no «todos»)', async () => {
    const r = await S.saludDeLosCampus([-1]);
    expect(r.campus).toEqual([]);
  });
});

describe('#533 · Comprobar ahora (servicios simulados)', () => {
  it('prueba con la clave descifrada, apunta en la tarjeta y en la salud, y no repite en un minuto', async () => {
    base.campus = [{ id: 2, nombre: 'Fono', type: 'crm' }];
    base.integraciones = [
      conClave(2, 'moodle', TOKEN_MOODLE, { config_public: { url: 'https://fono.example/campus', consultas: true } }),
      conClave(2, 'stripe', CLAVE_STRIPE),
    ];
    const probar = {
      stripe: vi.fn(async (k) => ({ ok: k === CLAVE_STRIPE, message: 'Conexión OK. Modo: LIVE (producción).' })),
      moodle: vi.fn(async () => ({ ok: false, message: 'El token del campus no vale (caducado o mal copiado).' })),
      brevo: vi.fn(),
    };

    const hechas = await S.comprobarAhora([2], { probar });
    expect(hechas[2].sort()).toEqual(['moodle', 'stripe']);
    expect(probar.stripe).toHaveBeenCalledWith(CLAVE_STRIPE, {});
    expect(probar.moodle).toHaveBeenCalledWith(TOKEN_MOODLE, { url: 'https://fono.example/campus', consultas: true });
    expect(base.tarjetas).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: 2, provider: 'moodle', status: 'error' }),
      expect.objectContaining({ projectId: 2, provider: 'stripe', status: 'success' }),
    ]));

    let r = await S.saludDeLosCampus([2]);
    expect(r.campus[0].casillas.moodle.estado).toBe('caida');

    // Un segundo clic enseguida no vuelve a llamar a nadie.
    await S.comprobarAhora([2], { probar });
    expect(probar.moodle).toHaveBeenCalledTimes(1);

    // Arreglado el token (y pasado el minuto), pasa a verde.
    base.comprobaciones = base.comprobaciones.map((x) => ({ ...x, comprobado_at: antes(1) }));
    probar.moodle.mockResolvedValueOnce({ ok: true, message: 'Conexión OK con FONO · Moodle 4.3.' });
    await S.comprobarAhora([2], { probar });
    r = await S.saludDeLosCampus([2]);
    expect(r.campus[0].casillas.moodle.estado).toBe('bien');
  });

  it('una clave que no se descifra se apunta como fallo sin llamar a fuera', async () => {
    base.campus = [{ id: 1, nombre: 'Psiko', type: 'crm' }];
    base.integraciones = [{ ...conClave(1, 'stripe', CLAVE_STRIPE), auth_tag: '00'.repeat(16) }];
    const probar = { stripe: vi.fn(), brevo: vi.fn(), moodle: vi.fn() };
    await S.comprobarAhora([1], { probar });
    expect(probar.stripe).not.toHaveBeenCalled();
    expect(base.guardadas[0]).toMatchObject({ conexion: 'stripe', ok: false, mensaje: 'La clave guardada no se puede descifrar.' });
  });

  it('un proveedor colgado no cuelga la comprobación', async () => {
    vi.useFakeTimers();
    try {
      base.integraciones = [conClave(1, 'brevo', `${XKEY}abcdef0123456789`)];
      const probar = { brevo: vi.fn(() => new Promise(() => {})), stripe: vi.fn(), moodle: vi.fn() };
      const p = S.comprobarAhora([1], { probar });
      await vi.advanceTimersByTimeAsync(S.TOPE_MS + 100);
      await p;
      expect(base.guardadas[0]).toMatchObject({ conexion: 'brevo', ok: false });
      expect(base.guardadas[0].mensaje).toMatch(/No ha contestado/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('la tienda: una petición de solo lectura y un motivo sin las claves', async () => {
    base.credWoo[5] = { store_url: 'https://tienda.example/', consumer_key: 'ck_0123456789abcdef0123', consumer_secret: 'cs_0123456789abcdef0123', active: true };
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    await S.comprobarAhora([5], { probar: { brevo: vi.fn() }, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/tienda\.example\/wp-json\/wc\/v3\/products\?per_page=1/);
    const g = base.guardadas.find((x) => x.conexion === 'woocommerce');
    expect(g).toMatchObject({ ok: false });
    expect(g.mensaje).toMatch(/no acepta las claves \(HTTP 401\)/);
    expect(g.mensaje).not.toMatch(/ck_|cs_/);

    const caida = await S.probarWooCommerce({ store_url: 'https://tienda.example' }, { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    expect(caida).toEqual({ ok: false, message: 'No se ha podido llegar a la tienda.' });
  });

  it('la clave de Brevo del CRM se prueba una vez y vale para los campus sin clave propia', async () => {
    process.env.BREVO_API_KEY = `${XKEY}crm-0123456789`;
    base.campus = [{ id: 1, nombre: 'Psiko', type: 'crm' }];
    const probar = { brevo: vi.fn(async () => ({ ok: false, message: 'API key inválida (401 Unauthorized)' })), stripe: vi.fn(), moodle: vi.fn() };
    await S.comprobarAhora([1], { probar });
    expect(probar.brevo).toHaveBeenCalledWith(`${XKEY}crm-0123456789`);
    const r = await S.saludDeLosCampus([1]);
    expect(r.campus[0].casillas.brevo).toMatchObject({ estado: 'caida', resumen: 'La clave de Brevo del CRM no vale' });
    expect(JSON.stringify(r)).not.toContain(XKEY.slice(0, -1));
  });

  it('las claves de Configuración › Claves: el Moodle del MCP (#335) y el Brevo de la marca', async () => {
    base.campus = [{ id: 2, nombre: 'Fono', type: 'crm' }];
    const m = encrypt(JSON.stringify({ url: 'https://fono-mcp.example/campus', token: TOKEN_MOODLE }));
    const b = encrypt(`${XKEY}marca-0123456789`);
    const g = encrypt(`${XKEY}crm-global-0123`);
    base.claves = [
      { id: 10, project_id: 2, service: 'moodle', encrypted_value: m.encrypted, iv: m.iv, auth_tag: m.authTag },
      { id: 11, project_id: 2, service: 'brevo', encrypted_value: b.encrypted, iv: b.iv, auth_tag: b.authTag },
      { id: 12, project_id: null, service: 'brevo', encrypted_value: g.encrypted, iv: g.iv, auth_tag: g.authTag },
    ];
    let r = await S.saludDeLosCampus([2]);
    expect(r.campus[0].casillas.moodle).toMatchObject({ estado: 'sin_datos', resumen: 'Clave del MCP: guardada, sin probar' });
    expect(r.campus[0].casillas.brevo.estado).toBe('sin_datos');

    const probar = {
      moodle: vi.fn(async () => ({ ok: false, message: 'El token del campus no vale (caducado o mal copiado).' })),
      brevo: vi.fn(async () => ({ ok: true, message: 'Conexión OK con cuenta x@fono.example.' })),
      stripe: vi.fn(),
    };
    const hechas = await S.comprobarAhora([2], { probar });
    expect(hechas[2].sort()).toEqual(['brevo_marca', 'moodle_mcp']);
    expect(probar.moodle).toHaveBeenCalledWith(TOKEN_MOODLE, { url: 'https://fono-mcp.example/campus' });
    expect(probar.brevo).toHaveBeenCalledWith(`${XKEY}marca-0123456789`);
    // La del CRM sale de la base, no del .env.
    expect(probar.brevo).toHaveBeenCalledWith(`${XKEY}crm-global-0123`);

    r = await S.saludDeLosCampus([2]);
    expect(r.campus[0].casillas.moodle).toMatchObject({ estado: 'caida', motivo: 'El token del campus no vale (caducado o mal copiado).' });
    expect(r.campus[0].casillas.brevo.estado).toBe('bien');
    const texto = JSON.stringify(r);
    for (const no of [TOKEN_MOODLE, XKEY.slice(0, -1), 'fono-mcp.example', 'x@fono.example']) expect(texto).not.toContain(no);
  });

  it('con Integraciones y Claves a la vez, manda la peor y se dice de cuál es el fallo', () => {
    const integ = conClave(2, 'moodle', TOKEN_MOODLE, { last_test_status: 'success', last_test_at: antes(1) });
    const c = S.evaluarMoodle({ integ, descifrable: true, mcp: { descifrable: true, comprobacion: { ok: false, mensaje: 'HTTP 500', comprobado_at: antes(0.5) } } }, AHORA);
    expect(c.estado).toBe('caida');
    expect(c.motivo).toBe('Clave del MCP: HTTP 500');
    expect(c.resumen).toMatch(/^Conectado .* · Clave del MCP: no conecta$/);
  });
});
