// Re-vincula productos a leads que tienen "programas_interes" en custom_fields
// pero producto_interes_id = NULL. Match mas agresivo: substring sin acentos.
import 'dotenv/config';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';

const PROJECT_ID = 10;
const DRY_RUN = process.argv.includes('--dry-run');

// Limpia palabras "ruido" del nombre para buscar
function cleanForMatch(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // sin acentos
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(curso|cursos|master|máster|maestria|maestría|diplomado|diplomados|seminario|formación|formacion|programa|en|de|del|la|el|los|las|para|sobre|y)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function matchProduct(rawName, productsList) {
  if (!rawName) return null;
  const clean = cleanForMatch(rawName);
  if (clean.length < 4) return null;
  // 1. Match exacto post-limpieza
  for (const p of productsList) {
    if (p.clean === clean) return p.id;
  }
  // 2. Substring: el nombre limpio del lead esta dentro del nombre limpio del producto
  for (const p of productsList) {
    if (p.clean.includes(clean) || clean.includes(p.clean)) return p.id;
  }
  // 3. Cuenta tokens en comun (>=70% de tokens del lead match)
  const leadTokens = clean.split(/\s+/).filter((t) => t.length > 2);
  if (leadTokens.length === 0) return null;
  let bestScore = 0, bestId = null;
  for (const p of productsList) {
    const prodTokens = new Set(p.clean.split(/\s+/));
    const matched = leadTokens.filter((t) => prodTokens.has(t)).length;
    const score = matched / leadTokens.length;
    if (score > bestScore && score >= 0.7) { bestScore = score; bestId = p.id; }
  }
  return bestId;
}

(async () => {
  console.log('Cargando productos...');
  const { rows: prods } = await query(
    `SELECT id, nombre FROM products WHERE project_id = $1 AND active`,
    [PROJECT_ID]
  );
  const productsList = prods.map((p) => ({ id: p.id, clean: cleanForMatch(p.nombre) }));
  console.log(`  ${productsList.length} productos cargados.`);

  console.log('Cargando leads sin producto...');
  const { rows: leads } = await query(
    `SELECT id, nombre, custom_fields->'programas_interes' AS programas
     FROM leads WHERE project_id = $1 AND deleted_at IS NULL AND producto_interes_id IS NULL
       AND custom_fields ? 'programas_interes'`,
    [PROJECT_ID]
  );
  console.log(`  ${leads.length} leads sin producto.`);

  let matched = 0, none = 0;
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const progs = Array.isArray(l.programas) ? l.programas : [];
    let id = null;
    for (const p of progs) {
      id = await matchProduct(p, productsList);
      if (id) break;
    }
    if (id) {
      matched++;
      if (!DRY_RUN) {
        await query(`UPDATE leads SET producto_interes_id = $1, updated_at = NOW() WHERE id = $2`, [id, l.id]);
      }
      if (matched <= 5) console.log(`  ✓ lead ${l.id} "${l.nombre.slice(0,40)}" → producto ${id} (programas: ${progs.slice(0,2).join(', ')})`);
    } else {
      none++;
    }
    if (i % 1000 === 0 && i > 0) console.log(`  procesados ${i}/${leads.length} (${matched} matched)`);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Leads sin producto: ${leads.length}`);
  console.log(`Matched ahora:      ${matched}`);
  console.log(`Sin match:          ${none}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
