import { getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as model from './facturas-colaborador.model.js';

/*
  Facturas de colaboradores (#202) · la lista de colaboradores.

  Quién ve qué (Diego, 07/10): el super admin, todo; un admin, solo los
  colaboradores que facturan a su empresa, y de ellos solo lo de su empresa.
  «Su empresa» son las empresas de sus campus, el mismo criterio que la #245
  (`ambito.js`). Se comprueba aquí, en el servidor, no en la pantalla.
*/

/** Las empresas que ve esta persona: `null` = todas. */
export async function ambitoDe(user) {
  if (user?.role === 'superadmin') return null;
  return model.empresasDeLosCampus(user.userId);
}

const NO_ESTA = () => new AppError('Colaborador no encontrado', 404, 'NOT_FOUND');

/** «2026-09» → «septiembre de 2026», para los mensajes (no «2026-09»). */
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesEscrito = (v) => { const [a, m] = String(v).split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };

function comprobarEmpresas(empresas, ambito) {
  const repetidas = new Set();
  for (const e of empresas) {
    if (repetidas.has(e.issuer_id)) {
      throw new AppError('Has elegido la misma empresa dos veces', 400, 'VALIDATION_ERROR');
    }
    repetidas.add(e.issuer_id);
    if (ambito && !ambito.includes(e.issuer_id)) {
      throw new AppError('Solo puedes elegir empresas de tus campus', 403, 'FORBIDDEN');
    }
  }
}

async function comprobarUsuario(userId) {
  if (userId && !(await model.esUsuarioColaborador(userId))) {
    throw new AppError('El usuario elegido tiene que tener el rol colaborador o tutor redactor', 400, 'VALIDATION_ERROR');
  }
}

/**
 * Un colaborador que factura también a empresas que este admin no lleva es de
 * varios: sus datos, su baja y su alta los cambia el super admin. El admin solo
 * toca lo de sus empresas (que factura o no a ellas, y lo acordado). Si no, el
 * admin de una empresa cambiaría el correo al que le llegan las facturas de la
 * otra, o lo daría de baja para todas.
 */
const COMPARTIDO = () => new AppError(
  'Este colaborador también factura a otras empresas del grupo: sus datos, su baja y su alta solo los cambia el super admin. Tú puedes cambiar lo que es de tu empresa: si le factura y lo acordado.',
  403, 'FORBIDDEN',
);

async function enTransaccion(fn) {
  const db = await getClient();
  let roto = false;
  try {
    await db.query('BEGIN');
    const r = await fn(db);
    await db.query('COMMIT');
    return r;
  } catch (err) {
    // Si el ROLLBACK también falla, el error que cuenta es el primero, y esa
    // conexión no vuelve al pool (`release(true)` la cierra).
    await db.query('ROLLBACK').catch(() => { roto = true; });
    throw err;
  } finally {
    db.release(roto);
  }
}

export async function empresas(user) {
  return model.empresas(await ambitoDe(user));
}

export async function listar(user, filtros) {
  const ambito = await ambitoDe(user);
  if (filtros.issuerId && ambito && !ambito.includes(filtros.issuerId)) {
    throw new AppError('Esa empresa no es de tus campus', 403, 'FORBIDDEN');
  }
  return model.listar({ issuerIds: ambito, ...filtros });
}

export async function ver(user, id) {
  const c = await model.porId(id, await ambitoDe(user));
  if (!c) throw NO_ESTA();
  return c;
}

export async function crear(user, datos, ip) {
  const ambito = await ambitoDe(user);
  comprobarEmpresas(datos.empresas, ambito);
  await comprobarUsuario(datos.user_id);

  const id = await enTransaccion(async (db) => {
    const nuevo = await model.insertar(db, datos, user.userId);
    for (const e of datos.empresas) await model.ponerEmpresa(db, nuevo, e);
    await model.anotar(db, {
      colaboradorId: nuevo, evento: 'alta', userId: user.userId, ip,
      detalle: {
        nombre: datos.nombre, email: datos.email, area: datos.area,
        empresas: datos.empresas, alta_desde: datos.alta_desde ?? null,
      },
    });
    return nuevo;
  });
  return model.porId(id, ambito);
}

/** Lo que cambia en un campo, para el registro: antes y después. */
function diferencias(antes, cambios) {
  const salida = {};
  for (const [k, v] of Object.entries(cambios)) {
    if (k === 'empresas') continue;
    const viejo = antes[k] ?? null;
    if (String(viejo) !== String(v ?? null)) salida[k] = { antes: viejo, despues: v ?? null };
  }
  return salida;
}

export async function editar(user, id, cambios, ip) {
  const ambito = await ambitoDe(user);
  const antes = await model.porId(id, ambito);
  if (!antes) throw NO_ESTA();
  if (cambios.empresas) comprobarEmpresas(cambios.empresas, ambito);
  const deLaFicha = Object.keys(cambios).filter((k) => k !== 'empresas' && cambios[k] !== undefined);
  if (deLaFicha.length && await model.facturaFueraDe(id, ambito)) {
    // Si llega igual que está (la pantalla manda la ficha entera), no es un cambio.
    const igual = (k) => String(antes[k] ?? '') === String(k === 'alta_desde' && cambios[k] ? cambios[k].slice(0, 7) : cambios[k] ?? '');
    if (!deLaFicha.every(igual)) throw COMPARTIDO();
    for (const k of deLaFicha) delete cambios[k];
  }
  if (cambios.user_id !== undefined) await comprobarUsuario(cambios.user_id);

  // `alta_desde` llega como «2026-09-01» y se guarda así; en la ficha sale «2026-09».
  const comparables = { ...antes, alta_desde: antes.alta_desde ? `${antes.alta_desde}-01` : null };
  const detalle = diferencias(comparables, cambios);

  await enTransaccion(async (db) => {
    await model.actualizar(db, id, cambios);

    if (cambios.empresas) {
      // Un admin solo toca las empresas de sus campus: las demás se quedan
      // como estaban, aunque no las vea.
      const todas = await model.empresasDe(id, db);
      const mias = ambito ? todas.filter((e) => ambito.includes(e.issuer_id)) : todas;
      const nuevas = new Map(cambios.empresas.map((e) => [e.issuer_id, e]));

      for (const e of mias) {
        if (!nuevas.has(e.issuer_id)) await model.quitarEmpresa(db, id, e.issuer_id);
      }
      for (const e of nuevas.values()) await model.ponerEmpresa(db, id, e);

      const despues = await model.empresasDe(id, db);
      if (!despues.length) {
        throw new AppError('Elige al menos una empresa a la que factura', 400, 'VALIDATION_ERROR');
      }
      const clave = (l) => JSON.stringify(l.filter((e) => !ambito || ambito.includes(e.issuer_id)));
      if (clave(todas) !== clave(despues)) {
        detalle.empresas = { antes: JSON.parse(clave(todas)), despues: JSON.parse(clave(despues)) };
      }
    }

    if (Object.keys(detalle).length) {
      await model.anotar(db, { colaboradorId: id, evento: 'cambio', userId: user.userId, ip, detalle });
    }
  });
  return model.porId(id, ambito);
}

export async function darDeBaja(user, id, desde, ip) {
  const ambito = await ambitoDe(user);
  const c = await model.porId(id, ambito);
  if (!c) throw NO_ESTA();
  if (await model.facturaFueraDe(id, ambito)) throw COMPARTIDO();
  if (c.baja_desde) throw new AppError(`Este colaborador ya tiene la baja desde ${mesEscrito(c.baja_desde)}`, 409, 'CONFLICT');

  await enTransaccion(async (db) => {
    await model.darDeBaja(db, id, desde);
    await model.anotar(db, { colaboradorId: id, evento: 'baja', userId: user.userId, ip, detalle: { desde } });
  });
  return model.porId(id, ambito);
}

/** Volver a darlo de alta, desde un mes («desde qué mes entra», definición del 01/10). */
export async function volverDeAlta(user, id, desde, ip) {
  const ambito = await ambitoDe(user);
  const c = await model.porId(id, ambito);
  if (!c) throw NO_ESTA();
  if (await model.facturaFueraDe(id, ambito)) throw COMPARTIDO();
  if (!c.baja_desde) throw new AppError('Este colaborador no está de baja', 409, 'CONFLICT');

  await enTransaccion(async (db) => {
    await model.volverDeAlta(db, id, desde);
    await model.anotar(db, { colaboradorId: id, evento: 'alta', userId: user.userId, ip, detalle: { desde, vuelve: true } });
  });
  return model.porId(id, ambito);
}

export async function registro(user, id) {
  const ambito = await ambitoDe(user);
  if (!(await model.porId(id, ambito))) throw NO_ESTA();
  const lineas = await model.registroDe(id, ambito);
  if (!ambito) return lineas;
  // Las líneas de alta y cambio llevan las empresas y lo acordado: a un admin,
  // solo las de sus empresas (lo de las demás no es suyo).
  const suyas = (l) => (Array.isArray(l) ? l.filter((e) => ambito.includes(Number(e.issuer_id))) : l);
  return lineas.map((l) => {
    const e = l.detalle?.empresas;
    if (!e) return l;
    const empresas = Array.isArray(e) ? suyas(e) : { antes: suyas(e.antes), despues: suyas(e.despues) };
    return { ...l, detalle: { ...l.detalle, empresas } };
  });
}
