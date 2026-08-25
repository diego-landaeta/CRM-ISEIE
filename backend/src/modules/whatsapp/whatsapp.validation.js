import { z } from 'zod';

export const createSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  label: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  // Por defecto compartida: una plantilla que solo ve quien la escribe no
  // arregla el problema que veniamos a resolver.
  ambito: z.enum(['compartida', 'personal']).default('compartida'),
});

export const updateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  orden: z.coerce.number().int().min(0).optional(),
});

/**
 * La respuesta automatica a una llamada.
 *
 * El texto se limita a 500 caracteres porque lo manda WhatsApp como mensaje
 * normal, y uno larguisimo a quien acaba de intentar llamar se lee como spam —
 * que es justo lo que hace que reporten un numero.
 *
 * `activa` sin texto no vale: rechazar la llamada y no decir nada deja al otro
 * pensando que le han colgado a proposito.
 */
export const respuestaLlamadaSchema = z.object({
  // Los mensajes van escritos: los que trae Zod de serie estan en ingles, y
  // aqui llegan tal cual a la pantalla de una gestora.
  activa: z.boolean({ required_error: 'Falta decir si esta activada' }),
  texto: z.string().trim()
    .max(500, { message: 'El mensaje no puede pasar de 500 caracteres' })
    .default(''),
}).refine((v) => !v.activa || v.texto.length > 0, {
  message: 'Hace falta el texto que se enviara al rechazar la llamada',
  path: ['texto'],
});
