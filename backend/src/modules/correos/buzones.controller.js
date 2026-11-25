import * as model from './buzones.model.js';
import {
  crearBuzonSchema, cambiarBuzonSchema, probarBuzonSchema,
} from './buzones.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { campusParaRecortar, veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import {
  cifrarConexion, descifrarConexion, probarConexion,
} from '../../shared/services/correo-entrante.service.js';
import { destinoSeguro } from '../../shared/services/correo-destino.js';

/**
 * Los buzones de correo de la Bandeja (CRM#1032).
 *
 * Diego, 23/11: «conectar varios correos de Hostinger como hicimos en CEDIA».
 *
 * La conexión (servidor, puerto, usuario, contraseña) entra por aquí y se
 * guarda cifrada. NO vuelve a salir: ni al listar, ni al guardar, ni al probar.
 * Lo que la pantalla sabe de un buzón es su nombre, su dirección, su campus, su
 * empresa y si tiene credenciales guardadas.
 */

const validar = (schema, body) => {
  const r = schema.safeParse(body || {});
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
};

/** Que el buzón sea de uno de sus campus (o de ninguno, si ve el CRM entero). 404 si no. */
async function buzonVisible(req, id) {
  const n = Number(id);
  const b = Number.isInteger(n) && n > 0 ? await model.uno(n) : null;
  if (!b) throw new AppError('Ese buzón no está', 404, 'NOT_FOUND');
  const campus = await campusParaRecortar(req);
  if (campus && b.project_id != null && !campus.includes(Number(b.project_id))) {
    throw new AppError('Ese buzón no está', 404, 'NOT_FOUND');
  }
  // Uno de ningún campus lo ve quien ve la Bandeja, pero solo lo toca quien ve
  // el CRM entero: es de todos.
  return b;
}

async function exigirTocable(req, b) {
  if (!veTodoElCrm(req.user) && b.project_id == null) {
    throw new AppError('Este buzón es de todo el CRM: solo lo cambia soporte o superadmin', 403, 'FORBIDDEN');
  }
}

/**
 * El campus y la empresa que se piden, comprobados. Quien no ve el CRM entero
 * tiene que elegir uno de SUS campus: un buzón sin campus lo verían todos.
 */
async function comprobarDestino(req, { projectId, empresaId, alCrear }) {
  if (!veTodoElCrm(req.user)) {
    if (alCrear && projectId == null) {
      throw new AppError('Elige el campus del buzón', 400, 'VALIDATION_ERROR');
    }
    if (projectId != null) {
      const mios = await campusDeLaPersona(req.user?.userId);
      if (!mios.includes(Number(projectId))) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
    }
  }
  if (empresaId != null) {
    const e = await model.empresa(empresaId);
    if (!e || !e.activo) throw new AppError('Esa empresa no está', 400, 'VALIDATION_ERROR');
    if (!veTodoElCrm(req.user) && e.project_id != null) {
      const mios = await campusDeLaPersona(req.user?.userId);
      if (!mios.includes(Number(e.project_id))) throw new AppError('Esa empresa no está', 400, 'VALIDATION_ERROR');
    }
  }
}

/**
 * Si el buzón es de una empresa SIN correo de facturación, se ofrece ponerlo
 * (punto 4 de la CRM#1032): los avisos de «Han llegado N facturas» van a ese
 * correo y, vacío, no llegan a nadie. Solo a quien puede cambiar la empresa.
 */
async function ofertaDeCorreo(req, b) {
  if (!b?.empresa_id || !b.empresa_sin_correo) return null;
  if (!(await tienePermiso(req, 'facturas.configurar'))) return null;
  return { empresaId: b.empresa_id, empresa: b.empresa_nombre, direccion: b.direccion };
}

/**
 * Puerto e IP del servidor, antes de guardar o probar: 400 si no se permite
 * (ver `correo-destino.js`). El servicio lo vuelve a mirar justo antes de
 * conectar, que es lo que para el rebinding; esto es para decirlo a tiempo.
 */
async function exigirDestino(conexion) {
  const d = await destinoSeguro(conexion);
  if (!d.ok) throw new AppError(d.motivo, 400, 'DESTINO_NO_PERMITIDO');
}

/** El error de la base por dirección repetida, en palabras. */
function siRepetido(err) {
  if (err?.code === '23505') {
    return new AppError('Ese buzón ya está conectado', 409, 'BUZON_REPETIDO');
  }
  return err;
}

export async function listar(req, res, next) {
  try {
    res.json({ success: true, data: await model.listar(await campusParaRecortar(req)) });
  } catch (e) { next(e); }
}

export async function crear(req, res, next) {
  try {
    const d = validar(crearBuzonSchema, req.body);
    await comprobarDestino(req, { projectId: d.project_id, empresaId: d.empresa_id, alCrear: true });
    await exigirDestino({ host: d.host, puerto: d.puerto });
    const cifrado = cifrarConexion({
      host: d.host, puerto: d.puerto, usuario: d.usuario || d.direccion, clave: d.clave,
    });
    let b;
    try {
      b = await model.crear({
        nombre: d.nombre, direccion: d.direccion, projectId: d.project_id, empresaId: d.empresa_id,
        cifrado, userId: req.user?.userId,
      });
    } catch (err) { throw siRepetido(err); }
    logger.info({ buzon: b.id, por: req.user?.userId }, 'Buzón de correo conectado');
    res.status(201).json({ success: true, data: b, ofrecerCorreoEmpresa: await ofertaDeCorreo(req, b) });
  } catch (e) { next(e); }
}

