// Pone el país de entrada a los prospectos que ya estaban (#221).
//
//   node scripts/rellenar-pais-origen.mjs                solo cuenta: no escribe nada
//   node scripts/rellenar-pais-origen.mjs --aplicar      escribe, en una sola transacción
//   node scripts/rellenar-pais-origen.mjs --campus=12    solo un campus
//
// La regla es la del alta (src/modules/leads/pais.js) y la lógica está en
// src/modules/leads/pais.relleno.js: este script NO las copia, las importa.
//
// Qué hace, y qué no:
//   · Solo rellena `leads.pais_origen` de los que no lo tienen, en los campus con
//     tabla de países (Configuración → «Países por subdominio»).
//   · La dirección sale de la ficha, de su fila de origen o, si no hay, del envío
//     de Make que lo creó (la página que mandó aunque el mapeo no la recogiera).
//   · Un prospecto con país no se toca: se puede pasar las veces que haga falta,
//     también después de añadir un país nuevo a la tabla de un campus.
//   · Sin dirección, sin tabla o con un prefijo que la tabla no tiene, no inventa.
//
// Deshacer: cada fila escrita queda en `leads_pais_origen_rellenado`. Para volver atrás:
//   UPDATE leads l SET pais_origen = NULL
//     FROM leads_pais_origen_rellenado r WHERE r.lead_id = l.id AND l.pais_origen = r.pais;
//
// Se niega a tocar una base que no sea la local salvo con PERMITIR_REMOTO=1:
// la de staging y la de producción las toca Diego. Con DATABASE_URL puesta:
//   PERMITIR_REMOTO=1 DATABASE_URL=... node scripts/rellenar-pais-origen.mjs
import pg from 'pg';
import { rellenarPaisOrigen } from '../src/modules/leads/pais.relleno.js';

const URL_BD = process.env.DATABASE_URL || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const aplicar = process.argv.includes('--aplicar');
const campusArg = process.argv.find((a) => a.startsWith('--campus='));
const campus = campusArg ? Number(campusArg.split('=')[1]) || null : null;
const enLocal = /(127\.0\.0\.1|localhost)/.test(URL_BD);

if (!enLocal && !process.env.PERMITIR_REMOTO) {
  console.error('\n  Esa DATABASE_URL no es local y no la voy a tocar sin PERMITIR_REMOTO=1.\n');
  process.exit(1);
}

const nombre = (codigo) => {
  try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(codigo) || codigo; } catch { return codigo; }
};

// Un cliente y no el pool: la transacción tiene que ir por una sola conexión.
const cli = new pg.Client({ connectionString: URL_BD });
await cli.connect();

try {
  const r = await rellenarPaisOrigen(cli, { aplicar, campus });
  console.log(`\n  Base: ${enLocal ? 'local' : 'REMOTA'} · ${aplicar ? 'APLICANDO' : 'solo contando (añade --aplicar para escribir)'}\n`);
  console.log(`  Campus con tabla de países ........... ${r.campus.length}${r.campus.length ? ` (${r.campus.map((c) => c.nombre).join(', ')})` : ''}`);
  console.log(`  Prospectos sin país revisados ........ ${r.revisados}`);
  console.log(`  Se les pone país ..................... ${r.cambios.length}`);
  console.log(`  Sin ninguna dirección ................ ${r.sinUrl}`);
  console.log(`  Dominio raíz o prefijo sin configurar  ${r.sinPais}\n`);
  for (const [codigo, n] of Object.entries(r.porPais).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(6)}  ${nombre(codigo)} (${codigo})`);
  }
  if (Object.keys(r.porFuente).length) {
    console.log(`\n  De dónde salió la dirección: ${Object.entries(r.porFuente).map(([f, n]) => `${f} ${n}`).join(' · ')}`);
  }
  console.log('');
  console.log(r.aplicado ? `  Hecho: ${r.cambios.length} prospectos con país.\n` : '  No se ha escrito nada.\n');
} catch (err) {
  console.error('\n  Falló y no se ha escrito nada:', err.message, '\n');
  process.exitCode = 1;
} finally {
  await cli.end();
}
