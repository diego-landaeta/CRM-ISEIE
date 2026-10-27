import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/*
  UN ADMIN CON LA EMPRESA ENTERA (#220)

  Diego, 10/10: «Un admin puede tener los proyectos futuros, pero de SU empresa:
  mayormente los admin son por empresa». No es un superadmin: no ve otras
  empresas ni gestiona usuarios.

  La empresa es la sociedad emisora del campus (`projects.sociedad_emisora_id`),
  la misma que agrupa el selector de la cabecera y que usa `ambito.js`.

  POR QUÉ NO SE TOCA NINGUNA CONSULTA DE ACCESO. El acceso sigue saliendo de
  `user_projects`, que leen cientos de sitios —`projectAccess`, `ambito.js`, el
  MCP, el reparto—. `user_empresas` solo dice qué empresas enteras tiene un
  admin, y sirve para mantener `user_projects` al día:

    · al marcar la casilla se le añaden todos los campus que la empresa tiene hoy;
    · al crear un campus en la empresa, o al pasarle uno, se le añade a esos
      admins en la misma transacción (`darCampusALosAdminsDeSuEmpresa`);
    · al quitarla, sus `user_projects` se quedan como están: deja de llegarle lo
      nuevo y ya. Quitarle campus es otra decisión, y se toma campus a campus.

  Solo cuenta el rol PRINCIPAL `admin`, el mismo criterio que `projectAccess`:
  una gestora con «admin» añadido no recibe campus por esta vía.
*/

const MIGRACION = '203';

let hayTabla = false;

/**
 * Si la migración ya está aplicada. Aquí las migraciones se escriben y las
 * aplica Diego al desplegar: hasta entonces guardar un usuario o crear un
 * proyecto NO puede fallar por esto. Se recuerda solo el «sí»: una tabla no
 * desaparece, y así no hace falta reiniciar para enterarse de que ya está.
 */
export async function existeTablaEmpresas(db = { query }) {
  if (hayTabla) return true;
  const { rows } = await db.query(`SELECT to_regclass('public.user_empresas') IS NOT NULL AS hay`);
  hayTabla = rows[0]?.hay === true;
  if (!hayTabla) logger.warn(`Usuarios: falta la migracion ${MIGRACION}; la casilla de empresa entera no se guarda todavia`);
  return hayTabla;
}

/** Solo para las pruebas. */
export function olvidarTabla() { hayTabla = false; }

/** Las empresas enteras de una persona. `null` si falta la migración: la pantalla lo distingue. */
export async function empresasDelUsuario(userId) {
  if (!(await existeTablaEmpresas())) return null;
  const { rows } = await query(
    'SELECT issuer_id FROM user_empresas WHERE user_id = $1 ORDER BY issuer_id', [userId]);
  return rows.map((r) => Number(r.issuer_id));
}

/**
 * Antes de guardar: que la migración esté y que las empresas existan. Son las
 * mismas que ofrece el selector de proyectos (`listSociedades`).
 */
export async function comprobarEmpresas(ids) {
  if (!ids?.length) return;
  if (!(await existeTablaEmpresas())) {
    throw new AppError(`Falta aplicar la migración ${MIGRACION}: todavía no se puede dar una empresa entera.`, 409, 'FALTA_MIGRACION');
  }
  const { rows } = await query(
    `SELECT id FROM invoice_issuers
      WHERE id = ANY($1::int[]) AND project_id IS NULL AND activo = true`,
    [ids]
  );
  const hay = new Set(rows.map((r) => Number(r.id)));
  const faltan = ids.filter((id) => !hay.has(Number(id)));
  if (faltan.length) {
    throw new AppError(`No existe la empresa ${faltan.join(', ')}`, 400, 'EMPRESA_DESCONOCIDA');
  }
}

/**
 * Deja las empresas enteras de un admin en `ids` y le da los campus de hoy.
 *
 * Va DENTRO de la transacción del alta o de la edición (`client`): si algo
 * falla, no se queda la casilla marcada sin los campus ni al revés.
 *
 * Las que se quitan solo salen de `user_empresas`. Sus campus, no.
 */
export async function ponerEmpresas(client, userId, ids, porUserId = null) {
  const lista = [...new Set((ids || []).map(Number))];
  await client.query(
    'DELETE FROM user_empresas WHERE user_id = $1 AND NOT (issuer_id = ANY($2::int[]))',
    [userId, lista]
  );
  if (!lista.length) return { campusAnadidos: 0 };
  await client.query(
    `INSERT INTO user_empresas (user_id, issuer_id, creado_por)
     SELECT $1, e, $3 FROM unnest($2::int[]) AS e
     ON CONFLICT (user_id, issuer_id) DO NOTHING`,
    [userId, lista, porUserId]
  );
  // Un colaborador (el equipo de desarrollo, 26/10/2026) es de la empresa, no de
  // sus campus: la empresa le vale para el tablero de tareas, y NO se le dan
  // campus (no tiene por qué ver nada de cada uno). Solo el admin los recibe.
  const { rows: [u] } = await client.query('SELECT role FROM users WHERE id = $1', [userId]);
  if (u?.role !== 'admin') return { campusAnadidos: 0 };
  // Todos los campus de la empresa, también los inactivos: el login ya filtra
  // `p.active`, y si uno se reactiva el admin lo tiene sin hacer nada.
  // El reparto no se toca: entra sin `recibe_leads`, como cualquier admin.
  const r = await client.query(
    `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
     SELECT $1, p.id,
            (SELECT COALESCE(MAX(up.orden_cola), 0) + 1 FROM user_projects up WHERE up.project_id = p.id),
            false
       FROM projects p
      WHERE p.sociedad_emisora_id = ANY($2::int[])
     ON CONFLICT (user_id, project_id) DO UPDATE SET active = true
     RETURNING project_id`,
    [userId, lista]
  );
  return { campusAnadidos: r.rowCount ?? r.rows?.length ?? 0 };
}

/**
 * Un campus nuevo en una empresa —o uno que pasa a ella—: a los admins que la
 * tienen entera se les añade, en la misma transacción que el proyecto.
 *
 * Solo admins ACTIVOS con el rol principal `admin`. Si la migración no está,
 * no hace nada: crear un proyecto no puede fallar por esto.
 *
 * Devuelve a quién se le ha añadido.
 */
export async function darCampusALosAdminsDeSuEmpresa(client, projectId) {
  if (!(await existeTablaEmpresas(client))) return [];
  const { rows } = await client.query(
    `INSERT INTO user_projects (user_id, project_id, orden_cola, recibe_leads)
     SELECT ue.user_id, p.id,
            (SELECT COALESCE(MAX(up.orden_cola), 0) FROM user_projects up WHERE up.project_id = p.id)
              + ROW_NUMBER() OVER (ORDER BY ue.user_id),
            false
       FROM projects p
       JOIN user_empresas ue ON ue.issuer_id = p.sociedad_emisora_id
       JOIN users u ON u.id = ue.user_id AND u.role = 'admin' AND u.active = true
      WHERE p.id = $1
     ON CONFLICT (user_id, project_id) DO UPDATE SET active = true
     RETURNING user_id`,
    [projectId]
  );
  return rows.map((r) => Number(r.user_id));
}
