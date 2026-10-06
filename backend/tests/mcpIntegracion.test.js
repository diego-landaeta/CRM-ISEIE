import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import pool from '../src/shared/config/db.js';
import mcp from '../src/modules/mcp/index.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';

/**
 * MCP contra la base de verdad (la local de docker-compose.dev.yml).
 *
 * Los otros dos tests del MCP sustituyen la base. Este no: crea dos empresas
 * con sus campus, personas de cada rol, prospectos, ventas y facturas, y le
 * pregunta al MCP por HTTP como lo haria Claude. Es la prueba de que el SQL
 * de verdad cumple lo que pidio Diego:
 *
 *   «Si yo estoy en X empresa solo ver los datos de ahi. Si solo soy de un
 *    campus solo de ese campus. No puedo ver ni consultar datos de otros
 *    campus». «Solo hara consulta el MCP».
 *
 * Todo lo que crea lleva la marca MCPTEST y se borra al final.
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/mcpIntegracion.test.js
 */

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPTEST${Date.now().toString(36)}`;
const SECRETOS = {
  nif: `${MARCA}-NIF-SECRETO`,
  dni: `${MARCA}-DNI-SECRETO`,
  iban: `ES00${MARCA}IBAN`,
};

// ids de lo creado
const S = {};   // sociedades
const P = {};   // proyectos
const U = {};   // personas
const L = {};   // prospectos
const V = {};   // ventas
const F = {};   // facturas
const TOKENS = {};

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

// ─── Datos ────────────────────────────────────────────────────────────────

async function crearSociedad(clave) {
  S[clave] = (await one(
    `INSERT INTO invoice_issuers (razon_social, nif, iban) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Empresa ${clave}`, `${MARCA}-${clave}`, SECRETOS.iban]
  )).id;
}

async function crearProyecto(clave, sociedad, { prueba = false } = {}) {
  P[clave] = (await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id, es_prueba)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`${MARCA} Campus ${clave}`, `${MARCA.toLowerCase()}-${clave.toLowerCase()}`, `${MARCA}-key-${clave}`, S[sociedad], prueba]
  )).id;
}

async function crearPersona(clave, role, proyectos = [], { usaMcp = false } = {}) {
  U[clave] = (await one(
    `INSERT INTO users (nombre, email, password_hash, role, usa_mcp)
     VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, role, usaMcp]
  )).id;
  for (const p of proyectos) {
    await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [U[clave], P[p]]);
  }
}

async function crearProspecto(clave, proyecto, responsable) {
  L[clave] = (await one(
    `INSERT INTO leads (project_id, nombre, email, telefono, responsable_id, identificacion_fiscal)
     VALUES ($1, $2, $3, '+34600000000', $4, $5) RETURNING id`,
    [P[proyecto], `${MARCA} Prospecto ${clave}`, `${clave.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`,
      responsable ? U[responsable] : null, SECRETOS.dni]
  )).id;
}

