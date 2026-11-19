import { query, getClient } from '../../shared/config/db.js';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { anotar, ACCIONES } from '../credentials/credentials.registro.js';
import { ROLES_TAREAS } from './tasks.model.js';
import { githubTableroActivo } from './tasks.github.js';
import {
  leerConfig, faltaEnConfig, sincronizarIssue, issueBorrada, sincronizarPr, contarComentario, recalcularResponsables,
} from './tasks.github.sync.js';

/*
  El webhook de GitHub y el panel «Configurar tablero › GitHub» (CRM-ISEIE#435).
  El panel lo ve solo quien tiene `tasks.github` (de serie, solo el superadmin).
*/

/* --- Los secretos: el del webhook y el token de solo lectura --- */

/*
  Van en `api_credentials`, servicio «github», cifrados (AES-256-GCM) como las
  demás claves: un JSON {"webhook_secret":"…","token":"…"}. Una sola fila, de
  todo el CRM (sin campus). Se escribe aquí y no con el upsert del módulo de
  credenciales porque cada CRM tiene un índice único distinto sobre esa tabla
  y con `project_id` NULL el ON CONFLICT no se dispara: se actualiza la que
  haya (activa o no) y, si no hay ninguna, se crea.
*/

export async function leerSecretos() {
  const { rows } = await query(
    `SELECT encrypted_value, iv, auth_tag FROM api_credentials
      WHERE service = 'github' AND project_id IS NULL AND active
      ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1`);
  if (!rows[0]) return {};
  try {
    const v = JSON.parse(decrypt(rows[0].encrypted_value, rows[0].iv, rows[0].auth_tag));
    return {
      webhook_secret: typeof v.webhook_secret === 'string' && v.webhook_secret ? v.webhook_secret : null,
      token: typeof v.token === 'string' && v.token ? v.token : null,
    };
  } catch (err) {
    logger.error({ err: err.message }, 'GitHub: no se pudo leer la credencial «github»');
    return {};
  }
}

/** Cambia el secreto o el token (lo que venga); `''` lo borra. Nunca devuelve el valor. */
export async function guardarSecretos(cambios, req) {
  const actual = await leerSecretos();
  const nuevo = { ...actual };
  for (const k of ['webhook_secret', 'token']) {
    if (cambios[k] !== undefined) nuevo[k] = cambios[k] ? String(cambios[k]).trim() : null;
  }
  const valor = JSON.stringify({ webhook_secret: nuevo.webhook_secret || null, token: nuevo.token || null });
  const { encrypted, iv, authTag } = encrypt(valor);
  const meta = { cola: (nuevo.token || nuevo.webhook_secret || '').slice(-4), updated_by: req.user?.userId ?? null };
  const { rowCount } = await query(
    `UPDATE api_credentials
        SET encrypted_value = $1, iv = $2, auth_tag = $3, active = true, updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE id = (SELECT id FROM api_credentials WHERE service = 'github' AND project_id IS NULL
                   ORDER BY active DESC, updated_at DESC NULLS LAST, id DESC LIMIT 1)`,
    [encrypted, iv, authTag, JSON.stringify(meta)]
  );
  if (!rowCount) {
    await query(
      `INSERT INTO api_credentials (project_id, service, encrypted_value, iv, auth_tag, metadata)
       VALUES (NULL, 'github', $1, $2, $3, $4)`,
      [encrypted, iv, authTag, JSON.stringify(meta)]
    );
  }
  // El registro de credenciales: qué se tocó y quién, nunca el valor.
  await anotar(req, ACCIONES.CAMBIAR, { servicio: 'github' });
  return { webhook_secret: Boolean(nuevo.webhook_secret), token: Boolean(nuevo.token) };
}

/* --- El aviso de GitHub --- */

/**
 * Procesa un aviso YA FIRMADO (la firma se mira antes, en el webhook). Una
 * transacción por aviso: si algo falla no queda a medias y GitHub lo puede
 * volver a mandar. El mismo aviso (X-GitHub-Delivery) dos veces no hace nada la
 * segunda; y aunque llegara con otro id, la issue tiene una sola tarea (UNIQUE).
 */
