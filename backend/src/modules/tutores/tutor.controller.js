import * as model from './tutor.model.js';
import * as userService from '../users/user.service.js';
import * as dossierService from '../dossiers/dossier.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import {
  altaTutorSchema, perfilSchema, colaboracionSchema,
  editarColaboracionSchema, ajustesSchema, calcularSchema, liquidarSchema,
} from './tutor.validation.js';

// Quien manda aqui.
//
// Dar de alta tutores y tocar porcentajes lo puede hacer un administrador o
// quien tenga la casilla `gestor_colaboraciones`. Es el mismo patron que
// `factura_manager`, que en este repositorio SI funciona; el sistema de roles
// personalizados tiene un caso a medias y no conviene apoyarse en el.
//
// Liquidar comisiones NO entra aqui: eso mueve dinero y se queda en manos de un
// administrador, no de quien organiza las colaboraciones.
//
// La casilla se mira en la BASE, no en el token: el token dura quince minutos y
// solo lleva el rol, asi que si viajara ahi, quitarle el permiso a alguien no
// surtiria efecto hasta que caducara su sesion.
async function puedeGestionar(req) {
  if (['admin', 'superadmin'].includes(req.user.role)) return true;
  return model.esGestorColaboraciones(req.user.userId);
}

async function exigirGestion(req) {
  if (!(await puedeGestionar(req))) {
    throw new AppError('No puedes gestionar colaboraciones', 403, 'FORBIDDEN');
  }
}

function valida(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.issues[0]?.message || 'Datos invalidos', 400, 'VALIDATION_ERROR');
  return r.data;
}

// GET /api/tutores?projectId=&activos=
export async function listar(req, res, next) {
  try {
    await exigirGestion(req);
    res.json({ success: true, data: await model.listar({
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
      activos: req.query.activos !== '0',
    })});
  } catch (err) { next(err); }
}