async function crearVenta(clave, prospecto, proyecto, vendedora, total, cobrado) {
  V[clave] = (await one(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE) RETURNING id`,
    [L[prospecto], P[proyecto], `${MARCA} Master ${clave}`, total, cobrado, U[vendedora]]
  )).id;
  if (cobrado > 0) {
    await q(`INSERT INTO conversion_payments (conversion_id, importe) VALUES ($1, $2)`, [V[clave], cobrado]);
  }
}

async function crearFactura(clave, venta, prospecto, proyecto, sociedad, numero) {
  F[clave] = (await one(
    `INSERT INTO invoices (project_id, conversion_id, lead_id, ano, numero, codigo, cliente_nombre, cliente_nif,
                           cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible,
                           total, issuer_id, issuer_razon_social, issuer_iban, serie)
     VALUES ($1, $2, $3, 2026, $4, $5, $6, $7, 'Calle Secreta 1', 'Madrid', '28001', 'España',
             '[]'::jsonb, 100, 121, $8, $9, $10, $11) RETURNING id`,
    [P[proyecto], V[venta], L[prospecto], numero, `${MARCA}-${clave}`, `${MARCA} Cliente ${clave}`,
      SECRETOS.nif, S[sociedad], `${MARCA} Empresa ${sociedad}`, SECRETOS.iban, `M${numero}`]
  )).id;
}

/**
 * El mapa:
 *
 *   Empresa UNO ── Campus A (admin Ana, gestora Gema con acceso, gestor Gus SIN acceso)
 *               └─ Campus B (admin Ana)
 *               └─ Campus T (de pruebas)
 *   Empresa DOS ── Campus C (gestora Clara con acceso)
 */
beforeAll(async () => {
  await crearSociedad('UNO');
  await crearSociedad('DOS');
  await crearProyecto('A', 'UNO');
  await crearProyecto('B', 'UNO');
  await crearProyecto('T', 'UNO', { prueba: true });
  await crearProyecto('C', 'DOS');

  await crearPersona('SUPER', 'superadmin');
  await crearPersona('ANA', 'admin', ['A', 'B']);
  await crearPersona('GEMA', 'gestor', ['A'], { usaMcp: true });
  await crearPersona('GUS', 'gestor', ['A']);
  await crearPersona('CLARA', 'gestor', ['C'], { usaMcp: true });
  await crearPersona('TUTOR', 'tutor', ['A'], { usaMcp: true });

  await crearProspecto('A_GEMA', 'A', 'GEMA');
  await crearProspecto('A_GUS', 'A', 'GUS');
  await crearProspecto('B_ANA', 'B', 'ANA');
  await crearProspecto('C_CLARA', 'C', 'CLARA');
  await crearProspecto('T_PRUEBA', 'T', 'ANA');

  await crearVenta('A_GEMA', 'A_GEMA', 'A', 'GEMA', 1000, 400);
  await crearVenta('A_GUS', 'A_GUS', 'A', 'GUS', 2000, 2000);
  await crearVenta('C_CLARA', 'C_CLARA', 'C', 'CLARA', 3000, 0);

  await crearFactura('A_GEMA', 'A_GEMA', 'A_GEMA', 'A', 'UNO', 9001);
  await crearFactura('A_GUS', 'A_GUS', 'A_GUS', 'A', 'UNO', 9002);
  await crearFactura('C_CLARA', 'C_CLARA', 'C_CLARA', 'C', 'DOS', 9003);

  // Los tokens se crean por el panel, como lo haria cada persona.
  for (const clave of ['SUPER', 'ANA', 'GEMA', 'CLARA']) {
    TOKENS[clave] = await crearTokenPorPanel(clave);
  }
}, 60000);

afterAll(async () => {
  const ids = (o) => Object.values(o);
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids(U)]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids(U)]);
  await q(`DELETE FROM invoices WHERE id = ANY($1::int[])`, [ids(F)]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids(V)]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids(V)]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids(L)]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids(U)]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids(U)]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids(P)]);
  await q(`DELETE FROM invoice_issuers WHERE id = ANY($1::int[])`, [ids(S)]);
  await pool.end();
}, 60000);

// ─── Utilidades ───────────────────────────────────────────────────────────

const jwtDe = async (clave) => {
  const { role } = await one(`SELECT role FROM users WHERE id = $1`, [U[clave]]);
  return jwt.sign({ userId: U[clave], role }, process.env.JWT_SECRET, { expiresIn: '10m' });
};

async function crearTokenPorPanel(clave) {
  const r = await request.post('/api/mcp/panel/tokens')
    .set('Authorization', `Bearer ${await jwtDe(clave)}`)
    .send({ nombre: `Claude de ${clave}` });
  if (r.status !== 201) throw new Error(`No se pudo crear el token de ${clave}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.token;
}

/** Todo lo que el MCP devuelve, para buscar secretos en ello al final. */
const RESPUESTAS = [];

let idRpc = 0;
async function rpc(token, method, params = {}) {
  const r = await request.post('/api/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Authorization', `Bearer ${token}`)
    .send({ jsonrpc: '2.0', id: ++idRpc, method, params });
  RESPUESTAS.push(JSON.stringify(r.body));
  return r;
}

/** Llama a una herramienta. Devuelve { ok, datos, texto }. */
async function llamar(clave, name, args = {}) {
  const r = await rpc(TOKENS[clave], 'tools/call', { name, arguments: args });
  expect(r.status).toBe(200);
  const texto = r.body.result.content[0].text;
  const ok = !r.body.result.isError;
  return { ok, texto, datos: ok ? JSON.parse(texto) : null };
}

const nuestros = (filas, col = 'id', de = L) => filas.map((f) => f[col]).filter((id) => Object.values(de).includes(id));
const nombresDe = (ids, de) => ids.map((id) => Object.keys(de).find((k) => de[k] === id)).sort();

/** Huella de todo lo creado: si algo cambia, el MCP escribio. */
async function fotoDeLosDatos() {
  const tablas = [
    ['leads', L], ['conversions', V], ['invoices', F], ['projects', P], ['invoice_issuers', S],
  ];
  const partes = [];
  for (const [tabla, o] of tablas) {
    const r = await one(
      `SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS h FROM ${tabla} t WHERE t.id = ANY($1::int[])`,
      [Object.values(o)]
    );
    partes.push(`${tabla}:${r.h}`);
  }
  const pagos = await one(
    `SELECT md5(string_agg(t::text, '|' ORDER BY t.id)) AS h FROM conversion_payments t WHERE conversion_id = ANY($1::int[])`,
    [Object.values(V)]
  );
  const users = await one(
    `SELECT md5(string_agg(concat_ws(',', t.id, t.role, t.usa_mcp, t.active), '|' ORDER BY t.id)) AS h FROM users t WHERE t.id = ANY($1::int[])`,
    [Object.values(U)]
  );
  return [...partes, `pagos:${pagos.h}`, `users:${users.h}`].join(' ');
}

let fotoInicial;
beforeAll(async () => { fotoInicial = await fotoDeLosDatos(); });

// ─── Protocolo ────────────────────────────────────────────────────────────

describe('el protocolo, con la base de verdad', () => {
  it('initialize y tools/list', async () => {
    const init = await rpc(TOKENS.ANA, 'initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('crm-iseih');

    const list = await rpc(TOKENS.ANA, 'tools/list');
    // 13 desde el 01/10: «listar_tutores», «comisiones_tutores» y «formaciones_sin_tutor».
    // 16 desde el 06/10 (#215): «listar_formaciones», «resumen_catalogo» y «ver_formacion».
    expect(list.body.result.tools.length).toBe(16);
    expect(list.body.result.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['listar_formaciones', 'resumen_catalogo', 'ver_formacion']));
  });

  it('el token se guarda como huella, nunca en claro', async () => {
    const filas = await q(`SELECT token_hash, prefijo FROM mcp_tokens WHERE user_id = $1`, [U.ANA]);
    expect(filas).toHaveLength(1);
    expect(filas[0].token_hash).not.toBe(TOKENS.ANA);
    expect(filas[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(TOKENS.ANA.startsWith(filas[0].prefijo)).toBe(true);
  });
});

// ─── Empresa y campus ─────────────────────────────────────────────────────

describe('super admin: todos los campus menos los de prueba', () => {
  it('mis_proyectos trae A, B y C, y no T', async () => {
    const { datos } = await llamar('SUPER', 'mis_proyectos');
    expect(nombresDe(nuestros(datos.proyectos, 'id', P), P)).toEqual(['A', 'B', 'C']);
  });

  it('ve los prospectos de las dos empresas', async () => {
    const { datos } = await llamar('SUPER', 'buscar_prospectos', { texto: MARCA, limite: 100 });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['A_GEMA', 'A_GUS', 'B_ANA', 'C_CLARA']);
  });
});

describe('admin de la empresa UNO (campus A y B)', () => {
  it('mis_proyectos: solo A y B', async () => {
    const { datos } = await llamar('ANA', 'mis_proyectos');
    expect(nombresDe(datos.proyectos.map((p) => p.id), P)).toEqual(['A', 'B']);
    expect(datos.proyectos.every((p) => p.sociedad_id === S.UNO)).toBe(true);
  });

  it('prospectos: los de A y B de todas las personas; nada de C', async () => {
    const { datos } = await llamar('ANA', 'buscar_prospectos', { texto: MARCA, limite: 100 });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['A_GEMA', 'A_GUS', 'B_ANA']);
  });

  it('pedir el campus C (otra empresa): rechazado', async () => {
    const r = await llamar('ANA', 'buscar_prospectos', { proyecto_id: P.C });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/No tienes acceso al campus/);
  });

  it('pedir la empresa DOS: rechazado', async () => {
    const r = await llamar('ANA', 'listar_ventas', { sociedad_id: S.DOS });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/No tienes acceso a la empresa/);
  });

  it('el campus de pruebas T tampoco, aunque sea de su empresa', async () => {
    const r = await llamar('ANA', 'buscar_prospectos', { proyecto_id: P.T });
    expect(r.ok).toBe(false);
  });

  it('ver un prospecto de C por su id: no existe para ella', async () => {
    const r = await llamar('ANA', 'ver_prospecto', { id: L.C_CLARA });
    expect(r.ok).toBe(false);
    expect(r.texto).toMatch(/no existe o no tienes acceso/);
  });

  it('ventas: las de A (Gema y Gus), con lo cobrado de conversion_payments', async () => {
    const { datos } = await llamar('ANA', 'listar_ventas', { texto: MARCA, limite: 100 });
    const mias = datos.ventas.filter((v) => Object.values(V).includes(v.id));
    expect(nombresDe(mias.map((v) => v.id), V)).toEqual(['A_GEMA', 'A_GUS']);
    const gema = mias.find((v) => v.id === V.A_GEMA);
    expect(Number(gema.cobrado)).toBe(400);
    expect(Number(gema.pendiente)).toBe(600);
  });

  it('facturas: las de A; nada de C', async () => {
    const { datos } = await llamar('ANA', 'listar_facturas', { texto: MARCA, limite: 100 });
    expect(nombresDe(nuestros(datos.facturas, 'id', F), F)).toEqual(['A_GEMA', 'A_GUS']);
  });

  it('acotar a la empresa UNO y al campus B funciona', async () => {
    const { datos } = await llamar('ANA', 'buscar_prospectos', { sociedad_id: S.UNO, proyecto_id: P.B, texto: MARCA });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['B_ANA']);
  });
});

