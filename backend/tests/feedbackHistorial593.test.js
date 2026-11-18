import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import crypto from 'crypto';
import { query } from '../src/shared/config/db.js';
import * as servicio from '../src/modules/feedback/feedback.service.js';

/**
 * El feedback deja rastro en el historial del prospecto (#169, #593), contra
 * la base de verdad.
 *
 * Las notas «💬 Contestó al feedback» y «📅 Pidió que le volvamos a contactar»
 * las pone el CRM, sin usuario. Mientras `lead_interactions.created_by` fue
 * NOT NULL el INSERT fallaba, el servicio se lo tragaba y la ficha no enseñaba
 * nada. Las pruebas de feedback simulaban el modelo y no lo veían: esta va con
 * las migraciones aplicadas, como la CI.
 */

const marca = `t593${Date.now()}`;
const ids = { users: [], projects: [], leads: [] };
let hayBase = true;
let porQueNo = null;

const uno = async (sql, p) => (await query(sql, p)).rows[0];

beforeAll(async () => {
  try {
    const t = await query("SELECT to_regclass('public.feedback_envios') AS f");
    if (!t.rows[0].f) throw new Error('Falta la migración 176 (feedback_envios).');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ["DELETE FROM admin_notifications WHERE (metadata->>'lead_id')::int = ANY($1::int[])", [ids.leads]],
    ['DELETE FROM lead_reminders WHERE lead_id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM feedback_envios WHERE lead_id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

/** Un prospecto con su gestora y su correo de feedback ya enviado. */
async function enviadoA(clave) {
  const p = await uno('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${clave} ${marca}`, `${clave.toLowerCase()}-${marca}`, `${clave}-${marca}-key`]);
  ids.projects.push(p.id);
  const u = await uno("INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id",
    [`Gestora ${marca}`, `${clave.toLowerCase()}@${marca}.test`]);
  ids.users.push(u.id);
  const l = await uno('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [p.id, `${clave} ${marca}`, `${clave.toLowerCase()}@lead.${marca}.test`, u.id]);
  ids.leads.push(l.id);
  const token = crypto.randomBytes(24).toString('base64url');
  await query(
    `INSERT INTO feedback_envios (lead_id, project_id, gestora_id, disparador, estado, token, email, enviado_at)
     VALUES ($1, $2, $3, 'dia7', 'enviado', $4, $5, NOW())`,
    [l.id, p.id, u.id, token, `${clave.toLowerCase()}@lead.${marca}.test`]);
  return { leadId: l.id, token };
}

const notasDe = async (leadId) => (await query(
  'SELECT nota, created_by FROM lead_interactions WHERE lead_id = $1 ORDER BY id', [leadId])).rows;

describe('el feedback en el historial del prospecto (#593)', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });

  it('la columna del autor admite notas que pone el CRM', async () => {
    if (!hayBase) return;
    const { rows: [c] } = await query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_name = 'lead_interactions' AND column_name = 'created_by'");
    expect(c.is_nullable).toBe('YES');
  });

  it('lo que contesta queda en su historial, sin autor', async () => {
    if (!hayBase) return;
    const { leadId, token } = await enviadoA('Contesta');
    const r = await servicio.responder(token, { respuestas: { motivo: 'precio', nota_atencion: '2', nota_atencion_otro: 'tardaron mucho' } });
    expect(r.ya).toBe(false);
    const notas = await notasDe(leadId);
    const contesto = notas.find((n) => n.nota.startsWith('💬 Contestó al feedback'));
    expect(contesto).toBeTruthy();
    expect(contesto.created_by).toBeNull();
    expect(contesto.nota).toContain('tardaron mucho');
  });

  it('«que me contacte» deja el recordatorio y su nota en el historial', async () => {
    if (!hayBase) return;
    const { leadId, token } = await enviadoA('Avisar');
    await servicio.responder(token, { respuestas: { motivo: 'fechas', avisar: 'si', avisar_cuando: 'mes_1' } });
    const notas = await notasDe(leadId);
    expect(notas.some((n) => n.nota.startsWith('📅 Pidió que le volvamos a contactar'))).toBe(true);
    const { rows } = await query('SELECT 1 FROM lead_reminders WHERE lead_id = $1', [leadId]);
    expect(rows.length).toBe(1);
  });
});
