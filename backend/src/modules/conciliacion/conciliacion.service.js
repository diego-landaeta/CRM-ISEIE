import { getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { esFacturaEmitida } from '../invoices/invoices.inmutable.js';
import * as model from './conciliacion.model.js';

/*
  Conciliación · Facturas y cobros (CRM#905). Las dos listas, sus candidatos y
  el enlace. Ver conciliacion.model.js para la regla de qué casa con qué.
*/

const redondear = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * Cuántas parejas tiene cada factura y cada cobro. Una pareja es segura cuando
 * los dos lados tienen solo esa.
 */
function cuentas(todas) {
  const porFactura = new Map();
  const porCobro = new Map();
  for (const p of todas) {
    porFactura.set(p.invoice_id, (porFactura.get(p.invoice_id) || 0) + 1);
    porCobro.set(p.payment_id, (porCobro.get(p.payment_id) || 0) + 1);
  }
  return (p) => porFactura.get(p.invoice_id) === 1 && porCobro.get(p.payment_id) === 1;
}

/**
 * Las parejas de esas facturas y cobros y, para decidir si son seguras, TODAS
 * las parejas de los del otro lado (también las de otros meses): un cobro de
 * octubre que casa con una factura de noviembre y con otra de octubre no es
 * seguro aunque en noviembre solo se vea una.
 */
async function parejasConSeguras({ invoiceIds, paymentIds, dias }) {
  const primeras = await model.parejas({ invoiceIds, paymentIds, dias });
  const facturas = [...new Set([...invoiceIds, ...primeras.map((p) => p.invoice_id)])];
  const cobros = [...new Set([...paymentIds, ...primeras.map((p) => p.payment_id)])];
  const todas = facturas.length === invoiceIds.length && cobros.length === paymentIds.length
    ? primeras
    : await model.parejas({ invoiceIds: facturas, paymentIds: cobros, dias });
  const esSegura = cuentas(todas);
  return todas.map((p) => ({ ...p, segura: esSegura(p) }));
}

/** Las dos listas del mes, con sus candidatos, y las seguras. */
export async function listar({ campus, mes, dias = model.DIAS }) {
  const rango = model.rangoDelMes(mes);
  const [facturas, cobros] = await Promise.all([
    model.facturasSinCobro({ campus, rango }),
    model.cobrosSinFactura({ campus, rango }),
  ]);
  const parejas = await parejasConSeguras({
    invoiceIds: facturas.map((f) => Number(f.id)),
    paymentIds: cobros.map((c) => Number(c.id)),
    dias,
  });

  const deFactura = new Map();
  const deCobro = new Map();
  for (const p of parejas) {
    if (!deFactura.has(p.invoice_id)) deFactura.set(p.invoice_id, []);
    deFactura.get(p.invoice_id).push(p);
    if (!deCobro.has(p.payment_id)) deCobro.set(p.payment_id, []);
    deCobro.get(p.payment_id).push(p);
  }

  const filasFacturas = facturas.map((f) => ({
    ...f,
    candidatos: (deFactura.get(Number(f.id)) || []).map((p) => ({
      payment_id: p.payment_id, fecha: p.cobro_fecha, importe: p.importe, cliente: p.cobro_cliente,
      producto: p.producto, conversion_id: p.conversion_id, dias: p.dias, por: p.por, segura: p.segura,
    })),
  }));
  const filasCobros = cobros.map((c) => ({
    ...c,
    en_cola: !c.fuera_de_cola,
    candidatas: (deCobro.get(Number(c.id)) || []).map((p) => ({
      invoice_id: p.invoice_id, codigo: p.codigo, fecha: p.factura_fecha, cliente: p.factura_cliente,
      dias: p.dias, por: p.por, segura: p.segura,
    })),
  }));

  // Las seguras de lo que se ve: las de las facturas del mes y las de los cobros
  // del mes (una pareja puede estar en las dos listas: una sola vez).
  const delMes = new Set([...filasFacturas.map((f) => Number(f.id))]);
  const cobrosDelMes = new Set(filasCobros.map((c) => Number(c.id)));
  const vistas = new Map();
  for (const p of parejas) {
    if (!p.segura) continue;
    if (!delMes.has(p.invoice_id) && !cobrosDelMes.has(p.payment_id)) continue;
    vistas.set(p.invoice_id, { invoice_id: p.invoice_id, payment_id: p.payment_id, importe: p.importe });
  }
  const seguras = [...vistas.values()];

  return {
    mes: mes || null,
    dias,
    facturas: filasFacturas,
    cobros: filasCobros,
    resumen: {
      facturas_sin_cobro: filasFacturas.length,
      importe_facturas: redondear(filasFacturas.reduce((s, f) => s + Number(f.total), 0)),
      cobros_sin_factura: filasCobros.length,
      importe_cobros: redondear(filasCobros.reduce((s, c) => s + Number(c.importe), 0)),
      seguras: seguras.length,
      importe_seguras: redondear(seguras.reduce((s, p) => s + Number(p.importe), 0)),
    },
    seguras,
  };
}

/**
 * Enlaza UNA factura con UN cobro, en su transacción. 409 si la factura ya
 * tiene cobro o el cobro ya tiene factura; nada más se cambia en la factura.
 *
 * `campus`: los campus de quien enlaza (null = todos). Fuera de ellos, 404: no
 * se confirma que exista.
 */
export async function enlazar({ invoiceId, paymentId, campus, userId = null, ip = null }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    const exec = (sql, params) => db.query(sql, params);
    const factura = await model.facturaParaEnlazar(exec, invoiceId);
    if (!factura || (campus && !campus.includes(Number(factura.project_id)))) {
      throw new AppError('Esa factura no existe.', 404, 'NOT_FOUND');
    }
    if (factura.payment_id) {
      throw new AppError(`La factura ${factura.codigo} ya tiene su cobro enlazado.`, 409, 'FACTURA_YA_TIENE_COBRO');
    }
    if (factura.tipo !== 'normal' || !esFacturaEmitida(factura) || factura.estado === 'cancelada' || factura.anulada_at) {
      throw new AppError(`La factura ${factura.codigo || factura.id} no es una factura emitida y viva: no se enlaza.`, 409, 'FACTURA_NO_ENLAZABLE');
    }
    const cobro = await model.cobroParaEnlazar(exec, paymentId);
    if (!cobro || (campus && !campus.includes(Number(cobro.project_id)))) {
      throw new AppError('Ese cobro no existe.', 404, 'NOT_FOUND');
    }
    if (cobro.tiene_factura) {
      throw new AppError(`Ese cobro ya tiene la factura ${cobro.factura_codigo}.`, 409, 'COBRO_YA_FACTURADO');
    }
    if (Number(cobro.project_id) !== Number(factura.project_id)) {
      throw new AppError('La factura y el cobro son de campus distintos.', 409, 'OTRO_CAMPUS');
    }
    if (Math.abs(Number(cobro.importe) - Number(factura.total)) >= 0.005) {
      throw new AppError('La factura y el cobro no son del mismo importe.', 409, 'IMPORTE_DISTINTO');
    }
    const hecha = await model.enlazar(exec, { invoiceId: factura.id, payment: cobro });
    if (!hecha) throw new AppError(`La factura ${factura.codigo} ya tiene su cobro enlazado.`, 409, 'FACTURA_YA_TIENE_COBRO');
    await model.apuntar(exec, {
      userId, ip,
      detalle: {
        invoice_id: factura.id, codigo: factura.codigo, payment_id: cobro.id, project_id: factura.project_id,
        importe: factura.total, antes: { conversion_id: factura.conversion_id, lead_id: factura.lead_id },
        despues: { conversion_id: hecha.conversion_id, lead_id: hecha.lead_id },
      },
    });
    await db.query('COMMIT');
    return hecha;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    // Dos a la vez sobre el mismo cobro: el índice único de la 107 para al segundo.
    if (err?.code === '23505') throw new AppError('Ese cobro ya tiene factura.', 409, 'COBRO_YA_FACTURADO');
    throw err;
  } finally {
    db.release();
  }
}

