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

// Los permisos acotados de facturacion y colaboraciones.
//
// Existian en la base y se comprobaban en el codigo, pero NO se podian dar desde
// ninguna pantalla: este esquema no los admitia. Por eso Ana Comercial llevaba
// desde su alta sin poder cambiar la fecha de una factura — no fue una decision,
// es que no habia forma de marcarselo ni de ver que le faltaba.
//
// Van aparte del rol a proposito: ser `gestor` no basta para decidir quien
// factura. Vanessa lo es y no debe.
export const updateUserSchema = z.object({
  nombre: z.string().min(2).max(200).optional(),
  role: z.enum(['admin', 'gestor', 'soporte', 'tutor']).optional(),
  factura_manager: z.boolean().optional(),
  editar_fechas_factura: z.boolean().optional(),
  gestor_colaboraciones: z.boolean().optional(),
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
  // La pantalla de Usuarios los pide expresamente; el resto de listas no.
  incluirTodos: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
