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
import { ACCIONES, CLAVES, POR_CLAVE, ROLES_FIJOS, explicarRoturas, roturasNuevas, valoresPorDefecto, vetada } from './catalogo.js';
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

/**
 * «Requiere» también en el servidor (Diego, #752): lo que se guarda no puede
 * dejar un permiso marcado sin lo que necesita (`dependencias` del catálogo).
 * Se mira el resultado FINAL —el rol con sus ajustes, la persona con su rol,
 * su rol a medida y sus excepciones—, no solo lo que se manda, y en los dos
 * sentidos: marcar «Editar prospectos» sin «Ver prospectos», y quitar «Ver
 * prospectos» dejando «Editar prospectos». Solo cuenta lo que rompe ESTE
 * cambio: lo que ya venía roto se deja estar (`roturasNuevas`).
 */
export const FALTA_REQUISITO = 'FALTA_REQUISITO';
function exigirDependencias(antes, despues) {
  const roturas = roturasNuevas(antes, despues);
  if (!roturas.length) return;
  throw new AppError(explicarRoturas(roturas), 400, FALTA_REQUISITO,
    { roturas: roturas.map((r) => ({ ...r, nombre: POR_CLAVE[r.clave].nombre, faltaNombre: POR_CLAVE[r.falta].nombre })) });
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
    const final = permisosDelRol(rol, await model.ajustesDeRoles(db));
    exigirDependencias(antes, final);
    return final;
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
    // Lo que trae roto su rol base no es cosa de este rol; lo que le rompen sus diferencias, sí.
    exigirDependencias(delBase, permisosDelRolAMedida({ base_role: base, permissions: diferencias }, ajustes));
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
    exigirDependencias(antes, despues);
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
  const deMas = await loQueDariaDeMas(quien, userId, { role, roles_extra });
  if (!deMas.length) return;
  if (deMas.includes(SOPORTE_SOLO_SUPERADMIN)) {
    throw new AppError('El rol soporte lo da el superadmin', 403, 'SOPORTE_SOLO_SUPERADMIN',
      { faltan: deMas, cuantos: 1, roles: ['soporte'] });
  }
  // Qué rol quitar (Tony, 03/11: cinco intentos sin saber cuál sobraba). Cada
  // rol pedido, mirado solo; si ninguno falla solo, es la suma de los añadidos.
  const extras = (roles_extra || []).filter((r) => r && r !== role);
  const culpables = [];
  if (role && (await loQueDariaDeMas(quien, userId, { role, roles_extra: [] })).length) culpables.push(role);
  for (const r of extras) {
    if ((await loQueDariaDeMas(quien, userId, { role: null, roles_extra: [r] })).length) culpables.push(r);
  }
  throw new AppError(
    `Ese rol le daría lo que tú no tienes: ${deMas.slice(0, 3).join(', ')}${deMas.length > 3 ? '…' : ''}`,
    403, 'NO_LO_TIENES', { faltan: deMas.slice(0, 3), cuantos: deMas.length, roles: culpables.length ? culpables : extras });
}

/**
 * La misma regla, sin lanzar: lo que GANARÍA la persona y quien la cambia no
 * tiene (nombres del catálogo). Vacía = se puede. `pre` ahorra repetir lo de
 * quien pregunta cuando se mira rol por rol (`rolesAsignables`).
 */
