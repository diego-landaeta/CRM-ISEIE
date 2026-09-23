import * as Proceso from './proceso.service.js';
import { crearPasoSchema, editarPasoSchema, reordenarSchema, ajustarPasoSchema } from './proceso.validation.js';
import { leadsToWasapiCsv, leadsToWasapiXlsx } from '../../shared/utils/wasapiCsv.js';

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
    const filas = await Proceso.baseDeSeguimiento({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      desdeDias: Number(req.query.desdeDias) || 15,
      descansoDias: Number(req.query.descansoDias) || 30,
      // Sin tope: se descarga la base entera, que es justo para lo que sirve.
      limite: 100000,
    });

    let leads = filas.map((f) => ({
      nombre: f.lead_nombre,
      email: f.lead_email,
      telefono: f.lead_telefono,
      status: f.lead_estado,
      producto_nombre: f.producto,
    }));
    // Sin telefono no entra en una difusion de WhatsApp. Se quitan aqui y se
    // dice cuantos eran en la cabecera, para que nadie cuente 800 arriba y 640
    // en el fichero y piense que se ha perdido algo.
    const total = leads.length;
    if (req.query.conTelefono !== '0') {
      leads = leads.filter((l) => l.telefono && String(l.telefono).replace(/[^\d]/g, '').length >= 7);
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
    const data = await Proceso.colaDelDia({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : null,
      limite: Number(req.query.limite) || 200,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * GET /api/proceso/seguimiento -> la base que no compro, para el repaso de fin
 * de mes. Mismo recorte que la cola: una gestora solo ve lo suyo.
 */
export async function seguimiento(req, res, next) {
  try {
    const data = await Proceso.baseDeSeguimiento({
      projectIds: proyectosDeLaCola(req),
      asesoraId: deQuienEsLaCola(req),
      desdeDias: Number(req.query.desdeDias) || 15,
      descansoDias: Number(req.query.descansoDias) || 30,
      limite: Number(req.query.limite) || 500,
    });
    res.json({ success: true, data });
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
