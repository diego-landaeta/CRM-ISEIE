import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';

// Brevo de mentira: cada prueba decide si el correo sale o falla.
const { envios } = vi.hoisted(() => ({ envios: { respuesta: { sent: true }, hechos: [] } }));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { envios.hechos.push(c); return envios.respuesta; }),
}));

import crypto from 'crypto';
import { query } from '../src/shared/config/db.js';
import * as servicio from '../src/modules/feedback/feedback.service.js';
import * as model from '../src/modules/feedback/feedback.model.js';

/**
 * A quién se le manda el «¿por qué has desistido?» (#169, #593), contra la
 * base de verdad:
 *   · WhatsApp cuenta como interacción: quien chatea no ha desistido;
 *   · es una vez por PERSONA (su correo), no por ficha;
 *   · quien compró con cualquiera de sus fichas no la recibe;
 *   · lo que falla o se queda a medias se reintenta, como mucho tres veces;
 *   · «que me contacte» va a una gestora disponible, y el aviso a quien tiene
 *     el recordatorio.
 */

const marca = `p593${Date.now()}`;
const ids = { users: [], projects: [], leads: [], convs: [] };
let hayBase = true;
let porQueNo = null;
let proyecto;
let gestora;
let n = 0;

const uno = async (sql, p) => (await query(sql, p)).rows[0];

