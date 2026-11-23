import * as model from './links-pago.model.js';
import * as service from './links-pago.service.js';
import {
  listarSchema, idSchema, configQuerySchema, configBodySchema, crearSchema, anularSchema, webhookAccionSchema,
  ventasProspectoSchema, planQuerySchema, planBodySchema, cobroAutoQuerySchema, cobroAutoBodySchema, cuotasQuerySchema,
  embudoSchema,
  totalConDescuento,
} from './links-pago.validation.js';
import * as cobroAuto from './links-pago.cobro-auto.js';
import * as cobroAutoModel from './links-pago.cobro-auto.model.js';
import * as seguimiento from './links-pago.seguimiento.js';
import { embudo as embudoDe } from './links-pago.embudo.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { cobroAutomaticoActivo } from '../../shared/config/soloEnPruebas.js';
import { listaDelAmbito, campusDeTodos, campusParaRecortar, exigirCampusSuyo } from '../../shared/utils/ambito.js';
import { alcanceComercial, dentroDelAlcance, personasDentro } from '../../shared/utils/roles.js';

/*
  QUIÉN VE QUÉ LINK (CRM#680, criterio 6 de Diego).

  «Cada gestora ve solo sus links; admin y superadmin, los de su alcance
  (`listaDelAmbito`), con su permiso en `catalogo.js`.»

  Dos recortes, como en el resto del CRM, y se aplican los dos:
    · campus: los de la persona (`listaDelAmbito` / `campusParaRecortar`);
    · personas: con `links_pago.ver_todos`, su alcance comercial (null = todas
      las de sus campus; quien lleva un equipo, el suyo). Sin él, solo los
      links que creó ella (o los de su equipo, si lo lleva).

  Siempre con la sesión, nunca con lo que diga la URL.
*/
async function personasQueVe(req) {
  const alcance = await alcanceComercial(req.user);
  if (await tienePermiso(req, 'links_pago.ver_todos')) return alcance;
  return alcance || [Number(req.user.userId)];
}

function fallo(parsed) {
  return new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
}

