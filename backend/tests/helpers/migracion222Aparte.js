/**
 * Pasar la migración 239 SOLO sobre los datos de una prueba (#423, QA de Diego,
 * punto 9).
 *
 * La 239 trabaja sobre `users`, `user_permission_overrides` y `custom_roles`
 * enteras: pasada contra la base compartida de las pruebas, tocaba a todas las
 * personas de las demás. Aquí se abre una conexión propia y se crean, en su
 * esquema temporal, tablas con el MISMO nombre y la misma forma (`LIKE …
 * INCLUDING ALL`: columnas, valores por defecto, índices únicos). PostgreSQL
 * busca primero en el esquema temporal, así que la migración, tal cual, solo ve
 * esas copias. Al acabar se borran: la base compartida no se entera.
 *
 *   const m = await abrir();
 *   const [u] = await m.q('INSERT INTO users … RETURNING id', […]);
 *   await m.pasar(); await m.pasar();     // dos veces: no repite nada
 *   await m.q('SELECT … FROM user_permission_overrides …');
 *   await m.cerrar();
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../src/shared/config/db.js';

const SQL = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations/239_permisos_casillas_a_excepciones.sql'), 'utf8');

const TABLAS = ['users', 'user_permission_overrides', 'custom_roles', 'permisos_registro', 'permisos_inertes_archivo'];

export async function abrir() {
  const c = await pool.connect();
  for (const t of TABLAS) await c.query(`CREATE TEMP TABLE ${t} (LIKE public.${t} INCLUDING ALL)`);
  return {
    cliente: c,
    q: (sql, p) => c.query(sql, p).then((r) => r.rows),
    pasar: () => c.query(SQL),
    async cerrar() {
      try {
        for (const t of TABLAS) await c.query(`DROP TABLE IF EXISTS pg_temp.${t}`);
      } finally {
        c.release();
      }
    },
  };
}
