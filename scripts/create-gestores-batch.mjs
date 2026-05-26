// Crea (o reactiva) usuarios reales en el VPS, asociados al proyecto ISEIE.
// Lee INITIAL_PASSWORD del .env (no se imprime ni se loguea). bcrypt cost 12.
//
// Tras crear los usuarios, considera REMOVER la linea INITIAL_PASSWORD del .env
// (ya no se necesita; cada usuario puede cambiarla desde /profile).
//
// Uso (en el VPS):
//   node /opt/crm-iseie/scripts/create-gestores-batch.mjs           # crea sin borrar nada
//   node /opt/crm-iseie/scripts/create-gestores-batch.mjs --check-old  # solo verifica FKs del viejo superadmin
//   node /opt/crm-iseie/scripts/create-gestores-batch.mjs --drop-old   # borra manuel@empresa.com (requiere --check-old previo OK)
import bcrypt from 'bcrypt';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const INITIAL_PASSWORD = process.env.INITIAL_PASSWORD;
if (!INITIAL_PASSWORD || INITIAL_PASSWORD.length < 8) {
  console.error('ERROR: define INITIAL_PASSWORD (>=8 chars) en /opt/crm-iseie/.env');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GESTORES = [
  { nombre: 'Fabiola',   email: 'fabiola@iseie.com' },
  { nombre: 'Daniela',   email: 'daniela@iseie.com' },
  { nombre: 'Karla',     email: 'karla@iseie.com' },
  { nombre: 'Raquel',    email: 'raquel@iseie.com' },
  { nombre: 'Catherine', email: 'cm.lizardohernandez@gmail.com' },
  { nombre: 'Diana',     email: 'esquediav@gmail.com' },
];
const SUPERADMIN_NEW = { nombre: 'Manuel Casas', email: 'manuelcasasprofesional@gmail.com' };
const SUPERADMIN_OLD_EMAIL = 'manuel@empresa.com';

const args = process.argv.slice(2);
const CHECK_OLD = args.includes('--check-old');
const DROP_OLD = args.includes('--drop-old');

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Verificar proyecto ISEIE
  const { rows: projRows } = await client.query(`SELECT id FROM projects WHERE slug = 'iseie' LIMIT 1`);
  if (projRows.length === 0) throw new Error("Proyecto 'iseie' no existe");
  const projectId = projRows[0].id;

  if (CHECK_OLD || DROP_OLD) {
    // Inventario de FKs del viejo superadmin para evitar romper datos
    const { rows: oldRows } = await client.query(
      `SELECT id, email FROM users WHERE email = $1`,
      [SUPERADMIN_OLD_EMAIL]
    );
    if (oldRows.length === 0) {
      console.log(`(viejo ${SUPERADMIN_OLD_EMAIL} no existe, nada que verificar/borrar)`);
    } else {
      const oldId = oldRows[0].id;
      const tables = [
        { t: 'leads',           col: 'responsable_id' },
        { t: 'leads',           col: 'deleted_by' },
        { t: 'leads',           col: 'created_by' },
        { t: 'conversions',     col: 'created_by' },
        { t: 'lead_interactions', col: 'created_by' },
        { t: 'expenses',        col: 'registrado_por' },
        { t: 'documents',       col: 'created_by' },
        { t: 'lead_status_history', col: 'changed_by' },
        { t: 'lead_spam_reports',   col: 'reportado_por' },
      ];
      console.log(`\nINVENTARIO FKs de ${SUPERADMIN_OLD_EMAIL} (id=${oldId}):`);
      let totalRefs = 0;
      for (const { t, col } of tables) {
        try {
          const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE ${col} = $1`, [oldId]);
          if (r.rows[0].n > 0) {
            console.log(`  ${t}.${col}: ${r.rows[0].n}`);
            totalRefs += r.rows[0].n;
          }
        } catch { /* columna no existe en este schema, ignorar */ }
      }
      if (totalRefs === 0) console.log('  (sin referencias, seguro borrar)');
      else console.log(`  TOTAL: ${totalRefs} referencias`);

      if (DROP_OLD) {
        if (totalRefs > 0) {
          console.log(`\n⚠️ ABORT: ${totalRefs} refs apuntan al usuario viejo. Necesita re-asignar antes de borrar.`);
          await client.query('ROLLBACK');
          process.exit(2);
        }
        await client.query(`DELETE FROM user_projects WHERE user_id = $1`, [oldId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [oldId]);
        console.log(`✓ Borrado: ${SUPERADMIN_OLD_EMAIL}`);
      }
    }
    if (CHECK_OLD && !DROP_OLD) {
      await client.query('ROLLBACK');
      process.exit(0);
    }
  }

  const passwordHash = await bcrypt.hash(INITIAL_PASSWORD, 12);
  const allUsers = [
    ...GESTORES.map((g) => ({ ...g, role: 'gestor' })),
    { ...SUPERADMIN_NEW, role: 'superadmin' },
  ];

  const results = [];
  for (const u of allUsers) {
    const email = u.email.toLowerCase().trim();

    const { rows } = await client.query(
      `INSERT INTO users (nombre, email, password_hash, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (email) DO UPDATE
         SET nombre = EXCLUDED.nombre,
             role = EXCLUDED.role,
             active = true,
             password_hash = EXCLUDED.password_hash,
             set_password_token = NULL,
             set_password_expires = NULL
       RETURNING id, (xmax = 0) AS inserted`,
      [u.nombre, email, passwordHash, u.role]
    );
    const userId = rows[0].id;
    const inserted = rows[0].inserted;

    // Asociar al proyecto unico
    await client.query(
      `INSERT INTO user_projects (user_id, project_id, orden_cola, active)
       VALUES ($1, $2, 0, true)
       ON CONFLICT (user_id, project_id) DO UPDATE SET active = true`,
      [userId, projectId]
    );

    results.push({ nombre: u.nombre, email, role: u.role, inserted });
  }

  await client.query('COMMIT');

  console.log(`\n${'='.repeat(72)}`);
  console.log(`USUARIOS PROCESADOS (password unica del .env, bcrypt cost 12)`);
  console.log('='.repeat(72));
  for (const r of results) {
    const action = r.inserted ? 'CREADO' : 'REACTIVADO';
    console.log(`  [${action.padEnd(10)}] ${r.role.padEnd(10)} ${r.email}`);
  }
  console.log('='.repeat(72));
  console.log('Login: https://crm.iseie.com/login con la password del .env');
  console.log('RECOMENDADO: cada usuario cambia su password desde /profile tras primer login.');
  console.log('Y borra INITIAL_PASSWORD del /opt/crm-iseie/.env cuando termines.');
  console.log('='.repeat(72));
} catch (e) {
  await client.query('ROLLBACK');
  console.error('ERROR:', e.message);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