export async function loQueDariaDeMas(quien, userId, { role, roles_extra }, pre = {}) {
  if (quien.role === 'superadmin') return [];
  // Diego, 26/10: soporte SIGUE dando de alta admins, gestoras y colaboradores,
  // como hasta hoy. Solo en el ALTA (userId null) y solo esos roles: cambiarle
  // el rol a alguien que ya existe sigue las reglas de siempre.
  if (!userId && puedeDarDeAltaComoSoporte(quien, { role, roles_extra })) return [];
  const datos = userId ? await model.datosDePermisos(userId) : null;
  const ajustesRol = datos ? datos.ajustesRol : (pre.ajustesRol ?? await model.ajustesDeRoles());
  const comoEs = datos
    ? { role: datos.usuario.role, roles_extra: datos.usuario.roles_extra, customRole: datos.customRole, excepciones: datos.excepciones }
    : { role: null, roles_extra: [], customRole: null, excepciones: {} };
  const antes = datos ? resolverPermisos({ ...comoEs, ajustesRol }).mapa : {};
  const despues = resolverPermisos({
    ...comoEs, ajustesRol, role: role ?? comoEs.role, roles_extra: roles_extra ?? comoEs.roles_extra,
  }).mapa;
  const mios = pre.mios ?? (await explicarPermisos(quien.userId)).mapa;
  const deMas = ACCIONES.filter((x) => !x.propia && despues[x.clave] && !antes[x.clave] && !mios[x.clave]).map((x) => x.nombre);
  if (deMas.length) return deMas;
  // El rol soporte ve TODAS las empresas. Lo da el superadmin (y soporte, en
  // el alta, arriba); un admin de empresa no, aunque con excepciones llegue a
  // tener todos los permisos que trae: lo que no cabe en el catálogo es el
  // alcance, y soporte es justo eso.
  if (!tieneRol(quien, 'soporte') && [role, ...(roles_extra || [])].includes('soporte')) {
    const yaLoEra = [datos?.usuario?.role, ...(datos?.usuario?.roles_extra || [])].includes('soporte');
    if (!yaLoEra) return [SOPORTE_SOLO_SUPERADMIN];
  }
  return [];
}

/** Lo que sale en «le faltaría» cuando un admin intenta dar el rol soporte. */
export const SOPORTE_SOLO_SUPERADMIN = 'El rol soporte (lo da el superadmin)';

/**
 * Para el formulario de alta (Tony, 03/11): qué roles puede dar quien pregunta,
 * como principal y como añadido, y si no, los tres primeros permisos que le
 * faltan. Sale de `loQueDariaDeMas`: la regla es la misma que al guardar.
 */
