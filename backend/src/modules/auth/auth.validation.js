import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()),
  password: z.string().min(1, 'Password requerido'),
});

export const setPasswordSchema = z.object({
  token: z.string().min(1, 'Token requerido'),
  password: z
    .string()
    .min(8, 'Minimo 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayuscula')
    .regex(/[0-9]/, 'Debe contener al menos un numero'),
  confirmPassword: z.string().min(1, 'Confirmacion requerida'),
}).refine((data) => data.password === data.confirmPassword, {
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
