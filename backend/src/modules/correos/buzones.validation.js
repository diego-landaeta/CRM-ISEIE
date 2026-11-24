import { z } from 'zod';
import { puertoPermitido, MOTIVO_PUERTO } from '../../shared/services/correo-destino.js';

/**
 * Los buzones de correo que lee la Bandeja (CRM#1032).
 *
 * Con Hostinger el usuario ES la dirección del buzón, así que `usuario` es
 * opcional: si no viene, se usa `direccion`. El servidor y el puerto traen los
 * de Hostinger por defecto.
 */

// Un nombre de servidor, sin esquema ni ruta: «imap.hostinger.com». Ni
// espacios ni barras, para que nadie cuele una URL.
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

const host = z.string().trim().toLowerCase().max(253)
  .regex(HOST, 'El servidor tiene que ser un nombre como imap.hostinger.com');
// Solo los de IMAP (993 TLS, 143 STARTTLS): ver `correo-destino.js`.
const puerto = z.coerce.number().int().min(1).max(65535)
  .refine((p) => puertoPermitido(p), MOTIVO_PUERTO);
const idOpcional = z.coerce.number().int().positive().nullable().optional();

export const crearBuzonSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre al buzón').max(120),
  direccion: z.string().trim().toLowerCase().email('La dirección del buzón no es válida').max(255),
  usuario: z.string().trim().max(255).optional().or(z.literal('')),
  clave: z.string().min(1, 'Falta la contraseña del buzón').max(500),
  host: host.default('imap.hostinger.com'),
  puerto: puerto.default(993),
  project_id: idOpcional,
  empresa_id: idOpcional,
});

/**
 * Cambiar uno. La contraseña, el servidor y el usuario solo se tocan si vienen:
 * el formulario los deja en blanco a propósito, para no devolver un secreto.
 */
export const cambiarBuzonSchema = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  direccion: z.string().trim().toLowerCase().email('La dirección del buzón no es válida').max(255).optional(),
  usuario: z.string().trim().max(255).optional().or(z.literal('')),
  clave: z.string().max(500).optional().or(z.literal('')),
  host: host.optional().or(z.literal('')),
  puerto: puerto.optional(),
  project_id: idOpcional,
  empresa_id: idOpcional,
});

/** «Probar conexión» con lo que hay escrito en el formulario, sin guardarlo. */
export const probarBuzonSchema = z.object({
  direccion: z.string().trim().toLowerCase().email().max(255).optional().or(z.literal('')),
  usuario: z.string().trim().max(255).optional().or(z.literal('')),
  clave: z.string().max(500).optional().or(z.literal('')),
  host: host.optional().or(z.literal('')),
  puerto: puerto.optional(),
});

export const sincronizarSchema = z.object({
  buzonId: z.coerce.number().int().positive().nullable().optional(),
}).passthrough();