/**
 * «Enlazar todas las seguras» del mes. Quien confirma dice cuántas y por cuánto
 * vio; si ya no son esas (alguien enlazó entre medias), 409 con las de ahora y
 * no se toca nada. Cada una va en su transacción: una que falle no deshace las
 * demás, y se cuenta.
 */
export async function enlazarSeguras({ campus, mes, dias = model.DIAS, cuantas, importe, userId = null, ip = null }) {
  const { seguras, resumen } = await listar({ campus, mes, dias });
  if (Number(cuantas) !== resumen.seguras || Math.abs(Number(importe) - resumen.importe_seguras) >= 0.005) {
    throw new AppError(
      `Las seguras han cambiado: ahora son ${resumen.seguras} por ${resumen.importe_seguras.toFixed(2)} €. Revísalas y confirma otra vez.`,
      409, 'SEGURAS_CAMBIADAS', { seguras: resumen.seguras, importe: resumen.importe_seguras });
  }
  const enlazadas = [];
  const fallidas = [];
  for (const p of seguras) {
    try {
      const r = await enlazar({ invoiceId: p.invoice_id, paymentId: p.payment_id, campus, userId, ip });
      enlazadas.push({ invoice_id: r.id, codigo: r.codigo, payment_id: r.payment_id, importe: r.total });
    } catch (err) {
      if (!(err instanceof AppError)) logger.error({ err: err.message, ...p }, 'conciliación: no se pudo enlazar una segura');
      fallidas.push({ ...p, error: err.message, code: err.code || null });
    }
  }
  return {
    enlazadas: enlazadas.length,
    importe: redondear(enlazadas.reduce((s, e) => s + Number(e.importe), 0)),
    detalle: enlazadas,
    fallidas,
  };
}
