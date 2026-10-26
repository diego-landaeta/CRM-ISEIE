import { AppError } from '../../shared/utils/AppError.js';
import { veTodoElCrm } from '../../shared/utils/ambito.js';
import { query } from '../../shared/config/db.js';
import * as eqModel from './tasks.equipos.model.js';
import { permisosDe, ambitoDe } from './tasks.service.js';
import * as reglas from './tasks.reglas.js';

/*
  Gestionar los equipos del tablero (Diego, 26/10/2026): «Admin y superadmin
  pueden crear, renombrar y archivar equipos y gestionar sus miembros y
  encargados». Con la clave «Gestionar equipos» (tasks.manage_teams), y siempre
  dentro de SUS empresas: un admin de CEDIA no toca los equipos de ICTESS.
*/

const NO_ESTA = () => new AppError('Equipo no encontrado', 404, 'NOT_FOUND');

async function exigirTabla() {
  if (!(await eqModel.existeEquipos())) {
    throw new AppError('Falta aplicar la migración de equipos: todavía no hay equipos', 409, 'FALTA_MIGRACION');
  }
}

/** Las empresas de quien mira: `null` = todas (superadmin y soporte). */
async function empresasDe(user) {
  if (veTodoElCrm(user)) return null;
  return eqModel.empresasDeLosCampus(await ambitoDe(user));
}

async function exigirGestion(user) {
  await exigirTabla();
  const p = await permisosDe(user);
  if (!p.manageTeams) throw new AppError('No tienes permiso para gestionar los equipos', 403, 'FORBIDDEN');
  return p;
}

/** El equipo, si es de una empresa de quien mira; si no, no existe para él. */
async function equipoDeSuEmpresa(user, id) {
  const equipo = await eqModel.equipoPorId(id);
  if (!equipo) throw NO_ESTA();
  const empresas = await empresasDe(user);
  if (empresas && !empresas.includes(Number(equipo.issuer_id))) throw NO_ESTA();
  return equipo;
}

const conflicto = (err, mensaje) => {
  if (err?.code === '23505') return new AppError(mensaje, 409, 'DUPLICATE');
  return err;
};

/** Los equipos que se ven: quien gestiona o asigna en todos, los de sus empresas; el resto, los suyos. */
export async function listar(user, { gestion = false } = {}) {
  if (!(await eqModel.existeEquipos())) return [];
  const p = await permisosDe(user);
  const deTodos = p.manageTeams || reglas.esMando(p);
  return eqModel.listarEquipos({
    issuerIds: await empresasDe(user),
    soloDe: deTodos ? null : user.userId,
    incluirArchivados: gestion && p.manageTeams,
  });
}

/** Sus equipos y cargos (el tablero y «Mis preferencias»), y si puede delegar en cada uno. */
export async function mios(user) {
  const p = await permisosDe(user);
  const lista = await eqModel.equiposDeLaPersona(user.userId);
  return lista.map((e) => ({
    ...e,
    puede_delegar: reglas.esMando(p) || (e.nivel_min_cargos != null && e.nivel > e.nivel_min_cargos),
  }));
}

/** Las empresas en las que se puede crear un equipo. */
export async function empresas(user) {
  await exigirGestion(user);
  const ids = await empresasDe(user);
  const { rows } = await query(
    `SELECT id, razon_social FROM invoice_issuers
      WHERE activo AND project_id IS NULL AND ($1::int[] IS NULL OR id = ANY($1::int[]))
      ORDER BY razon_social`, [ids]);
  return rows;
}

export async function detalle(user, id) {
  await exigirTabla();
  const equipo = await equipoDeSuEmpresa(user, id);
  const p = await permisosDe(user);
  if (!p.manageTeams && !reglas.esMando(p) && (await reglas.nivelEn(id, user.userId)) == null) throw NO_ESTA();
  return { ...equipo, miembros: await eqModel.miembrosDe(id) };
}

export async function crear(user, datos) {
  await exigirGestion(user);
  const ids = await empresasDe(user);
  if (ids && !ids.includes(Number(datos.issuer_id))) throw new AppError('Esa empresa no es de las tuyas', 403, 'FORBIDDEN');
  try {
    return await eqModel.crearEquipo({ ...datos, created_by: user.userId });
  } catch (err) { throw conflicto(err, 'Ya hay un equipo con ese nombre en esa empresa'); }
}

export async function editar(user, id, campos) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, id);
  try {
    return await eqModel.actualizarEquipo(id, campos);
  } catch (err) { throw conflicto(err, 'Ya hay un equipo con ese nombre en esa empresa'); }
}

export async function crearCargo(user, teamId, datos) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, teamId);
  try {
    return await eqModel.crearCargo(teamId, datos);
  } catch (err) { throw conflicto(err, 'Ese equipo ya tiene un cargo con ese nombre'); }
}

export async function editarCargo(user, teamId, roleId, campos) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, teamId);
  const cargo = await eqModel.cargoPorId(teamId, roleId);
  if (!cargo) throw new AppError('Cargo no encontrado', 404, 'NOT_FOUND');
  if (campos.is_active === false && await eqModel.miembrosConCargo(roleId) > 0) {
    throw new AppError('Ese cargo lo tiene alguien del equipo: cámbiale el cargo antes de archivarlo', 409, 'EN_USO');
  }
  try {
    return await eqModel.actualizarCargo(teamId, roleId, campos);
  } catch (err) { throw conflicto(err, 'Ese equipo ya tiene un cargo con ese nombre'); }
}

export async function candidatos(user, teamId) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, teamId);
  return eqModel.candidatosDe(teamId);
}

/** Meter a alguien en el equipo, o cambiarle el cargo. */
export async function ponerMiembro(user, teamId, userId, { team_role_id: roleId }) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, teamId);
  const cargo = await eqModel.cargoPorId(teamId, roleId);
  if (!cargo || !cargo.is_active) throw new AppError('Ese cargo no es de este equipo o está archivado', 400, 'VALIDATION_ERROR');
  const { rows: [persona] } = await query(
    `SELECT id, active, (role::text = ANY($2::text[]) OR roles_extra::text[] && $2::text[]) AS con_tablero FROM users WHERE id = $1`,
    [userId, ['superadmin', 'admin', 'colaborador']]);
  if (!persona || !persona.active || !persona.con_tablero) {
    throw new AppError('Esa persona no existe, está inactiva o no tiene tablero de tareas', 400, 'VALIDATION_ERROR');
  }
  if (!(await eqModel.esDeLaEmpresa(teamId, userId))) {
    throw new AppError('Esa persona no es de la empresa del equipo', 400, 'VALIDATION_ERROR');
  }
  await eqModel.ponerMiembro(teamId, userId, roleId, user.userId);
  return eqModel.miembrosDe(teamId);
}

export async function quitarMiembro(user, teamId, userId) {
  await exigirGestion(user);
  await equipoDeSuEmpresa(user, teamId);
  if (!(await eqModel.quitarMiembro(teamId, userId))) throw new AppError('Esa persona no está en el equipo', 404, 'NOT_FOUND');
  return eqModel.miembrosDe(teamId);
}
