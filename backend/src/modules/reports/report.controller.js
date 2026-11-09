import * as model from './report.model.js';
import { query } from '../../shared/config/db.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';
import { dineroPorCanal } from './dondePonerElDinero.js';
import { tramosPara, lecturaDe, guardarTramos, quitarTramos } from './tasaBaremo.js';
import {
  actividadPorComercial, detalleActividadPorComercial, TIPOS_DE_DETALLE,
  proyectosDeLaPersona, ayerEnMadrid,
} from '../mcp/mcp.model.js';
import { construirAmbito, acotarProyectos, responsableImpuesto, alcanceDelMcp } from '../mcp/mcp.acceso.js';
import { alcanceComercial, alcanceDeLider, dentroDelAlcance, personasDentro } from '../../shared/utils/roles.js';

// A que proyectos se acota el informe.
//
// Carlos: «ahora solo se puede por proyecto, tengo que tener la opcion de que
// sea por empresa — seleccionar CEDIA y que se vuelquen todos los datos de
// todos los campus asociados».
//
// No hace falta modelo nuevo: la sociedad ya vive en `projects.sociedad_emisora_id`,
// que apunta a `invoice_issuers`. Se traduce la sociedad a su lista de proyectos
// y el resto del informe no se entera de nada.
// Siempre dentro de lo suyo (`proyectosDelAmbito`): antes un admin de CEDIA
// pedía el informe de ICTESS con su `issuerId` o su `projectId` en la URL, y
// sin ninguno veía el de todas las empresas.
const proyectosDelInforme = (req) => proyectosDelAmbito(req);

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
//
// Una administradora con equipo comercial (09/11/2026): ella y sus gestoras, o
// una de ellas si la pide. Devuelve entonces una LISTA (el modelo la acepta).
export async function asesoraDelInforme(req) {
  const alcance = await alcanceComercial(req.user);
  if (alcance && alcance.length > 1) return personasDentro(alcance, req.query.asesoraId);
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
        asesoraId: await asesoraDelInforme(req),
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
    asesoraId: await asesoraDelInforme(req),
    // Base de conteo: 'factura' (que se emitio este mes) o 'cobro' (cuanto
    // dinero entro). Por defecto factura, que es como cuenta la contabilidad;
    // con cobro se caian del mes las facturas emitidas en un mes y cobradas en
    // el anterior.
    // Tres bases. «cerrado» es la de contabilidad: el mes en que la factura
    // queda cobrada. Cualquier otra cosa mantiene el defecto de siempre.
    base: ['cobro', 'cerrado'].includes(req.query.base) ? req.query.base : 'factura',
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

/**
 * GET /api/informes/mi-puesto -> como va quien pregunta.
 *
 * Una gestora solo puede pedir el suyo. Un admin puede mirar el de otra
 * --lo necesita para acompañarla-- pasando `gestoraId`.
 */
export async function miPuesto(req, res, next) {
  try {
    const esJefe = await tienePermiso(req, 'reports.puesto_ajeno');
    const pedido = req.query.gestoraId ? Number(req.query.gestoraId) : null;
    // Quien lleva un equipo comercial (QA del 09/11/2026): el puesto de una
    // gestora de fuera, no; y de la tabla, solo las filas de su equipo.
    const lider = await alcanceDeLider(req.user);
    if (esJefe && pedido && !dentroDelAlcance(lider, pedido)) {
      throw new AppError('Esa gestora no está en tu equipo', 403, 'FUERA_DE_TU_EQUIPO');
    }
    const userId = esJefe && pedido ? pedido : req.user.userId;
    const { from, to, ...ambito } = await rangoDeQuery(req);
    // Por defecto, EL MES EN CURSO. Con el historico entero el puesto casi no
    // se mueve --lo que se hizo en marzo pesa igual que lo de ayer-- y deja de
    // servir para corregir nada a tiempo.
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const desde = re.test(req.query.from || '') ? from : `${mes}-01`;
    const hasta = re.test(req.query.to || '') ? to : `${mes}-${String(hoy.getDate()).padStart(2, '0')}`;
    // `asesoraId` se queda fuera a proposito: recorta el informe a UNA persona
    // y aqui hace falta la tabla entera para saber en que puesto va.
    const { asesoraId, base, ...sinAsesora } = ambito;
    const data = await model.miPuesto({
      userId, from: desde, to: hasta, ...sinAsesora, esJefe,
      // Por fecha de VENTA salvo que pidan lo contrario: es lo que la gestora
      // reconoce como suyo el dia que cierra.
      base: ['factura', 'cerrado'].includes(req.query.base) ? req.query.base : 'cobro',
    });
    if (lider && Array.isArray(data.tabla)) {
      data.tabla = data.tabla.filter((f) => dentroDelAlcance(lider, f.user_id));
      // «Sin gestora» y el total son del campus entero: para ella, no.
      data.sin_gestora = null;
      data.total = null;
    }
    res.json({ success: true, data });
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

// GET /api/informes/canales  -> de donde vienen los prospectos y las ventas (#48)
export async function canales(req, res, next) {
  try {
    res.json({ success: true, data: await model.origenDeLosProspectos(await rangoDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/informes/canales/dinero  -> dónde poner el dinero (#56): por canal y campaña, contra el periodo anterior.
// Solo admin y super admin (lleva el gasto), y recortado a SUS campus.
export async function dondePonerElDinero(req, res, next) {
  try {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const hoy = new Date();
    const dia = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = req.query.from || dia(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    const to = req.query.to || dia(hoy);
    if (!re.test(from) || !re.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      throw new AppError('from y to tienen que ser fechas AAAA-MM-DD', 400, 'INVALID_DATE');
    }
    if (from > to) throw new AppError('from no puede ser posterior a to', 400, 'INVALID_RANGE');
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) throw new AppError('El rango no puede pasar de un año', 400, 'INVALID_RANGE');
    res.json({ success: true, data: await dineroPorCanal({ ...(await proyectosDelAmbito(req)), from, to }) });
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
    const r = await rangoDeQuery(req);
    const tasa = await model.tasaDeCierre(r);
    // Qué significa el número (#39): el tramo del baremo, si lo hay; y, para una
    // gestora, frente al equipo, que no necesita que nadie invente umbrales.
    const { ambito, tramos } = await tramosPara(r.projectIds || (r.projectId ? [r.projectId] : null));
    const equipo = r.asesoraId ? (await model.tasaDeCierre({ ...r, asesoraId: null })).tasa : null;
    res.json({ success: true, data: { ...tasa, baremo: { ambito, tramos }, lectura: lecturaDe(tasa.tasa, tramos), equipo } });
  } catch (err) { next(err); }
}

// GET /api/informes/tasa-cierre/baremo — los tramos que aplican a este ámbito.
export async function baremo(req, res, next) {
  try {
    const r = await rangoDeQuery(req);
    res.json({ success: true, data: await tramosPara(r.projectIds || (r.projectId ? [r.projectId] : null)) });
  } catch (err) { next(err); }
}

// PUT /api/informes/tasa-cierre/baremo { tramos, general? | project_id } — solo admin y super admin.
// Un campus suyo, o el general (solo super admin).
export async function guardarBaremo(req, res, next) {
  try {
    let projectId = null;
    if (req.body?.general === true) {
      if (req.user.role !== 'superadmin') throw new AppError('El baremo general lo cambia un super admin', 403, 'FORBIDDEN');
    } else {
      projectId = Number(req.body?.project_id ?? req.query.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError('Falta el campus (project_id) o general: true', 400, 'PROJECT_REQUIRED');
      req.query.projectId = String(projectId);
      await proyectosDelAmbito(req); // 403 si no es uno de sus campus
    }
    const tramos = await guardarTramos({ projectId, tramos: req.body?.tramos, userId: req.user.userId });
    res.json({ success: true, data: { project_id: projectId, tramos } });
  } catch (err) { next(err); }
}

// DELETE /api/informes/tasa-cierre/baremo?projectId= | general=true — vuelve a no etiquetar.
export async function quitarBaremo(req, res, next) {
  try {
    let projectId = null;
    if (req.query.general === 'true') {
      if (req.user.role !== 'superadmin') throw new AppError('El baremo general lo cambia un super admin', 403, 'FORBIDDEN');
    } else {
      projectId = Number(req.query.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) throw new AppError('Falta el campus (projectId) o general=true', 400, 'PROJECT_REQUIRED');
      await proyectosDelAmbito(req);
    }
    await quitarTramos(projectId);
    res.json({ success: true });
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


// ─── Actividad por comercial (#203, parte B) ──────────────────────────────
//
// La pantalla usa LA MISMA consulta que Claude (`actividadPorComercial`, parte
// A) y el mismo ámbito: sale de la persona (sus campus de `user_projects`; el
// superadmin, todos), y el campus o la empresa que pida la pantalla solo lo
// estrechan. Quien no es admin ni superadmin se ve solo a sí misma.
async function ambitoDeActividad(req) {
  const user = { id: req.user.userId, role: req.user.role };
  // Un campus de pruebas solo se ve si se elige él o su empresa (migración
  // 148); con «Todos», no. Claude no los ve nunca.
  const eligeAlgo = Boolean(req.query.projectId || req.query.issuerId);
  const ambito = construirAmbito(user, await proyectosDeLaPersona(user, { conPruebas: eligeAlgo }), await alcanceDelMcp(user));
  const projectIds = acotarProyectos(ambito, {
    proyecto_id: req.query.projectId ? Number(req.query.projectId) : null,
    sociedad_id: req.query.issuerId ? Number(req.query.issuerId) : null,
  });
  return { projectIds, responsableId: responsableImpuesto(ambito) };
}

// Una fecha AAAA-MM-DD que existe: el 30/02 tiene buen formato y no existe
// (llegaba a Postgres y daba un 500).
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s)
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Sin fechas, ayer (lo primero que se mira por la mañana).
function periodoDeActividad(req) {
  for (const k of ['desde', 'hasta']) {
    if (req.query[k] && !esFecha(req.query[k])) {
      throw new AppError(`Fecha no válida en «${k}»: ${req.query[k]}.`, 400, 'FECHA_NO_VALIDA');
    }
  }
  const desde = req.query.desde || ayerEnMadrid();
  const hasta = req.query.hasta || desde;
  if (desde > hasta) {
    throw new AppError(`«desde» (${desde}) es posterior a «hasta» (${hasta}).`, 400, 'PERIODO_AL_REVES');
  }
  return { desde, hasta };
}

// GET /api/reports/actividad-comercial?desde&hasta&projectId|issuerId
export async function actividadComercial(req, res, next) {
  try {
    const { projectIds, responsableId } = await ambitoDeActividad(req);
    res.json({ success: true, data: await actividadPorComercial({
      projectIds, responsableId, ...periodoDeActividad(req),
    }) });
  } catch (err) { next(err); }
}

// GET /api/reports/actividad-comercial/detalle?userId&tipo&desde&hasta&projectId|issuerId
// La lista detrás de un número. Una gestora solo puede pedir la suya, pida lo
// que pida.
export async function actividadComercialDetalle(req, res, next) {
  try {
    const { projectIds, responsableId } = await ambitoDeActividad(req);
    const tipo = String(req.query.tipo || '');
    if (!TIPOS_DE_DETALLE.includes(tipo)) {
      throw new AppError(`Tipo no válido: ${tipo || '(vacío)'}.`, 400, 'TIPO_NO_VALIDO');
    }
    // Con equipo, una de su equipo; fuera de él, no.
    const pedido = Number(req.query.userId);
    if (Array.isArray(responsableId) && req.query.userId && !responsableId.includes(pedido)) {
      throw new AppError('Esa persona no es de tu equipo.', 403, 'FUERA_DE_TU_EQUIPO');
    }
    const userId = Array.isArray(responsableId) ? pedido : (responsableId ?? pedido);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError('Falta la comercial (userId).', 400, 'FALTA_COMERCIAL');
    }
    res.json({ success: true, data: await detalleActividadPorComercial({
      projectIds, userId, tipo, ...periodoDeActividad(req),
    }) });
  } catch (err) { next(err); }
}
