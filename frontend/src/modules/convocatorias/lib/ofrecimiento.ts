import type { Embudo, Ofrecimiento, ResultadoOfrecimiento } from '../api/convocatorias.api';

/*
  Las decisiones de la pantalla de convocatorias (#86).

  Lo que NO está aquí, a propósito:

    - si compró            lo deduce el servidor de sus ventas posteriores
    - si debe respuesta    lo deduce el servidor de la fecha prometida
    - el aviso del tope    lo escribe el servidor al guardar

  Los tres llegan calculados. Rehacerlos aquí es firmar que algún día la ficha
  y el embudo digan cosas distintas de la misma persona.
*/

export type EstadoSolicitud = 'llenada' | 'no_llenada' | 'sin_saber';

/**
 * Si llenó la solicitud.
 *
 * `null` NO es «no». Es «todavía no se lo hemos preguntado», y es un estado de
 * verdad: contarlo como un no haría que el embudo pareciera peor de lo que es
 * y, peor, escondería el trabajo que queda por hacer.
 */
export function estadoDeSolicitud(o: Pick<Ofrecimiento, 'solicitud_llenada'>): EstadoSolicitud {
  if (o.solicitud_llenada === true) return 'llenada';
  if (o.solicitud_llenada === false) return 'no_llenada';
  return 'sin_saber';
}

export const TEXTO_SOLICITUD: Record<EstadoSolicitud, string> = {
  llenada: 'Llenó la solicitud',
  no_llenada: 'No la llenó',
  sin_saber: 'Sin preguntar',
};

export const TEXTO_RESULTADO: Record<ResultadoOfrecimiento, string> = {
  pendiente: 'Pendiente',
  concedida: 'Concedida',
  denegada: 'Denegada',
  caducada: 'Caducada',
};

/** El color de cada resultado, en tokens. */
export function tonoDelResultado(r: ResultadoOfrecimiento): 'success' | 'destructive' | 'muted' | 'info' {
  if (r === 'concedida') return 'success';
  if (r === 'denegada') return 'destructive';
  if (r === 'caducada') return 'muted';
  return 'info';
}

/**
 * Lo que se le prometió a esta persona, en una línea.
 *
 * Las dos fechas van juntas o no van: prometer un límite para pedirla sin
 * decir cuándo se contesta es la mitad del trato, y es justo la mitad que
 * genera la llamada de «¿se sabe algo?».
 */
export function textoDeLaVentana(
  o: Pick<Ofrecimiento, 'fecha_limite' | 'fecha_resultado'>,
  formatear: (iso: string) => string,
): string | null {
  const partes: string[] = [];
  if (o.fecha_limite) partes.push(`pedirla hasta el ${formatear(o.fecha_limite)}`);
  if (o.fecha_resultado) partes.push(`respuesta el ${formatear(o.fecha_resultado)}`);
  return partes.length ? partes.join(' · ') : null;
}

/**
 * Si un descuento pasa de los topes de la campaña.
 *
 * Esto es solo para avisar MIENTRAS SE ESCRIBE, antes de guardar. El aviso de
 * verdad —con su texto— lo devuelve el servidor, y ese es el que se enseña
 * después. Aquí solo se responde sí o no, para poner el campo en ámbar y que
 * nadie escriba un 85 sin darse cuenta.
 *
 * NO BLOQUEA, y eso es deliberado: bloquear un descuento que un responsable ha
 * autorizado a mano convierte la regla en un estorbo, y lo que se acaba
 * haciendo es no registrarlo — que es perder el dato.
 */
export function pasaDelTope(
  descuento: number | null | undefined,
  convocatoria: { tope_nueva?: number | null; tope_habilitada?: number | null } | null | undefined,
): boolean {
  if (descuento == null || !Number.isFinite(descuento)) return false;
  // El tope bajo es el de referencia: el CRM no sabe si la formación está «ya
  // habilitada», así que no puede decidir por su cuenta cuál de los dos aplica.
  const tope = convocatoria?.tope_nueva;
  return tope != null && descuento > Number(tope);
}

/**
 * Los tramos del embudo, en el orden en que ocurren.
 *
 * Se devuelven como lista y no como cuatro tarjetas sueltas porque lo que se
 * lee no es cada número: es cuánto se cae de un paso al siguiente.
 */
export function tramosDelEmbudo(e: Embudo | null): Array<{
  clave: string; etiqueta: string; valor: number; pct: number | null;
}> {
  if (!e) return [];
  return [
    { clave: 'ofrecidas', etiqueta: 'Se la ofrecimos a', valor: e.ofrecidas, pct: null },
    { clave: 'llenaron', etiqueta: 'Llenaron la solicitud', valor: e.llenaron, pct: e.pct_llenaron },
    { clave: 'con_descuento', etiqueta: 'Con descuento concedido', valor: e.con_descuento, pct: null },
    { clave: 'compraron', etiqueta: 'Compraron', valor: e.compraron, pct: e.pct_compraron },
  ];
}

/**
 * Si el embudo tiene algo que contar.
 *
 * Con cero ofrecimientos todos los porcentajes valen cero, y cuatro ceros en
 * fila se leen como «la beca no funciona» cuando lo que pasa es que nadie la
 * ha ofrecido todavía. Son cosas distintas y la pantalla tiene que decirlo.
 */
export function hayEmbudo(e: Embudo | null): boolean {
  return !!e && e.ofrecidas > 0;
}
