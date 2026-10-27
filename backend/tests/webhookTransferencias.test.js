import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas que firman token (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/*
  Webhook de transferencias (Diego, 15/10; migración 206).

  «Un apartado en Conexión para enviar esos datos ÚNICAMENTE CUANDO SE PONGA
  DATOS POR TRANSFERENCIA BANCARIA / DEPÓSITO BANCARIO».

  La base es de mentira: `db.js` contesta desde unas listas en memoria según lo
  que pregunte cada consulta. `fetch` y el DNS también son de mentira: aquí no
  sale nada a la red.
*/

// ─── La base de mentira ─────────────────────────────────────────────────────
const CEDIA = 8;     // empresa con los campus 1 y 2
const ICTESS = 9;    // empresa con el campus 3
const CAMPUS = { 1: CEDIA, 2: CEDIA, 3: ICTESS };
const USER_PROJECTS = { 20: [1, 2], 21: [1] };   // Antonio: CEDIA entera. Berta: solo el 1.

let webhooks = [];
let envios = [];
let cobros = {};
let sigId = 1;

const secretoDe = new Map();   // id de webhook → secreto en claro (para comprobar la firma)

function filaWebhook(w) {
  return {
    ...w,
    proyecto: w.project_id ? `Campus ${w.project_id}` : null,
    empresa: w.issuer_id ? `Empresa ${w.issuer_id}` : null,
    creado_por_nombre: null, ultimo_envio_at: null, fallidos_30_dias: 0,
  };
}

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params = []) => {
    // ── ambito.js: los campus de una persona
    if (sql.includes('FROM user_projects WHERE user_id = $1 AND active = true')) {
      return { rows: (USER_PROJECTS[params[0]] || []).map((project_id) => ({ project_id })) };
    }
    // Solo la consulta suelta (ámbito.js, campusDeContexto): el listado de webhooks por empresa la
    // lleva dentro como subconsulta y no es esto.
    if (sql.trim().startsWith('SELECT id FROM projects WHERE sociedad_emisora_id = $1')) {
      return { rows: Object.entries(CAMPUS).filter(([, e]) => e === params[0]).map(([id]) => ({ id: Number(id) })) };
    }
    if (sql.includes('SELECT 1 FROM projects WHERE id = $1')) return { rows: CAMPUS[params[0]] ? [{}] : [] };
    if (sql.trim().startsWith('SELECT sociedad_emisora_id FROM projects WHERE id = $1')) {
      return { rows: CAMPUS[params[0]] ? [{ sociedad_emisora_id: CAMPUS[params[0]] }] : [] };
    }
    if (sql.includes('SELECT 1 FROM invoice_issuers WHERE id = $1')) return { rows: [CEDIA, ICTESS].includes(params[0]) ? [{}] : [] };

    // ── el cobro
    if (sql.includes('FROM conversion_payments cp') && sql.includes('LEFT JOIN LATERAL')) {
      const c = cobros[params[0]];
      return { rows: c ? [{ ...c, registrado_id: params[1], registrado_nombre: params[1] ? 'Quien apunta' : null }] : [] };
    }
    if (sql.includes('WHERE activo AND $1 = ANY(metodos)')) {
      const [metodo, projectId, issuerId] = params;
      return {
        rows: webhooks.filter((w) => w.activo && w.metodos.includes(metodo) && (
          w.ambito === 'todas'
          || (w.ambito === 'empresa' && w.issuer_id === issuerId)
          || (w.ambito === 'campus' && w.project_id === projectId)
        )).map((w) => ({ id: w.id })),
      };
    }

    // ── los webhooks
    if (sql.includes('INSERT INTO webhooks_salientes\n') || sql.includes('INSERT INTO webhooks_salientes ')) {
      const [nombre, url, cif, iv, tag, cola, activo, ambito, issuer_id, project_id, metodos, uid] = params;
      const w = { id: sigId++, nombre, url, secreto_cifrado: cif, secreto_iv: iv, secreto_tag: tag, secreto_cola: cola,
        activo, ambito, issuer_id, project_id, metodos, creado_por: uid };
      webhooks.push(w);
      return { rows: [{ id: w.id }] };
    }
    if (sql.includes('SELECT id, nombre, url, activo, metodos, secreto_cifrado')) {
      return { rows: webhooks.filter((w) => w.id === params[0]) };
    }
    if (sql.includes('FROM webhooks_salientes w') && sql.includes('WHERE w.id = $1')) {
      return { rows: webhooks.filter((w) => w.id === params[0]).map(filaWebhook) };
    }
    if (sql.includes('FROM webhooks_salientes w')) {
      // listar: si viene la lista de campus de un admin, la regla de verdad.
      const mios = Array.isArray(params[0]) ? params[0] : null;
      // El ámbito de arriba (21/10): un campus o una empresa, como la consulta de verdad.
      const ctx = params.find((p) => typeof p === 'number');
      const porEmpresa = sql.includes('IN (SELECT id FROM projects WHERE sociedad_emisora_id');
      const porCampus = !porEmpresa && sql.includes('sociedad_emisora_id FROM projects WHERE id');
      const enAmbito = (w) => {
        if (ctx == null || (!porEmpresa && !porCampus)) return true;
        if (w.ambito === 'todas') return true;
        if (porEmpresa) return w.ambito === 'empresa' ? w.issuer_id === ctx : CAMPUS[w.project_id] === ctx;
        return w.ambito === 'campus' ? (w.project_id === ctx || CAMPUS[w.project_id] === CAMPUS[ctx]) : w.issuer_id === CAMPUS[ctx];
      };
      const lista = webhooks.filter(enAmbito).filter((w) => {
        if (!mios) return true;
        if (w.ambito === 'campus') return mios.includes(w.project_id);
        if (w.ambito === 'empresa') {
          const suyos = Object.entries(CAMPUS).filter(([, e]) => e === w.issuer_id).map(([id]) => Number(id));
          return suyos.length > 0 && suyos.every((id) => mios.includes(id));
        }
        return false;
      });
      return { rows: lista.map(filaWebhook) };
    }

    // ── los envíos
    if (sql.includes('INSERT INTO webhooks_salientes_envios')) {
      const [webhook_id, payment_id, evento, idempotency_key, prueba, payload] = params;
      if (envios.some((e) => e.idempotency_key === idempotency_key)) return { rows: [] };
      const e = { id: sigId++, webhook_id, payment_id, evento, idempotency_key, prueba, payload: JSON.parse(payload),
        estado: 'pendiente', intentos: 0, proximo_intento_at: new Date(Date.now() - 1), http_status: null, error: null };
      envios.push(e);
      return { rows: [{ id: e.id }] };
    }
    if (sql.includes("SET estado = 'enviando'")) {
      const e = envios.find((x) => x.id === params[0]);
      if (!e || e.estado !== 'pendiente' || (e.proximo_intento_at && e.proximo_intento_at > new Date())) return { rows: [] };
      e.estado = 'enviando'; e.intentos += 1; e.ultimo_intento_at = new Date();
      return { rows: [{ ...e }] };
    }
    if (sql.includes("SET estado = 'enviado'")) {
      const e = envios.find((x) => x.id === params[0]);
      Object.assign(e, { estado: 'enviado', http_status: params[1], respuesta: params[2], error: null, proximo_intento_at: null });
      return { rows: [{ ...e }] };
    }
    if (sql.includes('SET estado = CASE WHEN $5::int IS NULL')) {
      const e = envios.find((x) => x.id === params[0]);
      const espera = params[4];
      Object.assign(e, {
        estado: espera === null ? 'fallido' : 'pendiente', http_status: params[1], respuesta: params[2], error: params[3],
        proximo_intento_at: espera === null ? null : new Date(Date.now() + espera), espera,
      });
      return { rows: [{ ...e }] };
    }
    if (sql.includes("SET estado = 'pendiente', intentos = 0")) {
      const e = envios.find((x) => x.id === params[0] && x.estado === 'fallido');
      if (!e) return { rows: [] };
      Object.assign(e, { estado: 'pendiente', intentos: 0, error: null, proximo_intento_at: new Date(Date.now() - 1) });
      return { rows: [{ ...e }] };
    }
    if (sql.includes("WHERE estado = 'pendiente' AND proximo_intento_at <= NOW()")) {
      return { rows: envios.filter((e) => e.estado === 'pendiente' && e.proximo_intento_at <= new Date()).map((e) => ({ id: e.id })) };
    }
    if (sql.includes("WHERE estado = 'enviando' AND ultimo_intento_at")) return { rowCount: 0, rows: [] };
    if (sql.includes('SELECT * FROM webhooks_salientes_envios WHERE id = $1')) {
      return { rows: envios.filter((e) => e.id === params[0]).map((e) => ({ ...e })) };
    }
    if (sql.includes('FROM webhooks_salientes_envios e')) {
      const ids = Array.isArray(params[0]) ? params[0] : null;
      return { rows: envios.filter((e) => !ids || ids.includes(e.webhook_id)).map((e) => ({ ...e })) };
    }
    if (sql.includes('/* prueba del webhook */')) {
      return { rows: [{ campus_id: params[0] ?? null, campus_nombre: params[0] ? 'ACADEMIA IA' : null,
        empresa_id: 5, empresa_razon_social: 'Lateral Thinking Solutions SL', empresa_nif: 'B2', iban: 'ES11 2', bic: 'BICY',
        registrado_id: params[2], registrado_nombre: params[2] ? 'Diego' : null, registrado_email: params[2] ? 'd@example.com' : null }] };
    }
    return { rows: [] };
  }),
}));

