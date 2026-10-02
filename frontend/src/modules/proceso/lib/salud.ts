import type { ResumenCola } from '../api/agenda.api';

/*
  Cómo va la cola, de un vistazo (repaso de Diego del 15/09: «no hay gráficas
  de cómo va, ni la salud»).

  No se inventa ninguna cifra: son las cuatro que ya devuelve
  `GET /proceso/cola/resumen`, puestas de forma que se lean juntas. Cuatro
  números sueltos obligan a compararlos mentalmente; una barra dice en medio
  segundo si el día está bajo control o si se ha acumulado atraso.
*/

export type TonoDeTramo = 'destructive' | 'warning' | 'info' | 'muted';

export interface TramoDeSalud {
  clave: 'atrasados' | 'hoy' | 'manana' | 'semana';
  etiqueta: string;
  valor: number;
  tono: TonoDeTramo;
  /** Qué parte del total ocupa, en porcentaje. */
  porcentaje: number;
}

/**
 * Los cuatro tramos, con su parte de la barra.
 *
 * El orden es el del tiempo: lo que se debía haber hecho, lo de hoy, lo de
 * mañana y el resto de la semana. Así la barra se lee de izquierda a derecha
 * igual que se vive el día.
 */
export function tramosDeSalud(r: ResumenCola | null | undefined): TramoDeSalud[] {
  if (!r) return [];
  const crudos: Array<{ clave: TramoDeSalud['clave']; etiqueta: string; valor: number; tono: TonoDeTramo }> = [
    { clave: 'atrasados', etiqueta: 'atrasados', valor: r.atrasados || 0, tono: 'destructive' },
    { clave: 'hoy', etiqueta: 'para hoy', valor: r.hoy || 0, tono: 'warning' },
    { clave: 'manana', etiqueta: 'para mañana', valor: r.manana || 0, tono: 'info' },
    { clave: 'semana', etiqueta: 'esta semana', valor: r.esta_semana || 0, tono: 'muted' },
  ];
  const total = crudos.reduce((s, t) => s + t.valor, 0);
  return crudos.map((t) => ({
    ...t,
    // Sin nada en la cola no hay reparto que enseñar. Repartir 0 entre 0 da
    // NaN, y un NaN en un `width` deja la barra a lo ancho de la pantalla.
    porcentaje: total > 0 ? (t.valor * 100) / total : 0,
  }));
}

/** Cuántos pasos hay en la cola, sumando los cuatro tramos. */
export function totalDeLaCola(r: ResumenCola | null | undefined): number {
  return tramosDeSalud(r).reduce((s, t) => s + t.valor, 0);
}

/**
 * La frase de la salud, que es lo que de verdad se lee.
 *
 * La barra sola no dice si está bien o mal: dice el reparto. El juicio va en
 * palabras, y se apoya en UNA pregunta —¿cuánto de lo que ya tocaba está sin
 * hacer?—, porque es la única que cambia lo que se hace a continuación.
 *
 * No hay porcentajes en el texto a propósito: «el 26 % con retraso» suena a
 * informe, y esto se lee de pie con el café. «12 de 47 llegan tarde» es la
 * misma cifra y se entiende sin pensar.
 */
export function fraseDeSalud(r: ResumenCola | null | undefined): { texto: string; alerta: boolean } {
  const total = totalDeLaCola(r);
  if (total === 0) {
    return { texto: 'No queda nada pendiente en la cola.', alerta: false };
  }
  const atrasados = r?.atrasados || 0;
  const hoy = r?.hoy || 0;
  if (atrasados === 0) {
    return {
      texto: hoy === 0
        ? `Nada llega tarde. ${total} ${total === 1 ? 'paso' : 'pasos'} por delante.`
        : `Nada llega tarde. ${hoy} ${hoy === 1 ? 'paso' : 'pasos'} para hoy.`,
      alerta: false,
    };
  }
  return {
    texto: `${atrasados} de ${total} ${atrasados === 1 ? 'llega' : 'llegan'} tarde.`,
    alerta: true,
  };
}
