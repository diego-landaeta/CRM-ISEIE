/**
 * Cambiar permisos: lo que trae un rol, los roles a medida y lo de cada
 * persona (#423, fase 3). Todo deja su apunte en `permisos_registro` en la
 * misma transacción.
 *
 * QUIÉN PUEDE QUÉ (Diego, #423):
 *   - Un rol fijo, un rol a medida, la vista de un rol: valen para todas las
 *     empresas → quien tenga `roles.edit` (de serie, el admin y el superadmin:
 *     Diego, 26/10, «los admin siguen pudiendo, como hasta hoy»), y nunca
 *     poniéndole a un rol lo que él mismo no tiene.
 *   - Lo de una persona —sus excepciones y su rol a medida—: quien tenga
 *     `users.excepciones`, y si no es superadmin, solo a gente que comparta
 *     algún campus con él (como #384), nunca a un admin ni a un superadmin, y
 *     nunca más de lo que él mismo tiene: dar lo que no se tiene es la puerta
 *     para dárselo a uno mismo por otra persona.
 *   - Lo que el catálogo marca `nunca` para un rol no se da ni con excepción.
 */
import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as model from './permissions.model.js';
import { explicarPermisos, olvidarPermisos } from './permissions.service.js';
import { ACCIONES, CLAVES, POR_CLAVE, ROLES_FIJOS, valoresPorDefecto, vetada } from './catalogo.js';
import { permisosDelRol, permisosDelRolAMedida, resolverPermisos } from './resolver.js';
import { tieneRol } from '../../shared/utils/roles.js';

const SERIE = valoresPorDefecto();
const ROLES_EDITABLES = ROLES_FIJOS.map((r) => r.clave).filter((r) => r !== 'superadmin');