beforeAll(async () => {
  try {
    const t = await query("SELECT column_name FROM information_schema.columns WHERE table_name = 'feedback_envios' AND column_name = 'intentos'");
    if (!t.rows.length) throw new Error('Falta la migración 302.');
    proyecto = (await uno('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`Campus ${marca}`, `campus-${marca}`, `${marca}-key`])).id;
    ids.projects.push(proyecto);
    gestora = await usuario('Ana');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ["DELETE FROM admin_notifications WHERE (metadata->>'lead_id')::int = ANY($1::int[])", [ids.leads]],
    ['DELETE FROM wa_mensajes WHERE conversacion_id = ANY($1::int[])', [ids.convs]],
    ['DELETE FROM wa_conversaciones WHERE id = ANY($1::int[])', [ids.convs]],
    ['DELETE FROM conversions WHERE lead_id = ANY($1::int[])', [ids.leads]],
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

async function usuario(nombre, { disponible = true } = {}) {
  n += 1;
  const u = await uno(
    "INSERT INTO users (nombre, email, password_hash, role, is_available) VALUES ($1, $2, 'x', 'gestor', $3) RETURNING id",
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}${n}@${marca}.test`, disponible]);
  ids.users.push(u.id);
  return u.id;
}

/** Una ficha con su primer contacto (una llamada) hace `dias` días. */
async function ficha(correo, { dias = 10, responsable = gestora } = {}) {
  const l = await uno('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [proyecto, `Persona ${marca}`, correo, responsable]);
  ids.leads.push(l.id);
  await query(
    "INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha) VALUES ($1, 'llamada', 'Primer contacto', $2, NOW() - ($3 || ' days')::interval)",
    [l.id, gestora, String(dias)]);
  return l.id;
}

async function whatsappHace(leadId, dias) {
  const c = await uno(
    "INSERT INTO wa_conversaciones (instancia, jid, telefono, lead_id, project_id) VALUES ('test', $1, $2, $3, $4) RETURNING id",
    [`${marca}-${leadId}@s.whatsapp.net`, `34600${leadId}`, leadId, proyecto]);
  ids.convs.push(c.id);
  await query("INSERT INTO wa_mensajes (conversacion_id, direccion, texto, ts) VALUES ($1, 'entrante', 'hola', NOW() - ($2 || ' days')::interval)",
    [c.id, String(dias)]);
}

const correo = (x) => `${x}@persona.${marca}.test`;
const candidatos = async () => {
  const todos = await model.candidatosDelDia7({ tope: 500 });
  return todos.filter((id) => ids.leads.includes(id));
};

describe('a quién le toca el correo del 7.º día (#593)', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });

  it('7 días sin nada: le toca', async () => {
    if (!hayBase) return;
    const id = await ficha(correo('sola'));
    expect(await candidatos()).toContain(id);
  });

  it('si chatea por WhatsApp, no le toca', async () => {
    if (!hayBase) return;
    const id = await ficha(correo('chatea'));
    await whatsappHace(id, 2);
    expect(await candidatos()).not.toContain(id);
  });

  it('si compró con otra ficha, no le toca', async () => {
    if (!hayBase) return;
    const id = await ficha(correo('compro'));
    const otra = await ficha(correo('compro'), { dias: 40 });
    await query("INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Curso', 100)",
      [otra, proyecto]);
    const c = await candidatos();
    expect(c).not.toContain(id);
    expect(c).not.toContain(otra);
  });

  it('si ya la recibió por otra ficha, no le toca', async () => {
    if (!hayBase) return;
    const id = await ficha(correo('yarecibio'));
    const otra = await ficha(correo('yarecibio'), { dias: 40 });
    await query(
      "INSERT INTO feedback_envios (lead_id, project_id, disparador, estado, token, email) VALUES ($1, $2, 'dia7', 'enviado', $3, $4)",
      [otra, proyecto, crypto.randomBytes(24).toString('base64url'), correo('YaRecibio').toUpperCase()]);
    expect(await candidatos()).not.toContain(id);
  });

  it('con dos fichas sin nada, sale una sola', async () => {
    if (!hayBase) return;
    const a = await ficha(correo('dos'), { dias: 12 });
    const b = await ficha(`  ${correo('DOS')} `, { dias: 9 });
    const c = (await candidatos()).filter((x) => x === a || x === b);
    expect(c).toHaveLength(1);
  });

  it('si habla por la otra ficha, tampoco', async () => {
    if (!hayBase) return;
    const id = await ficha(correo('otraviva'), { dias: 12 });
    const otra = await ficha(correo('otraviva'), { dias: 1 });
    expect(await candidatos()).not.toContain(id);
    expect(await candidatos()).not.toContain(otra);
  });
});

describe('lo que no salió se reintenta (#593)', () => {
  async function envioEn(estado, { horas = 7, intentos = 1, email = correo(`r${Date.now()}${Math.random()}`) } = {}) {
    const id = await ficha(email);
    const f = await uno(
      `INSERT INTO feedback_envios (lead_id, project_id, gestora_id, disparador, estado, token, email, intentos, updated_at)
       VALUES ($1, $2, $3, 'dia7', $4, $5, $6, $7, NOW() - ($8 || ' hours')::interval) RETURNING id`,
      [id, proyecto, gestora, estado, crypto.randomBytes(24).toString('base64url'), email, intentos, String(horas)]);
    return { leadId: id, envioId: f.id };
  }
  const estadoDe = async (id) => uno('SELECT estado, intentos, nota_envio FROM feedback_envios WHERE id = $1', [id]);

  it('un fallido de hace horas sale en la vuelta siguiente', async () => {
    if (!hayBase) return;
    const { envioId } = await envioEn('fallido');
    envios.respuesta = { sent: true };
    await servicio.vueltaDelDia7({ pila: 200, tope: 100000 });
    const f = await estadoDe(envioId);
    expect(f.estado).toBe('enviado');
    expect(f.intentos).toBe(2);
  });

  it('un pendiente atascado también', async () => {
    if (!hayBase) return;
    const { envioId } = await envioEn('pendiente', { horas: 2, intentos: 0 });
    envios.respuesta = { sent: true };
    await servicio.vueltaDelDia7({ pila: 200, tope: 100000 });
    expect((await estadoDe(envioId)).estado).toBe('enviado');
  });

  it('a la tercera no se insiste más', async () => {
    if (!hayBase) return;
    const { envioId } = await envioEn('fallido', { intentos: 3 });
    envios.respuesta = { sent: true };
    await servicio.vueltaDelDia7({ pila: 200, tope: 100000 });
    expect((await estadoDe(envioId)).estado).toBe('fallido');
  });

  it('si entretanto compró, se cancela y no se manda', async () => {
    if (!hayBase) return;
    const { leadId, envioId } = await envioEn('fallido');
    await query("UPDATE leads SET status = 'convertido' WHERE id = $1", [leadId]);
    envios.hechos = [];
    await servicio.vueltaDelDia7({ pila: 200, tope: 100000 });
    const f = await estadoDe(envioId);
    expect(f.estado).toBe('cancelado');
    expect(envios.hechos.some((c) => c.clave === `feedback:${leadId}`)).toBe(false);
  });

  it('si Brevo revienta, queda fallido y no pendiente', async () => {
    if (!hayBase) return;
    const { envioId } = await envioEn('pendiente', { horas: 2, intentos: 0 });
    const brevo = await import('../src/shared/services/brevo.service.js');
    brevo.sendEmail.mockImplementationOnce(async () => { throw new Error('se cayó la red'); });
    await servicio.vueltaDelDia7({ pila: 200, tope: 100000 });
    const f = await estadoDe(envioId);
    expect(f.estado).toBe('fallido');
    expect(f.nota_envio).toContain('se cayó la red');
  });
});

describe('el registro de correos dice lo que pasó al final (#593)', () => {
  const clave = `feedback:prueba-${marca}`;
  afterAll(async () => { await query('DELETE FROM email_envios WHERE clave = $1', [clave]); });

  it('falla con el remitente de la marca y sale por el del CRM: queda «enviado»', async () => {
    if (!hayBase) return;
    const { registrar, yaSeEnvio } = await import('../src/shared/services/email-log.service.js');
    const base = { clave, destinatarios: ['x@x.test'], asunto: 'Feedback', etiquetas: ['feedback'] };
    await registrar({ ...base, estado: 'fallido', intentos: 1, error: 'sender not valid' });
    expect(await yaSeEnvio(clave)).toBe(false);
    await registrar({ ...base, estado: 'enviado', intentos: 1, brevoMsgId: 'msg-1' });
    const f = await uno('SELECT estado, intentos, brevo_msg_id, error FROM email_envios WHERE clave = $1', [clave]);
    expect(f).toMatchObject({ estado: 'enviado', intentos: 2, brevo_msg_id: 'msg-1', error: null });
    expect(await yaSeEnvio(clave)).toBe(true);
  });

  it('lo que ya salió no lo pisa un intento posterior', async () => {
    if (!hayBase) return;
    const { registrar } = await import('../src/shared/services/email-log.service.js');
    await registrar({ clave, destinatarios: ['x@x.test'], asunto: 'Feedback', estado: 'fallido', intentos: 1, error: 'otra vez' });
    const f = await uno('SELECT estado, brevo_msg_id FROM email_envios WHERE clave = $1', [clave]);
    expect(f).toMatchObject({ estado: 'enviado', brevo_msg_id: 'msg-1' });
  });
});

describe('«que me contacte»: a una gestora que esté (#593)', () => {
  async function contesta({ responsable, delEnvio }) {
    const id = await ficha(correo(`c${Date.now()}${Math.random()}`), { responsable });
    const token = crypto.randomBytes(24).toString('base64url');
    await query(
      "INSERT INTO feedback_envios (lead_id, project_id, gestora_id, disparador, estado, token, email, enviado_at) VALUES ($1, $2, $3, 'dia7', 'enviado', $4, 'x@x.test', NOW())",
      [id, proyecto, delEnvio, token]);
    await servicio.responder(token, { respuestas: { motivo: 'fechas', avisar: 'si', avisar_cuando: 'mes_1' } });
    const rec = await uno('SELECT created_by FROM lead_reminders WHERE lead_id = $1', [id]);
    const aviso = await uno(
      "SELECT target_user_ids FROM admin_notifications WHERE (metadata->>'lead_id')::int = $1 AND title = 'Te han contestado al feedback'", [id]);
    const nota = await uno("SELECT nota FROM lead_interactions WHERE lead_id = $1 AND nota LIKE '📅%'", [id]);
    return { rec, aviso, nota };
  }

  it('reasignado después del envío: recordatorio y aviso a la de ahora', async () => {
    if (!hayBase) return;
    const ahora = await usuario('Bea');
    const { rec, aviso } = await contesta({ responsable: ahora, delEnvio: gestora });
    expect(rec.created_by).toBe(ahora);
    expect(aviso.target_user_ids).toEqual([ahora]);
  });

  it('la responsable de baja: va a la del envío, que sí está', async () => {
    if (!hayBase) return;
    const deBaja = await usuario('Carla', { disponible: false });
    const { rec, aviso } = await contesta({ responsable: deBaja, delEnvio: gestora });
    expect(rec.created_by).toBe(gestora);
    expect(aviso.target_user_ids).toEqual([gestora]);
  });

  it('ninguna está: se le pone a la responsable y el historial lo dice', async () => {
    if (!hayBase) return;
    const deBaja = await usuario('Dora', { disponible: false });
    const otraDeBaja = await usuario('Eva', { disponible: false });
    const { rec, nota } = await contesta({ responsable: deBaja, delEnvio: otraDeBaja });
    expect(rec.created_by).toBe(deBaja);
    expect(nota.nota).toContain('no está disponible');
  });
});
