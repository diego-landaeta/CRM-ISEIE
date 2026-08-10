import * as model from './tutor.model.js';
import * as userService from '../users/user.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import {
  altaTutorSchema, perfilSchema, colaboracionSchema,
  editarColaboracionSchema, ajustesSchema,
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
const puedeGestionar = (req) => ['admin', 'superadmin'].includes(req.user.role)
  || req.user.gestor_colaboraciones === true;

function exigirGestion(req) {
  if (!puedeGestionar(req)) {
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
    exigirGestion(req);
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
    if (req.user.userId !== id) exigirGestion(req);
    const t = await model.ficha(id);
    if (!t) throw new AppError('Tutor no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: t });
  } catch (err) { next(err); }
}

// POST /api/tutores  — alta completa: usuario + perfil.
export async function alta(req, res, next) {
  try {
    exigirGestion(req);
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
    if (req.user.userId !== id) exigirGestion(req);
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
    if (!esTutor) exigirGestion(req);
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
    exigirGestion(req);
    const d = valida(colaboracionSchema, req.body);

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
    exigirGestion(req);
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
    exigirGestion(req);
    const r = await model.borrarColaboracion(parseInt(req.params.id));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

// ── Ajustes ─────────────────────────────────────────────────────────────────

export async function ajustes(req, res, next) {
  try {
    exigirGestion(req);
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
    if (!esTutor) exigirGestion(req);
    const hoy = new Date().toISOString().slice(0, 10);
    res.json({ success: true, data: await model.simular({
      desde: req.query.desde || hoy.slice(0, 8) + '01',
      hasta: req.query.hasta || hoy,
      tutorId: esTutor ? req.user.userId : (req.query.tutorId ? parseInt(req.query.tutorId) : null),
    })});
  } catch (err) { next(err); }
}