// El DNS: todo resuelve a una IP pública, salvo «interno.example.com».
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host) => (host === 'interno.example.com'
    ? [{ address: '10.0.0.5', family: 4 }]
    : [{ address: '93.184.216.34', family: 4 }])),
}));

const service = await import('../src/modules/webhooks-salientes/webhooks-salientes.service.js');
const { revisarUrl } = await import('../src/modules/webhooks-salientes/webhooks-salientes.validation.js');
const router = (await import('../src/modules/webhooks-salientes/webhooks-salientes.routes.js')).default;

// ─── fetch de mentira ───────────────────────────────────────────────────────
let respuestas = [];
const fetchFalso = vi.fn(async () => {
  const r = respuestas.length ? respuestas.shift() : { status: 200, body: 'ok' };
  if (r.error) throw r.error;
  return { status: r.status, text: async () => r.body || '' };
});
const fetchDeVerdad = globalThis.fetch;
globalThis.fetch = fetchFalso;
afterAll(() => { globalThis.fetch = fetchDeVerdad; });

/** Un webhook ya guardado, con su secreto cifrado de verdad. */
function webhook({ ambito = 'todas', issuer_id = null, project_id = null, metodos = ['transferencia', 'deposito'], activo = true, url } = {}) {
  const id = sigId++;
  const secreto = service.generarSecreto();
  const cif = service.cifrarSecreto(secreto);
  secretoDe.set(id, secreto);
  webhooks.push({
    id, nombre: `Webhook ${id}`, url: url || `https://hooks.example.com/w${id}`, activo, ambito, issuer_id, project_id, metodos,
    secreto_cifrado: cif.encrypted, secreto_iv: cif.iv, secreto_tag: cif.authTag, secreto_cola: cif.cola,
  });
  return id;
}

