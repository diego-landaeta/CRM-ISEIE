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