// GET /api/tutores/:id
export async function ficha(req, res, next) {
  try {
    // Un tutor puede ver SU ficha; el resto necesita permiso de gestion.
    const id = parseInt(req.params.id);
    if (req.user.userId !== id) await exigirGestion(req);
    const t = await model.ficha(id);
    if (!t) throw new AppError('Tutor no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

// POST /api/tutores  — alta completa: usuario + perfil.
export async function alta(req, res, next) {
  try {
    await exigirGestion(req);
    const d = valida(altaTutorSchema, req.body);

    // Se reutiliza el alta de usuarios tal cual: contraseña temporal, token de
    // 24 horas y correo de Brevo con el enlace para poner contraseña. No hay
    // que construir nada nuevo, y asi un tutor entra igual que cualquiera.
    const usuario = await userService.create({
      nombre: d.nombre,
      email: d.email,
      role: 'tutor',
      projectIds: d.projectIds,
    });

    // Si el alta trae contraseña, se le pone y se anula el token del correo:
    // asi puede entrar ya, sin depender de que Brevo este configurado.
    if (d.password) await model.ponerContrasena(usuario.id, d.password);

    const perfil = await model.guardarPerfil(usuario.id, d);
    res.status(201).json({ success: true, data: {
      ...usuario,
      perfil,
      // Que el frontal sepa si hay que enseñar el aviso del correo o no.
      entraYa: Boolean(d.password),
    }});
  } catch (err) { next(err); }
}

// PATCH /api/tutores/:id/perfil
export async function guardarPerfil(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (req.user.userId !== id) await exigirGestion(req);
    const d = valida(perfilSchema, req.body);
    res.json({ success: true, data: await model.guardarPerfil(id, d) });
  } catch (err) { next(err); }
}

// ── Colaboraciones ──────────────────────────────────────────────────────────

// GET /api/tutores/colaboraciones?tutorId=&productId=&activas=
export async function colaboraciones(req, res, next) {
  try {
    // Un tutor solo ve las suyas, ignorando lo que pida por query.
    const esTutor = req.user.role === 'tutor';
    if (!esTutor) await exigirGestion(req);
    res.json({ success: true, data: await model.colaboraciones({
      tutorId: esTutor ? req.user.userId : (req.query.tutorId ? parseInt(req.query.tutorId) : null),
      productId: req.query.productId ? parseInt(req.query.productId) : null,
      soloActivas: req.query.activas === '1',
    })});
  } catch (err) { next(err); }
}

// POST /api/tutores/colaboraciones
export async function crearColaboracion(req, res, next) {
  try {
    await exigirGestion(req);
    const d = valida(colaboracionSchema, req.body);

    // La formacion tiene que ser de una marca en la que el profesor da clase.
    // Puede estar en varias —eso es lo normal en el MultiCRM— pero no en una
    // que no es suya: cobraria de un proyecto donde no ha dado ni una clase.
    const suyo = await model.formacionEsDeSuProyecto(d.tutorId, d.productId);
    if (!suyo.ok) {
      throw new AppError(
        `Esa formacion es de ${suyo.proyecto || 'otro proyecto'} y el tutor no está dado de alta ahí.`
        + ' Añádelo a ese proyecto primero.',
        409, 'OTRO_PROYECTO'
      );
    }

    // Dos tramos del mismo tutor y formacion no pueden solaparse: no habria
    // forma de saber que porcentaje aplicar a un pago de esas fechas.
    const choques = await model.haySolape(d);
    if (choques.length) {
      const c = choques[0];
      throw new AppError(
        `Ya hay una colaboracion suya en esa formacion del ${String(c.vigente_desde).slice(0, 10)}`
        + `${c.vigente_hasta ? ' al ' + String(c.vigente_hasta).slice(0, 10) : ' en adelante'}.`
        + ' Ciérrala antes de abrir otra.',
        409, 'SOLAPE'
      );
    }

    res.status(201).json({ success: true, data: await model.crearColaboracion({
      ...d, createdBy: req.user.userId,
    })});
  } catch (err) { next(err); }
}

// PATCH /api/tutores/colaboraciones/:id
export async function editarColaboracion(req, res, next) {
  try {
    await exigirGestion(req);
    const id = parseInt(req.params.id);
    const d = valida(editarColaboracionSchema, req.body);

    const actual = await model.colaboracionPorId(id);
    if (!actual) throw new AppError('Colaboracion no encontrada', 404, 'NOT_FOUND');

    // Si se mueven las fechas, hay que volver a comprobar el solape con las
    // demas de ese tutor en esa formacion —excluyendo esta, que si no choca
    // consigo misma—.
    if (d.desde || d.hasta !== undefined) {
      const choques = await model.haySolape({
        tutorId: actual.tutor_id,
        productId: actual.product_id,
        desde: d.desde || String(actual.vigente_desde).slice(0, 10),
        hasta: d.hasta !== undefined ? d.hasta
          : (actual.vigente_hasta && String(actual.vigente_hasta).slice(0, 10)),
        excluirId: id,
      });
      if (choques.length) throw new AppError('Esas fechas se solapan con otra colaboracion suya', 409, 'SOLAPE');
    }

    res.json({ success: true, data: await model.actualizarColaboracion(id, d) });
  } catch (err) { next(err); }
}

// DELETE /api/tutores/colaboraciones/:id
export async function borrarColaboracion(req, res, next) {
  try {
    await exigirGestion(req);
    const r = await model.borrarColaboracion(parseInt(req.params.id));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// ── Ajustes ─────────────────────────────────────────────────────────────────

export async function ajustes(req, res, next) {
  try {
    await exigirGestion(req);
    res.json({ success: true, data: await model.ajustes() });
  } catch (err) { next(err); }
}

export async function guardarAjustes(req, res, next) {
  try {
    // Mover la fecha desde la que se paga cambia lo que cobra todo el mundo.
    // Eso no lo toca quien organiza colaboraciones: solo un administrador.
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      throw new AppError('Solo un administrador cambia estos ajustes', 403, 'FORBIDDEN');
    }
    const d = valida(ajustesSchema, req.body);
    res.json({ success: true, data: await model.guardarAjustes({ ...d, updatedBy: req.user.userId }) });
  } catch (err) { next(err); }
}

// GET /api/tutores/simulacion?desde=&hasta=&tutorId=
//
// Lo que se pagaria si el calculo estuviera encendido. No crea nada: sirve para
// revisar las colaboraciones antes de que generen dinero de verdad.
export async function simulacion(req, res, next) {
  try {
    const esTutor = req.user.role === 'tutor';
    if (!esTutor) await exigirGestion(req);
    const hoy = new Date().toISOString().slice(0, 10);
    res.json({ success: true, data: await model.simular({
      desde: req.query.desde || hoy.slice(0, 8) + '01',
      hasta: req.query.hasta || hoy,
      tutorId: esTutor ? req.user.userId : (req.query.tutorId ? parseInt(req.query.tutorId) : null),
      // Un profesor puede dar clase en varias marcas. Con un proyecto elegido
      // arriba se ve SOLO lo de esa marca; en «todos los proyectos» sale todo,
      // y cada linea dice de cual es.
      //
      // El tutor no filtra: el ve sus cursos, esten donde esten. Lo suyo es
      // suyo aunque esté repartido entre dos marcas.
      projectId: esTutor ? null : (req.query.projectId ? parseInt(req.query.projectId) : null),
    })});
  } catch (err) { next(err); }
}

// ── Comisiones de verdad ────────────────────────────────────────────────────

// POST /api/tutores/comisiones/calcular
// Crea las comisiones que falten. Se puede pulsar las veces que haga falta: el
// indice unico de la base impide que se duplique nada.
export async function calcular(req, res, next) {
  try {
    await exigirGestion(req);
    const d = valida(calcularSchema, req.body || {});
    const r = await model.reconciliar({
      desde: d.desde || null,
      hasta: d.hasta || null,
      projectId: d.projectId || null,
    });
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// GET /api/tutores/comisiones?periodo=&tutorId=&estado=&projectId=
export async function listarComisiones(req, res, next) {
  try {
    // Un tutor ve las SUYAS y nada mas: se le fuerza su identificador y se
    // ignora lo que pida por la URL.
    const esTutor = req.user.role === 'tutor';
    if (!esTutor) await exigirGestion(req);
    res.json({ success: true, data: await model.comisiones({
      periodo: /^\d{4}-\d{2}$/.test(req.query.periodo || '') ? req.query.periodo : null,
      tutorId: esTutor ? req.user.userId : (req.query.tutorId ? parseInt(req.query.tutorId) : null),
      estado: ['pendiente', 'pagada', 'revertida'].includes(req.query.estado) ? req.query.estado : null,
      projectId: esTutor ? null : (req.query.projectId ? parseInt(req.query.projectId) : null),
    })});
  } catch (err) { next(err); }
}

// GET /api/tutores/comisiones/resumen — una fila por tutor y mes.
export async function resumenComisiones(req, res, next) {
  try {
    const esTutor = req.user.role === 'tutor';
    if (!esTutor) await exigirGestion(req);
    res.json({ success: true, data: await model.resumenComisiones({
      periodo: /^\d{4}-\d{2}$/.test(req.query.periodo || '') ? req.query.periodo : null,
      tutorId: esTutor ? req.user.userId : (req.query.tutorId ? parseInt(req.query.tutorId) : null),
      projectId: esTutor ? null : (req.query.projectId ? parseInt(req.query.projectId) : null),
    })});
  } catch (err) { next(err); }
}

// POST /api/tutores/comisiones/liquidar
//
// Liquidar mueve dinero, asi que NO basta con gestionar colaboraciones: lo hace
// un administrador. Es la misma linea que separa organizar de pagar.
export async function liquidar(req, res, next) {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      throw new AppError('Solo un administrador marca comisiones como pagadas', 403, 'FORBIDDEN');
    }
    const d = valida(liquidarSchema, req.body || {});
    if (!d.ids?.length && !(d.periodo && d.tutorId)) {
      throw new AppError('Dime qué liquidar: unas líneas concretas, o un tutor y un mes.', 400, 'NADA_QUE_LIQUIDAR');
    }
    const r = await model.liquidar({
      ids: d.ids || null, periodo: d.periodo || null, tutorId: d.tutorId || null, userId: req.user.userId,
    });
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// POST /api/tutores/comisiones/:id/revertir
export async function revertirComision(req, res, next) {
  try {
    if (!['admin', 'superadmin'].includes(req.user.role)) {
      throw new AppError('Solo un administrador revierte una comisión', 403, 'FORBIDDEN');
    }
    const c = await model.revertirComision(parseInt(req.params.id), {
      userId: req.user.userId, motivo: String(req.body?.motivo || '').slice(0, 200),
    });
    if (!c) throw new AppError('Esa comisión no existe', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

// GET /api/tutores/pagos-sin-formacion?desde=&hasta=
// El dinero que no se puede atribuir a ningun tutor porque su venta no dice de
// que formacion es. Se enseña en vez de esconderse.
export async function pagosSinFormacion(req, res, next) {
  try {
    await exigirGestion(req);
    const hoy = new Date().toISOString().slice(0, 10);
    res.json({ success: true, data: await model.pagosSinFormacion({
      desde: /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde || '') ? req.query.desde : hoy.slice(0, 8) + '01',
      hasta: /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta || '') ? req.query.hasta : hoy,
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
    })});
  } catch (err) { next(err); }
}

// GET /api/tutores/curso/:productId — la ficha del curso, en solo lectura.
export async function cursoDetalle(req, res, next) {
  try {
    const productId = parseInt(req.params.productId);
    // Un profesor solo ve la ficha de lo que IMPARTE. Estar en la marca no
    // basta: el temario de un curso que no da no es asunto suyo.
    if (req.user.role === 'tutor') {
      if (!(await model.imparteEsteCurso(req.user.userId, productId))) {
        throw new AppError('Ese curso no es tuyo', 403, 'FORBIDDEN');
      }
    } else {
      await exigirGestion(req);
    }
    const c = await model.cursoDetalle(productId);
    if (!c) throw new AppError('Curso no encontrado', 404, 'NOT_FOUND');
    // Se dice si hay brochure y cual, pero NO su enlace: ese se pide aparte y
    // caduca, para que no acabe una direccion permanente reenviada por ahi.
    c.brochure = await model.brochureDelCurso(productId);
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

// GET /api/tutores/curso/:productId/brochure — enlace temporal al PDF del curso.
//
// El enlace caduca: no se le da al profesor una direccion permanente que pueda
// acabar reenviada por ahi. Es el mismo mecanismo que usa el resto del CRM.
export async function brochureDelCurso(req, res, next) {
  try {
    const productId = parseInt(req.params.productId);
    if (req.user.role === 'tutor') {
      if (!(await model.imparteEsteCurso(req.user.userId, productId))) {
        throw new AppError('Ese curso no es tuyo', 403, 'FORBIDDEN');
      }
    } else {
      await exigirGestion(req);
    }
    const d = await model.brochureDelCurso(productId);
    if (!d) throw new AppError('Este curso todavía no tiene brochure subido', 404, 'SIN_BROCHURE');
    const { url } = await dossierService.getPresignedUrl(d.id, (await model.cursoDetalle(productId)).project_id);
    res.json({ success: true, data: { url, filename: d.filename_original, version: d.version } });
  } catch (err) { next(err); }
}

// POST /api/tutores/:id/contrasena — ponerle una contraseña nueva.
//
// La pone quien gestiona colaboraciones: es lo que pasa de verdad cuando un
// profesor la pierde y escribe por WhatsApp un domingo. Antes habia que ser
// administrador y el profesor se quedaba fuera hasta el lunes.
//
// Solo vale para TUTORES: por aqui no se le puede cambiar la clave a una
// gestora ni a un administrador, aunque se pruebe con su identificador.
export async function cambiarContrasena(req, res, next) {
  try {
    await exigirGestion(req);
    const id = parseInt(req.params.id);
    const t = await model.ficha(id);
    if (!t) throw new AppError('Ese tutor no existe', 404, 'NOT_FOUND');
    const nueva = String(req.body?.password || '');
    if (nueva.length < 8) throw new AppError('La contraseña necesita al menos 8 caracteres', 400, 'CORTA');
    await model.ponerContrasena(id, nueva);
    res.json({ success: true, data: { id, nombre: t.nombre, email: t.email } });
  } catch (err) { next(err); }
}

// DELETE /api/tutores/:id — retirar a un profesor.
//
// No borra nada: lo desactiva y cierra sus cursos a dia de hoy. Sus comisiones
// se quedan donde estan —son dinero devengado— y si tiene algo pendiente de
// pagar se avisa en la respuesta, para que nadie lo retire creyendo que no
// debia nada.
export async function retirarTutor(req, res, next) {
  try {
    await exigirGestion(req);
    const id = parseInt(req.params.id);
    const r = await model.retirarTutor(id);
    if (!r) throw new AppError('Ese tutor no existe', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// POST /api/tutores/:id/reactivar
export async function reactivarTutor(req, res, next) {
  try {
    await exigirGestion(req);
    const r = await model.reactivarTutor(parseInt(req.params.id));
    if (!r) throw new AppError('Ese tutor no existe', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