// GET /api/links-pago
export async function listar(req, res, next) {
  try {
    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const { estado, leadId, conversionId, createdBy, page, limit } = parsed.data;

    const projectIds = (await listaDelAmbito(req)) || await campusDeTodos(req);
    const creadores = await personasQueVe(req);
    // Pedir los de una persona fuera del alcance no da error: da los del alcance.
    // `personasDentro` es el `acotarAlAlcance` de MultiCRM: null (todas) o una lista.
    const { rows, total } = await model.listar({
      projectIds,
      creadores: personasDentro(creadores, createdBy),
      createdBy: null,
      estado, leadId, conversionId, page, limit,
    });
    res.json({
      success: true,
      data: rows,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) { next(err); }
}

/** Hoy en Madrid, AAAA-MM-DD. */
const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

// GET /api/links-pago/embudo?desde=&hasta= (CRM#987)
// Creados, abiertos y pagados, con su % y lo cobrado, y las cuotas del cobro
// automático, por gestora y por campus. Con el ámbito de siempre: los campus de
// quien mira (`campusParaRecortar`) y, sin «ver todos», solo lo suyo.
export async function embudo(req, res, next) {
  try {
    const parsed = embudoSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const hoy = hoyEnMadrid();
    const hasta = parsed.data.hasta || hoy;
    const desde = parsed.data.desde || `${hasta.slice(0, 7)}-01`;
    if (desde > hasta) throw new AppError('La fecha de inicio no puede ir después de la del final', 400, 'VALIDATION_ERROR');

    let projectIds = (await listaDelAmbito(req)) || await campusDeTodos(req);
    const campus = await campusParaRecortar(req);
    if (campus) projectIds = projectIds.filter((p) => campus.includes(Number(p)));
    if (!projectIds.length) projectIds = [-1];
    const creadores = await personasQueVe(req);
    const data = await embudoDe({ projectIds, creadores, desde, hasta });
    res.json({ success: true, data: { desde, hasta, ...data } });
  } catch (err) { next(err); }
}

// GET /api/links-pago/:id
// Fuera de su campus o de su alcance es un 404, como si no existiera: no se
// confirma que haya un link de otra empresa o de otra gestora con ese id.
async function linkSuyo(req) {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) throw fallo(parsed);
  const link = await model.porId(parsed.data.id);
  const noEsta = new AppError('Link de pago no encontrado', 404, 'NOT_FOUND');
  if (!link) throw noEsta;

  const campus = await campusParaRecortar(req);
  if (campus && !campus.includes(Number(link.project_id))) throw noEsta;
  if (!dentroDelAlcance(await personasQueVe(req), link.created_by)) throw noEsta;
  return link;
}

export async function detalle(req, res, next) {
  try {
    const link = await linkSuyo(req);
    const [eventos, cobros] = await Promise.all([model.eventos(link.id), model.cobros(link.id)]);
    res.json({ success: true, data: { ...link, eventos, cobros } });
  } catch (err) { next(err); }
}

// ─── Configuración del campus (Integraciones › Links de pago) ───────────────

// GET /api/links-pago/config?projectId=N
// El campus ya lo ha comprobado `projectAccess` (req.projectId). Lo lee también
// quien crea links: la pantalla de crear necesita las monedas y la caducidad.
// `aviso_clave`: si el campus no puede crear links por la clave (no la tiene, o
// es live en pruebas), lo que diría «Crear link»; así el diálogo lo dice al
// abrirse y no al final. Nunca la clave.
export async function verConfig(req, res, next) {
  try {
    const parsed = configQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const cfg = await model.config(parsed.data.projectId);
    if (!cfg) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    const aviso_clave = await service.avisoDeClave(parsed.data.projectId);
    res.json({ success: true, data: { project_id: parsed.data.projectId, ...cfg, aviso_clave } });
  } catch (err) { next(err); }
}

// Quién cambió qué: son reglas de dinero. Se espera a apuntarlo, pero si falla
// no tumba el cambio, que ya está hecho.
function anotar(req, action, details) {
  return query(
    'INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
    [req.user.userId, action, JSON.stringify(details), req.ip || null],
  ).catch((err) => logger.warn({ err: err.message, action }, 'Links de pago: no se pudo anotar el cambio'));
}

// PUT /api/links-pago/config — solo lo que venga; lo demás, como estaba.
export async function guardarConfig(req, res, next) {
  try {
    const parsed = configBodySchema.safeParse({ ...req.body, projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const { projectId, ...pedidos } = parsed.data;
    const cambios = Object.fromEntries(Object.entries(pedidos).filter(([, v]) => v !== undefined));
    if (cambios.monedas) cambios.monedas = [...new Set(cambios.monedas)];
    const antes = await model.config(projectId);
    if (!antes) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');

    // Las reglas entre campos, con lo que ya hay: así el mensaje es claro y no
    // el de un CHECK de la base.
    const despues = { ...antes, ...cambios };
    if (despues.caducidad_dias > despues.caducidad_max_dias) {
      throw new AppError(`La caducidad por defecto (${despues.caducidad_dias} días) no puede pasar de la máxima (${despues.caducidad_max_dias}).`, 400, 'VALIDATION_ERROR');
    }
    if (!despues.monedas.includes(despues.moneda_defecto)) {
      throw new AppError(`La moneda por defecto (${despues.moneda_defecto}) tiene que estar entre las admitidas (${despues.monedas.join(', ')}).`, 400, 'VALIDATION_ERROR');
    }
    const ahora = await model.guardarConfig(projectId, cambios);

    // Quién cambió qué y de cuánto a cuánto: son reglas de dinero.
    const cambiado = Object.keys(cambios).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(ahora[k]));
    logger.info({ userId: req.user.userId, projectId, cambiado }, 'Links de pago: configuración cambiada');
    // Apagar el cobro automático del campus cancela los calendarios de Stripe de sus ventas.
    if (cambiado.includes('cobro_auto')) cobroAuto.alCambiarElCampus(projectId);
    if (cambiado.length) {
      await anotar(req, cambiado.length === 1 && cambiado[0] === 'descuento_max_pct' ? 'links_pago.descuento_max' : 'links_pago.config', {
        project_id: projectId,
        antes: Object.fromEntries(cambiado.map((k) => [k, antes[k]])),
        ahora: Object.fromEntries(cambiado.map((k) => [k, ahora[k]])),
      });
    }
    res.json({ success: true, data: { project_id: projectId, ...ahora } });
  } catch (err) { next(err); }
}

// ─── Crear y anular (fase 2) ────────────────────────────────────────────────

/*
  El prospecto o la venta, si la persona puede crearle un link: de uno de SUS
  campus y, si solo ve lo suyo, suyo (responsable del prospecto o vendedora de
  la venta). Si no, 404, como si no existiera.
*/
async function destinoSuyo(req, { leadId, conversionId }) {
  const noEsta = (que) => new AppError(`${que} no encontrado`, 404, 'NOT_FOUND');
  let destino;
  if (conversionId) {
    const v = await model.venta(conversionId);
    if (!v) throw noEsta('Venta');
    if (leadId && Number(leadId) !== Number(v.lead_id)) throw new AppError('Esa venta no es de ese prospecto', 400, 'VALIDATION_ERROR');
    destino = { projectId: Number(v.project_id), leadId: v.lead_id, conversionId: v.id,
      duenos: [v.vendedora_id, v.responsable_id], que: 'Venta' };
  } else {
    const l = await model.lead(leadId);
    if (!l) throw noEsta('Prospecto');
    destino = { projectId: Number(l.project_id), leadId: l.id, conversionId: null,
      duenos: [l.responsable_id], que: 'Prospecto' };
  }
  const campus = await campusParaRecortar(req);
  if (campus && !campus.includes(destino.projectId)) throw noEsta(destino.que);
  const alcance = await alcanceComercial(req.user);
  if (alcance && !destino.duenos.some((d) => d != null && dentroDelAlcance(alcance, d))) throw noEsta(destino.que);
  return destino;
}

/*
  Un link SIN PROSPECTO (Carlos, 20/11: «sin nombre de la persona»): solo el
  campus, que tiene que ser uno de los de quien lo crea. Fuera de sus campus,
  404, como si no existiera. Al pagarse, el CRM busca o crea el prospecto con lo
  que el alumno escribe en Checkout (links-pago.cobro.js).
*/
async function campusSuyo(req, projectId) {
  await exigirCampusSuyo(req, projectId, 'Campus no encontrado');
  return { projectId: Number(projectId), leadId: null, conversionId: null };
}

// POST /api/links-pago
export async function crear(req, res, next) {
  try {
    const parsed = crearSchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const b = parsed.data;
    const destino = b.leadId || b.conversionId ? await destinoSuyo(req, b) : await campusSuyo(req, b.projectId);

    const prod = await model.producto(b.productId);
    // Un curso de otro campus no vale: el precio y el nombre serían de otro sitio.
    if (!prod || Number(prod.project_id) !== destino.projectId) {
      throw new AppError('Ese curso no es del catálogo de este campus', 400, 'VALIDATION_ERROR');
    }
    const cfg = await model.config(destino.projectId);
    if (!cfg) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    const pendiente = destino.conversionId ? await model.pendienteDeVenta(destino.conversionId) : undefined;
    // CRM#909: desde una venta, nunca por encima de lo que queda por cobrar.
    service.noPasaDelPendiente({ importe: b.importe, moneda: b.moneda || cfg.moneda_defecto, pendiente });
    const enCuotas = b.modalidad === 'cuotas';
    const reglas = service.comprobarReglas({
      cfg, prod, importe: b.importe, moneda: b.moneda, caducidadDias: b.caducidad_dias,
      modalidad: b.modalidad, numCuotas: b.num_cuotas, inicial: b.inicial,
      esAdmin: await tienePermiso(req, 'links_pago.configurar'),
      // Desde una venta, el tope de descuento se mide contra lo pendiente (fase 3).
      pendiente,
    });

    /*
      EN CUOTAS (20/11): es el cobro automático. Se comprueba ANTES de crear nada
      (campus, permiso y clave de Stripe); el link cobra la cuota 1 y guarda la
      tarjeta, con el consentimiento de las demás junto al botón de pagar.

      CON INICIAL (CRM#982): el link cobra la inicial y las N cuotas iguales de lo
      que queda las cobra Stripe. En la venta serán N + 1 pagos (`num`).
    */
    let guardaTarjeta = null;
    let cuotas = null;
    if (enCuotas) {
      const disp = await cobroAuto.paraUnLinkEnCuotas(destino.projectId, {
        cfg, puedeCobroAuto: await tienePermiso(req, 'links_pago.cobro_automatico'),
      });
      if (!disp.disponible) throw new AppError(disp.motivo, 409, 'CUOTAS_NO_DISPONIBLES');
      const conInicial = b.inicial !== undefined;
      const importes = conInicial
        ? [b.inicial, ...service.repartirEnCuotas(service.restaCentimos(b.importe, b.inicial), b.num_cuotas)]
        : service.repartirEnCuotas(b.importe, b.num_cuotas);
      cuotas = { num: importes.length, importeCuota: importes[0], ...(conInicial ? { inicial: b.inicial } : {}) };
      guardaTarjeta = {
        consentimiento: cobroAuto.textoConsentimiento({
          campus: await model.nombreDelCampus(destino.projectId),
          cuotas: importes.slice(1).map((importe) => ({ importe })),
        }),
      };
    }
    // El precio antes del descuento y el descuento (CRM#982): Zod ya ha comprobado
    // que el total cuadra; aquí se calcula lo que se guarda.
    let descuento = null;
    if (b.precio_original !== undefined) {
      const t = totalConDescuento({ precio: b.precio_original, tipo: b.descuento_tipo, valor: b.descuento_valor });
      descuento = {
        precioOriginal: b.precio_original, tipo: b.descuento_tipo ?? null,
        valor: b.descuento_tipo ? b.descuento_valor : null, importe: b.descuento_tipo ? t.descuento : 0,
      };
    }
    const link = await service.crear({
      projectId: destino.projectId, leadId: destino.leadId, conversionId: destino.conversionId,
      prod, reglas, importe: b.importe, userId: Number(req.user.userId), guardaTarjeta, enCuotas: cuotas, descuento,
    });
    res.status(201).json({ success: true, data: link });
  } catch (err) { next(err); }
}

// GET /api/links-pago/cuotas-disponibles?projectId=N
// El asistente lo pregunta al elegir campus: si «Cuotas» se puede y, si no, por qué.
export async function cuotasDisponibles(req, res, next) {
  try {
    const parsed = cuotasQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const cfg = await model.config(parsed.data.projectId);
    if (!cfg) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    const data = await cobroAuto.paraUnLinkEnCuotas(parsed.data.projectId, {
      cfg, puedeCobroAuto: await tienePermiso(req, 'links_pago.cobro_automatico'),
    });
    res.json({ success: true, data: { project_id: parsed.data.projectId, ...data } });
  } catch (err) { next(err); }
}

// GET /api/links-pago/conectar-stripe (con el ámbito de la pantalla: ?projectId / ?issuerId)
// El aviso de arriba de «Links de pago» (CRM#992): los campus del ámbito de quien
// mira que no pueden cobrar cuotas solas por la clave de Stripe (no la tienen, o
// no tiene permiso de suscripciones). Con el interruptor del servidor apagado no
// se mira ningún campus: `activo: false` y el motivo.
export async function conectarStripe(req, res, next) {
  try {
    if (!cobroAutomaticoActivo()) {
      return res.json({ success: true, data: { activo: false, codigo: 'apagado_entorno', motivo: cobroAuto.MOTIVO_APAGADO, campus: [] } });
    }
    const projectIds = (await listaDelAmbito(req)) || await campusDeTodos(req);
    const campus = await cobroAuto.campusPorConectar(projectIds);
    res.json({ success: true, data: { activo: true, codigo: null, motivo: null, campus } });
  } catch (err) { next(err); }
}

// GET /api/links-pago/ventas-del-prospecto?leadId=N (o ?conversionId=N: el de esa venta)
// El prospecto (nombre, correo y teléfono para mandarle el link) y sus ventas
// con lo pendiente. Un prospecto fuera de su campus o de su alcance, 404.
export async function ventasDelProspecto(req, res, next) {
  try {
    const parsed = ventasProspectoSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const destino = await destinoSuyo(req, parsed.data);
    if (!destino.leadId) throw new AppError('Esa venta no tiene prospecto', 404, 'NOT_FOUND');
    const [l, ventas] = await Promise.all([model.lead(destino.leadId), model.ventasDelProspecto(destino.leadId)]);
    res.json({
      success: true,
      data: {
        lead: { id: l.id, nombre: l.nombre, email: l.email, telefono: l.telefono,
          project_id: Number(l.project_id), producto_interes_id: l.producto_interes_id },
        ventas,
      },
    });
  } catch (err) { next(err); }
}

// ─── Plan de pago (Diego, 19/11/2026) ───────────────────────────────────────
/*
  «Generar plan de pago»: desde una venta con plan de cuotas, un link de Stripe
  por cada cuota pendiente, con su importe y su fecha. Al pagarlo, el cobro salda
  ESA cuota (`installment_id` del link → `addPayment(..., { cuotaId })`).
  Una cuota que ya tiene un link vivo no se vuelve a generar: se devuelve el suyo.
*/
async function planDe(req, conversionId) {
  const destino = await destinoSuyo(req, { conversionId });
  const venta = await model.ventaParaPlan(destino.conversionId);
  const cuotas = await model.cuotasPendientes(destino.conversionId);
  return { destino, venta, cuotas };
}

// GET /api/links-pago/plan?conversionId=N
export async function verPlan(req, res, next) {
  try {
    const parsed = planQuerySchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const { destino, venta, cuotas } = await planDe(req, parsed.data.conversionId);
    // El cobro automático (309): si se puede, si está activo y cómo va cada cuota.
    const cobro_automatico = await cobroAuto.estadoDeLaVenta(destino.conversionId, destino.projectId);
    res.json({ success: true, data: { venta, cuotas, cobro_automatico } });
  } catch (err) { next(err); }
}

// POST /api/links-pago/plan { conversionId, cuotaIds? }
export async function generarPlan(req, res, next) {
  try {
    const parsed = planBodySchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const { destino, venta, cuotas } = await planDe(req, parsed.data.conversionId);
    if (!cuotas.length) {
      throw new AppError('Esta venta no tiene cuotas pendientes. Si va a plazos, crea antes su plan de cuotas en la venta.', 400, 'SIN_CUOTAS');
    }
    const pedidas = parsed.data.cuotaIds ? new Set(parsed.data.cuotaIds.map(Number)) : null;
    if (pedidas && [...pedidas].some((cid) => !cuotas.some((c) => Number(c.id) === cid))) {
      throw new AppError('Alguna de esas cuotas no es de esta venta o ya está cobrada.', 400, 'VALIDATION_ERROR');
    }
    if (!venta.producto_contratado_id) {
      throw new AppError('La venta no tiene curso: ponle el curso antes de generar el plan de pago.', 400, 'VENTA_SIN_CURSO');
    }
    const prod = await model.producto(venta.producto_contratado_id);
    if (!prod || Number(prod.project_id) !== destino.projectId) {
      throw new AppError('El curso de la venta no es del catálogo de este campus.', 400, 'VALIDATION_ERROR');
    }
    // Entre todas, nunca más de lo que queda por cobrar de la venta (CRM#909).
    const suma = cuotas.filter((c) => (!pedidas || pedidas.has(Number(c.id))) && !c.link_id).reduce((t, c) => t + Number(c.importe || 0), 0);
    if (Math.round(suma * 100) > Math.round(Number(venta.pendiente || 0) * 100)) {
      throw new AppError(`Las cuotas suman ${suma.toFixed(2)} € y a la venta le quedan ${Number(venta.pendiente || 0).toFixed(2)} € por cobrar. Revisa el plan de cuotas de la venta.`, 400, 'PASA_DEL_PENDIENTE');
    }
    const cfg = await model.config(destino.projectId);
    const userId = Number(req.user.userId);

    /*
      «Cobrar automáticamente con Stripe en las fechas de las cuotas» (309). Se
      activa ANTES de crear los links: el de la primera cuota guarda la tarjeta y
      las demás no llevan link (las cobra Stripe en su fecha; si una falla, al
      alumno le llega el link de esa factura).
    */
    let creados = [];
    let soloLaPrimera = false;
    if (parsed.data.cobroAutomatico) {
      if (!(await tienePermiso(req, 'links_pago.cobro_automatico'))) {
        throw new AppError('No tienes permiso para activar el cobro automático de las cuotas.', 403, 'FORBIDDEN');
      }
      const r = await cobroAuto.activar({ venta: await cobroAutoModel.ventaParaCobrar(destino.conversionId), userId });
      if (r.linkPrimera?.id && !cuotas.some((c) => Number(c.link_id) === Number(r.linkPrimera.id))) creados.push(Number(r.linkPrimera.id));
      soloLaPrimera = true;
      await anotar(req, 'links_pago.cobro_automatico', { conversion_id: destino.conversionId, activo: true });
    }
    const conLinkAhora = soloLaPrimera ? [] : await model.cuotasPendientes(destino.conversionId);
    const elegidas = conLinkAhora.filter((c) => !pedidas || pedidas.has(Number(c.id)));
    const nuevas = elegidas.filter((c) => !c.link_id);
    // Con el cobro automático activo (de antes), los links que se creen guardan la tarjeta.
    const guardaTarjeta = await cobroAuto.guardaTarjetaPara(destino.conversionId);
    for (const c of nuevas) {
      const reglas = service.reglasDeCuota({ cfg, prod, vence: c.vence });
      const link = await service.crear({
        projectId: destino.projectId, leadId: destino.leadId, conversionId: destino.conversionId,
        prod, reglas, importe: Number(c.importe), userId, cuota: { id: c.id, numero: c.numero, vence: c.vence }, guardaTarjeta,
      });
      creados.push(Number(link.id));
    }
    creados = [...new Set(creados)];
    // El plan tal como queda: cada cuota con su link (el nuevo o el que ya tenía).
    const ahora = await model.cuotasPendientes(destino.conversionId);
    res.status(creados.length ? 201 : 200).json({
      success: true,
      data: {
        venta, cuotas: ahora.filter((c) => !pedidas || pedidas.has(Number(c.id))), creados: creados.length,
        ya_tenian: elegidas.length - nuevas.length,
        cobro_automatico: await cobroAuto.estadoDeLaVenta(destino.conversionId, destino.projectId),
      },
    });
  } catch (err) { next(err); }
}

// ─── Cobro automático de las cuotas (309) ───────────────────────────────────

// GET /api/links-pago/cobro-automatico?conversionId=N — cómo va (también en la ficha de la venta).
export async function verCobroAutomatico(req, res, next) {
  try {
    const parsed = cobroAutoQuerySchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const destino = await destinoSuyo(req, { conversionId: parsed.data.conversionId });
    res.json({ success: true, data: await cobroAuto.estadoDeLaVenta(destino.conversionId, destino.projectId) });
  } catch (err) { next(err); }
}

// PUT /api/links-pago/cobro-automatico { conversionId, activo }
export async function cambiarCobroAutomatico(req, res, next) {
  try {
    const parsed = cobroAutoBodySchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const destino = await destinoSuyo(req, { conversionId: parsed.data.conversionId });
    const venta = await cobroAutoModel.ventaParaCobrar(destino.conversionId);
    const userId = Number(req.user.userId);
    let linkPrimera = null;
    if (parsed.data.activo) linkPrimera = (await cobroAuto.activar({ venta, userId })).linkPrimera;
    else await cobroAuto.desactivar({ venta, userId });
    await anotar(req, 'links_pago.cobro_automatico', { conversion_id: destino.conversionId, activo: parsed.data.activo });
    const estado = await cobroAuto.estadoDeLaVenta(destino.conversionId, destino.projectId);
    res.json({ success: true, data: { ...estado, link_primera: linkPrimera ? { id: linkPrimera.id, url: linkPrimera.url } : null } });
  } catch (err) { next(err); }
}

// POST /api/links-pago/:id/anular { motivo }
// Quien lo creó, o quien ve los de los demás en su alcance. Lo ajeno, 404.
export async function anular(req, res, next) {
  try {
    const link = await linkSuyo(req);
    const parsed = anularSchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const hecho = await service.anular(link, { userId: Number(req.user.userId), motivo: parsed.data.motivo });
    res.json({ success: true, data: hecho });
  } catch (err) { next(err); }
}

// POST /api/links-pago/:id/renovar (gemela de CRM#984)
// Un caducado de su campus y su alcance (lo ajeno, 404): un link nuevo igual.
export async function renovar(req, res, next) {
  try {
    const link = await linkSuyo(req);
    const nuevo = await seguimiento.renovar(Number(link.id), {
      userId: Number(req.user.userId),
      puedeCobroAuto: await tienePermiso(req, 'links_pago.cobro_automatico'),
    });
    res.status(201).json({ success: true, data: nuevo });
  } catch (err) { next(err); }
}

// ─── El webhook de la cuenta (solo quien configura) ─────────────────────────

// GET /api/links-pago/webhook?projectId=N
export async function verWebhook(req, res, next) {
  try {
    const parsed = configQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const data = await service.verWebhook(parsed.data.projectId, { campusVisibles: await campusParaRecortar(req) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// PUT /api/links-pago/webhook { projectId, accion }
export async function cambiarWebhook(req, res, next) {
  try {
    const parsed = webhookAccionSchema.safeParse({ ...req.body, projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const { projectId, accion } = parsed.data;
    const data = await service.cambiarWebhook(projectId, accion, { campusVisibles: await campusParaRecortar(req) });
    if (data.cambiado) {
      logger.info({ userId: req.user.userId, projectId, accion, endpointId: data.endpoint_id }, 'Links de pago: webhook de Stripe cambiado');
      await anotar(req, 'links_pago.webhook', { project_id: projectId, accion, endpoint_id: data.endpoint_id, activo: data.activo });
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

