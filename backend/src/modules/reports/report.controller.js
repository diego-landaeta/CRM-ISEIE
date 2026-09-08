import * as model from './report.model.js';
import { query } from '../../shared/config/db.js';

// A que proyectos se acota el informe.
//
// Carlos: «ahora solo se puede por proyecto, tengo que tener la opcion de que
// sea por empresa — seleccionar CEDIA y que se vuelquen todos los datos de
// todos los campus asociados».
//
// No hace falta modelo nuevo: la sociedad ya vive en `projects.sociedad_emisora_id`,
// que apunta a `invoice_issuers`. Se traduce la sociedad a su lista de proyectos
// y el resto del informe no se entera de nada.
async function proyectosDelInforme(req) {
  const issuerId = req.query.issuerId ? Number(req.query.issuerId) : null;
  if (!issuerId) {
    return {
      projectId: req.query.projectId ? Number(req.query.projectId) : null,
      projectIds: null,
    };
  }
  const { rows } = await query(
    `SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id`, [issuerId]);
  // Una sociedad sin proyectos NO puede acabar significando «todos»: seria
  // enseñar de mas justo cuando se pidio acotar. Se devuelve una lista que no
  // casa con nada y el informe sale vacio, que es la respuesta honesta.
  return { projectId: null, projectIds: rows.length ? rows.map((r) => r.id) : [-1] };
}

export async function overview(req, res, next) {
  try {
    const { from, to } = req.query;
    const data = await model.overview({
      ...(await proyectosDelInforme(req)),
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// A quien se recorta el informe. Una gestora solo ve lo suyo, y se decide aqui
// —no con lo que llegue por la URL— para que no pueda pedir lo de otra.
// Admin y superadmin ven todo, o lo de una en concreto si lo piden.
export function asesoraDelInforme(req) {
  const rol = req.user?.role;
  if (rol === 'admin' || rol === 'superadmin') {
    return req.query.asesoraId ? Number(req.query.asesoraId) : null;
  }
  return req.user?.userId || -1;
}

function makeReport(fn) {
  return async (req, res, next) => {
    try {
      const { from, to } = req.query;
      const data = await model[fn]({
        ...(await proyectosDelInforme(req)),
        from: from || null,
        to: to || null,
        asesoraId: asesoraDelInforme(req),
      });
      res.json({ success: true, data });
    } catch (err) { next(err); }
  };
}

export const resumenMensual = makeReport('resumenMensual');
export const prospectos = makeReport('prospectosReport');
export const ventas = makeReport('ventasReport');
export const general = makeReport('generalReport');
export const generalFacturacion = makeReport('generalFacturacionReport');
export const cobrosMensuales = makeReport('cobrosMensuales');
export const ventasVendedora = makeReport('ventasVendedora');

// Rango y proyecto tal y como llegan por query. Desde 2026 hacia adelante: lo
// anterior es de la facturacion vieja y no se reporta aqui.
const INICIO_DATOS = '2026-01-01';
// Es `async` porque traducir la sociedad a sus proyectos hay que preguntarlo.
// Todas las llamadas llevan `await`.
async function rangoDeQuery(req) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(req.query.from || '') ? req.query.from : INICIO_DATOS;
  return {
    ...(await proyectosDelInforme(req)),
    from: from < INICIO_DATOS ? INICIO_DATOS : from,
    to: re.test(req.query.to || '') ? req.query.to : null,
    // Por aqui pasan el panel del Resumen, los rankings y el detalle. Sin esto
    // una gestora veia los numeros de todos.
    asesoraId: asesoraDelInforme(req),
    // Base de conteo: 'factura' (que se emitio este mes) o 'cobro' (cuanto
    // dinero entro). Por defecto factura, que es como cuenta la contabilidad;
    // con cobro se caian del mes las facturas emitidas en un mes y cobradas en
    // el anterior.
    base: req.query.base === 'cobro' ? 'cobro' : 'factura',
  };
}

// GET /api/informes/ventas-asesora  -> detalle de ventas con su asesora
export async function ventasAsesora(req, res, next) {
  try {
    res.json({ success: true, data: await model.ventasPorAsesoraReport(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/asesoras-mes  -> por asesora y mes: leads, ventas y cobrado
export async function asesorasMes(req, res, next) {
  try {
    res.json({ success: true, data: await model.asesorasPorMes(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/panel -> KPIs con comparativa y serie para la grafica
export async function panel(req, res, next) {
  try {
    res.json({ success: true, data: await model.panelReportes(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/seguimiento -> a cuantos se les hizo seguimiento y cuanto
// se tardo. Pasa por `rangoDeQuery`, asi que respeta la sociedad y el recorte
// por asesora igual que el resto.
export async function seguimiento(req, res, next) {
  try {
    res.json({ success: true, data: await model.seguimientoYTiempos(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/paises  -> ranking de paises, deducido del prefijo telefonico
export async function paises(req, res, next) {
  try {
    res.json({ success: true, data: await model.paisesMasVendidos(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/formaciones  -> ranking de formaciones
export async function formaciones(req, res, next) {
  try {
    res.json({ success: true, data: await model.formacionesMasVendidas(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/detalle -> las filas que hay detras de un numero del panel
export async function detalle(req, res, next) {
  try {
    const r = await rangoDeQuery(req);
    res.json({ success: true, data: await model.detalleMetrica({
      ...r,
      tipo: String(req.query.tipo || 'ventas'),
      // asesoraId ya viene de rangoDeQuery: para una gestora es ella misma y no
      // puede pedir el de otra; para un admin, el que pida por la URL.
      mes: /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : null,
      pais: req.query.pais || null,
      formacion: req.query.formacion || null,
      limite: req.query.limite || null,
    }) });
  } catch (err) { next(err); }
}

// GET /api/informes/tasa-cierre -> el numero unico, con su desglose por meses.
export async function tasaCierre(req, res, next) {
  try {
    res.json({ success: true, data: await model.tasaDeCierre(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/tasa-cierre/detalle?lado=cerrados|todos
// Las personas que hay detras de cada sumando, para el «¿de donde sale?».
export async function tasaCierreDetalle(req, res, next) {
  try {
    res.json({ success: true, data: await model.detalleTasaDeCierre({
      ...await rangoDeQuery(req),
      lado: req.query.lado === 'todos' ? 'todos' : 'cerrados',
      limit: Math.min(2000, Number(req.query.limite) || 500),
    }) });
  } catch (err) { next(err); }
}

// GET /api/informes/aviso-sin-factura — que se va a quedar fuera del informe.
export async function avisoSinFactura(req, res, next) {
  try {
    const r = await rangoDeQuery(req);
    res.json({ success: true, data: await model.ventasSinFacturaEnRango({
      projectId: r.projectId, projectIds: r.projectIds, from: r.from, to: r.to,
    })});
  } catch (err) { next(err); }
}
