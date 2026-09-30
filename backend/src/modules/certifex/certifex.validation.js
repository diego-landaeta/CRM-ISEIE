import { z } from 'zod';
import { ESTADOS } from './certifex.model.js';

const texto = (max) => z.string().trim().max(max);
const opcional = (max) => z.union([texto(max), z.null()]).optional();

/** Lo que manda Certifex. Ya viene validado alli; aqui se valida otra vez, por si acaso. */
export const recibirSchema = z.object({
  certifexId: z.number().int().positive(),
  tipo: z.enum(['centro', 'consulta']),
  nombre: texto(200).min(2),
  email: z.string().trim().email().max(254),
  telefono: opcional(40),
  organizacion: opcional(200),
  urlCampus: opcional(500),
  mensaje: z.string().trim().min(5).max(4000),
  idioma: z.union([z.enum(['es', 'en', 'fr', 'pt']), z.null()]).optional(),
  creadoEn: z.string().datetime({ offset: true }).optional().nullable(),
});

export const listarSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  tipo: z.enum(['centro', 'consulta']).optional(),
  pagina: z.coerce.number().int().positive().optional(),
  limite: z.coerce.number().int().positive().max(100).optional(),
});

export const actualizarSchema = z.object({
  estado: z.enum(ESTADOS).optional(),
  notaInterna: z.union([texto(4000), z.null()]).optional(),
});

// --- Emisiones: lo que se le pide a la API de Certifex (/api/crm/v1) ---

export const listarEmisionesSchema = z.object({
  estado: z.enum(['pendiente', 'aprobada', 'rechazada', 'todas']).optional(),
  centro: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, 'Centro no valido').optional(),
  pagina: z.coerce.number().int().positive().optional(),
  tam: z.coerce.number().int().positive().max(200).optional(),
  curso: z.coerce.number().int().optional(),
  q: z.string().trim().max(100).optional(),
});

export const cursosSchema = z.object({
  centro: z.string().trim().regex(/^[A-Za-z0-9]{2,10}$/, 'Centro no valido'),
});

/** Quien decide NO va aqui: lo pone el servidor con el usuario de la sesion. */
export const decisionesSchema = z.object({
  items: z.array(z.object({
    matriculaId: z.number().int().positive(),
    decision: z.enum(['aprobada', 'rechazada']),
    motivo: z.union([texto(500), z.null()]).optional(),
  })).min(1, 'Elige al menos una matricula').max(200, 'Maximo 200 por vez'),
});

export const emitirSchema = z.object({
  // 10 y no 50, lo mismo que la pantalla: cada matricula de un campus con Moodle baja su
  // expediente en serie, y 50 pasan del minuto que nginx espera (504 con la emision a medias).
  matriculaIds: z.array(z.number().int().positive()).min(1, 'Elige al menos una matricula').max(10, 'Maximo 10 por vez: dividelo en tandas'),
});
