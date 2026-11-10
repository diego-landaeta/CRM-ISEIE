import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { registrarCambio } from '../permissions/permissions.model.js';

/*
  EQUIPO COMERCIAL DE UNA ADMINISTRADORA (Carlos, 09/11/2026; migración 274).

  «Raquel pasa a ser administradora como Daniela: no recibe leads y puede ver
  los leads y la gestión de las diferentes compañeras. Raquel podrá ver sus
  comerciales asignadas (pueden variar).»

  Aquí se lee y se cambia QUIÉN lleva a quién. Lo que eso deja ver lo decide
  `alcanceComercial` (shared/utils/roles.js), en cada petición, sin caché que
  vaciar: cambiar el equipo surte efecto en la siguiente.

  Solo pueden estar en un equipo personas activas que lleven prospectos
  (gestora o project manager, como rol principal o de más) y que compartan al
  menos un campus con la líder. Ella misma, no.
*/

const COMERCIALES = ['gestor', 'project_manager'];

const ES_COMERCIAL = `(u.role::text = ANY($ROL::text[]) OR u.roles_extra::text[] && $ROL::text[])`;

/** Las gestoras de un equipo, con su nombre (también las ya desactivadas). */
export async function gestorasDe(liderId, db = { query }) {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active, ec.creado_at
       FROM equipo_comercial ec JOIN users u ON u.id = ec.gestora_id
      WHERE ec.lider_id = $1
      ORDER BY u.nombre`, [liderId]);
  return rows;
}

/**
 * Quién puede entrar en el equipo de esa persona: comerciales activas que
 * comparten algún campus con ella. Con los campus que comparten, para que la
 * pantalla lo diga.
 */
export async function candidatasPara(liderId, db = { query }) {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.role,
            ARRAY_AGG(DISTINCT p.nombre ORDER BY p.nombre) AS campus
       FROM users u
       JOIN user_projects suyo ON suyo.user_id = u.id AND suyo.active
       JOIN user_projects mio ON mio.project_id = suyo.project_id AND mio.active AND mio.user_id = $1
       JOIN projects p ON p.id = suyo.project_id
      WHERE u.active = true AND u.id <> $1
        AND ${ES_COMERCIAL.replace(/\$ROL/g, '$2')}
      GROUP BY u.id, u.nombre, u.role
      ORDER BY u.nombre`, [liderId, COMERCIALES]);
  return rows;
}

async function liderDe(liderId, db = { query }) {
  const { rows: [u] } = await db.query('SELECT id, nombre, role, active FROM users WHERE id = $1', [liderId]);
  if (!u) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
  return u;
}

/** Lo que enseña la ficha: la líder, sus gestoras y quién más podría entrar. */
export async function equipoComercial(liderId) {
  const lider = await liderDe(liderId);
  const [gestoras, candidatas] = await Promise.all([gestorasDe(liderId), candidatasPara(liderId)]);
  return {
    lider: { id: lider.id, nombre: lider.nombre, role: lider.role },
    gestoraIds: gestoras.map((g) => g.id),
    gestoras,
    candidatas,
  };
}

/**
 * Cambia el equipo entero de una vez, en una transacción. Lo que ya estaba se
 * queda con su fecha; lo que sobra se quita. Queda apuntado en el registro de
 * permisos (Configuración › Usuarios › la ficha › historial).
 */
export async function ponerEquipoComercial(liderId, gestoraIds, porUserId) {
  const ids = [...new Set(gestoraIds.map(Number))];
  if (ids.includes(Number(liderId))) {
    throw new AppError('No puede tenerse a sí misma en su equipo', 400, 'NO_A_SI_MISMA');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await liderDe(liderId, client);

    if (ids.length) {
      const validas = new Set((await candidatasPara(liderId, client)).map((c) => Number(c.id)));
      const fuera = ids.filter((id) => !validas.has(id));
      if (fuera.length) {
        throw new AppError(
          `No se puede añadir ${fuera.length === 1 ? 'a la persona' : 'a las personas'} ${fuera.join(', ')}: `
          + 'tiene que estar activa, llevar prospectos (gestora o project manager) y compartir algún campus con ella.',
          400, 'GESTORA_NO_VALIDA');
      }
    }

    const antes = await gestorasDe(liderId, client);
    await client.query(
      'DELETE FROM equipo_comercial WHERE lider_id = $1 AND NOT (gestora_id = ANY($2::int[]))', [liderId, ids]);
    if (ids.length) {
      await client.query(
        `INSERT INTO equipo_comercial (lider_id, gestora_id, creado_por)
         SELECT $1, g, $3 FROM UNNEST($2::int[]) AS g
         ON CONFLICT (lider_id, gestora_id) DO NOTHING`, [liderId, ids, porUserId]);
    }
    const despues = await gestorasDe(liderId, client);

    const lista = (filas) => filas.map((g) => `${g.nombre} (#${g.id})`).join(', ') || null;
    if (lista(antes) !== lista(despues)) {
      await registrarCambio(client, {
        quienId: porUserId, destino: 'usuario', usuarioId: Number(liderId), clave: 'equipo_comercial',
        antes: lista(antes), despues: lista(despues), origen: 'usuarios',
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return equipoComercial(liderId);
}
