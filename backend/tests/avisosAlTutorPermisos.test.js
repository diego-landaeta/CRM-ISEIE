import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * «Avisar al tutor» (CRM#165 / CRM-ISEIE#188): la migración da permiso sobre
 * `tutor_avisos_comisiones` a los usuarios con los que corre la API.
 *
 * Diego, 27/11: las migraciones las pasa `postgres`, así que la tabla nace suya.
 * Sin el GRANT, `crm_user` / `crm_iseie_user` no pueden leerla ni escribirla:
 * la lista de Comisiones da 500 y el aviso falla DESPUÉS de haber mandado el
 * correo (el tutor lo recibe y no queda anotado).
 *
 * Contra la base. Todo va en una transacción que se deshace al final: el rol
 * que falte se crea dentro y desaparece con ella, para no pisar a otra prueba
 * que cree o borre el mismo rol a la vez. Por eso se le quitan a la migración
 * su BEGIN y su COMMIT (el COMMIT cerraría la nuestra).
 *
 * Un superusuario lo puede todo y has_table_privilege le dice que sí siempre:
 * solo se comprueban los roles que no lo son (en local y en el CI, `crm_user`
 * es el superusuario y `crm_iseie_user` el que de verdad se mira).
 *
 *   npx vitest run tests/avisosAlTutorPermisos.test.js
 */

process.env.LOG_LEVEL = 'silent';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');

const FICHERO = fs.readdirSync(path.join(AQUI, '../migrations')).find((f) => /^\d+_avisos_al_tutor\.sql$/.test(f));
const SQL = fs.readFileSync(path.join(AQUI, '../migrations', FICHERO), 'utf8');
const SIN_TRANSACCION = SQL.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, '');
const ROLES = ['crm_user', 'crm_iseie_user'];

afterAll(async () => { await pool.end(); });

describe(`la migración ${FICHERO}`, () => {
  it('abre y cierra su propia transacción (lo que se le quita aquí)', () => {
    expect(SQL).toMatch(/^BEGIN;\r?$/m);
    expect(SQL).toMatch(/^COMMIT;\r?$/m);
  });

  it('da SELECT, INSERT, UPDATE, DELETE sobre la tabla y USAGE, SELECT sobre su secuencia a crm_user y crm_iseie_user', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const r of ROLES) {
        const { rows } = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r]);
        if (!rows.length) await c.query(`CREATE ROLE ${r} NOLOGIN`);
        // Lo que ya tuviera (de un db:preparar con el rol creado) no cuenta:
        // se mide solo lo que da la migración.
        await c.query(`REVOKE ALL ON tutor_avisos_comisiones FROM ${r}`);
        await c.query(`REVOKE ALL ON SEQUENCE tutor_avisos_comisiones_id_seq FROM ${r}`);
      }
      // Dos veces: tiene que poder pasarse otra vez sin error.
      await c.query(SIN_TRANSACCION);
      await c.query(SIN_TRANSACCION);

      const { rows } = await c.query(
        `SELECT rolname AS rol,
                has_table_privilege(rolname, 'tutor_avisos_comisiones', 'SELECT') AS leer,
                has_table_privilege(rolname, 'tutor_avisos_comisiones', 'INSERT') AS anotar,
                has_table_privilege(rolname, 'tutor_avisos_comisiones', 'UPDATE') AS cambiar,
                has_table_privilege(rolname, 'tutor_avisos_comisiones', 'DELETE') AS borrar,
                has_sequence_privilege(rolname, 'tutor_avisos_comisiones_id_seq', 'USAGE') AS secuencia_usar,
                has_sequence_privilege(rolname, 'tutor_avisos_comisiones_id_seq', 'SELECT') AS secuencia_leer
           FROM pg_roles
          WHERE rolname = ANY($1::text[]) AND NOT rolsuper
          ORDER BY rolname`, [ROLES]);

      // Al menos uno de verdad (crm_iseie_user nunca es superusuario).
      expect(rows.map((r) => r.rol)).toContain('crm_iseie_user');
      for (const r of rows) {
        expect(r).toEqual({
          rol: r.rol, leer: true, anotar: true, cambiar: true, borrar: true, secuencia_usar: true, secuencia_leer: true,
        });
      }
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('el GRANT va para los dos roles, aunque en esta base uno sea superusuario', () => {
    // El último DO $$ de la migración, el de los permisos.
    const bloque = SQL.slice(SQL.lastIndexOf('DO $$'));
    for (const r of ROLES) expect(bloque).toContain(`'${r}'`);
    expect(bloque).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON tutor_avisos_comisiones TO %I/);
    expect(bloque).toMatch(/GRANT USAGE, SELECT ON SEQUENCE tutor_avisos_comisiones_id_seq TO %I/);
  });
});
