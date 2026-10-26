import { z } from 'zod';
import * as service from './permissions.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { catalogoParaPantalla } from './catalogo.js';
import * as editar from './permissions.editar.js';

const customRoleSchema = z.object({
  label:       z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_role:   z.enum(['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador']).default('gestor'),
  permissions: z.record(z.boolean()).default({}),
});

const overridesSchema = z.array(z.object({
  resource: z.string().min(1),
  action:   z.string().min(1),
  allowed:  z.boolean(),
}));

export async function getCatalogo(_req, res, next) {
  try {
    res.json({ success: true, data: catalogoParaPantalla() });
  } catch (err) { next(err); }
}

export async function getSystemDefaults(req, res, next) {
  try {
    res.json({ success: true, data: await service.getSystemDefaults() });
  } catch (err) { next(err); }
}

// Solo las claves de Tareas que se editan por rol, cada una con verdadero o falso.
const rolePermissionsSchema = z.object({
  permissions: z.record(z.boolean()).refine(
    (p) => Object.keys(p).length > 0 && Object.keys(p).every((k) => service.CLAVES_EDITABLES.includes(k)),
    { message: `Solo se pueden cambiar los permisos de Tareas: ${service.CLAVES_EDITABLES.join(', ')}` }
  ),
});

const ROL_NO_EDITABLE = 'Ese rol no se puede editar: el superadmin lo puede todo y el tutor no tiene tablero';

export async function getRolePermissions(req, res, next) {
  try {
    const data = await service.getRoleTaskPermissions(req.params.roleKey);
    if (!data) throw new AppError(ROL_NO_EDITABLE, 400, 'ROLE_NOT_EDITABLE');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function saveRolePermissions(req, res, next) {
  try {
    const parsed = rolePermissionsSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const data = await service.saveRoleTaskPermissions(req.params.roleKey, parsed.data.permissions, req.user);
    if (!data) throw new AppError(ROL_NO_EDITABLE, 400, 'ROLE_NOT_EDITABLE');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ── Una clave suelta por rol y por persona: «Diplomas (Certifex) · Ver» (#223) ──

const claveDeRolSchema = z.object({ permitido: z.boolean() });
// null = sin excepción: la persona tiene lo que diga su rol.
const claveDePersonaSchema = z.object({ permitido: z.boolean().nullable() });

export async function getClaveDeRol(req, res, next) {
  try {
    res.json({ success: true, data: await service.getClaveDeRol(req.params.clave, req.params.roleKey) });
  } catch (err) { next(err); }
}

export async function setClaveDeRol(req, res, next) {
  try {
    const parsed = claveDeRolSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Di si se le da o no (permitido: sí o no)', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await service.setClaveDeRol(
      req.params.clave, req.params.roleKey, parsed.data.permitido, req.user) });
  } catch (err) { next(err); }
}

export async function personasDeLaClave(req, res, next) {
  try {
    res.json({ success: true, data: await service.personasDeLaClave(
      req.params.clave, String(req.query.roleKey || ''), req.user) });
  } catch (err) { next(err); }
}

export async function setClaveDePersona(req, res, next) {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isInteger(userId) || userId <= 0) throw new AppError('userId inválido', 400, 'INVALID_ID');
    const parsed = claveDePersonaSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError('Di si se le da, se le quita o queda como su rol (permitido: sí, no o null)', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await service.setClaveDePersona(
      req.params.clave, userId, parsed.data.permitido, req.user) });
  } catch (err) { next(err); }
}

export async function listCustomRoles(req, res, next) {
  try {
    const roles = await service.listCustomRoles();
    res.json({ success: true, data: roles });
  } catch (err) { next(err); }
}

export async function getCustomRole(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT id, label, description, base_role, permissions, active, created_at FROM custom_roles WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError('Rol no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}

export async function createCustomRole(req, res, next) {
  try {
    const parsed = customRoleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const d = parsed.data;
    // Por el mismo camino que la pantalla de Roles (#423): con su registro.
    const role = await editar.crearRolAMedida(
      { nombre: d.label, descripcion: d.description ?? null, base: d.base_role, permisos: d.permissions }, req.user);
    res.status(201).json({ success: true, data: role });
  } catch (err) { next(err); }
}

export async function updateCustomRole(req, res, next) {
  try {
    // Sin `.default()`: lo que no se manda no se toca (antes un PUT con solo el
    // nombre devolvía el rol base a «gestor» y vaciaba sus permisos).
    const parsed = z.object({
      label: z.string().min(1).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
      base_role: z.enum(['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador']).optional(),
      permissions: z.record(z.boolean()).optional(),
      active: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const d = parsed.data;
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) throw new AppError('Rol no encontrado', 404, 'NOT_FOUND');
    const role = await editar.guardarRolAMedida(id,
      { nombre: d.label, descripcion: d.description, base: d.base_role, activo: d.active, permisos: d.permissions }, req.user);
    res.json({ success: true, data: role });
  } catch (err) { next(err); }
}

export async function deleteCustomRole(req, res, next) {
  try {
    const result = await editar.borrarRolAMedida(parseInt(req.params.id, 10), req.user);
    if (result.error === 'HAS_USERS') {
      throw new AppError('No se puede eliminar un rol que tiene usuarios asignados', 409, 'ROLE_HAS_USERS');
    }
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getUserPermissions(req, res, next) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId) || userId <= 0) throw new AppError('userId inválido', 400, 'INVALID_ID');
    // Con las reglas de la ficha (#423): un admin, solo gente de sus campus.
    const f = await editar.fichaDePermisos(userId, req.user);
    res.json({
      success: true,
      data: {
        user: { id: f.persona.id, nombre: f.persona.nombre, role: f.persona.role, custom_role_id: f.rolAMedida?.id ?? null },
        overrides: await service.getUserPermissions(userId),
        permissions: f.mapa,
      },
    });
  } catch (err) { next(err); }
}

export async function saveUserPermissions(req, res, next) {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId) || userId <= 0) throw new AppError('userId inválido', 400, 'INVALID_ID');
    const parsed = overridesSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    // Sustituye todas sus excepciones, como antes, pero por el camino de la
    // ficha (#423): en una transacción, con sus reglas y con registro.
    const nuevas = Object.fromEntries(parsed.data.map((o) => [`${o.resource}.${o.action}`, o.allowed]));
    const actuales = await service.getUserPermissions(userId);
    const cambios = { ...Object.fromEntries(actuales.map((o) => [`${o.resource}.${o.action}`, null])), ...nuevas };
    await editar.guardarExcepciones(userId, cambios, req.user);
    res.json({ success: true });
  } catch (err) { next(err); }
}

const viewSchema = z.object({
  default_route:        z.string().optional(),
  hidden_sidebar_items: z.array(z.string()).optional(),
  dashboard_widgets:    z.array(z.string()).optional(),
  compact_sidebar:      z.boolean().optional(),
});

// GET /api/permissions/role-views/:roleKey
export async function getRoleView(req, res, next) {
  try {
    const data = await service.getRoleView(req.params.roleKey);
    if (!data) throw new AppError('Rol no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// PUT /api/permissions/role-views/:roleKey (solo custom roles)
export async function setRoleView(req, res, next) {
  try {
    const id = parseInt(req.params.roleKey);
    if (isNaN(id)) throw new AppError('Solo roles custom son editables (pasa el id numérico)', 400, 'SYSTEM_ROLE_READONLY');
    const parsed = viewSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    const updated = await service.setCustomRoleView(id, parsed.data);
    if (!updated) throw new AppError('Rol custom no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}
