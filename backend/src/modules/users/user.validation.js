import { z } from 'zod';

const projectAssignmentSchema = z.object({
  projectId: z.number().int().positive(),
  recibeLeads: z.boolean().optional().default(false),
});

export const createUserSchema = z.object({
  nombre: z.string().min(2, 'Nombre minimo 2 caracteres').max(200),
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()),
  role: z.enum(['admin', 'gestor', 'soporte', 'tutor'], { message: 'Rol debe ser admin, gestor, soporte o tutor' }),
  // Legacy: lista de ids (recibe_leads queda en false).
  projectIds: z.array(z.number().int().positive()).optional().default([]),
  // Nuevo: lista con flag recibe_leads por proyecto.
  projects: z.array(projectAssignmentSchema).optional(),
});

export const updateUserSchema = z.object({
  nombre: z.string().min(2).max(200).optional(),
  role: z.enum(['admin', 'gestor', 'soporte', 'tutor']).optional(),
  projectIds: z.array(z.number().int().positive()).optional(),
  projects: z.array(projectAssignmentSchema).optional(),
  // Teléfono del gestor (WhatsApp): usado por el widget y para contacto.
  whatsapp_phone: z.string().max(30).nullable().optional().or(z.literal('')),
  whatsapp_display_name: z.string().max(120).nullable().optional().or(z.literal('')),
});

// Reset de contraseña por un superadmin (no requiere la contraseña actual).
export const adminSetPasswordSchema = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
});

export const listUsersSchema = z.object({
  active: z.enum(['true', 'false']).optional(),
  role: z.enum(['superadmin', 'admin', 'gestor', 'soporte', 'tutor']).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