export async function cambiar(req, res, next) {
  try {
    const actual = await buzonVisible(req, req.params.id);
    await exigirTocable(req, actual);
    const d = validar(cambiarBuzonSchema, req.body);
    await comprobarDestino(req, { projectId: d.project_id, empresaId: d.empresa_id, alCrear: false });
    if (!veTodoElCrm(req.user) && d.project_id === null) {
      throw new AppError('Elige el campus del buzón', 400, 'VALIDATION_ERROR');
    }

    // La conexión solo se toca si viene algo de ella. Lo que no viene se queda
    // como estaba: para eso se descifra la guardada, aquí y en ningún otro sitio.
    let cifrado = null;
    const cambiaDireccion = Boolean(d.direccion && d.direccion !== actual.direccion);
    const tocaConexion = Boolean(d.clave || d.host || d.usuario || d.puerto || cambiaDireccion);
    if (tocaConexion) {
      const fila = await model.conexionCifrada(actual.id);
      const antes = descifrarConexion(fila);
      // Con Hostinger el usuario es la dirección: si cambia la dirección y el
      // usuario era la dirección de antes, cambia con ella.
      const usuarioEraLaDireccion = (antes.usuario || '').toLowerCase() === actual.direccion;
      if (d.host || d.puerto) {
        await exigirDestino({ host: d.host || antes.host, puerto: d.puerto || antes.puerto });
      }
      cifrado = cifrarConexion({
        host: d.host || antes.host,
        puerto: d.puerto || antes.puerto,
        usuario: d.usuario || (cambiaDireccion && usuarioEraLaDireccion ? d.direccion : antes.usuario),
        clave: d.clave || antes.clave,
      });
    }
    let b;
    try {
      b = await model.cambiar(actual.id, {
        nombre: d.nombre, direccion: d.direccion, projectId: d.project_id, empresaId: d.empresa_id,
        cifrado, userId: req.user?.userId,
      });
    } catch (err) { throw siRepetido(err); }
    res.json({ success: true, data: b, ofrecerCorreoEmpresa: await ofertaDeCorreo(req, b) });
  } catch (e) { next(e); }
}

export async function quitar(req, res, next) {
  try {
    const b = await buzonVisible(req, req.params.id);
    await exigirTocable(req, b);
    await model.quitar(b.id, req.user?.userId);
    logger.info({ buzon: b.id, por: req.user?.userId }, 'Buzón de correo quitado');
    res.json({ success: true });
  } catch (e) { next(e); }
}

/**
 * «Probar conexión» con lo que hay en el formulario, sin guardar. Para un buzón
 * ya guardado (`/:id/probar`), lo que no se escriba se toma de lo guardado: así
 * se prueba una contraseña nueva sin volver a escribir lo demás.
 */
export async function probar(req, res, next) {
  try {
    const d = validar(probarBuzonSchema, req.body);
    let base = { host: 'imap.hostinger.com', puerto: 993, usuario: '', clave: '' };
    if (req.params.id) {
      const b = await buzonVisible(req, req.params.id);
      base = descifrarConexion(await model.conexionCifrada(b.id));
    }
    const conexion = {
      host: d.host || base.host,
      puerto: d.puerto || base.puerto,
      usuario: d.usuario || d.direccion || base.usuario,
      clave: d.clave || base.clave,
    };
    if (!conexion.usuario || !conexion.clave) {
      throw new AppError('Faltan el usuario o la contraseña del buzón', 400, 'VALIDATION_ERROR');
    }
    await exigirDestino(conexion);
    res.json({ success: true, data: await probarConexion(conexion) });
  } catch (e) { next(e); }
}

/** Poner la dirección del buzón como correo de facturación de su empresa, si no tiene. */
export async function usarComoCorreoDeEmpresa(req, res, next) {
  try {
    if (!(await tienePermiso(req, 'facturas.configurar'))) {
      throw new AppError('Cambiar el correo de una empresa es de quien configura la facturación', 403, 'FORBIDDEN');
    }
    const b = await buzonVisible(req, req.params.id);
    if (!b.empresa_id) throw new AppError('Este buzón no es de ninguna empresa', 400, 'SIN_EMPRESA');
    const e = await model.usarComoCorreoDeEmpresa(b.id);
    if (!e) {
      return res.json({ success: true, data: null, motivo: 'YA_TIENE_CORREO' });
    }
    logger.info({ buzon: b.id, empresa: e.id, por: req.user?.userId }, 'Buzón puesto como correo de facturación');
    res.json({ success: true, data: e });
  } catch (e) { next(e); }
}

/** Para el controlador de la Bandeja: que el buzón pedido se pueda leer. */
export { buzonVisible };
