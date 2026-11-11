// Trae al tablero TODAS las issues del repositorio de este CRM (CRM-ISEIE#435), una vez.
// Desde ahí las mantiene el webhook de GitHub.
//
//   node scripts/github-tablero-importar.mjs                     simula: cuenta y no escribe nada
//   node scripts/github-tablero-importar.mjs --aplicar           escribe, en una sola transacción
//   ... --copias ruta/sinc_CRM.json [--copia-repo dueño/copia]   además, el enlace a la issue de la
//                                                                copia de la empresa (mapa original→copia)
//
// Las abiertas entran «Por hacer» (o «En revisión» si tienen una PR a staging
// abierta o fusionada); las cerradas, «Hecha» con `completed_at` = `closed_at`,
// para que salgan en el Historial de tareas. Las de cabecera «> Misma tarea que
// …» no crean tarea. Responsable: el asignado de GitHub con usuario en el CRM
// (Configurar tablero › GitHub); si no, el supervisor, «Por definir quién lo hará».
//
// Idempotente: se puede lanzar las veces que haga falta. La segunda no crea
// nada; solo pone al día lo que cambió en GitHub. Sin correos ni avisos. El
// detalle, en src/modules/tasks/tasks.github.sync.js.
//
// Lee el repositorio, el equipo y el supervisor de la configuración (migración
// 278 y el panel), y el token de solo lectura de las credenciales (cifrado; sin
// token, va sin autenticar: el repositorio es público, con el límite de GitHub).
// Escribir pide GITHUB_TABLERO_ACTIVO=true. Se niega a tocar una base que no sea
// la local salvo con PERMITIR_REMOTO=1.
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { decrypt } from '../src/shared/utils/crypto.js';
import { importar, leerConfig } from '../src/modules/tasks/tasks.github.sync.js';
import { githubTableroActivo } from '../src/modules/tasks/tasks.github.js';

const URL_BD = process.env.DATABASE_URL || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const valor = (op) => { const i = args.indexOf(op); return i >= 0 ? args[i + 1] : null; };
const enLocal = /(127\.0\.0\.1|localhost)/.test(URL_BD);

if (!enLocal && !process.env.PERMITIR_REMOTO) {
  console.error('\n  Esa DATABASE_URL no es local y no la voy a tocar sin PERMITIR_REMOTO=1.\n');
  process.exit(1);
}
if (aplicar && !githubTableroActivo()) {
  console.error('\n  GITHUB_TABLERO_ACTIVO está apagado: no escribo. Sin --aplicar, simula.\n');
  process.exit(1);
}

/** El mapa original→copia del sincronizador (`copias/sinc_<repo>.json`), si se pasa. */
function leerCopias() {
  const ruta = valor('--copias');
  if (!ruta) return null;
  const st = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  return new Map(Object.entries(st.mapa || {}).map(([o, c]) => [Number(o), Number(c)]));
}

async function leerToken(cli) {
  const { rows } = await cli.query(
    `SELECT encrypted_value, iv, auth_tag FROM api_credentials
      WHERE service = 'github' AND project_id IS NULL AND active
      ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`);
  if (!rows[0]) return null;
  try { return JSON.parse(decrypt(rows[0].encrypted_value, rows[0].iv, rows[0].auth_tag)).token || null; } catch { return null; }
}

async function todas(ruta, token) {
  const salida = [];
  for (let pagina = 1; ; pagina += 1) {
    const r = await fetch(`https://api.github.com${ruta}${ruta.includes('?') ? '&' : '?'}per_page=100&page=${pagina}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'crm-tablero',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!r.ok) throw new Error(`GitHub ${r.status} en ${ruta}: ${(await r.text()).slice(0, 200)}`);
    const lote = await r.json();
    salida.push(...lote);
    if (lote.length < 100) return salida;
  }
}

const cli = new pg.Client({ connectionString: URL_BD });
await cli.connect();
try {
  const cfg = await leerConfig(cli);
  if (!cfg?.repo) throw new Error('No hay repositorio en la configuración (¿falta la migración 278?)');
  const token = await leerToken(cli);
  if (!token) console.log('  (sin token guardado: leo GitHub sin autenticar)');
  const issues = (await todas(`/repos/${cfg.repo}/issues?state=all`, token)).filter((i) => !i.pull_request);
  const prs = await todas(`/repos/${cfg.repo}/pulls?state=all`, token);
  const r = await importar(cli, { issues, prs, copias: leerCopias(), copiaRepo: valor('--copia-repo'), aplicar });
  console.log(`\n  ${r.repo}: ${r.issues} issues leídas (${prs.length} PR).`);
  console.log(`    nuevas: ${r.creadas}  (por hacer ${r.abiertas} · en revisión ${r.en_revision} · hechas ${r.cerradas})`);
  console.log(`    ya estaban: ${r.actualizadas} puestas al día, ${r.sin_cambios} sin cambios`);
  console.log(`    sin tarea (copia de otra): ${r.omitidas_copia}`);
  console.log(`    «Por definir quién lo hará»: ${r.por_definir} · con enlace a la copia: ${r.con_copia}`);
  console.log(aplicar ? '\n  Escrito.\n' : '\n  Simulación: no se ha cambiado nada (añade --aplicar).\n');
} catch (err) {
  console.error('  Falló, no se ha cambiado nada:', err.message);
  process.exitCode = 1;
} finally {
  await cli.end();
}
