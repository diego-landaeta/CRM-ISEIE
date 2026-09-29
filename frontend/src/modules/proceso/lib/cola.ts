import type { PasoEnCola } from '../api/agenda.api';

/*
  Las cuentas de la cola del día (#90).

  Aquí no se pinta nada: son las tres preguntas que la pantalla hace y que se
  pueden equivocar en silencio, así que van aparte y con pruebas.
*/

export interface GrupoDePaso {
  clave: string;
  orden: number;
  nombre: string;
  cuantos: number;
  /** Cuántos de ese paso llegan tarde. Es lo que decide si el grupo urge. */
  atrasados: number;
}

/**
 * Cuántos hay de cada paso, en orden de proceso.
 *
 * El issue lo pide así: «su lista de hoy, agrupada por paso: cuántos del 1,
 * cuántos del 2…». No se reordena la lista para agruparla —Diego defiende el
 * orden por urgencia, y romperlo escondería lo atrasado detrás del paso 1—:
 * son un contador y un filtro por encima del mismo orden.
 *
 * Van por `orden` y no por cuántos hay: el proceso tiene una secuencia y
 * enseñarla desordenada la desdibuja.
 */
export function contarPorPaso(cola: PasoEnCola[]): GrupoDePaso[] {
  const por = new Map<string, GrupoDePaso>();
  for (const fila of cola) {
    const g = por.get(fila.clave) ?? {
      clave: fila.clave,
      orden: fila.orden,
      nombre: fila.paso_nombre || fila.clave,
      cuantos: 0,
      atrasados: 0,
    };
    g.cuantos += 1;
    if (fila.dias_de_retraso > 0) g.atrasados += 1;
    por.set(fila.clave, g);
  }
  return [...por.values()].sort((a, b) => a.orden - b.orden);
}

/**
 * De qué tipo es la interacción que se apunta al contactar por un canal.
 *
 * El servidor solo acepta cuatro —`llamada`, `email`, `whatsapp`, `nota`— y los
 * canales de un paso son otros cuatro, que casi coinciden: `wasapi` es la
 * pasarela por la que sale el mensaje, pero lo que ha pasado es un WhatsApp.
 * Mandarlo tal cual lo rechaza la validación con un 400 que no explica nada.
 */
export function tipoDeInteraccion(canal: string | null | undefined): 'llamada' | 'email' | 'whatsapp' | 'nota' {
  if (canal === 'llamada' || canal === 'email' || canal === 'whatsapp') return canal;
  if (canal === 'wasapi') return 'whatsapp';
  return 'nota';
}

/**
 * A quién se pasa después de sacar a alguien de la cola.
 *
 * Se queda en la MISMA posición, que ahora ocupa quien venía detrás: es lo que
 * hace que «siguiente» encadene sin volver a la lista. Si era el último, se
 * retrocede uno; si no queda nadie, `null` y se cierra el panel.
 */
export function trasSacar(total: number, indice: number): number | null {
  const quedan = total - 1;
  if (quedan <= 0) return null;
  return Math.min(indice, quedan - 1);
}
