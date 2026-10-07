import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import pool from '../src/shared/config/db.js';
import mcp from '../src/modules/mcp/index.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import {
  enmascararTelefono, enmascararEmail, abreviarNombre, protegerDatos, recortarFilas,
} from '../src/modules/mcp/mcp.privacidad.js';

/**
 * Menos datos personales y un máximo de filas (#196).
 *
 * Diego: «teléfonos y correos enmascarados por defecto (por ejemplo
 * +34 6** *** 123); el nombre completo solo cuando haga falta; un máximo de
 * filas por respuesta, para que no se pueda volcar una tabla entera».
 */

describe('las reglas', () => {
  it('el teléfono, como el ejemplo de Diego', () => {
    expect(enmascararTelefono('+34 612 345 123')).toBe('+34 6** *** 123');
    expect(enmascararTelefono('612345123')).toBe('6*****123');
  });

  it('teléfonos con puntos, paréntesis o guiones también se enmascaran', () => {
    const r = protegerDatos({ telefono: '612.345.123', movil: '+34 (612) 34-51-23' });
    expect(r.telefono).toBe('6**.***.123');
    expect(r.movil).not.toMatch(/612/);
  });

  it('el correo', () => {
    expect(enmascararEmail('pedro.s@gmail.com')).toBe('p***@g***.com');
  });

  it('el nombre abreviado', () => {
    expect(abreviarNombre('Pedro Sánchez López')).toBe('Pedro S.');
  });

  it('solo se tocan datos de clientes: ni campus, ni equipo, ni contadores', () => {
    const r = protegerDatos({
      proyectos: [{ nombre: 'ISEIH' }],                       // un campus: igual
      ventas: [{ cliente: 'Pedro Sanchez', vendedora: 'Diego R.' }],
      por_tipo: { email: 2, whatsapp: 3 },                    // contadores: igual
    });
    expect(r.proyectos[0].nombre).toBe('ISEIH');
    expect(r.ventas[0]).toEqual({ cliente: 'Pedro S.', vendedora: 'Diego R.' });
    expect(r.por_tipo).toEqual({ email: 2, whatsapp: 3 });
  });

  it('con datos_completos sale todo tal cual', () => {
    const datos = { email: 'a@b.com', telefono: '+34 600 000 000', cliente: 'Ana Pérez' };
    expect(protegerDatos(datos, { completos: true })).toEqual(datos);
  });

  it('el máximo de filas recorta cualquier lista, también dentro de otra', () => {
    const { datos, recortes } = recortarFilas({ a: [1, 2, 3], b: { c: [1, 2, 3, 4] } }, 2);
    expect(datos).toEqual({ a: [1, 2], b: { c: [1, 2] } });
    expect(recortes.map((r) => r.lista)).toEqual(['a', 'b.c']);
  });
});

// ─── Con la base de verdad, por el MCP ────────────────────────────────────

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MCPPRIV${Date.now().toString(36)}`;
const ids = { users: [], projects: [], leads: [], ventas: [] };
let TOKEN;

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

beforeAll(async () => {
  const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  ids.projects.push(p.id);
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id, role`,
    [`${MARCA} Admin`, `admin@${MARCA.toLowerCase()}.test`]);
  ids.users.push(u.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, p.id]);
  for (let i = 1; i <= 5; i++) {
    const [l] = await q(
      `INSERT INTO leads (project_id, nombre, email, telefono, responsable_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [p.id, `${MARCA} Cliente${i} Apellido`, `cliente${i}@correo-${MARCA.toLowerCase()}.com`, `+34 612 345 12${i}`, u.id]
    );
    ids.leads.push(l.id);
  }
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, vendedora_id) VALUES ($1, $2, 'Master', 100, $3) RETURNING id`,
    [ids.leads[0], p.id, u.id]
  );
  ids.ventas.push(v.id);
  const jwtAdmin = jwt.sign({ userId: u.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  TOKEN = (await request.post('/api/mcp/panel/tokens').set('Authorization', `Bearer ${jwtAdmin}`).send({ nombre: 'priv' })).body.data.token;
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM mcp_auditoria WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM mcp_tokens WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.ventas]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  process.env.MCP_CODIGO_OBLIGATORIO = 'false';
  delete process.env.MCP_MAX_FILAS;
});

async function llamar(name, args = {}) {
  const r = await request.post(`/api/mcp/u/${TOKEN}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const texto = r.body.result.content[0].text;
  const corte = texto.indexOf('\n[Solo se muestran');
  return { texto, datos: JSON.parse(corte >= 0 ? texto.slice(0, corte) : texto) };
}

describe('por el MCP, con la base de verdad', () => {
  it('buscar_prospectos: correo y teléfono enmascarados, nombre abreviado', async () => {
    const { texto, datos } = await llamar('buscar_prospectos', { texto: MARCA, limite: 10 });
    const c1 = datos.prospectos.find((p) => p.id === ids.leads[0]);
    expect(c1.nombre).toBe(`${MARCA} C.`);
    expect(c1.telefono).toBe('+34 6** *** 121');
    expect(c1.email).toMatch(/^c\*\*\*@c\*\*\*\.com$/);
    // Nada entero en ninguna parte del texto.
    expect(texto).not.toContain('cliente1@');
    expect(texto).not.toContain('612 345 121');
    expect(texto).not.toContain('Cliente1 Apellido');
  });

  it('ver_prospecto: nombre completo (aquí hace falta), contacto enmascarado', async () => {
    const { datos } = await llamar('ver_prospecto', { id: ids.leads[0] });
    expect(datos.nombre).toBe(`${MARCA} Cliente1 Apellido`);
    expect(datos.telefono).toBe('+34 6** *** 121');
    expect(datos.email).not.toContain('cliente1@');
  });

  it('con datos_completos sale entero, y queda en la auditoría', async () => {
    const { datos } = await llamar('ver_prospecto', { id: ids.leads[0], datos_completos: true });
    expect(datos.telefono).toBe('+34 612 345 121');
    expect(datos.email).toBe(`cliente1@correo-${MARCA.toLowerCase()}.com`);
    // La auditoría se escribe sin hacer esperar a Claude: se espera a que llegue.
    await vi.waitFor(async () => {
      const filas = await q(
        `SELECT parametros FROM mcp_auditoria WHERE user_id = $1 AND herramienta = 'ver_prospecto'`, [ids.users[0]]
      );
      expect(filas.some((f) => f.parametros?.datos_completos === true)).toBe(true);
    });
  });

  it('el informe de ventas por asesora tampoco da el contacto entero', async () => {
    const { texto } = await llamar('informe', { tipo: 'ventas_por_asesora' });
    expect(texto).not.toContain('cliente1@');
    expect(texto).not.toContain('612 345 121');
  });

  it('máximo de filas por respuesta: recorta y avisa', async () => {
    process.env.MCP_MAX_FILAS = '2';
    const { texto, datos } = await llamar('buscar_prospectos', { texto: MARCA, limite: 10 });
    expect(datos.prospectos).toHaveLength(2);
    expect(texto).toMatch(/Solo se muestran las primeras 2 filas de «prospectos» \(había 5\)/);
  });
});
