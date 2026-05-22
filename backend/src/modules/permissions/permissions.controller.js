import { z } from 'zod';
import * as service from './permissions.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';

const customRoleSchema = z.object({
  label:       z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  base_role:   z.enum(['admin', 'gestor', 'soporte']).default('gestor'),
  permissions: z.record(z.boolean()).default({}),
});

const overridesSchema = z.array(z.object({
  resource: z.string().min(1),
  action:   z.string().min(1),
  allowed:  z.boolean(),
}));

export async function getSystemDefaults(req, res) {
  res.json({ success: true, data: service.getSystemDefaults() });
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
    const role = await service.createCustomRole(parsed.data);
    res.status(201).json({ success: true, data: role });
  } catch (err) { next(err); }
}

export async function updateCustomRole(req, res, next) {
  try {
    const parsed = customRoleSchema.partial().safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const role = await service.updateCustomRole(req.params.id, parsed.data);
    if (!role) throw new AppError('Rol no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: role });
  } catch (err) { next(err); }
}

export async function deleteCustomRole(req, res, next) {
  try {
    const result = await service.deleteCustomRole(req.params.id);
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
    const { rows } = await query(
      `SELECT id, nombre, role, custom_role_id FROM users WHERE id = $1`,
      [userId]
    );
    if (!rows[0]) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');

    const user = rows[0];
    const [overrides, permissionsMap] = await Promise.all([
      service.getUserPermissions(userId),
      service.buildPermissionsMap(userId, user.role, user.custom_role_id),
    ]);

    res.json({
      success: true,
      data: {
        user: { id: user.id, nombre: user.nombre, role: user.role, custom_role_id: user.custom_role_id },
        overrides,
        permissions: permissionsMap,
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

    await service.saveUserPermissions(userId, parsed.data);
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
