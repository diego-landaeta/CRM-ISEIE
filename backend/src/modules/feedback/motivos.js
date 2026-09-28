/**
 * Lo que se puede contestar a «¿por qué has desistido?».
 *
 * A falta de que las fije Carlos, son las que suele dar la gente (#169). La
 * última de verdad —«no me contestaron a tiempo»— es la única que depende de
 * nosotros, y por eso el panel la cruza con la gestora (#170).
 *
 * La CLAVE es lo que se guarda y no cambia; el texto se puede reescribir sin
 * tocar la base. «otro» deja escribir en una línea.
 */
export const MOTIVOS = [
  { clave: 'precio', texto: 'El precio' },
  { clave: 'fechas', texto: 'Las fechas no me encajan' },
  { clave: 'pensando', texto: 'Todavía me lo estoy pensando' },
  { clave: 'otro_centro', texto: 'Elegí otro centro' },
  { clave: 'no_interesa', texto: 'Ya no me interesa' },
  { clave: 'sin_respuesta', texto: 'No me contestaron a tiempo' },
  { clave: 'otro', texto: 'Otro motivo' },
];

export const CLAVES = MOTIVOS.map((m) => m.clave);

export function textoDe(clave) {
  return MOTIVOS.find((m) => m.clave === clave)?.texto || clave;
}

export const DISPARADORES = {
  descarte: 'Al descartarlo',
  dia7: 'Al 7.º día sin comprar',
};
