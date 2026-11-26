// Cobros de cuotas que Stripe canceló ANTES de que el CRM escuchara sus avisos (CRM#1103).
//
//   node scripts/cobros-cancelados-en-stripe.mjs            solo dice lo que haría
//   node scripts/cobros-cancelados-en-stripe.mjs --aplicar  marca las cuotas y avisa
//
// Se pasa UNA vez al desplegar la 343 (en el 360, la 332), en el servidor (lee su .env).
// A Stripe solo le pregunta (GET): cada suscripción abierta de una venta a plazos
// (#747) y cada calendario del cobro automático (309). Lo cancelado o impagado se
// trata igual que si llegara ahora su aviso: la cuota sigue pendiente, queda
// marcada «cobro automático cancelado» y se avisa a la gestora y a los admins,
// una vez (pasarlo dos veces no repite nada).
import 'dotenv/config';

const aplicar = process.argv.includes('--aplicar');
const { repasar } = await import('../src/modules/stripe-payments/cobro-cancelado.service.js');
const filas = await repasar({ aplicar });
for (const f of filas) {
  console.log(`venta ${f.conversionId} · campus ${f.projectId} · ${f.origen} · Stripe: ${f.estadoStripe ?? '—'} · ${f.resultado}`);
}
const tocadas = filas.filter((f) => /marcar|marcada/.test(String(f.resultado)));
console.log(`\n${filas.length} revisadas · ${tocadas.length} ${aplicar ? 'marcadas' : 'se marcarían'}${aplicar ? '' : ' (sin --aplicar no se toca nada)'}`);
const { default: pool } = await import('../src/shared/config/db.js');
await pool.end();
