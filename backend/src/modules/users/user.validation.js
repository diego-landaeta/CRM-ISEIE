import { z } from 'zod';
import { contrasenaNueva } from '../auth/auth.validation.js';

// El correo de otro, solo el super admin (#248). Igual que al crear: sin
// espacios y en minúsculas.
export const correoSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email('Email invalido').max(255)
);

const projectAssignmentSchema = z.object({
  projectId: z.number().int().positive(),
  recibeLeads: z.boolean().optional().default(false),
});

export const createUserSchema = z.object({
  nombre: z.string().min(2, 'Nombre minimo 2 caracteres').max(200),
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()),
  role: z.enum(['admin', 'gestor', 'soporte', 'tutor'], { message: 'Rol debe ser admin, gestor, soporte o tutor' }),
  // Roles de MAS. Superadmin no cabe: un rol añadido no puede dar acceso total.
  roles_extra: z.array(z.enum(['admin', 'gestor', 'soporte', 'tutor'])).optional(),
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
  // Solo lo acepta el super admin (lo comprueba el controlador): #248.
  email: correoSchema.optional(),
  // Con el correo nuevo, mandarle el enlace para poner contraseña allí (#246).
  // A un tutor no le sale nada mientras siga el freno.
  reenviarEnlace: z.boolean().optional(),
  role: z.enum(['admin', 'gestor', 'soporte', 'tutor']).optional(),
  roles_extra: z.array(z.enum(['admin', 'gestor', 'soporte', 'tutor'])).optional(),
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
// #248: las mismas reglas que «Establece tu contraseña», y repetida.
export const adminSetPasswordSchema = z.object({
  password: contrasenaNueva,
  confirmPassword: z.string().min(1, 'Repite la contraseña'),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
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
