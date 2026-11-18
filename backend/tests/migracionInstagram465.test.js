import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

/**
 * Migración 317 · Instagram con IA y atribución de Meta (gemela de CRM#845; en el 360, la 284, #465).
 *
 * En una base NUEVA y desechable dentro del Postgres local (Docker
 * `crm-db-local`, 127.0.0.1:15432):
 *
 *   · se aplican TODAS las migraciones en orden, como `npm run db:preparar`;
 *   · se vuelven a aplicar las de esta tarea (317 en adelante): tienen que poder
 *     pasarse dos veces. Las antiguas no se repiten: muchas no se protegen
 *     (001 crea tablas sin IF NOT EXISTS) y no es lo que se prueba aquí;
 *   · existen las tablas, las columnas, las claves foráneas, los únicos que
 *     deduplican (mid, comentario, evento de webhook) y el canal `instagram`.
 *
 * Sin el Postgres local, se salta. Nunca toca una base de un servidor.
 *
 *   npx vitest run tests/migracionInstagram465.test.js
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MIGRACIONES = path.join(AQUI, '..', 'migrations');
const PRIMERA_DE_ESTA_TAREA = '317_';

const URL_LOCAL = process.env.DATABASE_URL || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
const esLocal = /@(127\.0\.0\.1|localhost):15432\//.test(URL_LOCAL);
const conBase = (nombre) => { const u = new URL(URL_LOCAL); u.pathname = `/${nombre}`; return u.toString(); };

// ¿Hay Postgres local? Si no, el describe entero se salta.
let disponible = false;
if (esLocal) {
  const c = new pg.Client({ connectionString: conBase('postgres'), connectionTimeoutMillis: 2000 });
  try { await c.connect(); disponible = true; } catch { disponible = false; } finally { await c.end().catch(() => {}); }
}

// Lo mismo que hace scripts/db-preparar.mjs en local.
const sinOwnerTo = (sql) => sql.replace(/^\s*ALTER\s+(TABLE|SEQUENCE|TYPE|VIEW)\s+[^\n;]*OWNER\s+TO[^\n;]*;\s*$/gim, '');
const ficheros = fs.readdirSync(MIGRACIONES).filter((f) => f.endsWith('.sql')).sort();
const deEstaTarea = ficheros.filter((f) => f >= PRIMERA_DE_ESTA_TAREA);

const BASE = `crm_mig465_${Date.now().toString(36)}`;
let admin;
let db;

async function aplicar(lista) {
  for (const f of lista) {
    try {
      await db.query(sinOwnerTo(fs.readFileSync(path.join(MIGRACIONES, f), 'utf8')));
    } catch (e) {
      throw new Error(`Falla ${f}: ${e.message}`);
    }
  }
}

const columnas = async (tabla) => (await db.query(
  `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [tabla],
)).rows.map((r) => r.column_name);

// Claves foráneas de una tabla: «columna → tabla_destino (acción al borrar)».
const foraneas = async (tabla) => (await db.query(
  `SELECT a.attname AS col, c.confrelid::regclass::text AS destino, c.confdeltype AS al_borrar
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f' AND c.conrelid = $1::regclass`, [tabla],
)).rows.map((r) => `${r.col} → ${r.destino} (${r.al_borrar})`);

describe.skipIf(!disponible)('Migración 317: Instagram y atribución de Meta (#465)', () => {
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: conBase('postgres') });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${BASE}`);
    db = new pg.Client({ connectionString: conBase(BASE) });
    await db.connect();
  }, 30_000);

  afterAll(async () => {
    await db?.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${BASE} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  });

  it('hay migraciones de esta tarea', () => {
    expect(deEstaTarea).toContain('317_instagram_y_atribucion_meta.sql');
  });

  it('todas las migraciones se aplican en orden en una base vacía', async () => {
    await aplicar(ficheros);
  }, 300_000);

  it('las de esta tarea se pueden pasar una segunda vez', async () => {
    await aplicar(deEstaTarea);
  }, 60_000);

  it('existen las tablas nuevas', async () => {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY ($1)`,
      [['ig_accounts', 'ig_bot_config', 'ig_conversations', 'ig_messages', 'ig_comments', 'webhook_events']],
    );
    expect(rows.map((r) => r.table_name).sort()).toEqual(
      ['ig_accounts', 'ig_bot_config', 'ig_comments', 'ig_conversations', 'ig_messages', 'webhook_events'],
    );
  });

  it('lead_utms y leads tienen las columnas nuevas', async () => {
    expect(await columnas('lead_utms')).toEqual(expect.arrayContaining(
      ['meta_lead_id', 'meta_form_id', 'fbc', 'fbp', 'client_ip', 'user_agent', 'igsid', 'ig_account_id'],
    ));
    expect(await columnas('leads')).toEqual(expect.arrayContaining(['lifetime_value', 'landing_url']));
  });

  it('no se duplica lo que ya había: ni ai_usage ni source_channel', async () => {
    const { rows } = await db.query(`SELECT to_regclass('public.ai_usage') AS t`);
    expect(rows[0].t).toBeNull();
    expect(await columnas('leads')).not.toContain('source_channel');
    // El gasto de IA va a ia_gasto (249 en ISEIE), que ya existe.
    expect(await columnas('ia_gasto')).toEqual(expect.arrayContaining(['project_id', 'modelo', 'tokens_entrada', 'tokens_salida']));
  });

  it('el canal `instagram` existe en utm_channel', async () => {
    const { rows } = await db.query(`SELECT unnest(enum_range(NULL::utm_channel))::text AS v`);
    expect(rows.map((r) => r.v)).toContain('instagram');
  });

  it('las claves foráneas apuntan a donde deben', async () => {
    // c = CASCADE, n = SET NULL
    expect(await foraneas('ig_accounts')).toEqual(expect.arrayContaining(['project_id → projects (c)', 'connected_by → users (n)']));
    expect(await foraneas('ig_bot_config')).toEqual(expect.arrayContaining(['ig_account_id → ig_accounts (c)']));
    expect(await foraneas('ig_conversations')).toEqual(expect.arrayContaining([
      'ig_account_id → ig_accounts (c)', 'project_id → projects (c)', 'lead_id → leads (n)', 'assigned_user_id → users (n)',
    ]));
    expect(await foraneas('ig_messages')).toEqual(expect.arrayContaining(['conversation_id → ig_conversations (c)']));
    expect(await foraneas('ig_comments')).toEqual(expect.arrayContaining([
      'ig_account_id → ig_accounts (c)', 'project_id → projects (c)', 'lead_id → leads (n)',
    ]));
    expect(await foraneas('webhook_events')).toEqual(expect.arrayContaining(['project_id → projects (n)']));
    expect(await foraneas('lead_utms')).toEqual(expect.arrayContaining(['ig_account_id → ig_accounts (n)']));
  });

  it('deduplica: un mid, un comentario y un evento de webhook entran una vez', async () => {
    const one = async (sql, p) => (await db.query(sql, p)).rows[0];
    const proyecto = await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('IG465', 'ig465', 'ig465-k') RETURNING id`,
    );
    const cuenta = await one(
      `INSERT INTO ig_accounts (project_id, ig_user_id, username) VALUES ($1, '17841400000000001', 'prueba') RETURNING id, active`,
      [proyecto.id],
    );
    expect(cuenta.active).toBe(false); // nace apagada
    await expect(db.query(
      `INSERT INTO ig_accounts (project_id, ig_user_id) VALUES ($1, '17841400000000001')`, [proyecto.id],
    )).rejects.toThrow(/uq_ig_accounts_ig_user/);

    await db.query(`INSERT INTO ig_bot_config (ig_account_id) VALUES ($1)`, [cuenta.id]);
    await expect(db.query(
      `UPDATE ig_bot_config SET comment_mode = 'todo' WHERE ig_account_id = $1`, [cuenta.id],
    )).rejects.toThrow(/ig_bot_config_comment_mode/);

    const conv = await one(
      `INSERT INTO ig_conversations (ig_account_id, project_id, igsid) VALUES ($1, $2, 'igsid-1') RETURNING id`,
      [cuenta.id, proyecto.id],
    );
    // La fila del bot se guarda antes de enviar, sin mid: dos así no chocan.
    await db.query(`INSERT INTO ig_messages (conversation_id, role, text, status) VALUES ($1, 'assistant', 'hola', 'pendiente'), ($1, 'assistant', 'adiós', 'pendiente')`, [conv.id]);
    await db.query(`INSERT INTO ig_messages (conversation_id, role, text, mid) VALUES ($1, 'user', 'hola', 'mid.1')`, [conv.id]);
    await expect(db.query(
      `INSERT INTO ig_messages (conversation_id, role, text, mid) VALUES ($1, 'user', 'hola', 'mid.1')`, [conv.id],
    )).rejects.toThrow(/uq_ig_messages_mid/);
    await expect(db.query(
      `INSERT INTO ig_messages (conversation_id, role, text) VALUES ($1, 'bot', 'x')`, [conv.id],
    )).rejects.toThrow(/ig_messages_role/);

    await db.query(`INSERT INTO ig_comments (ig_account_id, project_id, comment_id) VALUES ($1, $2, 'c1')`, [cuenta.id, proyecto.id]);
    await expect(db.query(
      `INSERT INTO ig_comments (ig_account_id, project_id, comment_id) VALUES ($1, $2, 'c1')`, [cuenta.id, proyecto.id],
    )).rejects.toThrow(/uq_ig_comments_comment/);

    await db.query(`INSERT INTO webhook_events (source, event_id, payload) VALUES ('instagram', 'mid.1', '{}')`);
    await expect(db.query(
      `INSERT INTO webhook_events (source, event_id, payload) VALUES ('instagram', 'mid.1', '{}')`,
    )).rejects.toThrow(/uq_webhook_events_source_event/);
    // El mismo id desde otra fuente no choca.
    await db.query(`INSERT INTO webhook_events (source, event_id, payload) VALUES ('otra', 'mid.1', '{}')`);

    // Borrar la cuenta se lleva su cerebro, conversaciones, mensajes y comentarios.
    await db.query(`DELETE FROM ig_accounts WHERE id = $1`, [cuenta.id]);
    const { rows: [quedan] } = await db.query(
      `SELECT (SELECT count(*) FROM ig_bot_config)::int + (SELECT count(*) FROM ig_conversations)::int
            + (SELECT count(*) FROM ig_messages)::int + (SELECT count(*) FROM ig_comments)::int AS n`,
    );
    expect(quedan.n).toBe(0);
  });
});
