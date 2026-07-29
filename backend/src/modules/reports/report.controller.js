import * as model from './report.model.js';

export async function overview(req, res, next) {
  try {
    const { projectId, from, to } = req.query;
    const data = await model.overview({
      projectId: projectId ? Number(projectId) : null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

function makeReport(fn) {
  return async (req, res, next) => {
    try {
      const { projectId, from, to } = req.query;
      const data = await model[fn]({
        projectId: projectId ? Number(projectId) : null,
        from: from || null,
        to: to || null,
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
function rangoDeQuery(req) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const from = re.test(req.query.from || '') ? req.query.from : INICIO_DATOS;
  return {
    projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
    from: from < INICIO_DATOS ? INICIO_DATOS : from,
    to: re.test(req.query.to || '') ? req.query.to : null,
  };
}

// GET /api/reports/ventas-asesora  -> detalle de ventas con su asesora
export async function ventasAsesora(req, res, next) {
  try {
    res.json({ success: true, data: await model.ventasPorAsesoraReport(rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/reports/asesoras-mes  -> por asesora y mes: leads, ventas y cobrado
export async function asesorasMes(req, res, next) {
  try {
    res.json({ success: true, data: await model.asesorasPorMes(rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/reports/panel -> KPIs con comparativa y serie para la grafica
export async function panel(req, res, next) {
  try {
    res.json({ success: true, data: await model.panelReportes(rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/reports/paises  -> ranking de paises, deducido del prefijo telefonico
export async function paises(req, res, next) {
  try {
    res.json({ success: true, data: await model.paisesMasVendidos(rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/reports/formaciones  -> ranking de formaciones
export async function formaciones(req, res, next) {
  try {
    res.json({ success: true, data: await model.formacionesMasVendidas(rangoDeQuery(req)) });
  } catch (err) { next(err); }
}
