import { query, getClient } from '../../shared/config/db.js';
import { limpiaRolesExtra } from '../../shared/utils/roles.js';
import { existeTablaEmpresas, ponerEmpresas } from './user.empresas.js';
import { registrarCambio } from '../permissions/permissions.model.js';

// Esta lista es «quien puede llevar un prospecto», porque es para lo que la usa
// casi todo el CRM: el filtro de Prospectos, asignar responsable, la exportacion
// a Wasapi, el desplegable de gestora en Clientes y en Ventas.
//
// Por eso se quedan fuera dos grupos, aunque sean usuarios:
//
//  · Los PROFESORES. No venden ni atienden a nadie; tienen su propia pantalla.
//  · Quien lleva las COLABORACIONES —Vanessa, Jonathan—. Da de alta profesores y
//    les toca el porcentaje. Tiene rol de gestora porque es el unico que la
//    limita a ver solo lo suyo, pero no es una gestora: salia en esos
//    desplegables y se le podia asignar un prospecto a mano. Un prospecto en su
//    bandeja es un prospecto que no llama nadie.
//
// Quien necesita a TODO el personal —la pantalla de Usuarios, las nominas— lo
// pide con incluirTodos. Es al reves de como estaba: lo seguro es lo de por
// defecto, y ver a todos es lo que hay que pedir.
export async function findAll({ active, role, projectId, page, limit, incluirTodos = false }) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (active !== undefined) {
    conditions.push(`u.active = $${paramIdx++}`);
    params.push(active === 'true');
  }
  if (!incluirTodos) {
    // Con role='tutor' se piden profesores a proposito: ahi si salen.
    if (role !== 'tutor') conditions.push(`u.role <> 'tutor'`);
    // Los de colaboraciones no salen NUNCA por aqui, ni pidiendo role='gestor'
    // —que es justo como los pide quien busca una gestora—.
    conditions.push(`NOT COALESCE(u.gestor_colaboraciones, false)`);
  }
  if (role) {
    conditions.push(`u.role = $${paramIdx++}`);
    params.push(role);
  }
  if (projectId) {
    conditions.push(`EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $${paramIdx++})`);
    params.push(projectId);
  }

  const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  const countResult = await query(`SELECT COUNT(*) FROM users u ${where}`, params);
  const total = parseInt(countResult.rows[0].count);

  // Las empresas enteras de cada admin (#220). Sin la migracion 203 vale null:
  // la pantalla no enseña una casilla que no se puede guardar.
  const empresasSql = (await existeTablaEmpresas())
    ? `COALESCE((SELECT json_agg(ue.issuer_id ORDER BY ue.issuer_id)
                   FROM user_empresas ue WHERE ue.user_id = u.id), '[]'::json)`
    : 'NULL::json';

  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.roles_extra::text[] AS roles_extra, u.active, u.last_login_at, u.created_at, u.avatar_url, u.avatar_key,
            u.whatsapp_phone, u.whatsapp_display_name,
            -- Los permisos acotados viajan en el listado: sin esto la pantalla no
            -- puede enseñar quien los tiene, que es como se paso por alto que a Ana
            -- le faltaba uno. El de colaboraciones ya estaba anotado como pendiente
            -- en el tipo del frontal.
            -- (Sin comillas invertidas en este comentario: esto va dentro de una
            --  plantilla de texto de JavaScript y cerrarian la cadena.)
            COALESCE(u.factura_manager, false) AS factura_manager,
            COALESCE(u.editar_fechas_factura, false) AS editar_fechas_factura,
            COALESCE(u.gestor_colaboraciones, false) AS gestor_colaboraciones,
            COALESCE(
              (SELECT json_agg(up.project_id ORDER BY up.project_id)
               FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true),
              '[]'::json
            ) AS project_ids,
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'projectId', up.project_id,
                 'recibeLeads', up.recibe_leads
               ) ORDER BY up.project_id)
               FROM user_projects up
               WHERE up.user_id = u.id AND up.active = true),
              '[]'::json
            ) AS projects,
            ${empresasSql} AS empresa_ids
     FROM users u ${where}
     ORDER BY u.created_at DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...params, limit, offset]
  );

  return { users: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.roles_extra::text[] AS roles_extra, u.active, u.last_login_at, u.created_at, u.avatar_url, u.avatar_key
     FROM users u WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Sin distinguir mayúsculas, como el login y como Make: hay correos guardados con
// mayúsculas («Albertoj@iseie.com») y con `email = $1` otro podía quedarse con el
// mismo cambiando solo una letra (#248).
export async function findByEmail(email) {
  const { rows } = await query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
  return rows[0] || null;
}

/**
 * Si cambiarle el correo a alguien puede dejarle sin prospectos (#248).
 *
 * Make asigna el responsable de un prospecto por su correo (`responsable_email`,
 * cabecera X-Asesora-Email): si se cambia aquí y no en Make, ese prospecto ya no
 * le llega y se reparte a otra, sin error. Se mira si la persona:
 *   · entra en el reparto de algún campus (mismas reglas que `reparto.js`);
 *   · tiene prospectos asignados;
 *   · aparece por su correo en los envíos de Make.
 */
export async function avisoCambioCorreo(id) {
  const { rows: [r] } = await query(
    `SELECT u.email,
            (SELECT COUNT(*)::int FROM user_projects up
              WHERE up.user_id = u.id AND up.active = true
                AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))
                AND NOT COALESCE(u.gestor_colaboraciones, false)) AS campus_en_reparto,
            (SELECT COUNT(*)::int FROM leads l WHERE l.responsable_id = u.id) AS prospectos_asignados,
            (SELECT COUNT(*)::int FROM make_webhook_deliveries d
              WHERE LOWER(d.mapped->>'responsable_email') = LOWER(u.email)) AS envios_de_make
       FROM users u WHERE u.id = $1`,
    [id]
  );
  if (!r) return null;
  return {
    email: r.email,
    campusEnReparto: r.campus_en_reparto,
    prospectosAsignados: r.prospectos_asignados,
    enviosDeMake: r.envios_de_make,
    recibeProspectos: r.campus_en_reparto > 0 || r.prospectos_asignados > 0 || r.envios_de_make > 0,
  };
}

export async function getUserProjects(userId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.emoji, p.type
     FROM user_projects up JOIN projects p ON p.id = up.project_id
     WHERE up.user_id = $1 AND up.active = true AND p.active = true
     ORDER BY p.nombre`,
    [userId]
  );
  return rows;
}

export async function create({ nombre, email, passwordHash, role, roles_extra: rolesExtra = [], projectIds, projects, empresaIds = [], porUserId = null, setPasswordToken, setPasswordExpires }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO users (nombre, email, password_hash, role, roles_extra, set_password_token, set_password_expires)
       VALUES ($1, $2, $3, $4, $5::user_role[], $6, $7)
       RETURNING id, nombre, email, role, roles_extra::text[] AS roles_extra, active, created_at`,
      [nombre, email, passwordHash, role, limpiaRolesExtra(rolesExtra, role), setPasswordToken, setPasswordExpires]
    );
    const user = rows[0];

    const projectsList = Array.isArray(projects) && projects.length > 0
      ? projects.map((p) => ({ projectId: p.projectId ?? p.project_id, recibeLeads: !!(p.recibeLeads ?? p.recibe_leads) }))
      : (Array.isArray(projectIds) ? projectIds.map((pid) => ({ projectId: pid, recibeLeads: false })) : []);

    for (const { projectId, recibeLeads } of projectsList) {
      await client.query(
        `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
         VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2), $3)`,
        [user.id, projectId, recibeLeads]
      );
    }

    // La empresa entera (#220), en la misma transacción: sus campus de hoy
    // entran aquí, y si uno ya venía marcado arriba no se duplica.
    if (empresaIds?.length) await ponerEmpresas(client, user.id, empresaIds, porUserId);

    await client.query('COMMIT');
    return user;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function update(id, { nombre, role, roles_extra: rolesExtra, projectIds, projects, avatar_url, avatar_key,
  whatsapp_phone, whatsapp_display_name,
  factura_manager, editar_fechas_factura, gestor_colaboraciones, empresaIds, porUserId = null }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Cómo estaba, para el registro de permisos (#423).
    const previo = await quePermisosDecide(client, id, true);

    const sets = [];
    const params = [];
    let paramIdx = 1;

    if (nombre) { sets.push(`nombre = $${paramIdx++}`); params.push(nombre); }
    if (role) { sets.push(`role = $${paramIdx++}`); params.push(role); }
    // Los roles de mas. Se compara con undefined: una lista vacia SIGNIFICA
    // «quitaselos todos», y con `if (rolesExtra)` no se podria volver atras.
    if (rolesExtra !== undefined) {
      const principal = role || (await query('SELECT role FROM users WHERE id = $1', [id])).rows[0]?.role;
      sets.push(`roles_extra = $${paramIdx++}::user_role[]`);
      params.push(limpiaRolesExtra(rolesExtra, principal));
    }
    if (avatar_url !== undefined) { sets.push(`avatar_url = $${paramIdx++}`); params.push(avatar_url); }
    if (avatar_key !== undefined) { sets.push(`avatar_key = $${paramIdx++}`); params.push(avatar_key); }
    // Teléfono WhatsApp del gestor (cadena vacía → NULL para limpiar).
    if (whatsapp_phone !== undefined) { sets.push(`whatsapp_phone = $${paramIdx++}`); params.push(whatsapp_phone || null); }
    if (whatsapp_display_name !== undefined) { sets.push(`whatsapp_display_name = $${paramIdx++}`); params.push(whatsapp_display_name || null); }
    // Los permisos acotados. Se comparan con undefined y no por verdadero: si no,
    // desmarcar una casilla no la apagaria nunca.
    if (factura_manager !== undefined) { sets.push(`factura_manager = $${paramIdx++}`); params.push(!!factura_manager); }
    if (editar_fechas_factura !== undefined) { sets.push(`editar_fechas_factura = $${paramIdx++}`); params.push(!!editar_fechas_factura); }
    if (gestor_colaboraciones !== undefined) { sets.push(`gestor_colaboraciones = $${paramIdx++}`); params.push(!!gestor_colaboraciones); }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      params.push(id);
      await client.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params);
    }

    // Acepta el formato nuevo (projects: [{projectId, recibeLeads}]) o el
    // legacy (projectIds: number[]) — este segundo deja recibe_leads en FALSE
    // (comportamiento previo: solo gestores reciben leads).
    const projectsList = Array.isArray(projects) && projects.length > 0
      ? projects.map((p) => ({ projectId: p.projectId ?? p.project_id, recibeLeads: !!(p.recibeLeads ?? p.recibe_leads) }))
      : (Array.isArray(projectIds) ? projectIds.map((pid) => ({ projectId: pid, recibeLeads: false })) : null);

    if (projectsList) {
      await client.query(`UPDATE user_projects SET active = false WHERE user_id = $1`, [id]);
      for (const { projectId, recibeLeads } of projectsList) {
        await client.query(
          `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
           VALUES ($1, $2, (SELECT COALESCE(MAX(orden_cola), 0) + 1 FROM user_projects WHERE project_id = $2), $3)
           ON CONFLICT (user_id, project_id) DO UPDATE SET active = true, recibe_leads = EXCLUDED.recibe_leads`,
          [id, projectId, recibeLeads]
        );
      }
    }

    // Las empresas enteras (#220). DESPUÉS de los campus a propósito: si la
    // lista de arriba desmarcó uno de una empresa que sigue entera, aquí vuelve,
    // que es lo que dice la casilla. Quitar la empresa no quita sus campus.
    if (empresaIds !== undefined) await ponerEmpresas(client, id, empresaIds, porUserId);

    // Registro de permisos (#423): rol, roles de más y casillas, quién y cuándo.
    // En la misma transacción: si no se apunta, no se guarda.
    const ahora = await quePermisosDecide(client, id, false);
    for (const campo of Object.keys(ahora)) {
      if (JSON.stringify(previo?.[campo]) === JSON.stringify(ahora[campo])) continue;
      await registrarCambio(client, {
        quienId: porUserId, destino: 'usuario', usuarioId: id, clave: campo,
        antes: Array.isArray(previo?.[campo]) ? previo[campo].join(', ') : previo?.[campo],
        despues: Array.isArray(ahora[campo]) ? ahora[campo].join(', ') : ahora[campo],
        origen: 'usuarios',
      });
    }

    await client.query('COMMIT');

    return await findById(id);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Lo de una persona que decide qué puede hacer: su rol, sus roles de más y las casillas. */
async function quePermisosDecide(db, id, bloquear) {
  const { rows: [u] } = await db.query(
    `SELECT u.role::text AS role, COALESCE(u.roles_extra::text[], '{}') AS roles_extra,
            COALESCE(u.factura_manager, false) AS factura_manager,
            COALESCE(u.editar_fechas_factura, false) AS editar_fechas_factura,
            COALESCE(u.gestor_colaboraciones, false) AS gestor_colaboraciones,
            COALESCE((to_jsonb(u) ->> 'usa_whatsapp')::boolean, true) AS usa_whatsapp
       FROM users u WHERE u.id = $1 ${bloquear ? 'FOR UPDATE' : ''}`, [id]);
  if (!u) return null;
  return { rol: u.role, roles_extra: [...u.roles_extra].sort(), factura_manager: u.factura_manager,
    editar_fechas_factura: u.editar_fechas_factura, gestor_colaboraciones: u.gestor_colaboraciones, usa_whatsapp: u.usa_whatsapp };
}

export async function deactivate(id) {
  await query(`UPDATE users SET active = false, updated_at = NOW() WHERE id = $1`, [id]);
}

// Reset de contraseña por admin: fija el hash y anula cualquier token pendiente.
export async function setPasswordHash(id, passwordHash) {
  await query(
    `UPDATE users SET password_hash = $2, set_password_token = NULL, set_password_expires = NULL, updated_at = NOW()
     WHERE id = $1`,
    [id, passwordHash]
  );
}

export async function reactivate(id) {
  await query(`UPDATE users SET active = true, updated_at = NOW() WHERE id = $1`, [id]);
}

/**
 * El registro de actividad para la pantalla «Actividad» (`/activity`).
 *
 * Lo quitó sin querer el commit 02af73a (10/06), que copió este modelo del de
 * ISEIH para traer «Recibe leads»: ISEIH no tiene esta función y la ruta, el
 * controlador y la pantalla se quedaron llamando a algo que ya no existía (500
 * «userModel.listActivityLog is not a function»). La tabla no ha cambiado
 * desde la 001: `user_activity_log`, la misma que escriben auth, usuarios y
 * WhatsApp.
 *
 * `action` admite prefijo con LIKE («lead.%» trae todos los de prospectos).
 *
 * `ambito` acota a quien no ve el CRM entero (#245): su propia actividad y la
 * de quien comparte con él algún campus activo. Con EXISTS y no con JOIN a
 * `user_projects`: alguien con tres campus saldría tres veces y el total
 * contaría de más. `null` = todo (super admin y soporte, lo decide el
 * controlador). Una lista de campus vacía deja solo lo suyo, nunca «todo».
 */
export async function listActivityLog({
  userId = null, action = null, search = null, limit = 100, offset = 0, ambito = null,
} = {}) {
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];

  if (ambito) {
    where.push(`(a.user_id = ${p(ambito.userId)} OR EXISTS (
       SELECT 1 FROM user_projects up
        WHERE up.user_id = a.user_id AND up.active = true
          AND up.project_id = ANY(${p(ambito.projectIds || [])}::int[])))`);
  }
  if (userId) where.push(`a.user_id = ${p(userId)}`);
  if (action) where.push(action.includes('%') ? `a.action LIKE ${p(action)}` : `a.action = ${p(action)}`);
  if (search) {
    const s = p(`%${search}%`);
    where.push(`(u.nombre ILIKE ${s} OR u.email ILIKE ${s} OR a.action ILIKE ${s})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const filtros = params.slice();

  const { rows } = await query(
    `SELECT a.id, a.user_id, a.action, a.details, a.ip_address, a.created_at,
            u.nombre AS user_nombre, u.email AS user_email, u.role AS user_role
       FROM user_activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${p(limit)} OFFSET ${p(offset)}`,
    params
  );
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS total
       FROM user_activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}`,
    filtros
  );
  return { items: rows, total: countRows[0]?.total || 0 };
}
