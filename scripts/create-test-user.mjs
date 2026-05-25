// Crea (o reactiva) un superadmin temporal para tests CRUD y lo asocia a
// todos los proyectos ISEIE. Genera el bcrypt con cost 12.
// Uso (en el VPS, dentro de /opt/crm-iseie/):
//   node scripts/create-test-user.mjs
// Salida: OK_USER_ID=<id>
import bcrypt from 'bcrypt';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const email = 'crud-test-temp@iseie.test';
const password = 'TestCRM_2026!';
const hash = await bcrypt.hash(password, 12);
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const { rows } = await client.query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, $3, 'superadmin', true)
     ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, active=true
     RETURNING id`,
    ['CRUD Test (temporal)', email, hash]
  );
  const uid = rows[0].id;
  await client.query(
    `INSERT INTO user_projects (user_id, project_id, orden_cola, active)
     SELECT $1, id, 0, true FROM projects WHERE slug LIKE 'iseie-%'
     ON CONFLICT (user_id, project_id) DO UPDATE SET active = true`,
    [uid]
  );
  await client.query('COMMIT');
  console.log('OK_USER_ID=' + uid);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ERR:', e.message);
  process.exit(1);
} finally { client.release(); await pool.end(); }
