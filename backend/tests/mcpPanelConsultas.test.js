import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Conexión → MCP, «Consultas disponibles»: cada consulta en su apartado, para que la
 * pantalla no sea una lista plana de veinte. Con la base de verdad.
 *
 *   npx vitest run tests/mcpPanelConsultas.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { HERRAMIENTAS, GRUPO_DE_CONSULTA } = await import('../src/modules/mcp/mcp.tools.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MPC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
let ADMIN;

beforeAll(async () => {
  const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id, role`,
    [`${MARCA} ADMIN`, `admin@${MARCA.toLowerCase()}.test`]);
  ADMIN = u;
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM users WHERE id = $1`, [ADMIN.id]);
  await pool.end();
}, 60000);

describe('cada consulta tiene su apartado', () => {
  it('ninguna cae en «Otras»: al añadir una consulta hay que decir dónde se enseña', () => {
    const sinGrupo = HERRAMIENTAS.map((h) => h.nombre).filter((n) => !GRUPO_DE_CONSULTA[n]);
    expect(sinGrupo).toEqual([]);
  });

  it('y el mapa no habla de consultas que ya no existen', () => {
    const nombres = new Set(HERRAMIENTAS.map((h) => h.nombre));
    expect(Object.keys(GRUPO_DE_CONSULTA).filter((n) => !nombres.has(n))).toEqual([]);
  });

  it('las cuatro de Moodle van juntas', () => {
    const moodle = HERRAMIENTAS.filter((h) => h.nombre.startsWith('moodle_')).map((h) => GRUPO_DE_CONSULTA[h.nombre]);
    expect(moodle).toHaveLength(4);
    expect(new Set(moodle)).toEqual(new Set(['Moodle de los campus']));
  });
});

describe('GET /api/mcp/panel', () => {
  it('cada herramienta trae su apartado', async () => {
    const r = await request.get('/api/mcp/panel')
      .set('Authorization', `Bearer ${jwt.sign({ userId: ADMIN.id, role: ADMIN.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}`);
    expect(r.status).toBe(200);
    for (const h of r.body.data.herramientas) expect(h.grupo, h.nombre).toBeTruthy();
    expect(r.body.data.herramientas.find((h) => h.nombre === 'moodle_cursos').grupo).toBe('Moodle de los campus');
  });
});
