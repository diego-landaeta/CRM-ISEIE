/**
 * ¿De donde sale cada cifra de la respuesta? (#30, «que no invente»)
 *
 * «Si no tiene el dato, lo dice. Un numero inventado con buena redaccion es peor
 * que no responder.» Pedirselo al modelo en la instruccion no basta: es una
 * peticion, no una garantia. Aqui se COMPRUEBA, despues, con lo que de verdad
 * devolvio la base.
 *
 * QUE HACE
 *
 * Saca los numeros del texto de la respuesta, saca todos los numeros de los
 * datos que devolvieron las consultas, y mira cuales de los primeros no
 * aparecen en los segundos. Los que no aparecen son «cifras sin comprobar».
 *
 * QUE NO HACE, Y POR QUE ES ASI
 *
 * No bloquea la respuesta: una suma o un porcentaje que el modelo calculo bien
 * tampoco «sale» de los datos tal cual, y esconderlo seria peor. Lo que hace es
 * NO DEJAR PASAR EN SILENCIO una cifra que nadie puede rastrear: la pantalla la
 * enseña marcada y quien lee sabe que esa hay que comprobarla a mano.
 *
 * Tampoco se fia de las que son del propio texto de la pregunta («en 2026»,
 * «las 3 asesoras»): esas las puso quien pregunta, no el modelo.
 */

/** `12.345,67` (es), `12345.67` (en), `1.234` (miles) o `12,5` → numero. */
export function aNumero(crudo) {
  let t = String(crudo).trim().replace(/\s/g, '');
  if (!t) return NaN;
  const tienePunto = t.includes('.');
  const tieneComa = t.includes(',');
  if (tienePunto && tieneComa) {
    // El ultimo separador es el decimal.
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (tieneComa) {
    t = t.replace(',', '.');
  } else if (tienePunto) {
    // «1.234» o «1.234.567» son miles; «12.5» es un decimal.
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  }
  return Number(t);
}

// Numeros con o sin separadores de miles y con o sin decimales.
const NUMERO = /\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;

/**
 * Los numeros de un texto, sin los que no son cifras: fechas, años y los
 * numeros que ya venian en la pregunta.
 */
export function cifrasDelTexto(texto, { pregunta = '' } = {}) {
  let t = String(texto || '');
  // Fechas (2026-07-01, 01/07/2026): el dia y el mes no son datos.
  t = t.replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ');
  // Marcadores de lista («1. », «2) ») al principio de linea.
  t = t.replace(/^\s*\d+[.)]\s/gm, ' ');

  const enLaPregunta = new Set((String(pregunta).match(NUMERO) || []).map(aNumero));
  const salida = [];
  for (const crudo of t.match(NUMERO) || []) {
    const n = aNumero(crudo);
    if (!Number.isFinite(n)) continue;
    // Un año suelto no es una cifra de negocio.
    if (Number.isInteger(n) && n >= 2000 && n <= 2100) continue;
    if (enLaPregunta.has(n)) continue;
    salida.push({ texto: crudo, valor: n });
  }
  return salida;
}

/** Todos los numeros que hay dentro de unos datos, a cualquier profundidad. */
export function numerosDeLosDatos(datos) {
  const encontrados = [];
  const ver = (v) => {
    if (v == null) return;
    if (typeof v === 'number') { if (Number.isFinite(v)) encontrados.push(v); return; }
    if (typeof v === 'string') {
      // Postgres devuelve los `numeric` como cadena.
      if (/^-?\d+(\.\d+)?$/.test(v.trim())) encontrados.push(Number(v));
      return;
    }
    if (Array.isArray(v)) { v.forEach(ver); return; }
    if (typeof v === 'object') Object.values(v).forEach(ver);
  };
  ver(datos);
  return encontrados;
}

const redondea = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * ¿Aparece `valor` entre los datos? Se acepta que el modelo lo redondee: 1234,56
 * puede salir como 1.235 o 1,2 mil, y un porcentaje del 12,34 como 12 o 12,3.
 */
function aparece(valor, numeros) {
  // Con los MISMOS decimales que escribio el modelo: «13» vale para 13,4, pero
  // «12,9» no vale para 13,2. Redondear la cifra del modelo y la del dato a un
  // entero comun dejaria pasar casi cualquier numero que este cerca de alguno.
  const dec = (String(valor).split('.')[1] || '').length;
  for (const d of numeros) {
    if (d === valor) return true;
    if (dec <= 2 && redondea(d, dec) === valor) return true;
    // Las cifras en miles («1,2 mil» para 1.234).
    if (d !== 0 && Math.abs(d) >= 1000 && redondea(d / 1000, dec) === valor) return true;
  }
  return false;
}

/**
 * Las cifras de la respuesta que NO se encuentran en los datos.
 *
 * `datos` es la lista de lo que devolvio cada consulta. Sin datos, cualquier
 * cifra queda sin comprobar.
 */
export function cifrasSinRespaldo(respuesta, datos, { pregunta = '' } = {}) {
  const numeros = numerosDeLosDatos(datos);
  const sin = [];
  for (const c of cifrasDelTexto(respuesta, { pregunta })) {
    if (!aparece(c.valor, numeros)) sin.push(c.texto.trim());
  }
  // Sin repetir, en el orden en que salen.
  return [...new Set(sin)];
}
