// Configuración › Roles y la ficha de permisos de cada persona (#423, fase 3).
import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import * as editar from './permissions.editar.js';
import * as model from './permissions.model.js';

const permisosSchema = z.record(z.boolean());
const ROLES_BASE = ['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador'];

const rolAMedidaSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle nombre al rol').max(100),
  descripcion: z.string().max(500).nullable().optional(),
  base: z.enum(ROLES_BASE).optional(),
  activo: z.boolean().optional(),
  permisos: permisosSchema.optional(),
});

const idDe = (v) => {
  const id = Number.parseInt(v, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Identificador no válido', 400, 'INVALID_ID');
  return id;
};
const validar = (schema, body) => {
  const r = schema.safeParse(body);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
};

// GET /api/permissions/roles
export async function roles(_req, res, next) {
  try { res.json({ success: true, data: await editar.listarRoles() }); } catch (err) { next(err); }
}

// PUT /api/permissions/roles/fijos/:rol   { permisos: { clave: bool } }
export async function guardarRolFijo(req, res, next) {
  try {
    const { permisos } = validar(z.object({ permisos: permisosSchema }), req.body);
    res.json({ success: true, data: await editar.guardarRolFijo(req.params.rol, permisos, req.user) });
  } catch (err) { next(err); }
}

// POST /api/permissions/roles/a-medida
export async function crearRolAMedida(req, res, next) {
  try {
    const d = validar(rolAMedidaSchema, req.body);
    res.status(201).json({ success: true, data: await editar.crearRolAMedida(d, req.user) });
  } catch (err) { next(err); }
}

// PATCH /api/permissions/roles/a-medida/:id
export async function guardarRolAMedida(req, res, next) {
  try {
    const d = validar(rolAMedidaSchema.partial(), req.body);
    res.json({ success: true, data: await editar.guardarRolAMedida(idDe(req.params.id), d, req.user) });
  } catch (err) { next(err); }
}

// GET /api/permissions/personas/:id — lo suyo, cualquiera; lo de otro, con permiso.
export async function ficha(req, res, next) {
  try {
    const id = idDe(req.params.id);
    if (id !== req.user.userId && !(await tienePermiso(req, 'users.view', 'users.excepciones'))) {
      throw new AppError('No tienes permiso para esta accion', 403, 'FORBIDDEN');
    }
    res.json({ success: true, data: await editar.fichaDePermisos(id, req.user) });
  } catch (err) { next(err); }
}

// PUT /api/permissions/personas/:id/excepciones   { cambios: { clave: true | false | null } }
export async function guardarExcepciones(req, res, next) {
  try {
    const { cambios } = validar(z.object({ cambios: z.record(z.boolean().nullable()) }), req.body);
    res.json({ success: true, data: await editar.guardarExcepciones(idDe(req.params.id), cambios, req.user) });
  } catch (err) { next(err); }
}

// PUT /api/permissions/personas/:id/rol-a-medida   { customRoleId: number | null }
export async function cambiarRolAMedida(req, res, next) {
  try {
    const { customRoleId } = validar(z.object({ customRoleId: z.number().int().positive().nullable() }), req.body);
    res.json({ success: true, data: await editar.cambiarRolAMedida(idDe(req.params.id), customRoleId, req.user) });
  } catch (err) { next(err); }
}

// GET /api/permissions/registro?rol=&customRoleId=
export async function registro(req, res, next) {
  try {
    const rol = req.query.rol ? String(req.query.rol) : null;
    const customRoleId = req.query.customRoleId ? idDe(req.query.customRoleId) : null;
    res.json({ success: true, data: await model.leerRegistro({ rol, customRoleId, limite: 200 }) });
  } catch (err) { next(err); }
}
