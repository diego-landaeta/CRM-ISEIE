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