describe('gestora con acceso: solo lo suyo, dentro de su campus', () => {
  it('ve lo suyo: alcance «solo tus propios»', async () => {
    const { datos } = await llamar('GEMA', 'mis_proyectos');
    expect(datos.alcance).toMatch(/Solo tus propios/);
    expect(nombresDe(datos.proyectos.map((p) => p.id), P)).toEqual(['A']);
  });

  it('prospectos: solo el suyo, no el de Gus aunque sea del mismo campus', async () => {
    const { datos } = await llamar('GEMA', 'buscar_prospectos', { texto: MARCA, limite: 100 });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['A_GEMA']);
  });

  it('por la URL personal (Agregar conector) ve exactamente lo mismo: solo lo suyo', async () => {
    const r = await request.post(`/api/mcp/u/${TOKENS.GEMA}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/call',
        params: { name: 'buscar_prospectos', arguments: { texto: MARCA, limite: 100 } } });
    RESPUESTAS.push(JSON.stringify(r.body));
    expect(r.status).toBe(200);
    const datos = JSON.parse(r.body.result.content[0].text);
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['A_GEMA']);
  });

  it('la ficha del prospecto de Gus: no existe para ella', async () => {
    const r = await llamar('GEMA', 'ver_prospecto', { id: L.A_GUS });
    expect(r.ok).toBe(false);
  });

  it('su propia ficha si, con su venta', async () => {
    const { datos } = await llamar('GEMA', 'ver_prospecto', { id: L.A_GEMA });
    expect(datos.id).toBe(L.A_GEMA);
    expect(datos.ventas.map((v) => v.id)).toEqual([V.A_GEMA]);
  });

  it('ventas y facturas: solo las suyas', async () => {
    const v = await llamar('GEMA', 'listar_ventas', { texto: MARCA });
    expect(nombresDe(v.datos.ventas.map((x) => x.id).filter((id) => Object.values(V).includes(id)), V)).toEqual(['A_GEMA']);
    const f = await llamar('GEMA', 'listar_facturas', { texto: MARCA });
    expect(nombresDe(nuestros(f.datos.facturas, 'id', F), F)).toEqual(['A_GEMA']);
  });

  it('resumen de ventas: solo cuenta lo suyo', async () => {
    const { datos } = await llamar('GEMA', 'resumen_ventas', { proyecto_id: P.A });
    expect(datos.ventas).toBe(1);
    expect(Number(datos.importe_vendido)).toBe(1000);
    expect(Number(datos.cobrado)).toBe(400);
  });

  it('cobros pendientes: solo lo suyo', async () => {
    const { datos } = await llamar('GEMA', 'cobros_pendientes', { proyecto_id: P.A });
    const ventas = datos.detalle.map((d) => d.venta_id);
    expect(ventas).toContain(V.A_GEMA);
    expect(ventas).not.toContain(V.C_CLARA);
  });

  it('el informe de todo el campus se le niega; el mensual si', async () => {
    const general = await llamar('GEMA', 'informe', { tipo: 'resumen_general' });
    expect(general.ok).toBe(false);
    const mensual = await llamar('GEMA', 'informe', { tipo: 'resumen_mensual', proyecto_id: P.A });
    expect(mensual.ok).toBe(true);
  });
});

describe('gestora de la OTRA empresa', () => {
  it('Clara solo ve el campus C', async () => {
    const { datos } = await llamar('CLARA', 'buscar_prospectos', { texto: MARCA, limite: 100 });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['C_CLARA']);
    const r = await llamar('CLARA', 'listar_facturas', { proyecto_id: P.A });
    expect(r.ok).toBe(false);
  });
});

// ─── Quien entra ──────────────────────────────────────────────────────────

describe('la puerta, con la base de verdad', () => {
  it('un gestor sin la casilla no puede ni crear token', async () => {
    const r = await request.post('/api/mcp/panel/tokens')
      .set('Authorization', `Bearer ${await jwtDe('GUS')}`).send({ nombre: 'intento' });
    expect(r.status).toBe(403);
  });

  it('un tutor con la casilla puesta tampoco', async () => {
    const r = await request.post('/api/mcp/panel/tokens')
      .set('Authorization', `Bearer ${await jwtDe('TUTOR')}`).send({ nombre: 'intento' });
    expect(r.status).toBe(403);
  });

  it('un gestor no puede dar accesos', async () => {
    const r = await request.patch(`/api/mcp/panel/personas/${U.GUS}`)
      .set('Authorization', `Bearer ${await jwtDe('GEMA')}`).send({ usa_mcp: true });
    expect(r.status).toBe(403);
  });

  it('un admin no puede dar acceso a alguien de otro campus', async () => {
    const r = await request.patch(`/api/mcp/panel/personas/${U.CLARA}`)
      .set('Authorization', `Bearer ${await jwtDe('ANA')}`).send({ usa_mcp: false });
    expect(r.status).toBe(403);
  });

  it('el admin solo ve en la lista a la gente de sus campus', async () => {
    const r = await request.get('/api/mcp/panel/personas').set('Authorization', `Bearer ${await jwtDe('ANA')}`);
    const nuestras = r.body.data.filter((p) => Object.values(U).includes(p.id)).map((p) => p.id);
    // Tutor no sale: a un tutor no se le puede dar el MCP. Clara es de otro campus.
    expect(nombresDe(nuestras, U)).toEqual(['ANA', 'GEMA', 'GUS']);
  });

  it('dar acceso a Gus, usarlo, quitarlo (se pausa) y devolverlo: la MISMA URL vuelve a valer', async () => {
    const jwtAna = await jwtDe('ANA');
    let r = await request.patch(`/api/mcp/panel/personas/${U.GUS}`)
      .set('Authorization', `Bearer ${jwtAna}`).send({ usa_mcp: true });
    expect(r.status).toBe(200);

    TOKENS.GUS = await crearTokenPorPanel('GUS');
    const { datos } = await llamar('GUS', 'buscar_prospectos', { texto: MARCA });
    expect(nombresDe(nuestros(datos.prospectos), L)).toEqual(['A_GUS']);

    // Quitar el acceso: la puerta se cierra en la siguiente consulta...
    r = await request.patch(`/api/mcp/panel/personas/${U.GUS}`)
      .set('Authorization', `Bearer ${jwtAna}`).send({ usa_mcp: false });
    expect(r.status).toBe(200);
    expect((await rpc(TOKENS.GUS, 'tools/list')).status).toBe(403);
    // ...pero su URL NO se borra (decidido con Diana el 28/09)...
    const { revocado } = await one(`SELECT (revoked_at IS NOT NULL) AS revocado FROM mcp_tokens WHERE user_id = $1`, [U.GUS]);
    expect(revocado).toBe(false);

    // ...y al devolverle el acceso, la misma URL vuelve a funcionar sin tocar su Claude.
    await request.patch(`/api/mcp/panel/personas/${U.GUS}`)
      .set('Authorization', `Bearer ${jwtAna}`).send({ usa_mcp: true }).expect(200);
    const otraVez = await request.post(`/api/mcp/u/${TOKENS.GUS}`)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: ++idRpc, method: 'tools/list' });
    expect(otraVez.status).toBe(200);

    await request.patch(`/api/mcp/panel/personas/${U.GUS}`)
      .set('Authorization', `Bearer ${jwtAna}`).send({ usa_mcp: false }).expect(200);
  });

  it('los tokens caducan a los 90 días por defecto (#194; hasta el 03/10 no caducaban)', async () => {
    const filas = await q(
      `SELECT EXTRACT(EPOCH FROM (expires_at - created_at)) / 86400 AS dias
         FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [[U.ANA, U.GEMA]]
    );
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => Math.round(Number(f.dias)) === 90)).toBe(true);
  });

  it('quitar el campus a una persona: deja de verlo en la siguiente pregunta', async () => {
    await q(`UPDATE user_projects SET active = false WHERE user_id = $1 AND project_id = $2`, [U.ANA, P.B]);
    try {
      const { datos } = await llamar('ANA', 'mis_proyectos');
      expect(nombresDe(datos.proyectos.map((p) => p.id), P)).toEqual(['A']);
    } finally {
      await q(`UPDATE user_projects SET active = true WHERE user_id = $1 AND project_id = $2`, [U.ANA, P.B]);
    }
  });

  it('usuario desactivado: fuera, aunque su token siga vivo', async () => {
    await q(`UPDATE users SET active = false WHERE id = $1`, [U.CLARA]);
    try {
      expect((await rpc(TOKENS.CLARA, 'tools/list')).status).toBe(403);
    } finally {
      await q(`UPDATE users SET active = true WHERE id = $1`, [U.CLARA]);
    }
  });

  it('token caducado: 401', async () => {
    await q(`UPDATE mcp_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE user_id = $1`, [U.CLARA]);
    expect((await rpc(TOKENS.CLARA, 'tools/list')).status).toBe(401);
  });

  it('token revocado desde el panel: 401', async () => {
    const jwtGema = await jwtDe('GEMA');
    const panel = await request.get('/api/mcp/panel').set('Authorization', `Bearer ${jwtGema}`);
    const vivo = panel.body.data.tokens.find((t) => t.vivo);
    expect(vivo.token).toBeUndefined(); // el panel nunca devuelve el token
    await request.delete(`/api/mcp/panel/tokens/${vivo.id}`).set('Authorization', `Bearer ${jwtGema}`).expect(200);
    expect((await rpc(TOKENS.GEMA, 'tools/list')).status).toBe(401);
  });

  it('no se puede revocar el token de otra persona', async () => {
    const { id } = await one(`SELECT id FROM mcp_tokens WHERE user_id = $1 AND revoked_at IS NULL`, [U.ANA]);
    const r = await request.delete(`/api/mcp/panel/tokens/${id}`).set('Authorization', `Bearer ${await jwtDe('SUPER')}`);
    expect(r.status).toBe(404);
  });
});

