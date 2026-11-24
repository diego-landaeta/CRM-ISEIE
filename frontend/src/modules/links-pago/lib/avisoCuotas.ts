/*
  «CÓMO SE COBRA», ANTES DE CREAR (Diego, 24/11/2026).

  Diego no sabía cómo cobra un link en cuotas. Su caso: 1.250 €, inicial de 500 €
  y 3 cuotas de 250 € con cobro automático. Es UN solo enlace, que cobra hoy la
  inicial; después Stripe cobra solo cada cuota en su fecha con la tarjeta
  guardada. Sin cobro automático, cada cuota tiene su propio enlace. «Que salga sí
  o sí ese disclaimer: mismo enlace y se cobrará de esta forma.»

  Estas frases salen en «Crear link de pago» y en la venta (fraccionado con link),
  con las cifras del plan que se está escribiendo, y se rehacen al cambiarlo.
  Funciones puras: las mismas cuentas en las dos pantallas y en las pruebas.
*/

/** «1.250 €», «249,99 €»: sin decimales si es entero, con el punto de los miles. */
export function euros(n: number) {
  const c = Math.round(Number(n || 0) * 100);
  const entero = Math.trunc(Math.abs(c) / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const cent = Math.abs(c) % 100;
  return `${c < 0 ? '−' : ''}${entero}${cent ? `,${String(cent).padStart(2, '0')}` : ''} €`;
}

/** «24/12», o «24/12/2027» si el plan pasa de un año. */
function fecha(f: string, conAno: boolean) {
  const [a, m, d] = String(f).slice(0, 10).split('-');
  return conAno ? `${d}/${m}/${a}` : `${d}/${m}`;
}

/** «a», «a y b», «a, b y c». */
function enLista(xs: string[]) {
  return xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

export interface CuotaDelAviso { importe: number; vence?: string | null }

/**
 * «250 € el 24/12, el 24/01 y el 24/02» si son iguales; si no, cada importe con
 * su fecha: «249,99 € el 24/12 y 250,02 € el 24/01».
 */
export function cobrosEnLista(cuotas: CuotaDelAviso[], conAno = false) {
  if (!cuotas.length) return '';
  const cuando = (c: CuotaDelAviso) => (c.vence ? `el ${fecha(c.vence, conAno)}` : 'sin fecha');
  const iguales = cuotas.every((c) => Math.round(c.importe * 100) === Math.round(cuotas[0].importe * 100));
  return iguales
    ? `${euros(cuotas[0].importe)} ${enLista(cuotas.map(cuando))}`
    : enLista(cuotas.map((c) => `${euros(c.importe)} ${cuando(c)}`));
}

export interface DatosDelAviso {
  /** Si Stripe cobra solo las cuotas con la tarjeta guardada (un solo enlace). */
  automatico: boolean;
  /** Lo que cobra el primer enlace: la inicial (hoy) o, con la inicial ya pagada, la cuota 1. */
  primero: CuotaDelAviso & { esInicial: boolean };
  /** Las cuotas de después, con su importe y su fecha. */
  despues: CuotaDelAviso[];
  /** La inicial ya cobrada por otro lado (otro link, transferencia): no se vuelve a cobrar. */
  yaPagado?: number;
  total: number;
  /**
   * Cuándo salen los enlaces de cada cuota sin cobro automático: al registrar la
   * venta (`generarPlan`) o al pagarse la inicial («Crear link de pago»).
   */
  linksDeCuotas: 'al_registrar' | 'al_pagar';
  /** Si al alumno se le recuerda un enlace sin pagar (seguimiento encendido y el campus lo tiene). */
  recordatorio: boolean;
}

/** ¿Alguna fecha a más de 11 meses de la primera? Entonces, con el año. */
function pideAno(cuotas: CuotaDelAviso[]) {
  const fs = cuotas.map((c) => c.vence).filter((f): f is string => !!f && /^\d{4}-\d{2}-\d{2}/.test(f)).sort();
  if (fs.length < 2) return false;
  const [a1, m1] = fs[0].split('-').map(Number);
  const [a2, m2] = fs[fs.length - 1].split('-').map(Number);
  return (a2 - a1) * 12 + (m2 - m1) > 11;
}

export function tituloDelAviso(d: Pick<DatosDelAviso, 'automatico'>) {
  return d.automatico ? 'Cómo se cobra (cobro automático)' : 'Cómo se cobra (un enlace por cuota)';
}

/** Las frases del recuadro, en orden. */
export function frasesDelAviso(d: DatosDelAviso): string[] {
  const conAno = pideAno([d.primero, ...d.despues]);
  const out: string[] = [];
  if (d.yaPagado && d.yaPagado > 0) out.push(`La inicial (${euros(d.yaPagado)}) ya está pagada: no se vuelve a cobrar.`);
  if (d.automatico) {
    out.push('Un solo enlace.');
    out.push(d.primero.esInicial
      ? `Hoy se cobran ${euros(d.primero.importe)}.`
      : `Al pagarlo se cobra la cuota 1 (${euros(d.primero.importe)}${d.primero.vence ? `, vence el ${fecha(d.primero.vence, conAno)}` : ''}) y se guarda la tarjeta.`);
    if (d.despues.length) out.push(`Después, Stripe cobra solo ${cobrosEnLista(d.despues, conAno)} con la misma tarjeta.`);
  } else {
    const cuotas = d.primero.esInicial ? d.despues : [d.primero, ...d.despues];
    if (d.primero.esInicial) out.push(`Hoy se cobra la inicial (${euros(d.primero.importe)}) con este enlace.`);
    if (cuotas.length) {
      out.push(`Cada cuota tendrá su propio enlace (${cobrosEnLista(cuotas, conAno)}), ${d.linksDeCuotas === 'al_registrar'
        ? 'que te damos al registrar la venta'
        : 'que se crea al pagar la inicial: te lo damos en la venta y en «Links de pago»'}.`);
      out.push(d.recordatorio
        ? 'Si no lo paga, se le recuerda al alumno.'
        : 'El recordatorio automático al alumno está apagado: mándale cada enlace cuando toque.');
    }
  }
  out.push(`Total: ${euros(d.total)}.`);
  return out;
}