/** Un cobro de un campus, con su forma de pago. */
function cobro(id, metodo, campus = 1) {
  cobros[id] = {
    id, importe: '450.00', fecha: '2026-10-15', metodo, notas: 'Cuota 2', referencia: 'TRF-1',
    divisa_moneda: null, importe_divisa: null,
    venta_id: 70 + id, producto_contratado: 'Máster X', producto_contratado_id: 9, producto_catalogo: 'Máster X',
    importe_total: '1800.00', importe_pagado: '900.00',
    cliente_id: 5, cliente_nombre: 'Ana', cliente_email: 'ana@example.com', cliente_telefono: '+34600', cliente_dni: '00000000T',
    campus_id: campus, campus_nombre: `Campus ${campus}`, empresa_id: CAMPUS[campus],
    empresa_razon_social: 'CEDIA S.L.', empresa_nif: 'B1', iban: 'ES00 1', bic: 'BICX',
    gestora_id: 7, gestora_nombre: 'Gestora', gestora_email: 'g@example.com',
  };
}

const enviosA = (url) => fetchFalso.mock.calls.filter(([u]) => u === url).length;

beforeEach(() => {
  webhooks = []; envios = []; cobros = {}; respuestas = [];
  secretoDe.clear();
  fetchFalso.mockClear();
});

