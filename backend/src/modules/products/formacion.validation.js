import { z } from 'zod';

/**
 * Una formación entera, como la guarda la pantalla Productos › Formaciones
 * (CRM#1113): los datos del producto y sus módulos, de una vez.
 *
 * Los módulos van en el orden en que se ven: la posición en la lista ES el
 * orden. Uno con `id` es uno que ya existía (se actualiza); sin `id`, uno nuevo;
 * los que tenía la formación y no vienen se quitan.
 */

export const TIPOS_FORMACION = ['curso', 'diplomado', 'master'];

// Mismos topes que valida Certifex al imprimir el diploma (certifex.programa.js):
// pasarse aquí sería guardar algo que luego no se puede emitir.
export const MAX_HORAS = 5000;
export const MAX_MODULOS = 100;
export const MAX_HORAS_MODULO = 2000;

const vacioEsNulo = (v) => (v === '' || (typeof v === 'number' && Number.isNaN(v)) ? null : v);
const fecha = z.preprocess(vacioEsNulo,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha tiene que ser AAAA-MM-DD').nullable().optional());

const moduloSchema = z.object({
  id: z.number().int().positive().optional(),
  titulo: z.string().trim().min(1, 'Cada módulo necesita un título').max(300, 'El título de un módulo no puede pasar de 300 caracteres'),
  descripcion: z.preprocess(vacioEsNulo, z.string().max(20000, 'El temario de un módulo no puede pasar de 20.000 caracteres').nullable().optional()),
  horas: z.preprocess(vacioEsNulo, z.coerce.number().int('Las horas de un módulo van sin decimales')
    .min(0, 'Las horas no pueden ser negativas').max(MAX_HORAS_MODULO, `Un módulo no puede pasar de ${MAX_HORAS_MODULO} horas`).nullable().optional()),
});

const campos = {
  nombre: z.string().trim().min(1, 'La formación necesita un nombre').max(200, 'El nombre no puede pasar de 200 caracteres'),
  tipo_formacion: z.preprocess(vacioEsNulo, z.enum(TIPOS_FORMACION, { message: 'El tipo es curso, diplomado o máster' }).nullable().optional()),
  horas_totales: z.preprocess(vacioEsNulo, z.coerce.number().int('Las horas van sin decimales')
    .min(1, 'Las horas tienen que ser al menos 1').max(MAX_HORAS, `Una formación no puede pasar de ${MAX_HORAS} horas`).nullable().optional()),
  precio: z.preprocess(vacioEsNulo, z.coerce.number().nonnegative('El precio no puede ser negativo').max(10_000_000).nullable().optional()),
  moneda: z.preprocess(vacioEsNulo, z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'La moneda es un código de tres letras (EUR, USD…)').nullable().optional()),
  modalidad: z.preprocess(vacioEsNulo, z.string().trim().max(80).nullable().optional()),
  fecha_inicio: fecha,
  fecha_fin: fecha,
  modulos: z.array(moduloSchema).max(MAX_MODULOS, `Como mucho ${MAX_MODULOS} módulos`).optional(),
};

const fechasEnOrden = (d) => !d.fecha_inicio || !d.fecha_fin || d.fecha_fin >= d.fecha_inicio;
const idsSinRepetir = (d) => {
  const ids = (d.modulos || []).map((m) => m.id).filter(Boolean);
  return new Set(ids).size === ids.length;
};

export const formacionSchema = z.object(campos)
  .refine(fechasEnOrden, { message: 'La fecha de fin no puede ser anterior a la de inicio', path: ['fecha_fin'] })
  .refine(idsSinRepetir, { message: 'Un módulo está repetido', path: ['modulos'] });
