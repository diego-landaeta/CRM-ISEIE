import { describe, it, expect } from 'vitest';
import {
  aNumero, cifrasDelTexto, numerosDeLosDatos, cifrasSinRespaldo,
} from '../src/modules/ia-analisis/cifras.js';

/**
 * «Que no invente» (#30): cada cifra de la respuesta tiene que poder rastrearse
 * hasta los datos que devolvio la base.
 *
 * Pedirselo al modelo en la instruccion es una peticion, no una garantia. Esto
 * la comprueba despues. La regla mas facil de romper sin querer es la de los
 * decimales: si se redondea la cifra del modelo y la del dato a un entero comun,
 * casi cualquier numero «esta cerca» de alguno y pasa. Por eso hay casos de las
 * dos direcciones.
 */

describe('leer un numero escrito en español', () => {
  it.each([
    ['1.234', 1234],
    ['1.234.567', 1234567],
    ['1.234,56', 1234.56],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['1,234.56', 1234.56],
    ['1 234', 1234],
    ['0,75', 0.75],
  ])('«%s» es %d', (texto, esperado) => {
    expect(aNumero(texto)).toBe(esperado);
  });
});

describe('que cuenta como cifra del texto', () => {
  it('saca los importes y los porcentajes', () => {
    const c = cifrasDelTexto('Se cobraron 12.345,67 € y el 18,5 % fue en julio.').map((x) => x.valor);
    expect(c).toEqual([12345.67, 18.5]);
  });

  it('no cuenta las fechas ni los años', () => {
    expect(cifrasDelTexto('Del 2026-07-01 al 2026-07-31, en 2026.')).toEqual([]);
    expect(cifrasDelTexto('Hasta el 31/07/2026.')).toEqual([]);
  });

  it('no cuenta los marcadores de lista', () => {
    expect(cifrasDelTexto('1. Primera\n2. Segunda')).toEqual([]);
  });

  it('no cuenta los numeros que ya venian en la pregunta', () => {
    // «las 3 asesoras» lo puso quien pregunta, no el modelo.
    const c = cifrasDelTexto('Las 3 asesoras vendieron 40.', { pregunta: '¿cuánto vendieron las 3 asesoras?' });
    expect(c.map((x) => x.valor)).toEqual([40]);
  });
});

describe('los numeros que hay en los datos', () => {
  it('a cualquier profundidad, y tambien los que Postgres devuelve como cadena', () => {
    const n = numerosDeLosDatos({ a: 1, b: { c: [2, { d: '3.50' }] }, e: 'texto', f: null });
    expect(n.sort()).toEqual([1, 2, 3.5]);
  });
});

describe('cifras sin respaldo', () => {
  const datos = [{ leads: { total: 120, convertido: 18 }, cobrado: '12345.67', mes: [{ ventas: 7 }] }];

  it('una cifra que esta en los datos se respalda', () => {
    expect(cifrasSinRespaldo('Hubo 120 prospectos y 18 convertidos.', datos)).toEqual([]);
  });

  it('un importe con formato español se respalda', () => {
    expect(cifrasSinRespaldo('Se cobraron 12.345,67 €.', datos)).toEqual([]);
  });

  it('redondear al entero esta permitido', () => {
    expect(cifrasSinRespaldo('Se cobraron unos 12.346 €.', datos)).toEqual([]);
  });

  it('una cifra inventada se marca', () => {
    expect(cifrasSinRespaldo('Hubo 9.999 prospectos.', datos)).toEqual(['9.999']);
  });

  it('un decimal que no es el redondeo del dato NO se respalda por estar cerca', () => {
    // 12,9 no es 13,2 redondeado: con un redondeo comun a entero los dos
    // darian 13 y se colaria.
    expect(cifrasSinRespaldo('La tasa fue del 12,9 %.', [{ tasa: 13.2 }])).toEqual(['12,9']);
    expect(cifrasSinRespaldo('La tasa fue del 13,2 %.', [{ tasa: 13.2 }])).toEqual([]);
    expect(cifrasSinRespaldo('La tasa fue del 13 %.', [{ tasa: 13.2 }])).toEqual([]);
  });

  it('las cifras en miles se respaldan', () => {
    expect(cifrasSinRespaldo('Cobrado: 12,3 mil euros.', [{ cobrado: 12345.67 }])).toEqual([]);
    // Y si en los datos no hay nada de ese orden, se marca.
    expect(cifrasSinRespaldo('Cobrado: 12,3 mil euros.', [{ cobrado: 500 }])).toEqual(['12,3']);
  });

  it('sin datos, cualquier cifra queda sin comprobar', () => {
    expect(cifrasSinRespaldo('Se vendieron 40.', [])).toEqual(['40']);
  });

  it('una respuesta sin cifras no tiene nada que comprobar', () => {
    expect(cifrasSinRespaldo('No tengo ese dato.', datos)).toEqual([]);
  });

  it('no repite la misma cifra', () => {
    expect(cifrasSinRespaldo('Fueron 77 y otra vez 77.', datos)).toEqual(['77']);
  });
});
