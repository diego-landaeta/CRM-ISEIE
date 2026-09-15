/*
  Los rangos de fecha de los informes, contados por calendario.

  «La semana pasada» es la semana pasada —de lunes a domingo—, NO los siete
  días anteriores. Son cosas distintas y la diferencia se nota: pedido un
  martes, «los últimos 7 días» mezcla media semana con media de la anterior, y
  las cifras no cuadran con las de nadie que hable de «la semana pasada».

  La semana empieza en LUNES.
*/

/**
 * Una fecha en `YYYY-MM-DD`, leída en la zona horaria de quien mira.
 *
 * NO se usa `toISOString()`, que convierte a UTC antes de cortar: en España
 * (UTC+2) el 1 de enero a las 00:00 se vuelve el 31 de diciembre a las 22:00,
 * y el informe arrancaba el año anterior sin que nadie lo viera. Se veía bien
 * desde América y mal desde Madrid, que es donde está Carlos.
 */
export function iso(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Cuántos días hay que retroceder para llegar al lunes de esa semana. */
function haciaElLunes(d) {
  const dia = d.getDay();          // 0 domingo … 6 sábado
  return dia === 0 ? 6 : dia - 1;  // el domingo pertenece a la semana que acaba
}

function sumarDias(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return r;
}

/**
 * Los atajos, en el orden en que se ofrecen. Cada uno devuelve `{ from, to }`.
 *
 * `hoy` se pasa como parámetro en vez de leerlo dentro para que las pruebas
 * puedan fijar el día y no dependan de cuándo se ejecuten.
 */
export const ATAJOS = [
  {
    clave: 'hoy',
    etiqueta: 'Hoy',
    calcular: (hoy) => ({ from: iso(hoy), to: iso(hoy) }),
  },
  {
    clave: 'ayer',
    etiqueta: 'Ayer',
    calcular: (hoy) => {
      const ayer = sumarDias(hoy, -1);
      return { from: iso(ayer), to: iso(ayer) };
    },
  },
  {
    clave: 'esta_semana',
    etiqueta: 'Esta semana',
    calcular: (hoy) => ({ from: iso(sumarDias(hoy, -haciaElLunes(hoy))), to: iso(hoy) }),
  },
  {
    clave: 'semana_pasada',
    etiqueta: 'La semana pasada',
    calcular: (hoy) => {
      const lunesDeEsta = sumarDias(hoy, -haciaElLunes(hoy));
      return { from: iso(sumarDias(lunesDeEsta, -7)), to: iso(sumarDias(lunesDeEsta, -1)) };
    },
  },
  {
    clave: 'este_mes',
    etiqueta: 'Este mes',
    calcular: (hoy) => ({
      from: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
      to: iso(hoy),
    }),
  },
  {
    clave: 'mes_pasado',
    etiqueta: 'El mes pasado',
    calcular: (hoy) => ({
      from: iso(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)),
      // El día 0 del mes actual es el último del anterior, sin tener que saber
      // cuántos días tiene ni si es bisiesto.
      to: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 0)),
    }),
  },
  {
    clave: 'este_ano',
    etiqueta: 'Este año',
    calcular: (hoy) => ({ from: iso(new Date(hoy.getFullYear(), 0, 1)), to: iso(hoy) }),
  },
];

/** El rango con el que arranca la pantalla: el mes en curso. */
export function rangoPorDefecto(hoy = new Date()) {
  return ATAJOS.find((a) => a.clave === 'este_mes').calcular(hoy);
}

/**
 * Qué atajo corresponde a un rango, si es que alguno. Devuelve su clave o
 * null: sirve para marcar el botón, y para saber cuándo el rango es a medida.
 */
export function atajoDe(rango, hoy = new Date()) {
  if (!rango?.from || !rango?.to) return null;
  const encontrado = ATAJOS.find((a) => {
    const r = a.calcular(hoy);
    return r.from === rango.from && r.to === rango.to;
  });
  return encontrado ? encontrado.clave : null;
}
