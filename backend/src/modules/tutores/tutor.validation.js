

/*
  Marcar que se busca tutor para una formacion.

  `buscando: false` con un anuncio puesto NO se rechaza: se deja de buscar y se
  guarda con que se estuvo buscando. Borrar el anuncio al desmarcar seria
  perder el unico dato que responde: esto ya lo intentamos.
*/
export const busquedaDeTutorSchema = z.object({
  buscando: z.boolean().optional().default(true),
  // Los identificadores de Meta son numeros larguisimos, pero llegan como texto
  // y como texto se guardan: un 120255671225530569 no cabe en un entero de JS
  // sin perder cifras por el camino.
  adsetId: z.string().trim().max(50).nullable().optional(),
  campaignId: z.string().trim().max(50).nullable().optional(),
  nota: z.string().trim().max(500).nullable().optional(),
});
