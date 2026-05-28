// Fix masivo: re-parsear fecha_solicitud de leads importados de Contactos ISEIE 2026.
// Formatos en CSV (col 12):
//   - 2025-12-30T20:35:13.528Z  (ISO valido)
//   - 02-01-2026                 (DD-MM-YYYY)
//   - 2/01/2026 o 14/01/2026     (D/MM/YYYY)
//   - 2025-12-29                 (YYYY-MM-DD)
//   - "13/02/2026 - 18/05/2026"  (rango — tomar primera)
//   - "2026-01-21T20:06:45.859Z //06/03/2026"  (multiple — tomar primera)
import 'dotenv/config';
import fs from 'fs';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';

const PROJECT_ID = 10;
const CSV_PATH = '/tmp/contactos.csv';
const DRY_RUN = process.argv.includes('--dry-run');

function parseCsv(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) { if (c === '"' && n === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c === '\r') {} else cell += c; }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normPhone(s) {
  const d = String(s || '').replace(/[^\d]/g, '');
  return d.length >= 7 ? d.replace(/^0+/, '') : null;
}

function normEmail(s) {
  const t = (s || '').trim().toLowerCase();
  if (!t || /no\s*suministrad/i.test(t) || !t.includes('@')) return null;
  return t;
}

/** Parsea fecha en varios formatos en espanol/europeo. Devuelve Date o null. */
function parseDate(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // Si contiene multiples fechas (rango o anotaciones), tomar la primera
  const firstChunk = s.split(/[-/]\s|\s\/\/|\s-\s/)[0].trim();
  s = firstChunk;

  // ISO completo o YYYY-MM-DD: validar
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  // DD/MM/YYYY o D/MM/YYYY o DD/M/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d)) return d;
  }
  // DD-MM-YYYY
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d)) return d;
  }
  return null;
}

(async () => {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  console.log(`Filas CSV: ${rows.length - 1}`);

  // Index por email y telefono -> mejor fecha (priorizar la mas antigua = primera de las del CSV)
  const byEmail = new Map();
  const byPhone = new Map();
  let parsedOk = 0, parsedFail = 0;
  for (const r of rows.slice(1)) {
    if (r.length < 13) continue;
    const email = normEmail(r[1]);
    const phone = normPhone(r[2]) || normPhone(r[13]);
    const fechaRaw = (r[12] || '').trim();
    const fechaParsed = parseDate(fechaRaw);
    if (fechaRaw && !fechaParsed) parsedFail++;
    else if (fechaParsed) parsedOk++;
    if (!fechaParsed) continue;
    // Validacion: descartar fechas en futuro lejano (>1 mes en adelante = parseo erroneo)
    const limite = new Date(); limite.setMonth(limite.getMonth() + 1);
    if (fechaParsed > limite) continue;
    // Validacion: descartar fechas absurdas (antes de 2020)
    if (fechaParsed < new Date('2020-01-01')) continue;
    // Conservar la fecha MAS ANTIGUA por persona (cuando se creo originalmente)
    if (email) {
      const prev = byEmail.get(email);
      if (!prev || fechaParsed < prev) byEmail.set(email, fechaParsed);
    }
    if (phone) {
      const prev = byPhone.get(phone);
      if (!prev || fechaParsed < prev) byPhone.set(phone, fechaParsed);
    }
  }
  console.log(`Fechas parseadas OK: ${parsedOk}, fallaron: ${parsedFail}`);
  console.log(`Personas con email indexadas: ${byEmail.size}, con telefono: ${byPhone.size}`);

  // Leer leads del CRM importados (fuente_import = 'contactos_iseie_2026')
  const { rows: leads } = await query(
    `SELECT id, email, telefono, fecha_solicitud FROM leads
     WHERE project_id = $1 AND deleted_at IS NULL
       AND custom_fields->>'fuente_import' = 'contactos_iseie_2026'`,
    [PROJECT_ID]
  );
  console.log(`Leads a corregir: ${leads.length}`);

  let updated = 0, sinMatch = 0, sinCambio = 0;
  for (let i = 0; i < leads.length; i++) {
    const l = leads[i];
    const email = (l.email || '').trim().toLowerCase();
    const phone = normPhone(l.telefono);
    const f = (email && byEmail.get(email)) || (phone && byPhone.get(phone));
    if (!f) { sinMatch++; continue; }
    // Comparar con fecha actual del lead (a nivel dia)
    const cur = l.fecha_solicitud ? new Date(l.fecha_solicitud) : null;
    if (cur && Math.abs(cur - f) < 24 * 3600 * 1000) { sinCambio++; continue; }
    if (!DRY_RUN) {
      await query(`UPDATE leads SET fecha_solicitud = $1, updated_at = NOW() WHERE id = $2`, [f, l.id]);
    }
    updated++;
    if (updated <= 5) console.log(`  ✓ #${l.id} ${cur ? cur.toISOString().slice(0,10) : 'null'} → ${f.toISOString().slice(0,10)}`);
    if (i % 1000 === 0 && i > 0) console.log(`  procesados ${i}/${leads.length} (${updated} updates)`);
  }
  console.log(`\n=== Resumen ===`);
  console.log(`Updates: ${updated}`);
  console.log(`Sin match (no encontrados en CSV): ${sinMatch}`);
  console.log(`Sin cambio (ya correctos): ${sinCambio}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