// ─── Al final: nada cambio, nada sensible salio, todo quedo anotado ───────

describe('despues de todas las consultas', () => {
  it('los datos estan exactamente igual que al principio (solo consulta)', async () => {
    expect(await fotoDeLosDatos()).toBe(fotoInicial);
  });

  it('ninguna respuesta lleva NIF, DNI, IBAN ni direccion fiscal', () => {
    const todo = RESPUESTAS.join('\n');
    expect(RESPUESTAS.length).toBeGreaterThan(20);
    expect(todo).not.toContain(SECRETOS.nif);
    expect(todo).not.toContain(SECRETOS.dni);
    expect(todo).not.toContain(SECRETOS.iban);
    expect(todo).not.toContain('Calle Secreta');
    expect(todo).not.toContain(`${MARCA}-key-`); // webhook_api_key de los proyectos
  });

  it('cada consulta quedo en la auditoria, las buenas y las rechazadas', async () => {
    const filas = await q(
      `SELECT herramienta, ok FROM mcp_auditoria WHERE user_id = $1`, [U.ANA]
    );
    expect(filas.length).toBeGreaterThan(5);
    expect(filas.some((f) => !f.ok)).toBe(true);
    expect(filas.some((f) => f.ok && f.herramienta === 'listar_ventas')).toBe(true);
  });
});
