import { z } from 'zod';
import * as reportes from '../reports/report.model.js';
import { campanaQueRinde } from './campanas.js';

/**
 * Lo unico que la IA puede preguntarle a la base (#30, primera subfase).
 *
 * «Capa de solo lectura: consultas preparadas y tiempo maximo. La IA no ejecuta
 * lo que se le ocurra contra la base de produccion.»
 *
 * NO HAY SQL AQUI, Y ES EL PUNTO ENTERO
 *
 * (Una excepcion, y vive aparte: `campana_que_rinde` ejecuta `campanas.js`,
 * porque ningun informe cruza el gasto de una campaña con las ventas de sus
 * prospectos. Sigue siendo una consulta PREPARADA, de solo lectura y sin texto
 * del modelo dentro: el modelo solo elige fechas.)
 *
 * La tentacion evidente es dejar que el modelo escriba la consulta y ejecutarla
 * con un usuario de solo lectura. No se hace, por dos motivos:
 *
 *  1. Solo lectura no protege de un `SELECT` que cruce seis tablas sin indice y
 *     tenga la base ocupada un minuto. Leer tambien tumba.
 *  2. Y sobre todo: los numeros del CRM ya estan cuadrados en `report.model.js`
 *     —el reporte semanal se hizo sin escribir NI UNA consulta nueva por eso
 *     mismo—. Una consulta inventada por el modelo daria otro numero que el que
 *     enseña la pantalla, y entonces uno de los dos miente sin que nadie sepa
 *     cual.
 *
 * Asi que la IA elige de una lista y pasa parametros. Nada mas.
 *
 * LA REGLA DEL DINERO SE HEREDA
 *
 * Lo cobrado sale de `conversion_payments`, nunca de `conversions.importe_pagado`
 * —ese campo declara de mas: 209.930 € en ISEIE—. No hace falta repetirlo aqui
 * porque estas funciones son las mismas que usan las pantallas y el reporte
 * semanal.
 */

/** Ninguna consulta puede tener la base ocupada mas de esto. */
export const TOPE_MS = 8000;

/** Una fecha YYYY-MM-DD que existe: `2026-13-45` pasaria un regex y rompe en Postgres. */
const fechaReal = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
});

/**
 * Parametros de `campana_que_rinde`. Zod trata cada valor como lo que es —texto
 * de un modelo— y NO lo corrige: `'3; DROP TABLE'` no es un 3, es un descarte.
 * (`projectId` lo pone el servidor; se admite aqui por si se llama sin alcance.)
 */
export const ESQUEMA_CAMPANAS = z.object({
  projectId: z.coerce.number().int().positive(),
  from: fechaReal,
  to: fechaReal,
});

/**
 * El catalogo. Cada entrada dice que contesta y que parametros admite, en un
 * texto que se le puede dar al modelo tal cual. Con `esquema` (Zod), cada
 * parametro se valida con el suyo; sin el, con las reglas generales de abajo.
 */
export const CONSULTAS = {
  resumen_general: {
    descripcion: 'Resumen de un periodo: leads por estado y por canal, conversiones y dinero cobrado.',
    parametros: ['projectId', 'from', 'to', 'asesoraId'],
    ejecutar: (p) => reportes.overview(p),
  },
  resumen_mensual: {
    descripcion: 'Lo mismo pero desglosado mes a mes, para comparar un periodo con otro.',
    parametros: ['projectId', 'from', 'to', 'asesoraId'],
    ejecutar: (p) => reportes.resumenMensual(p),
  },
  ventas_por_asesora: {
    descripcion: 'Cada venta con su asesora, su fecha y su importe. Para ver quien cerro que.',
    parametros: ['projectId', 'from', 'to', 'asesoraId'],
    ejecutar: (p) => reportes.ventasPorAsesoraReport(p),
  },
  campana_que_rinde: {
    descripcion: 'Qué campaña de Meta rinde: por campaña, gasto, prospectos que llegaron al CRM por ella, '
      + 'ventas (conversiones con algún cobro, sin mensualidades), lo cobrado de verdad, coste por venta y '
      + 'retorno, más los totales. Dos lecturas del periodo: retorno = gasto del periodo frente a lo '
      + 'cobrado hasta hoy por los prospectos captados en él; retorno_en_periodo = lo que ha entrado '
      + 'dentro del periodo. Dilo así al citar el retorno.',
    parametros: ['projectId', 'from', 'to'],
    esquema: ESQUEMA_CAMPANAS,
    ejecutar: (p) => campanaQueRinde(p),
  },
};

export const NOMBRES = Object.keys(CONSULTAS);

/**
 * El catalogo en texto, para meterlo en la instruccion del modelo.
 *
 * Se genera del mismo objeto que se ejecuta: una lista escrita a mano se
 * quedaria vieja al añadir una consulta, y el modelo pediria cosas que ya no
 * existen o no sabria las que si.
 */
export const catalogoEnTexto = () =>
  NOMBRES.map((n) => `- ${n}: ${CONSULTAS[n].descripcion} (parámetros: ${CONSULTAS[n].parametros.join(', ')})`)
    .join('\n');

