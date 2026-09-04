import { z } from 'zod';

/**
 * Los servicios que se pueden guardar.
 *
 * Esta lista tiene que ir a la par con el enum `api_service` de la base
 * (migracion 137). Son dos sitios y no hay forma de compartirlos: si aqui falta
 * uno, el endpoint contesta 400 aunque la base lo admita — que es lo que pasaba
 * con los cuatro de abajo.
 *
 * Los cuatro ultimos son los que la #80 pide traer del .env.
 */
const SERVICES = [
  'meta', 'google_ads', 'gsc', 'stripe', 'claude', 'brevo',
  'woocommerce', 'evolution', 'r2', 'make',
];

/** Produccion o pruebas. Por defecto produccion, que es lo que habia hasta la #80. */
const ENTORNOS = ['produccion', 'pruebas'];

export const upsertCredentialSchema = z.object({
  project_id: z.number().int().positive().nullable().optional(),
  service: z.enum(SERVICES),
  value: z.string().min(4, 'Valor muy corto').max(10000),
  entorno: z.enum(ENTORNOS).optional().default('produccion'),
  metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export const listCredentialsSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  service: z.enum(SERVICES).optional(),
  entorno: z.enum(ENTORNOS).optional(),
});

export const SERVICIOS = SERVICES;
