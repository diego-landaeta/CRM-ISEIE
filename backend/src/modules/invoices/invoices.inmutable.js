import { AppError } from '../../shared/utils/AppError.js';

/**
 * Una factura EMITIDA no se borra ni se cambia (CRM#793, Diego 18/11/2026).
 *
 * Emitida es la que tiene número fiscal y no es borrador ni proforma: una
 * factura normal o un abono. Borradores y proformas se siguen editando y
 * borrando como siempre. La emitida, si hay que dejarla sin efecto, se anula
 * con su motivo y sale su rectificativa (`POST /invoices/:id/anular`).
 */
export function esFacturaEmitida(inv) {
  return !!inv && inv.tipo !== 'proforma' && inv.estado !== 'borrador' && inv.numero != null;
}

/** 409 FACTURA_EMITIDA si la factura está emitida. `que`: «borrar», «cambiar»… */
export function exigirNoEmitida(inv, que = 'cambiar') {
  if (!esFacturaEmitida(inv)) return;
  throw new AppError(
    `La factura ${inv.codigo || ''} ya está emitida: no se puede ${que}. `
    + 'Si hay que dejarla sin efecto, anúlala indicando el motivo y saldrá su rectificativa.',
    409, 'FACTURA_EMITIDA');
}
