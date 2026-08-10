// Deja la base de datos lista: aplica las migraciones que falten y, si se pide,
// las semillas de ejemplo.
//
//   npm run db:preparar            migraciones
//   npm run db:preparar -- --datos migraciones + datos de ejemplo
//
// Se escribio para que nadie tenga que tocar la base del servidor. Hasta ahora
// las migraciones se aplicaban a mano con psql, una a una, y los tests corrian
// por un tunel SSH contra staging de produccion.
//
// Tres decisiones que importan:
//
//   · Cada fichero se ejecuta ENTERO en una sola llamada, sin envolverlo en una
//     transaccion nuestra: 38 de las 124 migraciones abren la suya, y anidarlas
//     falla. Si una migracion no se protege a si misma, es cosa suya.
//   · Lo aplicado se anota en `_migraciones`. Volver a lanzarlo no repite nada,
//     que es lo que permite usarlo tanto en una base vacia como en una a medias.
//   · Las lineas `OWNER TO` se saltan en local. Nombran a los dueños de los dos
//     servidores (`crm_user`, `crm_iseie_user`) y en tu maquina ese rol no
//     existe: sin esto, 13 migraciones fallarian por algo que da igual en local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = path.join(AQUI, '..', 'migrations');
const SEMILLAS = path.join(AQUI, '..', 'seeds');

const URL_BD = process.env.DATABASE_URL
  || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const conDatos = process.argv.includes('--datos');
const enLocal = /(127\.0\.0\.1|localhost)/.test(URL_BD);

// Cinturon: esto no debe apuntar nunca a un servidor de verdad.
if (!enLocal && !process.env.PERMITIR_REMOTO) {
  console.error('\n  Esa DATABASE_URL no es local y no la voy a tocar.');
  console.error('  Las bases de staging y produccion las prepara Diego a mano.\n');
  process.exit(1);
}

const cli = new pg.Client({ connectionString: URL_BD });

function sinOwnerTo(sql) {
  if (!enLocal) return sql;
  return sql.replace(/^\s*ALTER\s+(TABLE|SEQUENCE|TYPE|VIEW)\s+[^\n;]*OWNER\s+TO[^\n;]*;\s*$/gim, '');
}

async function aplicar() {
  await cli.connect();
  await cli.query(`
    CREATE TABLE IF NOT EXISTS _migraciones (
      fichero     TEXT PRIMARY KEY,
      aplicada_el TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);

  const { rows } = await cli.query('SELECT fichero FROM _migraciones');
  const ya = new Set(rows.map((r) => r.fichero));

  const ficheros = fs.readdirSync(MIGRACIONES)
    .filter((f) => f.endsWith('.sql'))
    .sort();                       // 001_, 002_… el nombre ya ordena

  const pendientes = ficheros.filter((f) => !ya.has(f));
  if (!pendientes.length) {
    console.log(`  ${ficheros.length} migraciones, todas aplicadas. Nada que hacer.`);
  } else {
    console.log(`  ${pendientes.length} migraciones pendientes de ${ficheros.length}\n`);
    for (const f of pendientes) {
      const sql = sinOwnerTo(fs.readFileSync(path.join(MIGRACIONES, f), 'utf8'));
      try {
        await cli.query(sql);
        await cli.query('INSERT INTO _migraciones (fichero) VALUES ($1)', [f]);
        console.log(`    ${f}`);
      } catch (e) {
        console.error(`\n  FALLA en ${f}:\n    ${e.message}\n`);
        console.error('  No se anota como aplicada. Corrige y vuelve a lanzarlo.\n');
        await cli.end();
        process.exit(1);
      }
    }
  }

  if (conDatos) {
    console.log('\n  datos de ejemplo:');
    for (const f of ['001_seed_initial.sql', '002_seed_test_data.sql']) {
      const ruta = path.join(SEMILLAS, f);
      if (!fs.existsSync(ruta)) { console.log(`    ${f} — no existe, lo salto`); continue; }
      try {
        await cli.query(sinOwnerTo(fs.readFileSync(ruta, 'utf8')));
        console.log(`    ${f}`);
      } catch (e) {
        // Las semillas se pueden haber puesto ya. No es motivo para abortar.
        console.log(`    ${f} — ${e.message.slice(0, 80)}`);
      }
    }
  }

  const { rows: [t] } = await cli.query(
    "SELECT count(*) n FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log(`\n  Listo: ${t.n} tablas en la base.`);
  await cli.end();
}

aplicar().catch((e) => { console.error('  ', e.message); process.exit(1); });
