// Importa Contactos ISEIE 2026.csv (12,962 filas) a tabla leads.
// - Dedupe por email_norm O telefono_norm (misma persona = 1 lead)
// - "No suministrado" tratado como null
// - Agostina (no trabaja mas en ISEIE) → responsable=null + pendiente_reasignar=true
// - Etapa CSV → status CRM enum
// - Notas + 1er/2do/3er Seguimiento + cols extra → lead.notas multilinea
// - Multiples programas → custom_fields.programas_interes (array)
// - Match producto via findProductByName (unaccent, prefijos)
// - Match asesora por primer nombre
// - UPSERT por email/telefono → si ya existe lead (ej. CETLAT importado), actualiza
import 'dotenv/config';
import fs from 'fs';
import { query } from '/opt/crm-iseie/src/shared/config/db.js';
import { findProductByName } from '/opt/crm-iseie/src/modules/leads/lead.model.js';

const PROJECT_ID = 10;
const CSV_PATH = process.argv[2] || '/tmp/contactos.csv';
const DRY_RUN = process.argv.includes('--dry-run');

// ---------- Helpers ----------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inQ) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') {}
      else cell += c;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function normEmail(s) {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (/no\s*suministrad/i.test(t)) return null;
  if (!t.includes('@')) return null;
  return t;
}

function normPhone(s) {
  if (!s) return null;
  const digits = String(s).replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  // Conservar prefijo pais — quitar leading 0 si arranca con un solo 0
  return digits.replace(/^0+/, '');
}

const ETAPA_TO_STATUS = {
  'Por contactar':         'por_contactar',
  'Interesadx':            'contactado',
  'Interesad':             'contactado',
  'En Proceso':            'en_seguimiento',
  'Próxima convocatoria':  'en_seguimiento',
  'Solicitud de Admisión': 'en_seguimiento',
  'Busca presencial':      'en_seguimiento',
  'CETLAT':                'en_seguimiento',
  'No interesado/otro':    'no_interesado',
  'No interesado':         'no_interesado',
  'Venta':                 'convertido',
  'Título oficial':        'convertido',
};

// Prioridad para elegir mejor etapa cuando una persona aparece varias veces
const ETAPA_PRIORITY = {
  'convertido': 6, 'no_interesado': 1, 'en_seguimiento': 4,
  'contactado': 3, 'por_contactar': 2, 'nuevo': 0,
};

function mapStatus(etapaRaw) {
  const e = (etapaRaw || '').trim();
  return ETAPA_TO_STATUS[e] || 'nuevo';
}

function cleanAsesoraName(raw) {
  const s = (raw || '').trim();
  if (!s || s === '-' || s === '—') return null;
  return s.split(/\s+/)[0];
}

function nonEmpty(s) { return s && s.trim() && !/^no\s*suministrad/i.test(s.trim()); }

function buildNotes(rows) {
  // Combina notas de todas las filas del mismo contacto + seguimientos
  const blocks = [];
  for (const r of rows) {
    const notas = (r[9] || '').trim();
    const seg1 = [r[14], r[15], r[16], r[17]].filter(nonEmpty).join(' · ').trim();
    const seg2 = [r[18], r[19], r[20], r[21]].filter(nonEmpty).join(' · ').trim();
    const seg3 = [r[22], r[23], r[24], r[25]].filter(nonEmpty).join(' · ').trim();
    const programa = (r[6] || '').trim();
    const etapa = (r[7] || '').trim();
    const fecha = (r[12] || '').trim();
    const parts = [];
    if (programa) parts.push(`Programa: ${programa}${etapa ? ` (${etapa})` : ''}`);
    if (notas) parts.push(`Notas: ${notas}`);
    if (seg1) parts.push(`1er seguimiento: ${seg1}`);
    if (seg2) parts.push(`2do seguimiento: ${seg2}`);
    if (seg3) parts.push(`3er seguimiento: ${seg3}`);
    if (parts.length > 0) {
      blocks.push(`[${fecha || 's/f'}] ${parts.join(' | ')}`);
    }
  }
  return blocks.join('\n\n');
}

// ---------- Lookups con cache ----------
const productCache = new Map();
const userCache = new Map();

async function findProduct(name) {
  if (!name || !name.trim()) return null;
  const k = name.trim().toLowerCase();
  if (productCache.has(k)) return productCache.get(k);
  const p = await findProductByName(name.trim(), PROJECT_ID);
  const id = p?.id || null;
  productCache.set(k, id);
  return id;
}