export async function procesarAviso({ evento, entrega, payload }) {
  if (evento === 'ping') return { resultado: 'pong' };
  if (!['issues', 'issue_comment', 'pull_request'].includes(evento)) return { resultado: `ignorado: evento ${evento}` };

  const db = await getClient();
  try {
    await db.query('BEGIN');
    const cfg = await leerConfig(db);
    const falta = faltaEnConfig(cfg);
    if (falta.length) {
      await db.query('ROLLBACK');
      return { resultado: `sin configurar: falta ${falta.join(', ')}` };
    }
    const repo = payload?.repository?.full_name || '';
    if (repo.toLowerCase() !== String(cfg.repo).toLowerCase()) {
      await db.query('ROLLBACK');
      return { resultado: 'ignorado: es de otro repositorio' };
    }

    const issue = payload.issue || null;
    const pr = payload.pull_request || null;
    const number = issue?.number ?? pr?.number ?? null;
    if (entrega) {
      const { rowCount } = await db.query(
        `INSERT INTO github_entregas (delivery_id, evento, accion, repo, number)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (delivery_id) DO NOTHING`,
        [String(entrega).slice(0, 80), evento, payload.action || null, repo, number]
      );
      if (!rowCount) {
        await db.query('ROLLBACK');
        return { resultado: 'repetido: ya se procesó' };
      }
    }

    let r;
    if (evento === 'issues') {
      if (!issue) r = { resultado: 'sin issue' };
      else if (payload.action === 'deleted') r = await issueBorrada(db, cfg, issue);
      else if (payload.action === 'transferred') r = { resultado: 'ignorado: transferida' };
      else r = await sincronizarIssue(db, cfg, issue, { accion: payload.action });
    } else if (evento === 'issue_comment') {
      r = issue ? await contarComentario(db, cfg, issue, payload.action) : { resultado: 'sin issue' };
    } else {
      r = pr ? await sincronizarPr(db, cfg, pr) : { resultado: 'sin PR' };
    }

    if (entrega) {
      await db.query('UPDATE github_entregas SET resultado = $2 WHERE delivery_id = $1', [String(entrega).slice(0, 80), String(r.resultado).slice(0, 200)]);
    }
    await db.query('COMMIT');
    return r;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/* --- El panel --- */

/** La dirección que hay que poner en GitHub: la API pública de ESTE CRM. */
export function urlDelWebhook(env = process.env) {
  const fija = String(env.API_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const base = fija || (String(env.CRM_BASE_URL || '').trim().replace(/\/+$/, '') + '/api');
  return base.startsWith('http') ? `${base}/github/webhook` : '/api/github/webhook';
}

export async function estado() {
  const cfg = await leerConfig({ query });
  const secretos = await leerSecretos();
  const [{ rows: equipos }, { rows: personas }, { rows: usuarios }, { rows: [resumen] }, { rows: entregas }] = await Promise.all([
    query(
      `SELECT t.id, t.name, ii.razon_social AS empresa
         FROM task_teams t LEFT JOIN invoice_issuers ii ON ii.id = t.issuer_id
        WHERE t.is_active
        ORDER BY ii.razon_social NULLS LAST, t.sort_order, t.name`),
    query(
      `SELECT id, nombre FROM users
        WHERE active AND role::text = ANY($1::text[])
        ORDER BY nombre`,
      [ROLES_TAREAS]
    ),
    query(
      `SELECT gu.login, gu.user_id, u.nombre, u.active,
              (SELECT COUNT(*)::int FROM github_issue_tareas v WHERE gu.login = ANY(v.asignados)) AS issues
         FROM github_usuarios gu JOIN users u ON u.id = gu.user_id
        ORDER BY gu.login`),
    query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE estado = 'open')::int AS abiertas,
              COUNT(*) FILTER (WHERE estado = 'closed')::int AS cerradas,
              COUNT(*) FILTER (WHERE por_definir AND estado = 'open')::int AS por_definir,
              MAX(ultima_sincronizacion) AS ultima_sincronizacion
         FROM github_issue_tareas WHERE lower(repo) = lower($1)`,
      [cfg?.repo || '']
    ),
    query(
      `SELECT evento, accion, number, resultado, recibida_at FROM github_entregas
        ORDER BY recibida_at DESC LIMIT 10`),
  ]);
  // Los logins asignados en issues abiertas que no tienen usuario: lo que queda por poner.
  const { rows: sinUsuario } = await query(
    `SELECT l AS login, COUNT(*)::int AS issues
       FROM github_issue_tareas v, unnest(v.asignados) l
      WHERE v.estado = 'open' AND NOT EXISTS (SELECT 1 FROM github_usuarios gu WHERE gu.login = l)
      GROUP BY l ORDER BY 2 DESC, 1`);
  return {
    activo: githubTableroActivo(),
    config: cfg,
    falta: faltaEnConfig(cfg),
    secretos: { webhook_secret: Boolean(secretos.webhook_secret), token: Boolean(secretos.token) },
    webhook_url: urlDelWebhook(),
    eventos: ['issues', 'issue_comment', 'pull_request'],
    equipos,
    personas,
    usuarios,
    sin_usuario: sinUsuario,
    resumen,
    entregas,
  };
}

export async function guardarConfig(datos, user) {
  const sets = [];
  const params = [];
  for (const k of ['repo', 'team_id', 'supervisor_id', 'copia_repo']) {
    if (datos[k] !== undefined) { params.push(datos[k] === '' ? null : datos[k]); sets.push(`${k} = $${params.length}`); }
  }
  if (datos.team_id) {
    const { rows } = await query('SELECT 1 FROM task_teams WHERE id = $1 AND is_active', [datos.team_id]);
    if (!rows[0]) throw new AppError('Ese equipo no existe o está archivado', 400, 'EQUIPO_NO_VALIDO');
  }
  if (datos.supervisor_id) {
    const { rows } = await query('SELECT 1 FROM users WHERE id = $1 AND active', [datos.supervisor_id]);
    if (!rows[0]) throw new AppError('Esa persona no existe o está desactivada', 400, 'PERSONA_NO_VALIDA');
  }
  if (sets.length) {
    params.push(user.userId);
    await query(
      `UPDATE github_tablero_config SET ${sets.join(', ')}, updated_by = $${params.length}, updated_at = NOW() WHERE id = 1`,
      params
    );
  }
  return estado();
}

/** Pone (o cambia) a quién corresponde un login, y recoloca sus tareas. */
export async function ponerUsuario(login, userId, user) {
  const l = String(login).trim().toLowerCase();
  const { rows } = await query('SELECT 1 FROM users WHERE id = $1 AND active', [userId]);
  if (!rows[0]) throw new AppError('Esa persona no existe o está desactivada', 400, 'PERSONA_NO_VALIDA');
  return conLaConfig(async (db, cfg) => {
    await db.query(
      `INSERT INTO github_usuarios (login, user_id, created_by) VALUES ($1, $2, $3)
       ON CONFLICT (login) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
      [l, userId, user.userId]
    );
    return { login: l, recolocadas: cfg.supervisor_id ? await recalcularResponsables(db, cfg, l) : 0 };
  });
}

export async function quitarUsuario(login) {
  const l = String(login).trim().toLowerCase();
  return conLaConfig(async (db, cfg) => {
    const { rowCount } = await db.query('DELETE FROM github_usuarios WHERE login = $1', [l]);
    if (!rowCount) throw new AppError('Ese login no está en la lista', 404, 'NOT_FOUND');
    return { login: l, recolocadas: cfg.supervisor_id ? await recalcularResponsables(db, cfg, l) : 0 };
  });
}

async function conLaConfig(fn) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const r = await fn(db, (await leerConfig(db)) || {});
    await db.query('COMMIT');
    return r;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}
