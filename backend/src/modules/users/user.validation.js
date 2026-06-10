import { z } from 'zod';

const projectAssignmentSchema = z.object({
  projectId: z.number().int().positive(),
  recibeLeads: z.boolean().optional().default(false),
});

export const createUserSchema = z.object({
  nombre: z.string().min(2, 'Nombre minimo 2 caracteres').max(200),
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()),
  role: z.enum(['admin', 'gestor', 'soporte'], { message: 'Rol debe ser admin, gestor o soporte' }),
  // Legacy: lista de ids (recibe_leads queda en false).
  projectIds: z.array(z.number().int().positive()).optional().default([]),
  // Nuevo: lista con flag recibe_leads por proyecto.
  projects: z.array(projectAssignmentSchema).optional(),
});

export const updateUserSchema = z.object({
  nombre: z.string().min(2).max(200).optional(),
  role: z.enum(['admin', 'gestor', 'soporte']).optional(),
  projectIds: z.array(z.number().int().positive()).optional(),
  projects: z.array(projectAssignmentSchema).optional(),
});

export const listUsersSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  role: z.enum(['superadmin', 'admin', 'gestor', 'soporte']).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
