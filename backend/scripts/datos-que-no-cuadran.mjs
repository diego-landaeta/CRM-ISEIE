// Los datos que no cuadran (#42), contados y enseñados uno a uno.
//
//   node scripts/datos-que-no-cuadran.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// SOLO MIRA. No arregla nada, y es a propósito: cada una de estas cuatro cosas
// se decide caso por caso. Un alumno con tres ventas puede haber comprado tres
// cursos o puede ser una cuota metida como venta nueva, y eso no lo puede
// decidir un script —lo segundo infla las ventas y parte el plan de pago, lo
// primero es un buen cliente—.
//
// Se escribió porque estos cuatro llevan meses ahí: ninguno rompe una pantalla,
// así que nadie se topa con ellos. Contarlos de vez en cuando es la única
// forma de que no crezcan.
//
// Contra la base que diga DATABASE_URL. Es de solo lectura, así que correrlo
// contra producción no rompe nada, pero hay que pedirlo:
//
//   DATABASE_URL=... PERMITIR_REMOTO=1 node scripts/datos-que-no-cuadran.mjs
import pg from 'pg';

const URL_BD = process.env.DATABASE_URL
  || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const enLocal = /(127\.0\.0\.1|localhost)/.test(URL_BD);

if (!enLocal && !process.env.PERMITIR_REMOTO) {
  console.error('\n  Esa DATABASE_URL no es local. Si es a propósito: PERMITIR_REMOTO=1\n');
  process.exit(1);
}

const cli = new pg.Client({ connectionString: URL_BD });

/**
 * Cada revisión: qué busca, por qué importa, y qué hacer con lo que salga.
 * El «duele» no es adorno: sin él, una lista de ids no le dice nada a quien la
 * lee dentro de tres meses.
 */
const REVISIONES = [
  {
    titulo: 'Alumnos con más de una venta',
    duele: 'Puede ser que compraran dos cursos, o que la segunda cuota se metiera '
         + 'como venta nueva. Lo segundo infla las ventas y parte el plan de pago.',
    haz: 'Mirar uno a uno. Si es una cuota, marcarla como tal en la venta original.',
    sql: `SELECT l.id AS lead_id, l.nombre AS alumno, l.email,
                 count(*) AS ventas,
                 to_char(sum(c.importe_total), 'FM999G999D00') AS total,
                 string_agg(c.id::text, ', ' ORDER BY c.fecha_conversion) AS conversiones
            FROM conversions c
            JOIN leads l ON l.id = c.lead_id
           WHERE l.deleted_at IS NULL
           GROUP BY l.id, l.nombre, l.email
          HAVING count(*) > 1
           ORDER BY count(*) DESC, sum(c.importe_total) DESC`,
  },
  {
    titulo: 'Proformas que gastaron número de factura',
    duele: 'La numeración de facturas queda con huecos, que es exactamente lo que '
         + 'mira una inspección.',
    haz: 'No se renumera hacia atrás. Se documenta el hueco y se corrige el flujo '
       + 'para que una proforma no consuma número.',
    sql: `SELECT id, numero, ano, tipo, cliente_nombre,
                 to_char(created_at, 'YYYY-MM-DD') AS creada
            FROM invoices
           WHERE tipo = 'proforma' AND numero IS NOT NULL
           ORDER BY ano, numero`,
  },
  {
    titulo: 'Teléfonos que no pueden ser de nadie',
    duele: 'El enlace de WhatsApp abre un chat que no lleva a ninguna parte. No '
         + 'salta ningún error: la gestora apunta «no contesta».',
    haz: 'Buscar el número bueno en el formulario original, o pedirlo otra vez. '
       + 'La ficha ya avisa de estos desde el #42.',
    // El mismo criterio que `shared/lib/telefono.ts`: menos de 8 dígitos o más
    // de 15 no es un número de nadie. No se comprueba que EXISTA —eso no se
    // puede saber sin preguntarle a WhatsApp—, solo lo imposible.
    sql: `SELECT id, nombre, telefono, project_id,
                 length(regexp_replace(telefono, '[^0-9]', '', 'g')) AS digitos
            FROM leads
           WHERE deleted_at IS NULL
             AND telefono IS NOT NULL AND btrim(telefono) <> ''
             AND telefono !~* 'no\s*suministrad'
             AND (length(regexp_replace(telefono, '[^0-9]', '', 'g')) < 8
               OR length(regexp_replace(telefono, '[^0-9]', '', 'g')) > 15)
           ORDER BY digitos, id`,
  },
  {
    titulo: 'Cobros repetidos en el libro',
    duele: 'Misma venta, mismo importe y misma fecha, apuntados dos veces. Toda '
         + 'pantalla que SUMA el libro queda inflada; Reportes no, porque usa el '
         + 'campo de la venta — y por eso las dos discrepan.',
    haz: 'La migración 180 borra los que no tienen nada colgando y guarda copia. '
       + 'Los que tienen factura, comisión o cobro de Stripe se miran a mano: '
       + 'borrar uno con comisión se lleva la del profesor por delante.',
    sql: `SELECT p.conversion_id AS venta, l.nombre AS cliente,
                 p.importe, p.fecha, count(*) AS veces,
                 bool_or(EXISTS (SELECT 1 FROM invoices i WHERE i.payment_id = p.id)) AS con_factura,
                 bool_or(EXISTS (SELECT 1 FROM tutor_commissions t WHERE t.payment_id = p.id)) AS con_comision
            FROM conversion_payments p
            JOIN conversions c ON c.id = p.conversion_id
            JOIN leads l ON l.id = c.lead_id
           GROUP BY p.conversion_id, l.nombre, p.importe, p.fecha
          HAVING count(*) > 1
           ORDER BY count(*) DESC, p.conversion_id`,
  },
  {
    titulo: 'Ventas sin formación identificada',
    duele: 'Sin formación no se sabe de quién es la comisión y ningún profesor '
         + 'cobra por ellas.',
    haz: 'La pantalla «Ventas sin formación» las cruza una a una. Las migraciones '
       + '173 y 174 reparan las que se pueden deducir solas.',
    sql: `SELECT count(*) AS sin_formacion,
                 to_char(sum(importe_total), 'FM999G999D00') AS importe
            FROM conversions
           WHERE producto_contratado_id IS NULL`,
  },
];

function pinta(filas) {
  if (!filas.length) { console.log('    nada — esto está limpio\n'); return; }
  const cols = Object.keys(filas[0]);
  const ancho = {};
  for (const c of cols) {
    ancho[c] = Math.max(c.length, ...filas.map((f) => String(f[c] ?? '').length));
  }
  console.log('    ' + cols.map((c) => c.padEnd(ancho[c])).join('  '));
  console.log('    ' + cols.map((c) => '-'.repeat(ancho[c])).join('  '));
  for (const f of filas) {
    console.log('    ' + cols.map((c) => String(f[c] ?? '').padEnd(ancho[c])).join('  '));
  }
  console.log('');
}

await cli.connect();
console.log(`\n  Datos que no cuadran — ${enLocal ? 'base local' : 'BASE REMOTA'}\n`);

for (const r of REVISIONES) {
  console.log(`  ── ${r.titulo} ${'─'.repeat(Math.max(0, 60 - r.titulo.length))}`);
  console.log(`    ${r.duele}`);
  console.log(`    Qué hacer: ${r.haz}\n`);
  try {
    const { rows } = await cli.query(r.sql);
    pinta(rows);
  } catch (err) {
    // Una tabla que no existe en esta instalación no puede tumbar el resto.
    console.log(`    no se pudo mirar: ${err.message}\n`);
  }
}

await cli.end();
