// Importa solicitudes de beca CETLAT desde CSV → tabla leads.
// Mapea asesora, producto (via findProductByName con unaccent), status (Si/No → convertido/no_interesado),
// y guarda metadatos en custom_fields para auditoria.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';
import { findProductByName } from '/opt/crm-iseie/src/modules/leads/lead.model.js';

const PROJECT_ID = 10;
const CSV_PATH = process.argv[2] || '/tmp/cetlat.csv';
const DRY_RUN = process.argv.includes('--dry-run');

function parseCsv(text) {
  // Parser CSV simple con soporte de comillas y comas internas
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') {} // skip
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function mapStatus(venta, resuelto) {
  const v = (venta || '').trim().toLowerCase();
  if (v === 'si' || v === 'sí') return 'convertido';
  if (v === 'no') return 'no_interesado';
  if ((resuelto || '').trim()) return 'en_seguimiento';
  return 'nuevo';
}

function cleanAsesoraName(raw) {
  // "Daniela 40% Resuelta" → "Daniela"
  // "-" → null
  const s = (raw || '').trim();
  if (!s || s === '-' || s === '—') return null;
  return s.split(/\s+/)[0]; // primer token
}

async function findUserByFirstName(firstName) {
  if (!firstName) return null;
  const { rows } = await query(
    `SELECT id, nombre FROM users WHERE nombre ILIKE $1 LIMIT 1`,
    [`${firstName}%`]
  );
  return rows[0] || null;
}

(async () => {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  const header = rows[0];
  console.log('Headers:', header);
  console.log(`Total filas: ${rows.length - 1}`);

  let created = 0, skippedDup = 0, errors = 0;
  let prodMatch = 0, userMatch = 0;
  const productCache = new Map();
  const userCache = new Map();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 6) continue;
    const [cetlatId, nombre, email, telefono, programa, fecha, asesoraRaw, resuelto, planPago, venta, observacion] = r;

    if (!nombre || nombre.trim().length < 1) continue;

    // Idempotency: clave estable por CETLAT id
    const idempKey = cetlatId ? `cetlat:${cetlatId}` : `cetlat:${email || telefono}:${nombre}`;

    // Producto via findProductByName (maneja unaccent y prefijos)
    let productId = null;
    if (programa && programa.trim()) {
      const key = programa.trim().toLowerCase();
      if (productCache.has(key)) {
        productId = productCache.get(key);
      } else {
        const p = await findProductByName(programa.trim(), PROJECT_ID);
        productId = p?.id || null;
        productCache.set(key, productId);
      }
      if (productId) prodMatch++;
    }

    // Asesora → user
    let responsableId = null;
    const firstName = cleanAsesoraName(asesoraRaw);
    if (firstName) {
      if (userCache.has(firstName)) responsableId = userCache.get(firstName);
      else {
        const u = await findUserByFirstName(firstName);
        responsableId = u?.id || null;
        userCache.set(firstName, responsableId);
      }
      if (responsableId) userMatch++;
    }

    const status = mapStatus(venta, resuelto);
    const fechaSolicitud = fecha && fecha.trim() ? new Date(fecha.trim()) : new Date();

    const customFields = {
      origen: 'beca_cetlat',
      cetlat_id: cetlatId || null,
      programa_solicitado: programa || null,
      porcentaje_resuelto: resuelto || null,
      plan_pago_enviado: planPago || null,
      venta_marcada: venta || null,
      observacion: observacion || null,
      asesora_csv: asesoraRaw || null,
    };

    if (DRY_RUN) {
      if (i <= 5) console.log(`  [${i}] ${nombre} | prog=${productId} | resp=${responsableId} | status=${status}`);
      continue;
    }

    try {
      const { rows: ins } = await query(
        `INSERT INTO leads (project_id, nombre, email, telefono, producto_interes_id, status, responsable_id,
                            fecha_solicitud, custom_fields, idempotency_key, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, NOW(), NOW())
         ON CONFLICT (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [PROJECT_ID, nombre.trim(), (email || '').trim() || null, (telefono || '').trim() || null,
         productId, status, responsableId, fechaSolicitud,
         JSON.stringify(customFields), idempKey]
      );
      if (ins[0]) created++;
      else skippedDup++;
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`  err row ${i}: ${e.message}`);
    }

    if (created % 50 === 0 && created > 0) console.log(`  ${created} creados...`);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Creados:           ${created}`);
  console.log(`Saltados dup:      ${skippedDup}`);
  console.log(`Errores:           ${errors}`);
  console.log(`Programa matcheado: ${prodMatch}`);
  console.log(`Asesora matcheada:  ${userMatch}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
