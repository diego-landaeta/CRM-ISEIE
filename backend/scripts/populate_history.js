// Pobla lead_interactions con UNA entrada cronologica por cada fila del CSV
// que pertenece a un lead unico. Asi la pestaña Historial muestra la timeline
// real (programa interesado → seguimientos → etapas).
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

function normEmail(s) {
  const t = (s || '').trim().toLowerCase();
  if (!t || /no\s*suministrad/i.test(t) || !t.includes('@')) return null;
  return t;
}
function normPhone(s) {
  const d = String(s || '').replace(/[^\d]/g, '');
  return d.length >= 7 ? d.replace(/^0+/, '') : null;
}
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).split(/[-/]\s|\s\/\/|\s-\s/)[0].trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const d = new Date(s); if (!isNaN(d)) return d; }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { const d = new Date(+m[3], +m[2]-1, +m[1]); if (!isNaN(d)) return d; }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (m) { const d = new Date(+m[3], +m[2]-1, +m[1]); if (!isNaN(d)) return d; }
  return null;
}

// Detecta tipo de interaccion por el contenido de las notas/seguimientos
function detectTipo(text) {
  const t = (text || '').toLowerCase();
  if (/whats?app|wsp|wpp\b|voice\b/.test(t)) return 'whatsapp';
  if (/llamad[ao]|llam[oó]|telef|cell|telefon/.test(t)) return 'llamada';
  if (/email|correo|mail|envi[oó]\s+m/.test(t)) return 'email';
  return 'nota';
}

// Arma el texto de la interaccion para una fila
function buildInteractionText(r) {
  const programa = (r[6] || '').trim();
  const etapa = (r[7] || '').trim();
  const tecnico = (r[8] || '').trim();
  const notas = (r[9] || '').trim();
  const seg1 = [r[14], r[15], r[16], r[17]].filter((x) => x && x.trim() && !/no\s*suministrad/i.test(x)).join(' · ').trim();
  const seg2 = [r[18], r[19], r[20], r[21]].filter((x) => x && x.trim() && !/no\s*suministrad/i.test(x)).join(' · ').trim();
  const seg3 = [r[22], r[23], r[24], r[25]].filter((x) => x && x.trim() && !/no\s*suministrad/i.test(x)).join(' · ').trim();

  const parts = [];
  if (programa) parts.push(`📚 ${programa}${etapa ? ` · ${etapa}` : ''}`);
  if (tecnico) parts.push(`👤 ${tecnico}`);
  if (notas) parts.push(`📝 ${notas}`);
  if (seg1) parts.push(`🔁 1er seg: ${seg1}`);
  if (seg2) parts.push(`🔁 2do seg: ${seg2}`);
  if (seg3) parts.push(`🔁 3er seg: ${seg3}`);
  return parts.join('\n');
}

(async () => {
  console.log('Leyendo CSV...');
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  console.log(`Filas: ${rows.length - 1}`);

  // Index por email/phone → array de rows
  const groups = new Map(); // key → { rows, key }
  const keyByEmail = new Map();
  const keyByPhone = new Map();

  for (const r of rows.slice(1)) {
    if (r.length < 8 || !r[0]?.trim()) continue;
    const email = normEmail(r[1]);
    const phone = normPhone(r[2]) || normPhone(r[13]);
    if (!email && !phone) continue;
    let groupKey = (email && keyByEmail.get(email)) || (phone && keyByPhone.get(phone));
    if (!groupKey) {
      groupKey = `g${groups.size}`;
      groups.set(groupKey, { rows: [], email, phone });
    }
    groups.get(groupKey).rows.push(r);
    if (email) keyByEmail.set(email, groupKey);
    if (phone) keyByPhone.set(phone, groupKey);
  }
  console.log(`Personas únicas: ${groups.size}`);

  // Para cada grupo, buscar lead en DB y crear lead_interactions
  let leadsConHistorial = 0, interaccionesCreadas = 0, sinLeadMatch = 0;
  let i = 0;
  for (const { rows: pRows, email, phone } of groups.values()) {
    i++;
    // Buscar lead
    const params = [];
    let where = `project_id = $1 AND deleted_at IS NULL`;
    params.push(PROJECT_ID);
    if (email) { where += ` AND LOWER(email) = $${params.length + 1}`; params.push(email); }
    else if (phone) { where += ` AND regexp_replace(telefono, '[^0-9]', '', 'g') = $${params.length + 1}`; params.push(phone); }
    const { rows: leadRows } = await query(`SELECT id FROM leads WHERE ${where} LIMIT 1`, params);
    if (!leadRows[0]) { sinLeadMatch++; continue; }
    const leadId = leadRows[0].id;

    // Verificar si ya tiene interacciones de este import
    const exists = await query(`SELECT 1 FROM lead_interactions WHERE lead_id = $1 AND nota LIKE '%fuente_import:contactos%' LIMIT 1`, [leadId]);
    if (exists.rows[0]) continue;

    // Ordenar filas por fecha (más antigua primero para timeline natural)
    const sortedRows = [...pRows].sort((a, b) => {
      const da = parseDate(a[12]); const db = parseDate(b[12]);
      if (!da && !db) return 0;
      if (!da) return 1; if (!db) return -1;
      return da - db;
    });

    let creadasParaEste = 0;
    for (const r of sortedRows) {
      const fecha = parseDate(r[12]);
      if (!fecha) continue; // sin fecha valida no creamos interaccion
      // Validar fecha razonable (entre 2020 y hoy+30d)
      const limite = new Date(); limite.setMonth(limite.getMonth() + 1);
      if (fecha < new Date('2020-01-01') || fecha > limite) continue;

      const text = buildInteractionText(r);
      if (!text) continue;
      const tipo = detectTipo(`${r[9]} ${r[14]} ${r[18]} ${r[22]}`);
      const notaConTag = `${text}\n\n— fuente_import:contactos_iseie_2026`;

      if (!DRY_RUN) {
        await query(
          `INSERT INTO lead_interactions (lead_id, tipo, nota, fecha) VALUES ($1, $2::interaction_type, $3, $4)`,
          [leadId, tipo, notaConTag, fecha]
        );
      }
      creadasParaEste++;
      interaccionesCreadas++;
    }
    if (creadasParaEste > 0) leadsConHistorial++;
    if (i % 500 === 0) console.log(`  procesados ${i}/${groups.size} (${interaccionesCreadas} interacciones creadas)`);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Personas en CSV:           ${groups.size}`);
  console.log(`Leads con historial nuevo: ${leadsConHistorial}`);
  console.log(`Interacciones creadas:     ${interaccionesCreadas}`);
  console.log(`Sin lead match en DB:      ${sinLeadMatch}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
