// Aplica la regla de origen → canal a los prospectos que ya están (#48).
//
//   node scripts/recalcular-canal.mjs             solo cuenta: no escribe nada
//   node scripts/recalcular-canal.mjs --aplicar   escribe, en una sola transacción
//
// La regla es la de siempre (src/modules/leads/canal.js): la misma que usa el
// alta de un prospecto. Este script NO la copia, la importa.
//
// Qué hace, y qué no (el detalle, en `planearRecalculo`):
//   · Solo toca el canal de las filas sin canal o en «directo». Uno puesto a mano
//     o por Make no se cambia nunca.
//   · Rellena las UTM que faltan con las que traiga la dirección guardada.
//   · A los prospectos que tienen `leads.landing_url` pero ninguna fila en
//     `lead_utms`, se la crea.
//   · Sin ninguna pista, no inventa nada.
//
// Deshacer: antes de escribir, guarda el canal anterior de cada fila tocada en
// `lead_utms_canal_anterior`. Para volver atrás:
//   UPDATE lead_utms u SET canal_detectado = a.canal_anterior::utm_channel
//     FROM lead_utms_canal_anterior a WHERE a.lead_id = u.lead_id;
// (las UTM rellenadas desde la dirección se pueden dejar: eran dato que ya estaba.)
//
// Se niega a tocar una base que no sea la local salvo con PERMITIR_REMOTO=1:
// la de staging y la de producción las toca Diego. Con DATABASE_URL puesta:
//   PERMITIR_REMOTO=1 DATABASE_URL=... node scripts/recalcular-canal.mjs
import pg from 'pg';
import { planearRecalculo, utmsDeLaDireccion, deducirCanal, tienePistaDeOrigen } from '../src/modules/leads/canal.js';

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
  // 1 · Filas de lead_utms, para quedarse con las de canal débil (sin canal o «directo»).
  const { rows: existentes } = await cli.query(
    `SELECT u.lead_id, u.canal_detectado::text AS canal_detectado, u.utm_source, u.utm_medium, u.utm_campaign,
            u.utm_content, u.utm_term, u.referrer, COALESCE(NULLIF(u.landing_url, ''), l.landing_url) AS landing_url
       FROM lead_utms u JOIN leads l ON l.id = u.lead_id
      WHERE l.deleted_at IS NULL`
  );
  const plan = planearRecalculo(existentes);

  // 2 · Prospectos con dirección guardada y ninguna fila de UTM.
  const { rows: sinFila } = await cli.query(
    `SELECT l.id AS lead_id, l.landing_url
       FROM leads l
      WHERE l.deleted_at IS NULL AND COALESCE(l.landing_url, '') <> ''
        AND NOT EXISTS (SELECT 1 FROM lead_utms u WHERE u.lead_id = l.id)`
  );
  const nuevas = sinFila
    .map((f) => {
      const utms = utmsDeLaDireccion(f.landing_url);
      const pista = tienePistaDeOrigen({ ...utms, landing_url: f.landing_url });
      return { ...f, utms, pista, canal: deducirCanal({ ...utms, landing_url: f.landing_url }) };
    })
    .filter((f) => f.pista);

  const transiciones = new Map();
  const cuenta = (de, a) => {
    const clave = `${de ?? '(vacío)'} → ${a}`;
    transiciones.set(clave, (transiciones.get(clave) || 0) + 1);
  };
  for (const c of plan.cambios) cuenta(c.canal_antes, c.canal_nuevo);
  for (const f of nuevas) cuenta(null, f.canal);

  console.log(`\n  Base: ${enLocal ? 'local' : 'REMOTA'} · ${aplicar ? 'APLICANDO' : 'solo contando (añade --aplicar para escribir)'}\n`);
  console.log(`  Filas de origen revisadas ............ ${existentes.length}`);
  console.log(`  Con un canal que se respeta .......... ${plan.respetadas}`);
  console.log(`  Débiles pero sin ninguna pista ....... ${plan.sinPista}`);
  console.log(`  Cambian de canal o de UTM ............ ${plan.cambios.length}`);
  console.log(`  Prospectos sin fila y con dirección .. ${sinFila.length} (con pista: ${nuevas.length})\n`);
  for (const [t, n] of [...transiciones.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${t}`);
  console.log('');

  if (!aplicar) {
    console.log('  No se ha escrito nada.\n');
  } else {
    await cli.query('BEGIN');
    await cli.query(
      `CREATE TABLE IF NOT EXISTS lead_utms_canal_anterior (
         lead_id INTEGER NOT NULL, canal_anterior TEXT, recalculado_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
    );
    for (const c of plan.cambios) {
      await cli.query(`INSERT INTO lead_utms_canal_anterior (lead_id, canal_anterior) VALUES ($1, $2)`, [c.lead_id, c.canal_antes]);
      const u = c.utms_nuevas;
      await cli.query(
        `UPDATE lead_utms SET canal_detectado = $2::utm_channel,
                utm_source = COALESCE(NULLIF(utm_source, ''), $3), utm_medium = COALESCE(NULLIF(utm_medium, ''), $4),
                utm_campaign = COALESCE(NULLIF(utm_campaign, ''), $5), utm_content = COALESCE(NULLIF(utm_content, ''), $6),
                utm_term = COALESCE(NULLIF(utm_term, ''), $7)
          WHERE lead_id = $1`,
        [c.lead_id, c.canal_nuevo, u.utm_source ?? null, u.utm_medium ?? null, u.utm_campaign ?? null, u.utm_content ?? null, u.utm_term ?? null]
      );
    }
    for (const f of nuevas) {
      await cli.query(
        `INSERT INTO lead_utms (lead_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_url, canal_detectado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::utm_channel) ON CONFLICT (lead_id) DO NOTHING`,
        [f.lead_id, f.utms.utm_source, f.utms.utm_medium, f.utms.utm_campaign, f.utms.utm_content, f.utms.utm_term, f.landing_url, f.canal]
      );
    }
    await cli.query('COMMIT');
    console.log(`  Hecho: ${plan.cambios.length} filas actualizadas y ${nuevas.length} creadas.\n`);
  }
} catch (err) {
  await cli.query('ROLLBACK').catch(() => {});
  console.error('\n  Falló y no se ha escrito nada:', err.message, '\n');
  process.exitCode = 1;
} finally {
  await cli.end();
}
