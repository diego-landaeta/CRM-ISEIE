// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { rellenoDeAbajo, altoDelMarco, ALTO_MINIMO, loQueHayEncima } from '@/modules/whatsapp/lib/altoDelMarco';

/**
 * El marco del chat termina donde termina el sitio (#112).
 *
 * «La caja de escribir y la lista de conversaciones no terminan a la misma
 * altura: en la esquina de abajo a la izquierda queda un escalón. Se nota con el
 * chat abierto a pantalla completa.»
 *
 * El alto se mide —donde empieza el marco, y todo lo que queda hasta abajo— y
 * hay que descontarle el relleno de los contenedores. Ese descuento se apuntaba
 * UNA vez, al entrar: 32 px, el del contenedor del CRM. Al ampliar, el marco
 * pasa a colgar de `.wa-completa`, que es `fixed` con 8 px, y se le seguian
 * restando 32. Veinticuatro pixeles de fondo del hilo por debajo de la lista y
 * de la barra de escribir, que es lo que se ve como escalon.
 *
 * Aqui se fija el descuento: sale de la hoja de estilos, no de una medicion
 * hecha una vez y reutilizada donde ya no vale.
 */

const hechos: HTMLElement[] = [];

/** Monta `padre > hijo` en el documento y devuelve el hijo. */
const anidar = (estilos: Partial<CSSStyleDeclaration>[]) => {
  let arriba: HTMLElement = document.body;
  let ultimo: HTMLElement = document.body;
  for (const e of estilos) {
    const d = document.createElement('div');
    Object.assign(d.style, e);
    arriba.appendChild(d);
    hechos.push(d);
    arriba = d;
    ultimo = d;
  }
  const marco = document.createElement('div');
  ultimo.appendChild(marco);
  hechos.push(marco);
  return marco;
};

afterEach(() => { hechos.forEach((d) => d.remove()); hechos.length = 0; });

describe('lo que hay que descontar por debajo', () => {
  it('en la pagina: el relleno del contenedor del CRM', () => {
    // <main class="xl:p-8"> → <div class="space-y-2"> → marco
    const marco = anidar([{ paddingBottom: '32px' }, {}]);
    expect(rellenoDeAbajo(marco)).toBe(32);
  });

  it('ampliado: el del contenedor fijo, y NADA de lo que tiene encima', () => {
    // El caso del fallo. `.wa-completa` es fixed con 8 px y esta metido dentro
    // del mismo contenedor de 32: si se sumaran los dos, se restarian 40.
    const marco = anidar([{ paddingBottom: '32px' }, { position: 'fixed', paddingBottom: '8px' }]);
    expect(rellenoDeAbajo(marco)).toBe(8);
  });

  it('se suman los de en medio', () => {
    const marco = anidar([{ paddingBottom: '32px' }, { paddingBottom: '4px' }]);
    expect(rellenoDeAbajo(marco)).toBe(36);
  });

  it('el margen de abajo cuenta igual: tambien es sitio que no es suyo', () => {
    const marco = anidar([{ paddingBottom: '16px', marginBottom: '8px' }]);
    expect(rellenoDeAbajo(marco)).toBe(24);
  });

  it('sin rellenos, cero', () => {
    expect(rellenoDeAbajo(anidar([{}, {}]))).toBe(0);
  });

  it('sin marco todavia, cero y no revienta', () => {
    // Se llama desde una medicion que puede correr antes de que el ref exista.
    expect(rellenoDeAbajo(null)).toBe(0);
    expect(rellenoDeAbajo(undefined)).toBe(0);
  });
});

describe('el alto que le toca', () => {
  it('todo lo que queda desde donde empieza', () => {
    expect(altoDelMarco(78, 900, 32)).toBe(790);   // en la pagina
  });

  it('ampliado llega mas abajo, que es el arreglo', () => {
    expect(altoDelMarco(54, 900, 8)).toBe(838);
    // Con el descuento viejo terminaba 24 px antes.
    expect(altoDelMarco(54, 900, 32)).toBe(838 - 24);
  });

  it('nunca por debajo del minimo, aunque no quepa', () => {
    // En una ventana baja el marco desborda y la pagina se desplaza. Es peor
    // dejar una conversacion en una rendija de 100 px.
    expect(altoDelMarco(600, 700, 32)).toBe(ALTO_MINIMO);
  });

  it('se redondea, que un alto con decimales deja una linea de medio pixel', () => {
    expect(altoDelMarco(77.6, 900, 32)).toBe(790);
  });
});

describe('lo que hay que vigilar por encima (#180, como CRM#128)', () => {
  // En el movil la barra de estado arranca en dos o tres lineas («No tienes
  // WhatsApp enlazado») y se queda en una cuando llega la conexion. El body no
  // cambia de tamaño —el contenedor es min-h-screen— y el marco subia sin
  // volver a medirse. Lo que se vigila tiene que incluir esa barra.
  it('los hermanos de delante del marco y los de cada contenedor', () => {
    const cabeceraCrm = document.createElement('header');
    const main = document.createElement('main');
    const barra = document.createElement('div');
    const pagina = document.createElement('div');
    const marco = document.createElement('div');
    const detras = document.createElement('div');
    document.body.append(cabeceraCrm, main);
    main.append(pagina);
    pagina.append(barra, marco, detras);
    hechos.push(cabeceraCrm, main);

    const encima = loQueHayEncima(marco);
    expect(encima).toContain(barra);
    expect(encima).toContain(cabeceraCrm);
    // Lo de detras no lo mueve: no hace falta vigilarlo.
    expect(encima).not.toContain(detras);
    expect(encima).not.toContain(marco);
  });

  it('sin marco todavia, nada', () => {
    expect(loQueHayEncima(null)).toEqual([]);
  });
});
