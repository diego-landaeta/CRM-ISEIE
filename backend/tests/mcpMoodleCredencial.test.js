import { describe, it, expect, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as credenciales from '../src/modules/credentials/credentials.model.js';
import { credencialesMoodle, ErrorMoodle } from '../src/modules/mcp/mcp.moodle.cliente.js';

/**
 * #335 · La credencial «moodle» de un campus, con la base de verdad: se guarda
 * cifrada (migracion 220 aplicada: el enum ya admite el servicio), se lee por
 * el MCP y el secreto no queda en claro en ninguna columna.
 *
 * Es el unico trozo de #335 que toca la base. Lo demas (mcpMoodle.test.js) va
 * con la base y Moodle simulados. Marca unica y limpieza al final.
 */

const MARCA = `MDL${Date.now().toString(36)}`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
let proyecto;
const creadas = [];

afterAll(async () => {
  for (const id of creadas) await pool.query('DELETE FROM api_credentials WHERE id = $1', [id]);
  await pool.end();
});

describe('la credencial moodle de un campus, en la base', () => {
  it('se puede guardar (el enum la admite), cifrada, y el MCP la lee', async () => {
    const { rows } = await pool.query('SELECT id FROM projects WHERE active = true ORDER BY id LIMIT 1');
    proyecto = rows[0].id;
    // Si ya hubiera una de otro, no se pisa: no es nuestra.
    const previa = await pool.query(
      `SELECT 1 FROM api_credentials WHERE service = 'moodle' AND project_id = $1 AND COALESCE(metadata->>'entorno','produccion') = 'produccion'`,
      [proyecto]
    );
    if (previa.rowCount) return;

    const valor = JSON.stringify({ url: `https://${MARCA.toLowerCase()}.test/`, token: TOKEN });
    const cred = await credenciales.upsert({ project_id: proyecto, service: 'moodle', value: valor, entorno: 'produccion' });
    creadas.push(cred.id);

    // En la base no hay nada legible.
    const { rows: [fila] } = await pool.query('SELECT * FROM api_credentials WHERE id = $1', [cred.id]);
    expect(JSON.stringify(fila)).not.toContain(TOKEN);
    expect(JSON.stringify(fila)).not.toContain(MARCA.toLowerCase());

    const leidas = await credencialesMoodle([proyecto]);
    expect(leidas.get(proyecto)).toEqual({ url: `https://${MARCA.toLowerCase()}.test`, token: TOKEN });

    // Un campus sin credencial no esta en el mapa (el MCP dira «sin Moodle configurado»).
    expect((await credencialesMoodle([2147483000])).size).toBe(0);
  });

  it('la de «pruebas» no se usa en el MCP', async () => {
    const { rows } = await pool.query('SELECT id FROM projects WHERE active = true ORDER BY id DESC LIMIT 1');
    const otro = rows[0].id;
    const previa = await pool.query(`SELECT 1 FROM api_credentials WHERE service = 'moodle' AND project_id = $1`, [otro]);
    if (previa.rowCount) return;
    const cred = await credenciales.upsert({
      project_id: otro, service: 'moodle', value: JSON.stringify({ url: 'https://pruebas.test', token: TOKEN }), entorno: 'pruebas',
    }).catch((e) => e);
    if (cred instanceof Error) return; // sin la migracion de entornos en esta base: nada que probar
    creadas.push(cred.id);
    expect((await credencialesMoodle([otro])).has(otro)).toBe(false);
  });

  it('un valor que no es JSON se lee como error de credencial, sin repetir el valor', async () => {
    expect(ErrorMoodle).toBeTruthy();
    const { rows } = await pool.query('SELECT id FROM projects WHERE active = true ORDER BY id OFFSET 1 LIMIT 1');
    if (!rows[0]) return;
    const id = rows[0].id;
    const previa = await pool.query(`SELECT 1 FROM api_credentials WHERE service = 'moodle' AND project_id = $1`, [id]);
    if (previa.rowCount) return;
    const cred = await credenciales.upsert({ project_id: id, service: 'moodle', value: `no-json-${TOKEN}`, entorno: 'produccion' });
    creadas.push(cred.id);
    const leida = (await credencialesMoodle([id])).get(id);
    expect(leida).toBeInstanceOf(ErrorMoodle);
    expect(leida.message).not.toContain(TOKEN);
  });
});