// ─── Qué dispara y qué no ───────────────────────────────────────────────────
describe('qué forma de cobro dispara el webhook', () => {
  it('una transferencia sale, con su evento, su payload y sus cabeceras', async () => {
    const w = webhook();
    cobro(1, 'transferencia');
    const nuevos = await service.avisarCobro(1, { userId: 3 });
    expect(nuevos).toHaveLength(1);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe(`https://hooks.example.com/w${w}`);
    expect(opciones.method).toBe('POST');
    expect(opciones.redirect).toBe('manual');
    expect(opciones.headers['X-CRM-Evento']).toBe('cobro.transferencia');
    expect(opciones.headers['X-CRM-Entrega']).toBe(String(nuevos[0]));
    const p = JSON.parse(opciones.body);
    expect(p).toMatchObject({
      evento: 'cobro.transferencia',
      prueba: false,
      idempotency_key: `cobro-1-webhook-${w}`,
      cobro: { id: 1, importe: 450, moneda: 'EUR', fecha: '2026-10-15', metodo: 'transferencia', referencia: 'TRF-1', notas: 'Cuota 2' },
      venta: { id: 71, producto: 'Máster X', importe_total: 1800, pagado: 900, pendiente: 900 },
      cliente: { nombre: 'Ana', email: 'ana@example.com', telefono: '+34600', dni_nif: '00000000T' },
      campus: { id: 1, nombre: 'Campus 1' },
      empresa: { id: CEDIA, razon_social: 'CEDIA S.L.', nif: 'B1' },
      cuenta_destino: { iban: 'ES00 1', bic: 'BICX' },
      gestora: { nombre: 'Gestora', email: 'g@example.com' },
      registrado_por: { id: 3, nombre: 'Quien apunta' },
    });
    expect(p.importe).toBe(450);   // arriba, el de ESTE cobro (21/10)
    // Y plano, con los nombres de los escenarios de Make montados así (21/10).
    expect(p).toMatchObject({
      'Nombre completo': 'Ana', Email: 'ana@example.com', 'Teléfono': '+34600', 'Formación': 'Máster X',
      Importe: 450, Moneda: 'EUR', 'Fecha de pago': '2026-10-15', Referencia: 'TRF-1', Comercial: 'Gestora',
    });
    expect(typeof p.enviado_at).toBe('string');
    expect(envios[0].estado).toBe('enviado');
  });

  it('un depósito bancario sale como cobro.deposito', async () => {
    webhook();
    cobro(2, 'deposito');
    await service.avisarCobro(2);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(fetchFalso.mock.calls[0][1].headers['X-CRM-Evento']).toBe('cobro.deposito');
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body).evento).toBe('cobro.deposito');
  });

  it.each(['tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'paypal', 'otro', null])(
    'con %s no sale nada',
    async (metodo) => {
      webhook();
      cobro(3, metodo);
      expect(await service.avisarCobro(3)).toEqual([]);
      expect(fetchFalso).not.toHaveBeenCalled();
      expect(envios).toHaveLength(0);
    },
  );

  it('la forma de pago se lee de la base: una pista de «transferencia» no basta', async () => {
    webhook();
    cobro(4, 'tarjeta');
    await service.avisarCobro(4, { metodo: 'transferencia' });
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('un webhook solo de depósitos no salta con una transferencia', async () => {
    webhook({ metodos: ['deposito'] });
    cobro(5, 'transferencia');
    await service.avisarCobro(5);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('un webhook apagado no recibe nada', async () => {
    webhook({ activo: false });
    cobro(6, 'transferencia');
    await service.avisarCobro(6);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe('el ámbito: todas las empresas, una empresa o un campus', () => {
  it('cada cobro va a los webhooks de su campus, de su empresa y a los de todas', async () => {
    const todas = webhook({ ambito: 'todas' });
    const cedia = webhook({ ambito: 'empresa', issuer_id: CEDIA });
    const ictess = webhook({ ambito: 'empresa', issuer_id: ICTESS });
    const campus1 = webhook({ ambito: 'campus', project_id: 1 });
    const campus2 = webhook({ ambito: 'campus', project_id: 2 });

    cobro(10, 'transferencia', 2);   // campus 2, CEDIA
    await service.avisarCobro(10);
    expect(enviosA(`https://hooks.example.com/w${todas}`)).toBe(1);
    expect(enviosA(`https://hooks.example.com/w${cedia}`)).toBe(1);
    expect(enviosA(`https://hooks.example.com/w${campus2}`)).toBe(1);
    expect(enviosA(`https://hooks.example.com/w${ictess}`)).toBe(0);
    expect(enviosA(`https://hooks.example.com/w${campus1}`)).toBe(0);

    fetchFalso.mockClear();
    cobro(11, 'deposito', 3);        // campus 3, ICTESS
    await service.avisarCobro(11);
    expect(enviosA(`https://hooks.example.com/w${todas}`)).toBe(1);
    expect(enviosA(`https://hooks.example.com/w${ictess}`)).toBe(1);
    expect(enviosA(`https://hooks.example.com/w${cedia}`)).toBe(0);
    expect(enviosA(`https://hooks.example.com/w${campus1}`)).toBe(0);
    expect(enviosA(`https://hooks.example.com/w${campus2}`)).toBe(0);
  });
});

describe('la firma', () => {
  it('X-CRM-Firma es el HMAC-SHA256 del cuerpo exacto, con el secreto del webhook', async () => {
    const w = webhook();
    cobro(20, 'transferencia');
    await service.avisarCobro(20);
    const { headers, body } = fetchFalso.mock.calls[0][1];
    const esperada = `sha256=${crypto.createHmac('sha256', secretoDe.get(w)).update(body).digest('hex')}`;
    expect(headers['X-CRM-Firma']).toBe(esperada);
    // Con otro secreto no casa.
    expect(headers['X-CRM-Firma']).not.toBe(service.firmar(body, 'otro-secreto-cualquiera'));
  });

  it('el secreto se guarda cifrado y no se parece al original', () => {
    const s = service.generarSecreto();
    const c = service.cifrarSecreto(s);
    expect(s.startsWith('whsec_')).toBe(true);
    expect(c.encrypted).not.toContain(s);
    expect(c.cola).toBe(s.slice(-4));
  });
});

describe('reintentos y duplicados', () => {
  it('el mismo cobro no se manda dos veces al mismo webhook', async () => {
    webhook();
    cobro(30, 'transferencia');
    await service.avisarCobro(30);
    await service.avisarCobro(30);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(envios).toHaveLength(1);
  });

  it('un 500 se reintenta con espera creciente y, tras el último intento, queda fallido', async () => {
    webhook();
    cobro(31, 'transferencia');
    respuestas = [{ status: 500 }, { status: 502 }, { status: 503 }, { status: 500 }];
    await service.avisarCobro(31);
    const e = envios[0];
    expect(e).toMatchObject({ estado: 'pendiente', intentos: 1, espera: 60_000 });

    const esperas = [];
    for (let i = 0; i < 3; i += 1) {
      e.proximo_intento_at = new Date(Date.now() - 1);   // «ya le toca»
      await service.procesarPendientes();
      esperas.push(e.espera);
    }
    expect(esperas).toEqual([5 * 60_000, 15 * 60_000, null]);
    expect(e).toMatchObject({ estado: 'fallido', intentos: 4, http_status: 500 });
    expect(fetchFalso).toHaveBeenCalledTimes(4);
    // Y la clave de idempotencia es la misma en todos los intentos.
    const claves = fetchFalso.mock.calls.map(([, o]) => o.headers['X-CRM-Idempotencia']);
    expect(new Set(claves).size).toBe(1);
  });

  it('si el reintento sale bien, queda enviado', async () => {
    webhook();
    cobro(32, 'transferencia');
    respuestas = [{ error: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }, { status: 204 }];
    await service.avisarCobro(32);
    expect(envios[0].estado).toBe('pendiente');
    expect(envios[0].error).toMatch(/no contestó/);
    envios[0].proximo_intento_at = new Date(Date.now() - 1);
    await service.procesarPendientes();
    expect(envios[0]).toMatchObject({ estado: 'enviado', http_status: 204, intentos: 2 });
  });

  it('antes de su hora no se reintenta', async () => {
    webhook();
    cobro(33, 'transferencia');
    respuestas = [{ status: 500 }];
    await service.avisarCobro(33);
    await service.procesarPendientes();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('un 400 no se reintenta: el destino no lo quiere', async () => {
    webhook();
    cobro(34, 'transferencia');
    respuestas = [{ status: 400, body: 'campo raro' }];
    await service.avisarCobro(34);
    expect(envios[0]).toMatchObject({ estado: 'fallido', intentos: 1, http_status: 400, respuesta: 'campo raro' });
  });

  it('un fallido se puede reenviar a mano, con su misma clave', async () => {
    const w = webhook();
    cobro(35, 'transferencia');
    respuestas = [{ status: 404 }, { status: 200 }];
    await service.avisarCobro(35);
    expect(envios[0].estado).toBe('fallido');
    const r = await service.reenviar(envios[0].id, 1);
    expect(r.estado).toBe('enviado');
    expect(fetchFalso.mock.calls[1][1].headers['X-CRM-Idempotencia']).toBe(`cobro-35-webhook-${w}`);
  });

  it('un destino que resuelve a la red interna no recibe nada, ni se reintenta', async () => {
    webhook({ url: 'https://interno.example.com/hook' });
    cobro(36, 'transferencia');
    await service.avisarCobro(36);
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(envios[0]).toMatchObject({ estado: 'fallido' });
    expect(envios[0].error).toMatch(/red interna/);
  });

  it('«Enviar prueba» manda el ejemplo con "prueba": true y un solo intento', async () => {
    const w = webhook({ metodos: ['deposito'] });
    respuestas = [{ status: 500 }];
    const r = await service.enviarPrueba(webhooks.find((x) => x.id === w));
    const p = JSON.parse(fetchFalso.mock.calls[0][1].body);
    expect(p.prueba).toBe(true);
    expect(p.evento).toBe('cobro.deposito');
    expect(r.estado).toBe('fallido');   // la prueba no se reintenta
  });

  it('«Enviar prueba» lleva lo real del webhook, cliente y producto de prueba y el importe de la transferencia, no el total', async () => {
    const w = webhook({ ambito: 'campus', project_id: 5 });
    await service.enviarPrueba(webhooks.find((x) => x.id === w), 9);
    const p = JSON.parse(fetchFalso.mock.calls[0][1].body);
    expect(p.prueba).toBe(true);
    expect(p.campus).toMatchObject({ id: 5, nombre: 'ACADEMIA IA' });
    expect(p.empresa).toMatchObject({ razon_social: 'Lateral Thinking Solutions SL' });
    expect(p.cuenta_destino).toMatchObject({ iban: 'ES11 2', bic: 'BICY' });
    expect(p.registrado_por).toMatchObject({ id: 9, nombre: 'Diego' });
    // Los correos de la prueba van a quien la lanza (Make no puede escribir a example.com).
    expect(p.cliente).toMatchObject({ nombre: 'Cliente de prueba', email: 'd@example.com' });
    expect(p.gestora.email).toBe('d@example.com');
    expect(p.venta.producto).toBe('Producto de prueba');
    expect(p.importe).toBe(250);
    expect(p.cobro.importe).toBe(250);
    expect(p.venta.importe_total).toBe(1000);
  });
});

// ─── URLs ───────────────────────────────────────────────────────────────────
describe('la URL', () => {
  it.each([
    ['http://hooks.example.com/x', /https/],
    ['ftp://hooks.example.com/x', /https/],
    ['https://localhost/x', /red interna/],
    ['https://10.1.2.3/x', /red interna/],
    ['https://169.254.169.254/latest', /red interna/],
    ['https://[::1]/x', /red interna/],
    ['https://usuario:clave@hooks.example.com/x', /usuario/],
    ['no es una url', /no es válida/],
  ])('%s no vale', (url, motivo) => {
    expect(revisarUrl(url)).toMatch(motivo);
  });

  it('una https pública sí', () => {
    expect(revisarUrl('https://hook.eu1.make.com/abc123')).toBeNull();
  });
});

// ─── Permisos (por la API, con su JWT) ──────────────────────────────────────
describe('quién puede', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/webhooks-salientes', router);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code }));

  const token = (user) => `Bearer ${jwt.sign(registrar(user), process.env.JWT_SECRET)}`;
  const MANUEL = { userId: 1, role: 'superadmin' };
  const ANTONIO = { userId: 20, role: 'admin' };   // CEDIA entera (campus 1 y 2)
  const BERTA = { userId: 21, role: 'admin' };     // solo el campus 1
  const base = { nombre: 'Contabilidad', url: 'https://hooks.example.com/conta' };

  it.each([['gestor'], ['soporte'], ['tutor']])('%s no entra', async (role) => {
    const r = await request(app).get('/api/webhooks-salientes').set('Authorization', token({ userId: 50, role }));
    expect(r.status).toBe(403);
  });

  it('sin sesión, 401', async () => {
    expect((await request(app).get('/api/webhooks-salientes')).status).toBe(401);
  });

  it('el de todas las empresas, solo el super admin', async () => {
    const no = await request(app).post('/api/webhooks-salientes').set('Authorization', token(ANTONIO))
      .send({ ...base, ambito: 'todas' });
    expect(no.status).toBe(403);
    const si = await request(app).post('/api/webhooks-salientes').set('Authorization', token(MANUEL))
      .send({ ...base, ambito: 'todas' });
    expect(si.status).toBe(201);
    // El secreto sale UNA vez, al crearlo; luego, solo su cola.
    expect(si.body.data.secreto).toMatch(/^whsec_/);
    expect(si.body.data.secreto_cifrado).toBeUndefined();
    const lista = await request(app).get('/api/webhooks-salientes').set('Authorization', token(MANUEL));
    expect(lista.body.data[0].secreto).toBeUndefined();
    expect(lista.body.data[0].secreto_cola).toBe(si.body.data.secreto.slice(-4));
  });

  it('un admin: su campus sí, el de otro no', async () => {
    const si = await request(app).post('/api/webhooks-salientes').set('Authorization', token(BERTA))
      .send({ ...base, ambito: 'campus', project_id: 1 });
    expect(si.status).toBe(201);
    const no = await request(app).post('/api/webhooks-salientes').set('Authorization', token(BERTA))
      .send({ ...base, ambito: 'campus', project_id: 3 });
    expect(no.status).toBe(403);
  });

  it('un admin: la empresa solo si está en todos sus campus', async () => {
    const berta = await request(app).post('/api/webhooks-salientes').set('Authorization', token(BERTA))
      .send({ ...base, ambito: 'empresa', issuer_id: CEDIA });
    expect(berta.status).toBe(403);
    const antonio = await request(app).post('/api/webhooks-salientes').set('Authorization', token(ANTONIO))
      .send({ ...base, ambito: 'empresa', issuer_id: CEDIA, metodos: ['transferencia'] });
    expect(antonio.status).toBe(201);
    expect(antonio.body.data.metodos).toEqual(['transferencia']);
  });

  it('un admin no ve, no prueba ni reenvía el webhook de otro', async () => {
    const ajeno = webhook({ ambito: 'empresa', issuer_id: CEDIA });
    const lista = await request(app).get('/api/webhooks-salientes').set('Authorization', token(BERTA));
    expect(lista.body.data.map((w) => w.id)).not.toContain(ajeno);
    const prueba = await request(app).post(`/api/webhooks-salientes/${ajeno}/prueba`).set('Authorization', token(BERTA));
    expect(prueba.status).toBe(403);
    envios.push({ id: 999, webhook_id: ajeno, estado: 'fallido', idempotency_key: 'k', payload: {} });
    const reenvio = await request(app).post('/api/webhooks-salientes/envios/999/reenviar').set('Authorization', token(BERTA));
    expect(reenvio.status).toBe(403);
  });

  it('con una empresa elegida arriba, los envíos de los webhooks de otra empresa no se ven (21/10)', async () => {
    const deCedia = webhook({ ambito: 'campus', project_id: 1 });
    const deIctess = webhook({ ambito: 'campus', project_id: 3 });
    envios.push({ id: 801, webhook_id: deCedia, estado: 'enviado', idempotency_key: 'a', payload: {} });
    envios.push({ id: 802, webhook_id: deIctess, estado: 'enviado', idempotency_key: 'b', payload: {} });
    const ictess = await request(app).get(`/api/webhooks-salientes/envios?issuerId=${ICTESS}`).set('Authorization', token(MANUEL));
    expect(ictess.status).toBe(200);
    expect(ictess.body.data.map((e) => e.id)).toEqual([802]);
    const campus1 = await request(app).get('/api/webhooks-salientes/envios?projectId=1').set('Authorization', token(MANUEL));
    expect(campus1.body.data.map((e) => e.id)).toEqual([801]);
    const todo = await request(app).get('/api/webhooks-salientes/envios').set('Authorization', token(MANUEL));
    expect(todo.body.data.map((e) => e.id).sort()).toEqual([801, 802]);
    const berta = await request(app).get(`/api/webhooks-salientes/envios?issuerId=${ICTESS}`).set('Authorization', token(BERTA));
    expect(berta.body.data).toEqual([]);   // ICTESS no es de sus campus
  });

  it('desde un campus se ven los webhooks de los demás campus de su empresa, no los de otra (21/10)', async () => {
    const campus1 = webhook({ ambito: 'campus', project_id: 1 });
    const campus2 = webhook({ ambito: 'campus', project_id: 2 });   // CEDIA, como el 1
    const campus3 = webhook({ ambito: 'campus', project_id: 3 });   // ICTESS
    const lista = await request(app).get('/api/webhooks-salientes?projectId=1').set('Authorization', token(MANUEL));
    expect(lista.body.data.map((w) => w.id).sort()).toEqual([campus1, campus2].sort());
    envios.push({ id: 811, webhook_id: campus2, estado: 'enviado', idempotency_key: 'c', payload: {} });
    envios.push({ id: 812, webhook_id: campus3, estado: 'enviado', idempotency_key: 'd', payload: {} });
    const env = await request(app).get('/api/webhooks-salientes/envios?projectId=1').set('Authorization', token(MANUEL));
    expect(env.body.data.map((e) => e.id)).toEqual([811]);
    // Berta solo tiene el campus 1: el del campus 2 no es suyo y no lo ve, aunque sea de su empresa.
    const berta = await request(app).get('/api/webhooks-salientes?projectId=1').set('Authorization', token(BERTA));
    expect(berta.body.data.map((w) => w.id)).toEqual([campus1]);
  });

  it('una URL sin https se rechaza al guardar', async () => {
    const r = await request(app).post('/api/webhooks-salientes').set('Authorization', token(MANUEL))
      .send({ ...base, url: 'http://hooks.example.com/conta', ambito: 'todas' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/https/);
    const r2 = await request(app).patch('/api/webhooks-salientes/1').set('Authorization', token(MANUEL))
      .send({ url: 'http://otra.example.com' });
    expect(r2.status).toBe(400);
  });

  it('solo se pueden elegir transferencia y depósito', async () => {
    const r = await request(app).post('/api/webhooks-salientes').set('Authorization', token(MANUEL))
      .send({ ...base, ambito: 'todas', metodos: ['transferencia', 'tarjeta'] });
    expect(r.status).toBe(400);
  });
});
