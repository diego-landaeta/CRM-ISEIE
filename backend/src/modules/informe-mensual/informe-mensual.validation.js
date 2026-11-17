import { z } from 'zod';

const periodo = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El mes va como AAAA-MM');
const id = z.coerce.number().int().positive().max(2147483647);

// El informe en pantalla y en Excel: un mes y, si se quiere, una empresa.
export const informeSchema = z.object({ periodo, issuerId: id.optional() });

// El ZIP de facturas es siempre de UNA empresa.
export const zipSchema = z.object({ periodo, issuerId: id });

// El enlace del correo: empresa, mes, cuándo caduca y la firma.
export const descargaSchema = z.object({
  issuerId: id,
  periodo,
  exp: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
