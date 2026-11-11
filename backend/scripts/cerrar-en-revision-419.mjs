// Cierra como «Hecha» las tareas que se quedaron «En revisión» al cambiar la
// regla del tablero (CRM-ISEIE#419): quien hace la tarea la pasa a «Hecha» él mismo,
// y las que esperaban revisión no se vuelven a revisar.
//
// SALVO LAS QUE TIENEN SUPERVISOR (Diego, 11/11/2026): esas las cierra su
// supervisor, a mano; el guion no las toca ni las cuenta.
//
//   node scripts/cerrar-en-revision-419.mjs             solo cuenta: no escribe nada
//   node scripts/cerrar-en-revision-419.mjs --aplicar   las cierra, en una sola transacción
//
// Cada una queda «Hecha» con la fecha de su último movimiento y su evento
// `status_changed` a nombre de quien la lleva. Sin correos ni avisos. Se puede
// lanzar dos veces: la segunda no encuentra nada. El detalle, en
// src/modules/tasks/tasks.cierre-en-revision.js.
//
// Se lanza al subir la versión, DESPUÉS de desplegar el código nuevo (si no, el
// tablero viejo seguiría mandando tareas a «En revisión»).
//
// Se niega a tocar una base que no sea la local salvo con PERMITIR_REMOTO=1:
// la de staging y la de producción las toca Diego. Con DATABASE_URL puesta:
//   PERMITIR_REMOTO=1 DATABASE_URL=... node scripts/cerrar-en-revision-419.mjs
import pg from 'pg';
import { cerrarLasEnRevision } from '../src/modules/tasks/tasks.cierre-en-revision.js';

const URL_BD = process.env.DATABASE_URL || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const aplicar = process.argv.includes('--aplicar');
const enLocal = /(127\.0\.0\.1|localhost)/.test(URL_BD);

if (!enLocal && !process.env.PERMITIR_REMOTO) {
  console.error('\n  Esa DATABASE_URL no es local y no la voy a tocar sin PERMITIR_REMOTO=1.\n');
  process.exit(1);
}

const cli = new pg.Client({ connectionString: URL_BD });
await cli.connect();

try {
  const r = await cerrarLasEnRevision(cli, { aplicar });
  const fecha = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');
  for (const t of r.tareas) {
    console.log(`  #${t.id}  ${fecha(t.completed_at)}  ${String(t.title).slice(0, 70)}`);
  }
  console.log(`\n  ${r.total} tarea(s) «En revisión» sin supervisor ${aplicar ? 'cerradas como «Hecha».' : 'se cerrarían. Simulación: no se ha cambiado nada (añade --aplicar).'}`);
  console.log('  Las que tienen supervisor no se tocan: las cierra él, a mano.\n');
} catch (err) {
  console.error('  Falló, no se ha cambiado nada:', err.message);
  process.exitCode = 1;
} finally {
  await cli.end();
}