async function findAsesora(firstName) {
  if (!firstName) return null;
  if (userCache.has(firstName)) return userCache.get(firstName);
  // Agostina NO existe — devolver null pero cachear para no preguntar de nuevo
  const { rows } = await query(
    `SELECT id FROM users WHERE nombre ILIKE $1 LIMIT 1`,
    [`${firstName}%`]
  );
  const id = rows[0]?.id || null;
  userCache.set(firstName, id);
  return id;
}

async function findExistingLead(email, phone) {
  if (email) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE project_id = $1 AND LOWER(email) = $2 AND deleted_at IS NULL LIMIT 1`,
      [PROJECT_ID, email]
    );
    if (rows[0]) return rows[0].id;
  }
  if (phone) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE project_id = $1
         AND telefono IS NOT NULL
         AND regexp_replace(telefono, '[^0-9]', '', 'g') = $2
         AND deleted_at IS NULL LIMIT 1`,
      [PROJECT_ID, phone]
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

// ---------- Main ----------
(async () => {
  const text = fs.readFileSync(CSV_PATH, 'utf-8');
  const rows = parseCsv(text);
  console.log('Headers:', rows[0].length, 'cols');
  console.log(`Total filas data: ${rows.length - 1}`);

  // Step 1: Agrupar filas por persona (email_norm O phone_norm)
  // Cada persona tiene un set de "claves" (email + phone) — usamos union-find ligera
  const data = rows.slice(1).filter((r) => r.length > 8 && r[0].trim());
  const personByKey = new Map(); // key -> person object
  const people = [];

  for (const r of data) {
    const email = normEmail(r[1]);
    const phone = normPhone(r[2]) || normPhone(r[13]);
    if (!email && !phone && !r[0].trim()) continue;

    // Buscar si ya hay persona con cualquiera de las claves
    let person = null;
    if (email && personByKey.has(`e:${email}`)) person = personByKey.get(`e:${email}`);
    else if (phone && personByKey.has(`p:${phone}`)) person = personByKey.get(`p:${phone}`);

    if (!person) {
      person = { rows: [], emails: new Set(), phones: new Set(), nombres: new Set() };
      people.push(person);
    }
    person.rows.push(r);
    if (email) { person.emails.add(email); personByKey.set(`e:${email}`, person); }
    if (phone) { person.phones.add(phone); personByKey.set(`p:${phone}`, person); }
    if (r[0].trim()) person.nombres.add(r[0].trim());
  }

  console.log(`\nPersonas únicas (dedupe email+telefono): ${people.length}`);
  const multiRow = people.filter((p) => p.rows.length > 1).length;
  console.log(`  con varias filas (multi-curso): ${multiRow}`);
  console.log(`  sin email pero con telefono: ${people.filter((p) => p.emails.size === 0 && p.phones.size > 0).length}`);
  console.log(`  sin email ni telefono: ${people.filter((p) => p.emails.size === 0 && p.phones.size === 0).length}`);

  if (DRY_RUN) {
    console.log('\n--- Muestra dry-run (primeras 5 personas) ---');
    for (const p of people.slice(0, 5)) {
      const programas = [...new Set(p.rows.map((r) => r[6]?.trim()).filter(Boolean))];
      const etapas = [...new Set(p.rows.map((r) => r[7]?.trim()).filter(Boolean))];
      const asesoras = [...new Set(p.rows.map((r) => cleanAsesoraName(r[8])).filter(Boolean))];
      console.log(`  ${[...p.nombres][0]} (${p.rows.length} filas) | emails=${p.emails.size} tel=${p.phones.size}`);
      console.log(`    programas: ${programas.slice(0, 3).join(', ')}${programas.length > 3 ? `... +${programas.length - 3}` : ''}`);
      console.log(`    etapas:    ${etapas.join(', ')}`);
      console.log(`    asesoras:  ${asesoras.join(', ')}`);
    }
    process.exit(0);
  }

  // Step 2: Procesar cada persona
  let created = 0, updated = 0, errors = 0, agostinaFlag = 0;
  let prodMatch = 0, asesoraMatch = 0;
  let i = 0;
  for (const p of people) {
    i++;
    try {
      // Mejor row: la que tenga etapa de mayor prioridad
      const sortedRows = [...p.rows].sort((a, b) => {
        const sa = ETAPA_PRIORITY[mapStatus(a[7])] || 0;
        const sb = ETAPA_PRIORITY[mapStatus(b[7])] || 0;
        return sb - sa;
      });
      const best = sortedRows[0];
      const nombre = [...p.nombres][0] || best[0].trim();
      const email = [...p.emails][0] || null;
      const phone = [...p.phones][0] || null;

      const programas = [...new Set(p.rows.map((r) => r[6]?.trim()).filter(Boolean))];
      const facultades = [...new Set(p.rows.map((r) => r[4]?.trim()).filter(Boolean))];
      const categorias = [...new Set(p.rows.map((r) => r[5]?.trim()).filter(Boolean))];
      const paises = [...new Set(p.rows.map((r) => r[11]?.trim()).filter(Boolean))];
      const origenes = [...new Set(p.rows.map((r) => r[10]?.trim()).filter(Boolean))];
      const allEtapas = [...new Set(p.rows.map((r) => r[7]?.trim()).filter(Boolean))];

      const status = mapStatus(best[7]);
      const productId = programas.length ? await findProduct(programas[0]) : null;
      if (productId) prodMatch++;

      const asesoraRaw = cleanAsesoraName(best[8]);
      const isAgostina = asesoraRaw && /^agost/i.test(asesoraRaw);
      let responsableId = null;
      if (asesoraRaw && !isAgostina) {
        responsableId = await findAsesora(asesoraRaw);
        if (responsableId) asesoraMatch++;
      }
      if (isAgostina) agostinaFlag++;

      const notas = buildNotes(p.rows);
      const fechaSolic = best[12] ? new Date(best[12]) : new Date();
      const fechaValid = !isNaN(fechaSolic.getTime()) ? fechaSolic : new Date();

      const customFields = {
        origen_csv: origenes.join(', ') || null,
        pais: paises.join(', ') || null,
        facultad: facultades.join(', ') || null,
        categoria_programa: categorias.join(', ') || null,
        programas_interes: programas,
        etapas_csv: allEtapas,
        ok_status: (best[3] || '').trim() || null,
        tecnico_csv: asesoraRaw || null,
        pendiente_reasignar: isAgostina,
        motivo_pendiente: isAgostina ? 'Agostina ya no trabaja con ISEIE - admin/superadmin debe reasignar o dejar como historial' : null,
        fuente_import: 'contactos_iseie_2026',
        emails_alt: [...p.emails].filter((e) => e !== email),
        telefonos_alt: [...p.phones].filter((t) => t !== phone),
        nombres_alt: [...p.nombres].filter((n) => n !== nombre),
      };

      const idempKey = `contactos:${email || phone || nombre.toLowerCase()}`;

      // UPSERT: buscar lead existente por email o telefono
      const existingId = await findExistingLead(email, phone);

      if (existingId) {
        // Update: append notas, merge custom_fields, mantener status si ya es mas avanzado
        await query(
          `UPDATE leads SET
              nombre = COALESCE(NULLIF(nombre, ''), $2),
              email = COALESCE(NULLIF(email, ''), $3),
              telefono = COALESCE(NULLIF(telefono, ''), $4),
              producto_interes_id = COALESCE(producto_interes_id, $5),
              responsable_id = COALESCE(responsable_id, $6),
              notas = CASE WHEN notas IS NULL OR notas = '' THEN $7 ELSE notas || E'\\n\\n--- Import Contactos 2026 ---\\n' || $7 END,
              custom_fields = custom_fields || $8::jsonb,
              status = CASE WHEN $9 = 'convertido' OR $9 = 'no_interesado' THEN $9::lead_status ELSE status END,
              updated_at = NOW()
           WHERE id = $1`,
          [existingId, nombre, email, phone, productId, responsableId, notas, JSON.stringify(customFields), status]
        );
        updated++;
      } else {
        await query(
          `INSERT INTO leads (project_id, nombre, email, telefono, producto_interes_id, status, responsable_id,
                              fecha_solicitud, notas, custom_fields, idempotency_key, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, NOW(), NOW())
           ON CONFLICT (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
          [PROJECT_ID, nombre, email, phone, productId, status, responsableId,
           fechaValid, notas, JSON.stringify(customFields), idempKey]
        );
        created++;
      }
    } catch (e) {
      errors++;
      if (errors < 5) console.error(`  err person ${i} (${[...p.nombres][0]}): ${e.message}`);
    }

    if (i % 250 === 0) console.log(`  procesadas ${i}/${people.length} (+${created} creados, +${updated} updates)`);
  }

  console.log(`\n=== Resumen ===`);
  console.log(`Personas procesadas:  ${people.length}`);
  console.log(`Leads creados:        ${created}`);
  console.log(`Leads actualizados:   ${updated}`);
  console.log(`Errores:              ${errors}`);
  console.log(`Programa matcheado:   ${prodMatch}/${people.length}`);
  console.log(`Asesora matcheada:    ${asesoraMatch}/${people.length}`);
  console.log(`Marcados pendiente_reasignar (Agostina): ${agostinaFlag}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e); process.exit(1); });
