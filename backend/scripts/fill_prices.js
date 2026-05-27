// Llena solo precios para productos con precio=0 — usa el HTML scraper extractMetaBox.
// Foreground, lotes paralelos chicos para no saturar iseie.com.
import 'dotenv/config';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';
import { extractMetaBox } from '/opt/crm-iseie/src/modules/woocommerce/html-scraper.js';

const PROJECT_ID = 10;
const BATCH_SIZE = parseInt(process.argv[2] || '20');
const CONCURRENCY = 4;
const TIMEOUT_MS = 12000;

async function fetchHtml(url) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 CRM-PriceFill/1.0' },
      signal: ac.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function processOne(p) {
  try {
    const html = await fetchHtml(p.url_info);
    const mb = extractMetaBox(html);
    const precio = mb?.precio?.value;
    if (precio && precio > 0) {
      await query('UPDATE products SET precio=$1, updated_at=NOW() WHERE id=$2', [precio, p.id]);
      return { id: p.id, ok: true, precio };
    }
    return { id: p.id, ok: false, reason: 'no precio en HTML' };
  } catch (e) {
    return { id: p.id, ok: false, reason: e.message.slice(0, 60) };
  }
}

(async () => {
  // Incluye productos sin precio + productos con precio sospechosamente bajo
  // (<50 € — probable mis-parse de "1,985 €" como 1.985 en versiones previas
  // del parser). El nuevo parser entiende coma como separador de miles.
  const { rows } = await query(
    `SELECT id, nombre, url_info, precio FROM products
     WHERE project_id = $1 AND active
       AND (precio IS NULL OR precio = 0 OR precio < 50)
       AND url_info IS NOT NULL
     ORDER BY (precio > 0 AND precio < 50) DESC, id LIMIT $2`,
    [PROJECT_ID, BATCH_SIZE]
  );
  console.log(`Procesando ${rows.length} productos (concurrency=${CONCURRENCY})...`);
  let done = 0, ok = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(slice.map(processOne));
    for (const r of results) {
      done++;
      if (r.ok) { ok++; console.log(`  ✓ #${r.id} → ${r.precio}€`); }
      else console.log(`  · #${r.id} (${r.reason})`);
    }
  }
  console.log(`\nDone. ${ok}/${done} con precio extraído.`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
