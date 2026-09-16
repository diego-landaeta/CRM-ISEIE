/**
 * Cuanto sitio le queda al marco del chat por debajo (#112).
 *
 * El alto del marco se mide: donde empieza, y todo lo que queda hasta abajo.
 * Lo que hay que descontar es el relleno de los contenedores que lo envuelven,
 * porque ese hueco no es suyo — si se lo queda, la pagina desborda y salen dos
 * barras de desplazamiento, la del chat y la del navegador.
 *
 * ANTES SE APUNTABA UNA VEZ, Y POR ESO FALLABA AL AMPLIAR
 *
 * La primera version dejaba desbordar la pagina a proposito y se quedaba con lo
 * que desbordo. Un numero, medido al entrar, reutilizado siempre. En la pagina
 * daba 32 —el relleno del contenedor del CRM— y estaba bien.
 *
 * Al ampliar, el marco pasa a colgar de `.wa-completa`, que es `fixed` con 8 px
 * de relleno. Se seguian restando 32, asi que el marco terminaba 24 px antes del
 * borde de la pantalla: por debajo se veia el fondo del hilo (#0b141a) contra la
 * lista (#111b21) y la barra de escribir (#202c33). Eso es el «escalon abajo a
 * la izquierda» que se reporto.
 *
 * Ahora se suma el relleno de abajo de los contenedores, que sale de la hoja de
 * estilos y no de una prueba. Vale para los dos modos sin tener que saber en
 * cual estamos, y no realimenta: ninguno de esos rellenos depende del alto del
 * marco.
 *
 * Se para en el primero `fixed`: ese ya no arrastra el relleno de lo que tenga
 * encima, esta colocado contra la pantalla.
 */
export function rellenoDeAbajo(desde: Element | null | undefined): number {
  let n: Element | null = desde?.parentElement ?? null;
  let total = 0;
  while (n && n !== document.body) {
    const cs = getComputedStyle(n);
    total += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.marginBottom) || 0);
    if (cs.position === 'fixed') break;
    n = n.parentElement;
  }
  return total;
}

/** Lo minimo que puede medir el marco: por debajo no cabe una conversacion. */
export const ALTO_MINIMO = 420;

/**
 * El alto que le toca al marco.
 *
 * `arriba` es donde empieza el marco en la pantalla; `ventana`, el alto de la
 * ventana. Lo demas es lo que hay que dejarle a los contenedores.
 */
export function altoDelMarco(arriba: number, ventana: number, relleno: number): number {
  return Math.max(ALTO_MINIMO, Math.round(ventana - arriba - relleno));
}
