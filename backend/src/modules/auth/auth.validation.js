import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password requerido'),
});

// Las reglas de una contraseña nueva, las de «Establece tu contraseña». Las usa
// también el super admin al ponérsela a otro (#248): las mismas en todas partes.
export const contrasenaNueva = z
  .string()
  .min(8, 'Minimo 8 caracteres')
  .max(200)
  .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
  .regex(/[0-9]/, 'Debe contener al menos un numero');

export const setPasswordSchema = z.object({
  token: z.string().min(1, 'Token requerido'),
  password: contrasenaNueva,
  // Opcional: que las dos coincidan lo comprueba la pantalla. Si se exige y la
  // pantalla no la manda, cualquier contraseña da «Required» y, al octavo
  // intento, «Demasiados intentos» (ISEIE, 02/10, la invitación de Vlad).
  // Si viene, tiene que coincidir.
  confirmPassword: z.string().optional(),
}).refine((data) => data.confirmPassword === undefined || data.password === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
});

// Cambio de contrasena por el propio usuario (sesion activa).
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Contrasena actual requerida'),
  newPassword: z
    .string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
    .regex(/[0-9]/, 'Debe contener al menos un numero'),
  confirmPassword: z.string().min(1, 'Confirmacion requerida'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Las contrasenas no coinciden',
  path: ['confirmPassword'],
}).refine((data) => data.newPassword !== data.currentPassword, {
  message: 'La nueva contrasena debe ser distinta a la actual',
  path: ['newPassword'],
});

// Auto-actualizacion del propio perfil (nombre solamente; email no cambiable).
export const updateMyProfileSchema = z.object({
  nombre: z.string().min(2, 'Nombre muy corto').max(200),
});

// El propio correo, solo para tutores (#246, Diego 09/10).
export const updateMyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo no válido').max(255),
});