async function enTransaccion(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    // Lo recordado de cualquiera ya no vale: un rol o una excepción cambian lo
    // que puede alguien (o muchos).
    olvidarPermisos();
    return r;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Nadie le pone a un rol lo que él no tiene (Diego, 26/10: los admin siguen
 * cambiando roles, «pero se mantiene que nadie puede dar más de lo que tiene»).
 * Solo cuenta lo que el rol GANA: quitar no es dar, y lo que el rol ya traía se
 * puede dejar como está aunque quien lo cambia no lo tenga.
 */
async function exigirQueElRolNoGaneLoQueNoTienes(quien, antes, despues, db) {
  if (quien.role === 'superadmin') return;
  const mios = (await explicarPermisos(quien.userId, db))?.mapa || {};
  const deMas = ACCIONES.filter((x) => despues[x.clave] === true && antes[x.clave] !== true && mios[x.clave] !== true)
    .map((x) => x.nombre);
  if (deMas.length) {
    throw new AppError(`No puedes ponerle a un rol lo que tú no tienes: ${deMas.slice(0, 3).join(', ')}${deMas.length > 3 ? '…' : ''}`, 403, 'NO_LO_TIENES');
  }
}

function soloClavesDelCatalogo(permisos) {
  const fuera = Object.keys(permisos || {}).filter((k) => !CLAVES.has(k));
  if (fuera.length) throw new AppError(`Esos permisos no existen: ${fuera.join(', ')}`, 400, 'CLAVE_DESCONOCIDA');
}

/* ─── Roles ───────────────────────────────────────────────────────────── */

/** Los roles fijos y los a medida, cada uno con lo que trae y cuánta gente lo tiene. */
export async function listarRoles() {
  const ajustes = await model.ajustesDeRoles();
  const [{ rows: cuantos }, roles] = await Promise.all([
    query(`SELECT role::text AS role, custom_role_id, COUNT(*)::int AS n FROM users WHERE active GROUP BY 1, 2`),
    model.findAllCustomRoles(),
  ]);
  const personasDe = (r) => cuantos.filter((c) => c.role === r && !c.custom_role_id).reduce((a, c) => a + c.n, 0);
  return {
    fijos: ROLES_FIJOS.map((r) => ({
      clave: r.clave, nombre: r.nombre, descripcion: r.descripcion,
      permisos: permisosDelRol(r.clave, ajustes),
      cambiados: ajustes.filter((a) => a.role === r.clave).map((a) => `${a.resource}.${a.action}`),
      personas: personasDe(r.clave),
      editable: r.clave !== 'superadmin',
    })),
    aMedida: roles.map((cr) => ({
      id: cr.id, nombre: cr.label, descripcion: cr.description, base: cr.base_role || 'gestor', activo: cr.active !== false,
      permisos: permisosDelRolAMedida(cr, ajustes),
      cambiados: Object.keys(cr.permissions || {}).filter((k) => CLAVES.has(k)),
      personas: cuantos.filter((c) => c.custom_role_id === cr.id).reduce((a, c) => a + c.n, 0),
    })),
  };
}

/**
 * Deja un rol fijo con exactamente estos permisos. Se guarda solo lo que se
 * aparta de su valor de serie (tabla 197); lo demás vuelve a lo de serie.
 */
export async function guardarRolFijo(rol, permisos, quien) {
  if (!ROLES_EDITABLES.includes(rol)) throw new AppError('Ese rol no se cambia (el superadmin lo tiene todo)', 400, 'ROLE_NOT_EDITABLE');
  soloClavesDelCatalogo(permisos);
  return enTransaccion(async (db) => {
    const ajustes = await model.ajustesDeRoles(db);
    const antes = permisosDelRol(rol, ajustes);
    const deseado = { ...antes, ...permisos };
    await exigirQueElRolNoGaneLoQueNoTienes(quien, antes,
      Object.fromEntries(ACCIONES.map((x) => [x.clave, deseado[x.clave] === true])), db);
    await db.query('DELETE FROM role_permission_overrides WHERE role = $1', [rol]);
    for (const x of ACCIONES) {
      const v = deseado[x.clave] === true;
      if (v !== (SERIE[rol]?.[x.clave] === true)) {
        await db.query(
          `INSERT INTO role_permission_overrides (role, resource, action, allowed, updated_by) VALUES ($1, $2, $3, $4, $5)`,
          [rol, x.recurso, x.accion, v, quien.userId]);
      }
      if (v !== antes[x.clave]) {
        await model.registrarCambio(db, { quienId: quien.userId, destino: 'rol', rol, clave: x.clave, antes: antes[x.clave], despues: v, origen: 'pantalla_roles' });
      }
    }
    return permisosDelRol(rol, await model.ajustesDeRoles(db));
  });
}

/** Crea un rol a medida a partir de un rol fijo. */
export async function crearRolAMedida({ nombre, descripcion = null, base = 'gestor', permisos = {} }, quien) {
  if (!ROLES_EDITABLES.includes(base)) throw new AppError('Un rol a medida parte de un rol fijo (no del superadmin)', 400, 'BASE_NO_VALIDA');
  soloClavesDelCatalogo(permisos);
  return enTransaccion(async (db) => {
    const ajustes = await model.ajustesDeRoles(db);
    const delBase = permisosDelRol(base, ajustes);
    const diferencias = Object.fromEntries(Object.entries(permisos).filter(([k, v]) => (v === true) !== delBase[k]).map(([k, v]) => [k, v === true]));
    // Lo que trae de su rol base no es «darlo»: eso ya lo tiene el rol fijo.
    // Lo que se le marca de más, sí.
    await exigirQueElRolNoGaneLoQueNoTienes(quien, delBase, { ...delBase, ...diferencias }, db);
    const { rows: [cr] } = await db.query(
      `INSERT INTO custom_roles (label, description, base_role, permissions) VALUES ($1, $2, $3, $4)
       RETURNING id, label, description, base_role, permissions, active`,
      [nombre, descripcion, base, JSON.stringify(diferencias)]);
    await model.registrarCambio(db, { quienId: quien.userId, destino: 'rol_medida', customRoleId: cr.id, clave: 'creado', despues: `${nombre} (parte de ${base})`, origen: 'pantalla_roles' });
    for (const [k, v] of Object.entries(diferencias)) {
      await model.registrarCambio(db, { quienId: quien.userId, destino: 'rol_medida', customRoleId: cr.id, clave: k, antes: delBase[k], despues: v, origen: 'pantalla_roles' });
    }
    return cr;
  });
}

/** Cambia un rol a medida: nombre, descripción, rol base, activo y/o sus permisos. */
export async function guardarRolAMedida(id, { nombre, descripcion, base, activo, permisos }, quien) {
  if (permisos) soloClavesDelCatalogo(permisos);
  if (base !== undefined && !ROLES_EDITABLES.includes(base)) throw new AppError('Un rol a medida parte de un rol fijo', 400, 'BASE_NO_VALIDA');
  return enTransaccion(async (db) => {
    const { rows: [cr] } = await db.query('SELECT id, label, description, base_role, permissions, active FROM custom_roles WHERE id = $1 FOR UPDATE', [id]);
    if (!cr) throw new AppError('Ese rol no existe', 404, 'NOT_FOUND');
    const ajustes = await model.ajustesDeRoles(db);
    const antes = permisosDelRolAMedida(cr, ajustes);
    const nuevaBase = base ?? cr.base_role ?? 'gestor';
    const delBase = permisosDelRol(nuevaBase, ajustes);
    const deseado = { ...antes, ...(permisos || {}) };
    const diferencias = Object.fromEntries(ACCIONES.filter((x) => deseado[x.clave] !== delBase[x.clave]).map((x) => [x.clave, deseado[x.clave] === true]));
    // Con el rol base nuevo incluido: cambiarle la base también le da lo que trae.
    await exigirQueElRolNoGaneLoQueNoTienes(quien, antes,
      permisosDelRolAMedida({ ...cr, base_role: nuevaBase, permissions: diferencias }, ajustes), db);
    const { rows: [nuevo] } = await db.query(
      `UPDATE custom_roles SET label = $2, description = $3, base_role = $4, active = $5, permissions = $6, updated_at = NOW()
        WHERE id = $1 RETURNING id, label, description, base_role, permissions, active`,
      [id, nombre ?? cr.label, descripcion === undefined ? cr.description : descripcion, nuevaBase, activo ?? cr.active, JSON.stringify(diferencias)]);
    const reg = (clave, a, d) => model.registrarCambio(db, { quienId: quien.userId, destino: 'rol_medida', customRoleId: id, clave, antes: a, despues: d, origen: 'pantalla_roles' });
    if (nuevaBase !== (cr.base_role || 'gestor')) await reg('base', cr.base_role, nuevaBase);
    if (activo !== undefined && activo !== cr.active) await reg('activo', cr.active, activo);
    if (nombre !== undefined && nombre !== cr.label) await reg('nombre', cr.label, nombre);
    const despues = permisosDelRolAMedida(nuevo, ajustes);
    for (const x of ACCIONES) if (despues[x.clave] !== antes[x.clave]) await reg(x.clave, antes[x.clave], despues[x.clave]);
    return nuevo;
  });
}

/* ─── Personas ────────────────────────────────────────────────────────── */

/**
 * ¿Puede `quien` tocar los permisos de `userId`? Lanza 404 si no es de los
 * suyos (no se confirma que exista) y 403 si es de su campus pero no le toca.
 */
async function exigirQuePuedaTocar(quien, persona, db) {
  if (quien.role === 'superadmin') return;
  if (!persona || !(await model.compartenCampus(quien.userId, persona.id, db))) {
    throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  }
  const suyos = [persona.role, ...(persona.roles_extra || [])];
  if (suyos.includes('superadmin') || suyos.includes('admin')) {
    throw new AppError('Los permisos de un admin los cambia el superadmin', 403, 'FORBIDDEN');
  }
  if (persona.id === quien.userId) throw new AppError('Tus propios permisos te los cambia otra persona', 403, 'FORBIDDEN');
}

/** Lo mismo, por su id: para quien cambia el rol de alguien desde Usuarios. */
export async function exigirQuePuedaTocarA(quien, userId) {
  if (quien.role === 'superadmin') return;
  const datos = await model.datosDePermisos(userId);
  await exigirQuePuedaTocar(quien, datos?.usuario);
}

/**
 * Nadie da lo que no tiene (QA de Diego, punto 7): al dar de alta a alguien o
 * cambiarle el rol o los roles de más, todo lo que GANE tiene que tenerlo
 * quien lo cambia, como con las excepciones y el rol a medida. `userId` null
 * es un alta: no tenía nada. Lo que ya tenía no cuenta (quitar no es dar), ni
 * lo `propia` del catálogo (sus cursos, su factura: un admin da de alta a un tutor).
 */
export async function exigirQueNoDeMasDeLoQueTiene(quien, userId, { role, roles_extra }) {
  if (quien.role === 'superadmin') return;
  // Diego, 26/10: soporte SIGUE dando de alta admins, gestoras y colaboradores,
  // como hasta hoy. Solo en el ALTA (userId null) y solo esos roles: cambiarle
  // el rol a alguien que ya existe sigue las reglas de siempre.
  if (!userId && puedeDarDeAltaComoSoporte(quien, { role, roles_extra })) return;
  const datos = userId ? await model.datosDePermisos(userId) : null;
  const ajustesRol = datos ? datos.ajustesRol : await model.ajustesDeRoles();
  const comoEs = datos
    ? { role: datos.usuario.role, roles_extra: datos.usuario.roles_extra, customRole: datos.customRole, excepciones: datos.excepciones }
    : { role: null, roles_extra: [], customRole: null, excepciones: {} };
  const antes = datos ? resolverPermisos({ ...comoEs, ajustesRol }).mapa : {};
  const despues = resolverPermisos({
    ...comoEs, ajustesRol, role: role ?? comoEs.role, roles_extra: roles_extra ?? comoEs.roles_extra,
  }).mapa;
  const mios = (await explicarPermisos(quien.userId)).mapa;
  const deMas = ACCIONES.filter((x) => !x.propia && despues[x.clave] && !antes[x.clave] && !mios[x.clave]).map((x) => x.nombre);
  if (deMas.length) {
    throw new AppError(`Ese rol le daría lo que tú no tienes: ${deMas.slice(0, 3).join(', ')}${deMas.length > 3 ? '…' : ''}`, 403, 'NO_LO_TIENES');
  }
}

/**
 * Las altas que soporte hace aunque el rol nuevo traiga lo que soporte no tiene
 * (Diego, 26/10, punto 3). Exportada para la prueba.
 */
export const ALTAS_DE_SOPORTE = ['admin', 'gestor', 'colaborador'];
export function puedeDarDeAltaComoSoporte(quien, { role, roles_extra = [] }) {
  if (!tieneRol(quien, 'soporte')) return false;
  const pedidos = [role, ...(roles_extra || [])].filter(Boolean);
  // Lo que no es de la lista (otro soporte, un tutor) sigue la regla general.
  return pedidos.length > 0 && pedidos.every((r) => ALTAS_DE_SOPORTE.includes(r) || r === 'soporte');
}

/** Todo lo que puede una persona y de dónde le viene, para su ficha. */
export async function fichaDePermisos(userId, quien) {
  const e = await explicarPermisos(userId);
  if (!e) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  const propia = Number(userId) === Number(quien.userId);
  if (!propia && quien.role !== 'superadmin' && !(await model.compartenCampus(quien.userId, userId))) {
    throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  }
  let puedeEditar = false;
  if (!propia) {
    const mios = await explicarPermisos(quien.userId);
    if (mios?.mapa['users.excepciones']) {
      try { await exigirQuePuedaTocar(quien, e.persona); puedeEditar = true; } catch { puedeEditar = false; }
    }
  }
  const roles = await model.findAllCustomRoles();
  return {
    persona: { id: e.persona.id, nombre: e.persona.nombre, email: e.persona.email, role: e.persona.role, roles_extra: e.persona.roles_extra, active: e.persona.active },
    mapa: e.mapa,
    origenes: e.origenes,
    excepciones: Object.fromEntries(Object.entries(e.excepciones).filter(([k]) => CLAVES.has(k))),
    rolAMedida: e.customRole ? { id: e.customRole.id, nombre: e.customRole.label, activo: e.customRole.active !== false } : null,
    rolesAMedida: roles.filter((r) => r.active !== false).map((r) => ({ id: r.id, nombre: r.label, base: r.base_role })),
    registro: await model.leerRegistro({ usuarioId: userId, limite: 50 }),
    puedeEditar,
  };
}

/**
 * Cambia excepciones de una persona: `{ clave: true | false | null }` (null =
 * como diga su rol). Solo las claves que se mandan; las demás, igual.
 */
export async function guardarExcepciones(userId, cambios, quien) {
  soloClavesDelCatalogo(cambios);
  return enTransaccion(async (db) => {
    const datos = await model.datosDePermisos(userId, db);
    const persona = datos?.usuario;
    await exigirQuePuedaTocar(quien, persona, db);
    const antes = (await explicarPermisos(userId, db)).mapa;
    const mios = quien.role === 'superadmin' ? null : (await explicarPermisos(quien.userId, db)).mapa;
    const susRoles = [persona.role, ...persona.roles_extra];
    for (const [clave, valor] of Object.entries(cambios)) {
      const x = POR_CLAVE[clave];
      if (valor === true && vetada(x, persona.role, persona.roles_extra)) {
        throw new AppError(`«${x.nombre}» no se le puede dar a quien es ${susRoles.join(' y ')}`, 400, 'NUNCA');
      }
      if (valor === true && mios && mios[clave] !== true) {
        throw new AppError(`No puedes dar «${x.nombre}»: tú no lo tienes`, 403, 'NO_LO_TIENES');
      }
      const [resource, action] = [x.recurso, x.accion];
      if (valor === null || valor === undefined) {
        await db.query('DELETE FROM user_permission_overrides WHERE user_id = $1 AND resource = $2 AND action = $3', [userId, resource, action]);
      } else {
        await db.query(
          `INSERT INTO user_permission_overrides (user_id, resource, action, allowed, updated_by, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (user_id, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
          [userId, resource, action, valor === true, quien.userId]);
      }
    }
    const despues = (await explicarPermisos(userId, db)).mapa;
    for (const clave of Object.keys(cambios)) {
      const exAntes = datos.excepciones[clave];
      const exDespues = cambios[clave];
      if ((exAntes ?? null) === (exDespues ?? null) && antes[clave] === despues[clave]) continue;
      await model.registrarCambio(db, {
        quienId: quien.userId, destino: 'usuario', usuarioId: userId, clave,
        antes: exAntes === undefined ? `como su rol (${antes[clave] ? 'sí' : 'no'})` : (exAntes ? 'sí' : 'no'),
        despues: exDespues === null || exDespues === undefined ? `como su rol (${despues[clave] ? 'sí' : 'no'})` : (exDespues ? 'sí' : 'no'),
        origen: 'ficha_usuario',
      });
    }
    return despues;
  });
}

/** Le pone (o le quita, con null) un rol a medida a una persona. */
export async function cambiarRolAMedida(userId, customRoleId, quien) {
  return enTransaccion(async (db) => {
    const datos = await model.datosDePermisos(userId, db);
    await exigirQuePuedaTocar(quien, datos?.usuario, db);
    let nuevo = null;
    if (customRoleId !== null) {
      const { rows: [cr] } = await db.query('SELECT id, label, description, base_role, permissions, active FROM custom_roles WHERE id = $1', [customRoleId]);
      if (!cr || cr.active === false) throw new AppError('Ese rol a medida no existe o está desactivado', 400, 'ROL_NO_VALIDO');
      nuevo = cr;
      if (quien.role !== 'superadmin') {
        // Nadie da un rol que trae más de lo que él tiene.
        const mios = (await explicarPermisos(quien.userId, db)).mapa;
        const trae = permisosDelRolAMedida(cr, datos.ajustesRol);
        const deMas = ACCIONES.filter((x) => trae[x.clave] && !mios[x.clave]).map((x) => x.nombre);
        if (deMas.length) throw new AppError(`Ese rol trae lo que tú no tienes: ${deMas.slice(0, 3).join(', ')}${deMas.length > 3 ? '…' : ''}`, 403, 'NO_LO_TIENES');
      }
    }
    await db.query('UPDATE users SET custom_role_id = $2, updated_at = NOW() WHERE id = $1', [userId, customRoleId]);
    await model.registrarCambio(db, {
      quienId: quien.userId, destino: 'usuario', usuarioId: userId, clave: 'rol_a_medida',
      antes: datos.customRole?.label ?? null, despues: nuevo?.label ?? null, origen: 'ficha_usuario',
    });
    return (await explicarPermisos(userId, db)).mapa;
  });
}

/** Borra un rol a medida que nadie tiene. Si alguien lo tiene, no. */
export async function borrarRolAMedida(id, quien) {
  return enTransaccion(async (db) => {
    const { rows: [cr] } = await db.query('SELECT id, label FROM custom_roles WHERE id = $1 FOR UPDATE', [id]);
    if (!cr) return { ok: true };
    const { rows: alguien } = await db.query('SELECT 1 FROM users WHERE custom_role_id = $1 LIMIT 1', [id]);
    if (alguien.length) return { error: 'HAS_USERS' };
    // El apunte antes de borrar: la fila del registro guarda el id y, al
    // borrarse el rol, se queda con el nombre en `antes`.
    await model.registrarCambio(db, { quienId: quien.userId, destino: 'rol_medida', customRoleId: id, clave: 'borrado', antes: cr.label, origen: 'pantalla_roles' });
    await db.query('DELETE FROM custom_roles WHERE id = $1', [id]);
    return { ok: true };
  });
}
