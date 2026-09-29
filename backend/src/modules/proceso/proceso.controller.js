import * as Proceso from './proceso.service.js';
import { crearPasoSchema, editarPasoSchema, reordenarSchema, ajustarPasoSchema } from './proceso.validation.js';
import { leadsToWasapiCsv, leadsToWasapiXlsx, detectCountry } from '../../shared/utils/wasapiCsv.js';

export async function listarPasos(req, res, next) {
  try {
    const pasos = await Proceso.listarPasos(req.projectIds || [req.projectId], {
      includeInactive: req.query.includeInactive === 'true',
    });
    res.json({ success: true, data: pasos });
  } catch (err) { next(err); }
}

export async function crearPaso(req, res, next) {
  try {
    const datos = crearPasoSchema.parse(req.body);
    const paso = await Proceso.crearPaso(req.projectIds || [req.projectId], datos);
    res.status(201).json({ success: true, data: paso });
  } catch (err) { next(err); }
}

export async function editarPaso(req, res, next) {
  try {
    const datos = editarPasoSchema.parse(req.body);
    const paso = await Proceso.editarPaso(Number(req.params.id), req.projectIds || [req.projectId], datos);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}

export async function reordenarPasos(req, res, next) {
  try {
    const { ids } = reordenarSchema.parse(req.body);
    const pasos = await Proceso.reordenarPasos(req.projectIds || [req.projectId], ids);
    res.json({ success: true, data: pasos });
  } catch (err) { next(err); }
}

export async function desactivarPaso(req, res, next) {
  try {
    const paso = await Proceso.desactivarPaso(Number(req.params.id), req.projectIds || [req.projectId]);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}

// ── LA AGENDA DE CADA PROSPECTO (#89 · #90) ─────────────────────────────────

// De quien es la cola. Se decide AQUI y no con lo que llegue por la URL: una
// gestora solo ve lo suyo aunque escriba el id de otra a mano. Admin y
// superadmin ven todo, o el de una en concreto si lo piden.
function deQuienEsLaCola(req) {
  const rol = req.user?.role;
  if (rol === 'admin' || rol === 'superadmin') {
    return req.query.gestoraId ? Number(req.query.gestoraId) : null;
  }
  return req.user?.userId || -1;
}

// Que proyectos entran. Sin `projectId` no se filtra por proyecto, que es la
// vista de «todos». No abre ninguna puerta: a una gestora la acota su propio
// recorte, y quien no es gestora ya puede ver todos los proyectos.
function proyectosDeLaCola(req) {
  // Una EMPRESA manda varios proyectos a la vez (sus campus). Diego, 14/09:
  // «estos procesos en empresas deben ser por empresa, no por proyecto».
  // Antes solo se leia `projectId`, asi que con CEDIA elegida la cola
  // enseñaba la de TODOS los proyectos --no la de sus siete campus--.
  const varios = String(req.query.projectIds || '')
    .split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (varios.length) return varios;
  const uno = Number(req.query.projectId);
  return Number.isInteger(uno) && uno > 0 ? [uno] : null;
}

/**
 * Los filtros del repaso, tal como llegan de la pantalla.
 *
 * Los leen los DOS sitios que consultan la base --la lista y la descarga de
 * Wasapi-- para que el fichero que se baja sea exactamente lo que se esta
 * viendo. Si cada uno leyera los suyos, bajarias 800 creyendo que son los 40
 * que habias filtrado.
 */
/**
 * «12,40,51» -> [12, 40, 51]. Una formacion puede tener un id por campus, y el
 * desplegable los manda todos juntos. Lo que no sea un id se descarta.
 */
function idsDeFormacion(valor) {
  const ids = String(valor || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return ids.length ? ids : null;
}

function filtrosDelRepaso(req) {
  const ant = ['este_mes', 'uno_a_tres', 'tres_a_seis', 'mas_de_seis'];
  return {
    busca: req.query.busca || null,
    productoId: req.query.productoId ? Number(req.query.productoId) : null,
    productoIds: idsDeFormacion(req.query.productoIds),
    antiguedad: ant.includes(req.query.antiguedad) ? req.query.antiguedad : null,
    sinContactar: req.query.sinContactar === '1',
    estado: req.query.estado || null,
    desdeDias: Number(req.query.desdeDias) || 15,
    descansoDias: Number(req.query.descansoDias) || 30,
  };
}

/**
 * GET /api/proceso/seguimiento/wasapi -> el repaso de fin de mes, en CSV.
 *
 * Diego, 23/09: «seguimiento fin de mes es para descargar con Wasapi». El
 * repaso se manda en difusion, no uno a uno, y la difusion se carga desde un
 * fichero. Copiar los telefonos al portapapeles servia para cuarenta; para
 * ochocientos, no.
 *
 * EL FORMATO NO SE REESCRIBE AQUI: se usa el mismo `leadsToWasapiCsv` que la
 * descarga de Prospectos. Si un dia cambia una columna, cambia en los dos
 * sitios a la vez, que es lo unico que impide que una difusion salga con las
 * columnas corridas.
 *
 * EL RECORTE ES EL MISMO que el de la pantalla: una gestora descarga los suyos
 * y nada mas. Va por `deQuienEsLaCola`, no por un parametro.
 */
export async function wasapiSeguimiento(req, res, next) {
  try {
    // MISMOS FILTROS QUE LA LISTA. Lo que se baja es lo que se esta viendo:
    // bajarse la base entera cuando en pantalla hay cuarenta filtradas es la
    // forma mas silenciosa de mandar una difusion a quien no tocaba.
    const { filas } = await Proceso.baseDeSeguimiento({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      ...filtrosDelRepaso(req),
      // Sin tope: se descarga TODO lo que cumple el filtro, no solo la pagina.
      limite: 100000,
    });

    let leads = filas.map((f) => ({
      nombre: f.lead_nombre,
      email: f.lead_email,
      telefono: f.lead_telefono,
      status: f.lead_estado,
      producto_nombre: f.producto,
    }));
    const total = leads.length;

    // ── Las MISMAS condiciones que la descarga de Prospectos ────────────────
    // Diego: «el descargar para Wasapi debe tener las mismas condiciones como
    // si fueran de prospectos». Se aplican igual y en el mismo orden que en
    // `exportWasapi`, para que el fichero salga identico venga de donde venga.

    // Excluir estados: se marca a quien NO debe recibir el envio.
    const fuera = String(req.query.excludeStatus || '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (fuera.length) leads = leads.filter((l) => !fuera.includes(l.status));

    // Sin telefono no entra en una difusion de WhatsApp.
    if (req.query.onlyWithPhone !== 'false' && req.query.conTelefono !== '0') {
      leads = leads.filter((l) => l.telefono && String(l.telefono).replace(/[^\d]/g, '').length >= 7);
    }

    // El pais sale del prefijo del telefono, igual que alli.
    if (req.query.pais) {
      const cual = String(req.query.pais).toLowerCase();
      leads = leads.filter((l) => (detectCountry(l.telefono) || '').toLowerCase() === cual);
    }

    const nombre = `wasapi-seguimiento-${new Date().toISOString().slice(0, 10)}`;
    res.setHeader('X-Total-Base', String(total));
    res.setHeader('X-Total-Descargados', String(leads.length));
    if (String(req.query.format || '').toLowerCase() === 'xlsx') {
      const buf = await leadsToWasapiXlsx(leads);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}.xlsx"`);
      res.send(buf);
      return;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}.csv"`);
    res.send(leadsToWasapiCsv(leads));
  } catch (err) { next(err); }
}

export async function cola(req, res, next) {
  try {
    // 100 por pagina. Con 1.400 en la cola de una empresa, pintarlas todas deja
    // la pantalla pegada; y cortar sin decirlo era lo que habia antes.
    const porPagina = Math.min(Number(req.query.limite) || 100, 300);
    const pagina = Math.max(Number(req.query.pagina) || 1, 1);
    const filtros = {
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : null,
      estado: req.query.estado || null,
      busca: req.query.busca || null,
      productoId: req.query.productoId ? Number(req.query.productoId) : null,
      productoIds: idsDeFormacion(req.query.productoIds),
      desde: /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : null,
      // El tramo lo aplica el servidor con SU «hoy» (ver colaDelDia).
      tramo: ['atrasados', 'hoy', 'manana', 'semana'].includes(req.query.tramo) ? req.query.tramo : null,
    };
    // La lista y, a la vez, las formaciones que tiene su gente: con todos los
    // filtros MENOS el de formacion, para que elegir una no borre las demas.
    const [{ filas, total }, { formaciones }] = await Promise.all([
      Proceso.colaDelDia({ ...filtros, limite: porPagina, desplazamiento: (pagina - 1) * porPagina }),
      Proceso.colaDelDia({ ...filtros, productoId: null, productoIds: null, soloFormaciones: true }),
    ]);
    res.json({
      success: true,
      data: filas,
      formaciones,
      pagination: {
        total, page: pagina, limit: porPagina,
        totalPages: Math.max(1, Math.ceil(total / porPagina)),
      },
    });
  } catch (err) { next(err); }
}

/**
 * GET /api/proceso/seguimiento -> la base que no compro, para el repaso de fin
 * de mes. Mismo recorte que la cola: una gestora solo ve lo suyo.
 */
export async function seguimiento(req, res, next) {
  try {
    // La pagina. 50 por vuelta: con 2.000 en la base, pintarlas todas deja la
    // pantalla pegada y nadie baja mas alla de la tercera.
    const porPagina = Math.min(Number(req.query.limite) || 50, 200);
    const pagina = Math.max(Number(req.query.pagina) || 1, 1);
    const comunes = {
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      ...filtrosDelRepaso(req),
    };
    const [{ filas, total }, { formaciones }] = await Promise.all([
      Proceso.baseDeSeguimiento({ ...comunes, limite: porPagina, desplazamiento: (pagina - 1) * porPagina }),
      Proceso.baseDeSeguimiento({ ...comunes, productoId: null, productoIds: null, soloFormaciones: true }),
    ]);
    res.json({
      formaciones,
      success: true,
      data: filas,
      pagination: {
        total, page: pagina, limit: porPagina,
        totalPages: Math.max(1, Math.ceil(total / porPagina)),
      },
    });
  } catch (err) { next(err); }
}

export async function resumenSeguimiento(req, res, next) {
  try {
    const data = await Proceso.resumenDeSeguimiento({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      desdeDias: Number(req.query.desdeDias) || 15,
      descansoDias: Number(req.query.descansoDias) || 30,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function resumenCola(req, res, next) {
  try {
    const data = await Proceso.resumenDeLaCola({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function pasosDeUnLead(req, res, next) {
  try {
    const data = await Proceso.pasosDeLead(Number(req.params.leadId));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function replanificar(req, res, next) {
  try {
    const cuantos = await Proceso.planificarPasosDeLead(Number(req.params.leadId));
    res.json({ success: true, data: { creados: cuantos } });
  } catch (err) { next(err); }
}

export async function ajustarPasoDeLead(req, res, next) {
  try {
    const datos = ajustarPasoSchema.parse(req.body);
    const paso = await Proceso.ajustarPaso(Number(req.params.id), datos);
    res.json({ success: true, data: paso });
  } catch (err) { next(err); }
}