export async function rolesAsignables(quien) {
  const pre = { ajustesRol: await model.ajustesDeRoles(), mios: (await explicarPermisos(quien.userId))?.mapa || {} };
  const fila = (deMas) => ({ puede: deMas.length === 0, faltan: deMas.slice(0, 3), cuantos: deMas.length });
  const roles = [];
  for (const r of ROLES_FIJOS) {
    const principal = fila(await loQueDariaDeMas(quien, null, { role: r.clave, roles_extra: [] }, pre));
    // Superadmin no se da como añadido (el formulario no lo ofrece): lo mismo que como principal.
    const anadido = r.clave === 'superadmin'
      ? principal
      : fila(await loQueDariaDeMas(quien, null, { role: null, roles_extra: [r.clave] }, pre));
    roles.push({ rol: r.clave, nombre: r.nombre, principal, anadido });
  }
  return roles;
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
 * #694 · Lo que tendría alguien que todavía no existe: con este rol, estos
 * roles de más y estas excepciones. Es lo que enseña el alta de Usuarios
 * antes de crear a la persona, con el mismo «de dónde le viene» que su ficha.
 * `puedeEditar`: si quien pregunta puede poner excepciones (`users.excepciones`).
 * `misPermisos`: lo que tiene él, para que la pantalla no ofrezca dar lo que
 * no tiene (el servidor lo vuelve a comprobar al crear).
 */
export async function vistaPreviaDeAlta({ role, roles_extra = [], excepciones = {}, projectIds = [] }, quien) {
  soloClavesDelCatalogo(excepciones);
  const ajustesRol = await model.ajustesDeRoles();
  const { mapa, origenes } = resolverPermisos({ role, roles_extra, excepciones, ajustesRol });
  const mios = quien.role === 'superadmin' ? null : ((await explicarPermisos(quien.userId))?.mapa || {});
  const tieneElPermiso = mios ? mios['users.excepciones'] === true : true;
  // Revisión de la #698: la misma regla que `exigirExcepcionesDeAlta`. Si la
  // persona nueva es admin, sus excepciones solo las pone el superadmin; la
  // pantalla no las ofrece para luego dar 403 al crear.
  const esAdmin = [role, ...(roles_extra || [])].some((r) => r === 'admin' || r === 'superadmin');
  const deAdmin = tieneElPermiso && Boolean(mios) && esAdmin;
  // Con el permiso, pero sin un campus suyo todavía elegido: se dice por qué no.
  const sinCampus = tieneElPermiso && !deAdmin && !(await campusSuyoEnElAlta(quien, projectIds));
  return {
    mapa, origenes,
    puedeEditar: tieneElPermiso && !deAdmin && !sinCampus,
    motivo: deAdmin ? ADMIN_SOLO_SUPERADMIN : (sinCampus ? SIN_CAMPUS_SUYO : null),
    misPermisos: mios ? Object.keys(mios).filter((k) => mios[k] === true) : null,
  };
}

/**
 * #694 · ¿Lleva el alta algún campus de quien da de alta? Sus permisos solo los
 * toca quien comparte campus con ella (`exigirQuePuedaTocar`), y una persona sin
 * campus no es de los suyos: sin esto, el alta de un tutor o un colaborador sin
 * campus se creaba, sus excepciones fallaban con «Usuario no encontrado» y se
 * borraba. El superadmin, siempre.
 */
const SIN_CAMPUS_SUYO = 'Para darle permisos, ponle primero uno de tus campus.';
const ADMIN_SOLO_SUPERADMIN = 'Los permisos de un admin los cambia el superadmin.';

export async function campusSuyoEnElAlta(quien, projectIds = []) {
  if (quien.role === 'superadmin') return true;
  const ids = [...new Set((projectIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return false;
  const { rows } = await query(
    'SELECT 1 FROM user_projects WHERE user_id = $1 AND active AND project_id = ANY($2::int[]) LIMIT 1',
    [quien.userId, ids]);
  return rows.length > 0;
}

/** Los campus de un alta, vengan como `projectIds` o como `projects` (`{ projectId }`). */
export function campusDelAlta({ projectIds = [], projects = [] } = {}) {
  return [...(projectIds || []), ...(projects || []).map((p) => p?.projectId)];
}

/**
 * #694 · Las excepciones de un alta, comprobadas ANTES de crear a nadie, con
 * las mismas reglas que `guardarExcepciones`: que existan en el catálogo, que
 * su rol pueda tenerlas, que quien da tenga lo que da, y que los permisos de
 * un admin solo los toque el superadmin. Así el alta no se queda a medias.
 */
export async function exigirExcepcionesDeAlta(quien, { role, roles_extra = [], projectIds = [] }, cambios) {
  soloClavesDelCatalogo(cambios);
  if (!Object.keys(cambios || {}).length) return;
  const suyos = [role, ...(roles_extra || [])];
  if (quien.role !== 'superadmin' && (suyos.includes('superadmin') || suyos.includes('admin'))) {
    throw new AppError('Los permisos de un admin los cambia el superadmin', 403, 'FORBIDDEN');
  }
  if (!(await campusSuyoEnElAlta(quien, projectIds))) throw new AppError(SIN_CAMPUS_SUYO, 400, 'SIN_CAMPUS_SUYO');
  const mios = quien.role === 'superadmin' ? null : ((await explicarPermisos(quien.userId))?.mapa || {});
  for (const [clave, valor] of Object.entries(cambios)) {
    const x = POR_CLAVE[clave];
    if (valor === true && vetada(x, role, roles_extra)) {
      throw new AppError(`«${x.nombre}» no se le puede dar a quien es ${suyos.filter(Boolean).join(' y ')}`, 400, 'NUNCA');
    }
    if (valor === true && mios && mios[clave] !== true) {
      throw new AppError(`No puedes dar «${x.nombre}»: tú no lo tienes`, 403, 'NO_LO_TIENES');
    }
  }
}

/**
 * Cambia excepciones de una persona: `{ clave: true | false | null }` (null =
 * como diga su rol). Solo las claves que se mandan; las demás, igual.
 */
export async function guardarExcepciones(userId, cambios, quien, { origen = 'ficha_usuario' } = {}) {
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
    exigirDependencias(antes, despues);
    for (const clave of Object.keys(cambios)) {
      const exAntes = datos.excepciones[clave];
      const exDespues = cambios[clave];
      if ((exAntes ?? null) === (exDespues ?? null) && antes[clave] === despues[clave]) continue;
      await model.registrarCambio(db, {
        quienId: quien.userId, destino: 'usuario', usuarioId: userId, clave,
        antes: exAntes === undefined ? `como su rol (${antes[clave] ? 'sí' : 'no'})` : (exAntes ? 'sí' : 'no'),
        despues: exDespues === null || exDespues === undefined ? `como su rol (${despues[clave] ? 'sí' : 'no'})` : (exDespues ? 'sí' : 'no'),
        // 'alta_usuario' cuando vienen con el alta (#694): así no se confunden con una edición posterior.
        origen,
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
