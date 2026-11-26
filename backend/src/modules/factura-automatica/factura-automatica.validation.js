import { z } from 'zod';

// El formulario público (#452). La forma aquí; si los datos valen para una
// factura (NIF de verdad, nombre que no sea de relleno…) lo dice
// `datos-fiscales.js`, que es la misma regla que se aplica a la ficha.
const texto = (max) => z.string().trim().max(max).optional().nullable();

export const datosFiscalesSchema = z.object({
  tipo: z.enum(['particular', 'empresa']).default('particular'),
  nombre: texto(200),
  nif: texto(50),
  direccion: texto(300),
  codigo_postal: texto(20),
  ciudad: texto(120),
  pais: texto(80),
  email: texto(255),
}).strict();

// «Enviar factura automáticamente: Sí / No» y «Enviar a este correo» (#764, 24/11).
// `email` vacío o null: el de la ficha del alumno.
export const envioFacturaSchema = z.object({
  auto: z.boolean({ required_error: 'Di si la factura se envía sola: sí o no', invalid_type_error: 'Enviar la factura sola: sí o no' }),
  email: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? null : v),
    z.string().trim().toLowerCase().max(255).email('Ese correo no es válido').nullable().optional(),
  ),
}).strict();

// GET /api/factura-automatica/panel — el ámbito lo lee `listaDelAmbito`.
export const panelSchema = z.object({
  limite: z.coerce.number().int().min(1).max(500).optional(),
}).passthrough();
