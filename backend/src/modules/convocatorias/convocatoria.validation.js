import { z } from 'zod';

const pct = z.number().int().min(0).max(100);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD');

export const crearConvocatoriaSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  descripcion: z.string().trim().max(2000).optional(),
  // Los topes vienen con el valor de CETLAT porque es lo que hay hoy; se
  // cambian por convocatoria si hace falta.
  tope_nueva: pct.optional(),
  tope_habilitada: pct.optional(),
  nota_interna: z.string().trim().max(2000).optional(),
});

export const editarConvocatoriaSchema = crearConvocatoriaSchema.partial().extend({
  activa: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay nada que cambiar' });

export const ofrecerSchema = z.object({
  leadId: z.number().int().positive(),
  canal: z.enum(['llamada', 'whatsapp', 'email', 'presencial', 'otro']).optional(),
  // Las dos fechas que se le dicen al cliente. Van juntas o ninguna: prometer
  // un límite sin decir cuándo se contesta es la mitad del trato.
  fecha_limite: fecha.optional(),
  fecha_resultado: fecha.optional(),
  nota: z.string().trim().max(1000).optional(),
}).refine((d) => !d.fecha_limite || !d.fecha_resultado || d.fecha_resultado >= d.fecha_limite, {
  message: 'El resultado no puede ser antes del límite para pedirla',
  path: ['fecha_resultado'],
});

export const actualizarOfrecimientoSchema = z.object({
  // `null` no: para decir «no la llenó» está `false`. Dejarlo sin tocar es no
  // saberlo todavía, y eso es un estado de verdad.
  solicitud_llenada: z.boolean().optional(),
  // Con dos decimales: hay descuentos de 12,5 %.
  descuento: z.number().min(0).max(100).optional(),
  resultado: z.enum(['pendiente', 'concedida', 'denegada', 'caducada']).optional(),
  fecha_limite: fecha.optional(),
  fecha_resultado: fecha.optional(),
  nota: z.string().trim().max(1000).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay nada que cambiar' });
