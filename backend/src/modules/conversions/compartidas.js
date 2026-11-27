/*
  FILTRAR LAS VENTAS COMPARTIDAS (CRM#163 y CRM-ISEIE#186, Diego 21/09 y 25/11).

  Una venta atendida entre dos gestoras tiene sus filas en
  `conversion_vendedoras`. En Ventas, Ingresos y Análisis de ventas salían
  mezcladas con el resto y solo se distinguían por la etiqueta A MEDIAS, fila a
  fila.

  Tres opciones: «Todas» (no filtra), «Solo compartidas» y «Solo enteras». Es un
  filtro sobre QUÉ ventas salen, no sobre cuánto cuentan: con una gestora
  elegida, la venta compartida le sigue contando la mitad (`conversion_reparto`
  y su peso, en cada consulta), igual que sin el filtro.

  El valor nunca entra en el SQL: solo elige entre dos condiciones fijas.
*/
import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';

export const OPCIONES = ['todas', 'solo', 'enteras'];

/** El parámetro `compartidas`, tal como lo acepta la API. */
export const compartidasSchema = z.enum(OPCIONES, {
  errorMap: () => ({ message: 'El filtro de reparto solo admite «todas», «solo» o «enteras»' }),
});

/** Lo que llega por la dirección, o null si es «todas» o algo que no se entiende. */
export function opcionDeCompartidas(valor) {
  const v = String(valor || '').trim().toLowerCase();
  return v === 'solo' || v === 'enteras' ? v : null;
}

/**
 * Lee `compartidas` de la query con Zod, para las rutas que no tienen un esquema
 * propio (Ventas, Análisis, la lista del periodo, las cuotas). Sin valor, null
 * («todas»); con un valor que no es de los tres, 400.
 */
export function leerCompartidas(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const r = compartidasSchema.safeParse(valor);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return opcionDeCompartidas(r.data);
}

/** La condición SQL para la venta con alias `alias`, o null si no hay que filtrar. */
export function condicionDeCompartidas(valor, alias = 'c') {
  const opcion = opcionDeCompartidas(valor);
  if (!opcion) return null;
  const existe = `EXISTS (SELECT 1 FROM conversion_vendedoras cvx WHERE cvx.conversion_id = ${alias}.id)`;
  return opcion === 'solo' ? existe : `NOT ${existe}`;
}

/** La misma condición con su `AND ` delante, o '' si no hay que filtrar. */
export function yCompartidas(valor, alias = 'c') {
  const c = condicionDeCompartidas(valor, alias);
  return c ? `AND ${c}` : '';
}
