import * as model from './correos.model.js';
import * as buzonesModel from './buzones.model.js';
import { listaDelAmbito, campusParaRecortar } from '../../shared/utils/ambito.js';
import { leerBuzon } from '../../shared/services/correo-entrante.service.js';
import { sincronizarSchema } from './buzones.validation.js';
import { buzonVisible } from './buzones.controller.js';

const fecha = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);

export async function listar(req, res, next) {
  try {
    // UNA lista, pida lo que pida (Diego, 04/11): con `?projectId=` de uno suyo,
    // `proyectosDelAmbito` daba `projectIds` null y el modelo no filtraba nada.
    const projectIds = await listaDelAmbito(req);
    // Solo lo recibido (CRM-ISEIE#701): el modelo no enseña lo que sale.
    res.json({ success: true, data: await model.listar({
      busca: (req.query.busca || '').trim() || null,
      desde: fecha(req.query.desde),
      hasta: fecha(req.query.hasta),
      // Un buzón: su id, o 'servidor' para lo que entró por el del .env.
      buzon: req.query.buzon === 'servidor' ? 'servidor' : (Number(req.query.buzon) || null),
      projectIds,
      limite: req.query.limite,
      pagina: req.query.pagina,
    }) });
  } catch (e) { next(e); }
}

/** Uno con su cuerpo. Es la unica ruta que devuelve el texto del correo. */
export async function uno(req, res, next) {
  try {
    // Un id que no es un número no es un correo (y no llega a la base como NaN).
    const id = Number(req.params.id);
    const c = Number.isInteger(id) && id > 0 ? await model.uno(id) : null;
    // El de otro campus, como si no existiera (los que no son de ninguno, sí: la lista también los enseña).
    const campus = await campusParaRecortar(req);
    const ajeno = c && campus && c.project_id != null && !campus.includes(Number(c.project_id));
    if (!c || ajeno) return res.status(404).json({ success: false, error: 'Ese correo no está' });
    res.json({ success: true, data: c });
  } catch (e) { next(e); }
}

export async function recuento(req, res, next) {
  try { res.json({ success: true, data: await model.recuento(await campusParaRecortar(req)) }); }
  catch (e) { next(e); }
}

/**
 * POST /api/correos/sincronizar — trae del buzon lo que haya llegado.
 *
 * Existe aparte del cron porque quien acaba de mandar un aviso y espera
 * respuesta no quiere esperar al siguiente pase: pulsa y mira. Y NUNCA lanza
 * —el servicio devuelve el motivo— para que el buzon caido no se vea como un
 * error del CRM.
 */
export async function sincronizar(req, res, next) {
  try {
    // Uno (CRM#1032) o todos. Sin buzones —ni en la base ni en el .env— el
    // servicio contesta SIN_BUZON, igual que antes.
    const r = sincronizarSchema.safeParse(req.body || {});
    const buzonId = r.success ? r.data.buzonId || null : null;
    if (buzonId) {
      await buzonVisible(req, buzonId);
      return res.json({ success: true, data: await leerBuzon({ buzonId }) });
    }
    // Todos los que ve quien pulsa. Quien ve el CRM entero, todos; el resto,
    // los de sus campus, uno a uno: no lee el buzón de otra empresa.
    // Sin buzones en la base, el del .env para quien tenga el permiso: como
    // antes de la CRM#1032.
    const campus = await campusParaRecortar(req);
    const todos = await buzonesModel.listar(null);
    if (!campus || !todos.length) return res.json({ success: true, data: await leerBuzon() });
    const suyos = todos.filter((b) => b.project_id != null && campus.includes(Number(b.project_id)));
    if (!suyos.length) {
      return res.json({ success: true, data: { leidos: 0, nuevos: 0, motivo: 'SIN_BUZON', buzones: [] } });
    }
    const total = { leidos: 0, nuevos: 0, buzones: [] };
    for (const b of suyos) {
      const uno = await leerBuzon({ buzonId: b.id });
      total.leidos += uno.leidos;
      total.nuevos += uno.nuevos;
      total.buzones.push(...(uno.buzones || []));
    }
    if (total.buzones.length && total.buzones.every((b) => b.motivo === 'ERROR')) total.motivo = 'ERROR';
    res.json({ success: true, data: total });
  } catch (e) { next(e); }
}