/**
 * Las consultas como herramientas de Claude (#30, segunda subfase).
 *
 * Se generan del mismo objeto que se ejecuta, por lo mismo que `catalogoEnTexto`.
 *
 * EL PROYECTO NO ES UN PARAMETRO. El modelo no ve `projectId` ni `projectIds` y
 * no puede pedirlos: el alcance lo pone el servidor segun quien pregunta (ver
 * `ejecutar`). Si fuera un parametro, bastaria que alguien escribiera «y ahora
 * los de ICTESS» para que el modelo se lo pidiera a la base.
 */
export function herramientasParaClaude() {
  return NOMBRES.map((nombre) => {
    const c = CONSULTAS[nombre];
    const propiedades = {
      from: { type: 'string', description: 'Inicio del periodo, formato YYYY-MM-DD.' },
      to: { type: 'string', description: 'Fin del periodo, formato YYYY-MM-DD, incluido.' },
    };
    if (c.parametros.includes('asesoraId')) {
      propiedades.asesoraId = {
        type: 'integer',
        description: 'Id de una asesora concreta. Solo si la pregunta es por una persona y se conoce su id.',
      };
    }
    return { name: nombre, description: c.descripcion, input_schema: { type: 'object', properties: propiedades } };
  });
}

/** Una fecha de las que acepta Postgres, y no cualquier cosa. */
const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Limpia los parametros: solo los que la consulta admite, y con el tipo bueno.
 *
 * Lo que llega aqui lo ha escrito un modelo de lenguaje, asi que se trata como
 * lo que es: entrada de fuera. Un `projectId` que no sea un numero o un `from`
 * con formato raro no se corrigen — se descartan, y la consulta se hace sin
 * ellos. Adivinar que queria decir es como se cuelan los numeros que no son.
 */
export function limpiarParametros(nombre, dados = {}) {
  const admite = CONSULTAS[nombre]?.parametros || [];
  const esquema = CONSULTAS[nombre]?.esquema;
  const limpio = {};
  for (const clave of admite) {
    const v = dados[clave];
    if (v == null || v === '') continue;
    if (esquema) {
      // Con esquema Zod manda el: valido o descartado, sin intermedios.
      const r = esquema.shape[clave]?.safeParse(v);
      if (r?.success) limpio[clave] = r.data;
      continue;
    }
    if (clave === 'projectId' || clave === 'asesoraId') {
      const n = parseInt(v, 10);
      if (Number.isInteger(n) && n > 0) limpio[clave] = n;
    } else if (clave === 'from' || clave === 'to') {
      if (esFecha(v)) limpio[clave] = v;
    }
  }
  return limpio;
}

/**
 * Ejecuta una consulta del catalogo, con tope de tiempo.
 *
 * Devuelve `{ nombre, parametros, datos }` — con los parametros DE VERDAD
 * usados, no los que pidio el modelo. Esa diferencia es la que permite
 * comprobar la respuesta a mano: si contesto «julio» pero se ejecuto sin fechas,
 * se ve.
 */
export async function ejecutar(nombre, parametros = {}, { alcance = null } = {}) {
  const consulta = CONSULTAS[nombre];
  if (!consulta) {
    // Se dice QUE se pidio y que hay: si el modelo se inventa un nombre, el
    // registro tiene que servir para saberlo sin adivinar.
    const err = new Error(`Consulta desconocida: ${nombre}. Disponibles: ${NOMBRES.join(', ')}`);
    err.code = 'CONSULTA_DESCONOCIDA';
    throw err;
  }

  // EL ALCANCE LO PONE EL SERVIDOR (#30, #245). Con `alcance`, lo que el modelo
  // haya puesto de proyecto se tira y manda el de quien pregunta: un admin de
  // una empresa solo mide sus campus, diga lo que diga el modelo. Sin `alcance`
  // se comporta como siempre. `alcance: {}` es «sin recorte» (superadmin).
  const limpios = limpiarParametros(nombre, parametros);
  if (alcance) {
    delete limpios.projectId;
    const id = parseInt(alcance.projectId, 10);
    if (Number.isInteger(id) && id > 0) limpios.projectId = id;
    if (Array.isArray(alcance.projectIds) && alcance.projectIds.length) {
      limpios.projectIds = alcance.projectIds.map(Number).filter((n) => Number.isInteger(n));
    }
  }

  // El tope va aqui y no en la consulta: `statement_timeout` de Postgres corta
  // la consulta pero no libera al que espera si el pool esta lleno, y lo que se
  // protege es el CRM entero, no solo la base.
  let reloj;
  const conTope = new Promise((_, rechazar) => {
    reloj = setTimeout(() => {
      const err = new Error(`La consulta «${nombre}» tardo mas de ${TOPE_MS / 1000} segundos y se corto.`);
      err.code = 'CONSULTA_LENTA';
      rechazar(err);
    }, TOPE_MS);
  });

  try {
    const datos = await Promise.race([consulta.ejecutar(limpios), conTope]);
    return { nombre, parametros: limpios, datos };
  } finally {
    clearTimeout(reloj);
  }
}
