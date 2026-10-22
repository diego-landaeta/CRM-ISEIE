import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { conLoDelCrm, exigirMisMatriculas } from './certifex.emisiones.js';
import * as model from './certifex.model.js';
import { programasPara, datosDeCandidato, formacionesDeCentro, proyectoDeCentro } from './certifex.programa.js';
import { sincronizarTemario } from '../products/temario.js';
import { certifex, recorrer } from './certifex.cliente.js';
import { alcanceDe, acotar, exigirCentro, exigirExpedientes, NO_ENCONTRADA } from './certifex.alcance.js';
import { prepararEmision, emitirConPrograma, emitirMatriculas, resultadoBloqueado } from './certifex.emision.js';
import { conFirma, correoDe, firmaTransparente, guardarFirmaSubida, origenesDeFirma, pngDe } from './certifex.firma.js';
import {
  listarSolicitudesSchema, listarDiplomasSchema, porAvisarSchema, aprobarEmitirSchema, rechazarSchema, emitirDiplomasSchema,
  avisosSchema, avisosRechazoSchema, revocarSchema, corregirSchema, editarSchema, formacionesSchema, listarTerminadosSchema,
  sincronizarTemarioSchema, nuevoDiplomaSchema, pedirDiplomaSchema,
  mensajeDeValidacion, normalizarNombreDiploma,
} from './certifex.validation.js';

/**
 * Certifex · Diplomas (#272): las solicitudes que los alumnos hacen desde Moodle y
 * los diplomas ya emitidos, desde el CRM.
 *
 * Decisiones del usuario (08/10) que mandan aqui:
 *  · El alumno solo escribe su nombre, y es el que se imprime. El panel lo ensena
 *    destacado junto al de Moodle para revisarlo antes de aprobar.
 *  · El DNI no lo escribe el alumno: vive en Certifex, en el titular, y se pone desde el
 *    panel («Sin DNI · Poner»). Es OBLIGATORIO para emitir (Diego, 20/10: «es
 *    obligatorio»): sin el, ni se aprueba ni se emite (ver certifex.emision.js).
 *  · Emitir NO avisa. El correo al alumno sale solo cuando una persona del CRM lo
 *    aprueba, en un paso aparte (`avisos`), despues de ver el PDF.
 *  · Un nombre mal escrito se CORRIGE (mismo numero, auditado), no se revoca y reemite.
 *  · Antes de aprobar se puede REVISAR (`editar`): el nombre que se imprimira (vive en
 *    Certifex), el correo con el que buscar al alumno en el CRM, la formacion vendida y
 *    el programa a imprimir. Lo revisado es lo que usa «Aprobar y emitir».
 *
 * Quien actua ante Certifex (decididoPor, emitidaPor, aprobadoPor, revocadaPor,
 * corregidoPor) es SIEMPRE el usuario con sesion; lo que diga el cuerpo se ignora.
 * Todo esto es solo de administracion (ver certifex.routes.js), y cada admin solo ve y
 * toca los campus de sus proyectos (certifex.alcance.js); super admin, todos.
 */

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(mensajeDeValidacion(r.error), 400, 'VALIDATION_ERROR');
  return r.data;
}

const quien = (req) => req.user.email;

// ─────────────────────────────────────────────── listados

/** El dia (AAAA-MM-DD) de una fecha, en hora de Madrid: «hoy» es el de la oficina. */
export function diaDe(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
}

/**
 * Un listado del panel. Sin filtros propios del CRM se pide la pagina tal cual; con
 * fechas, curso (en diplomas), estado del aviso o `todo=1` (exportar) se recorre y se
 * pagina aqui.
 */
async function listado(ruta, params, f, { fecha, extra = null }) {
  const pagina = f.pagina ?? 1;
  const tam = f.tam ?? 50;
  const conFechas = !!(f.desde || f.hasta);
  if (!conFechas && !extra && f.todo !== '1') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    qs.set('pagina', String(pagina));
    qs.set('tam', String(tam));
    const d = await certifex('GET', `${ruta}?${qs.toString()}`);
    return { filas: Array.isArray(d?.filas) ? d.filas : [], total: Number(d?.total ?? 0), pagina, tam, truncado: false };
  }
  const enRango = (row) => {
    if (!conFechas) return true;
    const d = diaDe(fecha(row));
    if (!d) return false;
    return (!f.desde || d >= f.desde) && (!f.hasta || d <= f.hasta);
  };
  const r = await recorrer(ruta, params, {
    filtro: (row) => enRango(row) && (!extra || extra(row)),
    // Lo de antes de `desde` ya no puede entrar si lo que sigue es aun mas antiguo.
    fecha,
    antiguo: f.desde ? (row) => { const d = diaDe(fecha(row)); return !!d && d < f.desde; } : null,
  });
  if (f.todo === '1') return { filas: r.filas, total: r.filas.length, pagina: 1, tam: r.filas.length, truncado: r.truncado };
  return { filas: r.filas.slice((pagina - 1) * tam, pagina * tam), total: r.filas.length, pagina, tam, truncado: r.truncado };
}

/** Lo que se ensena a quien pide un campus que no es suyo (o no tiene ninguno). */
const paginaVacia = (f) => ({ filas: [], total: 0, pagina: f.todo === '1' ? 1 : f.pagina ?? 1, tam: f.todo === '1' ? 0 : f.tam ?? 50, truncado: false });

/** Un filtro por varios campus, para `listado` (null si no hace falta). */
const deMisCentros = (ambito) => (ambito.centros ? (row) => ambito.centros.has(String(row?.centro).toUpperCase()) : null);

/** Junta dos filtros de fila (cualquiera puede ser null). */
const ambos = (a, b) => (a && b ? (row) => a(row) && b(row) : a || b);

// ─────────────────────────────────────────────── solicitudes

/**
 * Las solicitudes de diploma (lo que el alumno pidio desde Moodle), por estado.
 * Cada fila trae lo que el CRM sabe de ese correo (`crm`) y, en las rechazadas, el
 * aviso de rechazo que ya se aprobo (`avisoRechazo`).
 */
export async function solicitudes(req, res, next) {
  try {
    const f = parsear(listarSolicitudesSchema, req.query);
    const ambito = acotar(await alcanceDe(req.user), f.centro);
    if (ambito.vacio) return res.json({ success: true, data: paginaVacia(f) });
    const data = await listado('/candidatos', {
      estado: f.estado ?? 'pendiente', solicitadas: '1', centro: ambito.centro, curso: f.curso, q: f.q,
    }, f, { fecha: (c) => c?.solicitud?.en, extra: deMisCentros(ambito) });
    // Lo revisado a mano va primero: cambia con que correo se cruza y que programa sale.
    await conEdicion(data.filas);
    await conLoDelCrm(data.filas, req.user);
    await conAvisoRechazo(data.filas);
    if ((f.estado ?? 'pendiente') !== 'rechazada') {
      await conProgramaCrm(data.filas);
      await conFirma(data.filas);
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * Lo revisado a mano de cada fila sin diploma (`edicion`): el correo del CRM, la
 * formacion elegida y el programa editado, con quien y cuando. null si no hay nada.
 * Si la base no contesta, el listado sale igual, sin ediciones.
 */
async function conEdicion(filas) {
  const sinTitulo = filas.filter((c) => !c.nexpediente);
  for (const c of filas) c.edicion = null;
  if (!sinTitulo.length) return;
  try {
    const m = await model.edicionesDe(sinTitulo.map((c) => c.matriculaId));
    for (const c of sinTitulo) c.edicion = m.get(c.matriculaId) ?? null;
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo leer lo revisado a mano');
  }
}

/**
 * El programa que se imprimiria si se emite ahora (`programaCrm`): el de la formacion
 * vendida, o null con el motivo. Es lo que se revisa antes de aprobar.
 */
async function conProgramaCrm(filas) {
  const sinTitulo = filas.filter((c) => !c.nexpediente);
  for (const c of filas) c.programaCrm = null;
  const m = await programasPara(sinTitulo.map(datosDeCandidato));
  for (const c of sinTitulo) c.programaCrm = m.get(c.matriculaId) ?? null;
}

async function conAvisoRechazo(filas) {
  const rechazadas = filas.filter((c) => c?.decision?.decision === 'rechazada').map((c) => c.matriculaId);
  for (const c of filas) c.avisoRechazo = null;
  if (!rechazadas.length) return;
  try {
    const m = await model.avisosRechazoDe(rechazadas);
    for (const c of filas) c.avisoRechazo = m.get(c.matriculaId) ?? null;
  } catch (e) {
    // El listado sale igual: no saber si se aviso no puede bloquear el panel.
    logger.warn({ err: e.message }, 'Certifex: no se pudo leer el aviso de rechazo');
  }
}

/**
 * Lo que espera a una persona DESPUES de aprobar, dentro de las solicitudes:
 *  · `porAvisar`: con diploma emitido y vigente, y ningun aviso aprobado todavia.
 *    Es el «pendiente de aviso»: ver el PDF y, si esta bien, enviarlo al alumno.
 *  · `sinEmitir`: aprobadas sin diploma (la emision fallo o se corto). Se reintenta.
 */
async function despuesDeAprobar({ centro, centros = null, q }) {
  if (centros && centros.size === 0) return { porAvisar: [], sinEmitir: [], truncado: false };
  const deMios = (row) => !centros || centros.has(String(row?.centro).toUpperCase());
  const aprobadas = await recorrer('/candidatos', { estado: 'aprobada', solicitadas: '1', centro, q }, { filtro: deMios });
  const conTitulo = aprobadas.filas.filter((c) => c.nexpediente);
  const sinEmitir = aprobadas.filas.filter((c) => !c.nexpediente);
  if (!conTitulo.length) return { porAvisar: [], sinEmitir, truncado: aprobadas.truncado };

  const buscados = new Set(conTitulo.map((c) => c.nexpediente));
  // Un diploma de una solicitud se emite despues de pedirlo: lo de antes de la
  // solicitud mas antigua (con un dia de margen) ya no puede ser de ninguna.
  const masAntigua = conTitulo.reduce((m, c) => (c.solicitud?.en && (!m || c.solicitud.en < m) ? c.solicitud.en : m), null);
  const limite = masAntigua ? new Date(new Date(masAntigua).getTime() - 86_400_000).toISOString() : null;
  const diplomas = await recorrer('/diplomas', { estado: 'vigentes', centro }, {
    filtro: (d) => buscados.has(d.nexpediente) && deMios(d),
    completo: (hallados) => hallados.length >= buscados.size,
    fecha: (d) => d.emitidoEn,
    antiguo: limite ? (d) => !!d.emitidoEn && d.emitidoEn < limite : null,
  });
  const porExp = new Map(diplomas.filas.map((d) => [d.nexpediente, d]));
  const porAvisar = conTitulo
    .map((c) => ({ ...c, diploma: porExp.get(c.nexpediente) ?? null }))
    .filter((c) => c.diploma && !c.diploma.aviso);
  return { porAvisar, sinEmitir, truncado: aprobadas.truncado || diplomas.truncado };
}

export async function porAvisar(req, res, next) {
  try {
    const f = parsear(porAvisarSchema, req.query);
    const ambito = acotar(await alcanceDe(req.user), f.centro);
    const data = ambito.vacio
      ? { porAvisar: [], sinEmitir: [], truncado: false }
      : await despuesDeAprobar({ centro: ambito.centro, centros: ambito.centros ?? null, q: f.q });
    for (const c of data.porAvisar) if (c.diploma) c.diploma.emitidoEnCrm = emitidoPorElCrm(c.diploma);
    await conEdicion([...data.porAvisar, ...data.sinEmitir]);
    await conLoDelCrm([...data.porAvisar, ...data.sinEmitir], req.user);
    await conProgramaCrm(data.sinEmitir);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Los contadores de arriba del panel, de un campus o de todos. */
export async function resumen(req, res, next) {
  try {
    const ambito = acotar(await alcanceDe(req.user), parsear(porAvisarSchema, req.query).centro);
    if (ambito.vacio) {
      return res.json({ success: true, data: { pendientes: 0, rechazadas: 0, vigentes: 0, revocados: 0, terminados: 0, porAvisar: 0, sinEmitir: 0, porEnviar: 0 } });
    }
    // Varios campus suyos: Certifex cuenta de uno en uno, y se suman.
    const lista = ambito.centros ? [...ambito.centros] : [ambito.centro];
    const total = async (ruta, params) => {
      const n = await Promise.all(lista.map(async (centro) => {
        const qs = new URLSearchParams({ ...params, pagina: '1', tam: '1' });
        if (centro) qs.set('centro', centro);
        const d = await certifex('GET', `${ruta}?${qs.toString()}`);
        return Number(d?.total ?? 0);
      }));
      return n.reduce((a, b) => a + b, 0);
    };
    const [pendientes, rechazadas, vigentes, revocados, terminados, despues, porEnviar] = await Promise.all([
      total('/candidatos', { estado: 'pendiente', solicitadas: '1' }),
      total('/candidatos', { estado: 'rechazada', solicitadas: '1' }),
      total('/diplomas', { estado: 'vigentes' }),
      total('/diplomas', { estado: 'revocados' }),
      total('/candidatos', { estado: 'todas', terminados: '1' }),
      despuesDeAprobar({ centro: ambito.centro, centros: ambito.centros ?? null }),
      contarPorEnviar(ambito),
    ]);
    res.json({
      success: true,
      data: {
        pendientes, rechazadas, vigentes, revocados, terminados,
        porAvisar: despues.porAvisar.length,
        sinEmitir: despues.sinEmitir.length,
        porEnviar,
      },
    });
  } catch (err) { next(err); }
}

/** 404 si alguna matricula no es de los campus de quien actua (con los datos ya leidos). */
function exigirMatriculasDe(alcance, ids, datos) {
  if (!alcance) return;
  for (const id of ids) {
    const centro = datos.get(id)?.centro;
    if (!centro || !alcance.has(String(centro).toUpperCase())) throw new AppError(`${NO_ENCONTRADA} (${id})`, 404, 'NOT_FOUND');
  }
}

/**
 * «Aprobar y emitir», en un paso: el visto bueno y la emision, con el programa oficial de
 * la formacion vendida. NO avisa al alumno: el diploma queda «pendiente de aviso» hasta
 * que alguien lo vea y lo envie.
 *
 * Si la aprobacion sale y la emision falla, la matricula queda aprobada sin diploma
 * (sale en «Aprobados sin diploma» para reintentar) y se dice asi, no como un fallo
 * de todo.
 *
 * Todo lo que puede fallar se mira ANTES de aprobar: si la base o Certifex no contestan,
 * no se aprueba ni se emite nada (error claro). Una matricula sin DNI (`codigo:
 * 'FALTA_DNI'`), o revisada a mano que aun asi no tiene programa, no se aprueba ni se
 * emite (`fase: 'emitir_bloqueado'`, con el motivo).
 */
export async function aprobarEmitir(req, res, next) {
  try {
    const { matriculaIds } = parsear(aprobarEmitirSchema, req.body);
    const alcance = await alcanceDe(req.user);
    // Antes de decidir: la busqueda en Certifex es la misma y no depende del estado.
    const preparado = await prepararEmision(matriculaIds);
    exigirMatriculasDe(alcance, matriculaIds, preparado.datos);
    const aDecidir = matriculaIds.filter((id) => !preparado.bloqueadas.has(id));
    const dec = aDecidir.length
      ? await certifex('POST', '/decisiones', {
        decisiones: aDecidir.map((matriculaId) => ({ matriculaId, decision: 'aprobada', decididoPor: quien(req) })),
      })
      : { resultados: [] };
    const fallidas = new Map((dec?.resultados ?? []).filter((r) => !r.ok).map((r) => [r.matriculaId, r.error || 'No se pudo aprobar']));
    const aEmitir = aDecidir.filter((id) => !fallidas.has(id));
    const { porId, error } = aEmitir.length ? await emitirConPrograma(quien(req), aEmitir, preparado) : { porId: new Map(), error: null };

    const resultados = matriculaIds.map((matriculaId) => {
      if (preparado.bloqueadas.has(matriculaId)) return resultadoBloqueado(matriculaId, preparado);
      if (fallidas.has(matriculaId)) return { matriculaId, ok: false, fase: 'aprobar', error: fallidas.get(matriculaId) };
      const r = porId.get(matriculaId);
      if (r) return { ...r, matriculaId, fase: 'emitir', ...(r.ok ? {} : { error: `Aprobada, pero sin diploma: ${r.error || 'error al emitir'}` }) };
      return { matriculaId, ok: false, fase: 'emitir', error: `Aprobada, pero sin diploma: ${error?.message || 'Certifex no contestó por esta matrícula'}` };
    });
    logger.info({ userId: req.user.userId, n: matriculaIds.length, ok: resultados.filter((r) => r.ok).length }, 'Certifex: aprobar y emitir');
    res.json({ success: true, data: { resultados } });
  } catch (err) { next(err); }
}

/** Emitir lo ya aprobado (reintento de «Aprobados sin diploma»), tambien con su programa. */
export async function emitir(req, res, next) {
  try {
    const { matriculaIds } = parsear(emitirDiplomasSchema, req.body);
    const resultados = await emitirMatriculas(req.user, matriculaIds);
    res.json({ success: true, data: { resultados } });
  } catch (err) { next(err); }
}

/** Rechazar con motivo (obligatorio). No avisa: el aviso de rechazo es otro paso. */
export async function rechazar(req, res, next) {
  try {
    const { matriculaIds, motivo } = parsear(rechazarSchema, req.body);
    await exigirMisMatriculas(req.user, matriculaIds);
    const data = await certifex('POST', '/decisiones', {
      decisiones: matriculaIds.map((matriculaId) => ({ matriculaId, decision: 'rechazada', motivo, decididoPor: quien(req) })),
    });
    logger.info({ userId: req.user.userId, n: matriculaIds.length }, 'Certifex: solicitudes rechazadas');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * «Enviar diploma al alumno»: aprueba el aviso por correo de diplomas ya emitidos.
 * Si el servidor de Certifex tiene el correo apagado, `correoActivo` llega a false y
 * el panel lo dice: queda aprobado, pero el correo no ha salido.
 */
export async function avisos(req, res, next) {
  try {
    const { nexpedientes } = parsear(avisosSchema, req.body);
    await exigirExpedientes(await alcanceDe(req.user), nexpedientes);
    const data = await certifex('POST', '/avisos', { nexpedientes, aprobadoPor: quien(req) }, { timeoutMs: 120_000 });
    logger.info({ userId: req.user.userId, n: nexpedientes.length, correoActivo: data?.correoActivo }, 'Certifex: avisos de diploma aprobados');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** «Enviar aviso de rechazo»: aprueba el correo con el motivo. Se apunta aqui quien y cuando. */
export async function avisosRechazo(req, res, next) {
  try {
    const { matriculaIds } = parsear(avisosRechazoSchema, req.body);
    await exigirMisMatriculas(req.user, matriculaIds);
    const data = await certifex('POST', '/avisos-rechazo', { matriculaIds, aprobadoPor: quien(req) }, { timeoutMs: 120_000 });
    try {
      await model.registrarAvisosRechazo(data?.resultados ?? [], quien(req));
    } catch (e) {
      logger.warn({ err: e.message }, 'Certifex: no se pudo apuntar el aviso de rechazo');
    }
    logger.info({ userId: req.user.userId, n: matriculaIds.length, correoActivo: data?.correoActivo }, 'Certifex: avisos de rechazo aprobados');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── revisar antes de aprobar

/** La fila de Certifex de una solicitud, por matricula (null si no esta). */
async function solicitudDe(matriculaId) {
  const r = await recorrer('/candidatos', { estado: 'todas', solicitadas: '1' }, {
    filtro: (c) => c.matriculaId === matriculaId,
    completo: (hallados) => hallados.length >= 1,
  });
  return r.filas[0] ?? null;
}

/**
 * «Editar» en una solicitud sin diploma: revisar con que datos se trabaja antes de
 * aprobar. null en un campo quita esa edicion.
 *
 *  · `nombre`: el que se imprimira. NO se guarda en el CRM: lo tiene Certifex, que es
 *    quien imprime, y alli queda quien lo reviso. Se manda primero: si Certifex dice
 *    que ya hay diploma o que el nombre no vale, no se guarda nada mas.
 *  · `emailCrm`, `productoId`, `programa`: van a certifex_solicitudes, con quien y cuando.
 *
 * Con diploma emitido no se edita (409): lo que cambia entonces es el diploma, y eso es
 * «Corregir» (mismo numero, auditado). Devuelve la fila como la ve el panel.
 */
export async function editar(req, res, next) {
  try {
    const d = parsear(editarSchema, req.body);
    const c = await solicitudDe(d.matriculaId);
    if (!c) throw new AppError('Esa solicitud no esta en Certifex (o no es de los campus de este CRM).', 404, 'NOT_FOUND');
    exigirCentro(await alcanceDe(req.user), c.centro, 'Esa solicitud no esta en Certifex (o no es de tus campus).');
    if (c.nexpediente) {
      throw new AppError(`Ya tiene el diploma emitido (${c.nexpediente}): se cambia con «Corregir», no aqui.`, 409, 'YA_EMITIDO');
    }
    if (d.productoId != null) {
      const { formaciones: lista, motivo } = await formacionesDeCentro(c.centro);
      if (!lista.some((f) => f.id === d.productoId)) {
        throw new AppError(motivo || `Esa formacion no esta en el catalogo del campus ${c.centro}.`, 400, 'VALIDATION_ERROR');
      }
    }

    // El DNI vive en Certifex, en el alumno, como el nombre: es quien lo imprime (Carlos,
    // 20/10). Va antes que el resto: si Certifex lo rechaza (otro alumno ya lo tiene, o ya hay
    // diploma), no se guarda nada más.
    if (d.dni !== undefined) {
      const r = await certifex('POST', '/solicitudes/dni', { matriculaId: d.matriculaId, dni: d.dni, editadoPor: quien(req) });
      c.titular = { ...(c.titular ?? {}), dni: r?.dni ?? d.dni };
    }

    if (d.nombre !== undefined) {
      const r = await certifex('POST', '/solicitudes/nombre', { matriculaId: d.matriculaId, nombre: d.nombre, editadoPor: quien(req) });
      c.solicitud = {
        ...(c.solicitud ?? {}),
        nombre: r?.nombre ?? d.nombre,
        nombreAlumno: r?.nombreAlumno ?? c.solicitud?.nombreAlumno ?? c.solicitud?.nombre ?? null,
        revisado: r?.revisado ?? null,
      };
    }

    const cambios = { emailCrm: d.emailCrm, productoId: d.productoId, programa: d.programa };
    if (Object.values(cambios).some((v) => v !== undefined)) {
      await model.guardarEdicion(d.matriculaId, cambios, quien(req), {
        centro: c.centro,
        cursoRef: c.curso?.ref ?? null,
        cursoNombre: c.curso?.nombre ?? null,
        nombreDiploma: c.solicitud?.nombreAlumno ?? c.solicitud?.nombre ?? null,
        nombreMoodle: c.titular?.nombre ?? null,
        email: c.titular?.email ?? null,
        solicitadaEn: c.solicitud?.en ?? null,
      });
    }

    await conEdicion([c]);
    await conLoDelCrm([c], req.user);
    await conProgramaCrm([c]);
    await conFirma([c]);
    logger.info({
      userId: req.user.userId, matriculaId: d.matriculaId,
      campos: ['nombre', 'dni', 'emailCrm', 'productoId', 'programa'].filter((k) => d[k] !== undefined),
    }, 'Certifex: solicitud revisada antes de aprobar');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── la firma del alumno (CRM #349)

/** La matricula de una peticion (multipart o ruta), validada; 400 si no es un id. */
function matriculaDe(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Falta la matrícula.', 400, 'VALIDATION_ERROR');
  return id;
}

/** La solicitud sin diploma de esa matricula, de los campus de quien pide (404/409 si no). */
async function solicitudParaFirma(user, matriculaId) {
  const c = await solicitudDe(matriculaId);
  if (!c) throw new AppError('Esa solicitud no esta en Certifex (o no es de los campus de este CRM).', 404, 'NOT_FOUND');
  exigirCentro(await alcanceDe(user), c.centro, 'Esa solicitud no esta en Certifex (o no es de tus campus).');
  return c;
}

/**
 * POST /diplomas/firma (multipart: `file` + `matriculaId`) — subir o cambiar la firma del
 * alumno antes de aprobar (Diego, 19/10: «si no la tiene debe salir para cargarla»). Se
 * guarda ya procesada: PNG con el fondo transparente y recortada al trazo. Con diploma
 * emitido no se cambia (409). Devuelve la fila como la ve el panel.
 */
export async function subirFirma(req, res, next) {
  try {
    const matriculaId = matriculaDe(req.body?.matriculaId);
    if (!req.file?.buffer?.length) throw new AppError('Falta la imagen de la firma.', 400, 'VALIDATION_ERROR');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
      throw new AppError('La firma tiene que ser una imagen PNG, JPG o WEBP.', 400, 'FIRMA_NO_VALIDA');
    }
    const c = await solicitudParaFirma(req.user, matriculaId);
    if (c.nexpediente) {
      throw new AppError(`Ya tiene el diploma emitido (${c.nexpediente}): la firma ya no se cambia.`, 409, 'YA_EMITIDO');
    }
    const png = await firmaTransparente(req.file.buffer);
    await guardarFirmaSubida(matriculaId, c.centro, png, quien(req), {
      centro: c.centro,
      cursoRef: c.curso?.ref ?? null,
      cursoNombre: c.curso?.nombre ?? null,
      nombreDiploma: c.solicitud?.nombreAlumno ?? c.solicitud?.nombre ?? null,
      nombreMoodle: c.titular?.nombre ?? null,
      email: c.titular?.email ?? null,
      solicitadaEn: c.solicitud?.en ?? null,
    });
    await conEdicion([c]);
    await conLoDelCrm([c], req.user);
    await conProgramaCrm([c]);
    await conFirma([c]);
    logger.info({ userId: req.user.userId, matriculaId, bytes: png.length }, 'Certifex: firma del alumno subida');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

/**
 * GET /diplomas/firma/:matriculaId — la firma que se imprimiria (PNG transparente): la
 * subida a mano o la de la matricula de admision. 404 si no tiene.
 */
export async function verFirma(req, res, next) {
  try {
    const matriculaId = matriculaDe(req.params.matriculaId);
    const c = await solicitudParaFirma(req.user, matriculaId);
    const origen = (await origenesDeFirma([{ matriculaId, centro: c.centro, email: correoDe(c), edicion: (await model.edicionesDe([matriculaId])).get(matriculaId) }])).get(matriculaId);
    if (!origen) throw new AppError('Este alumno no tiene firma.', 404, 'NOT_FOUND');
    let png;
    try {
      png = await pngDe(origen);
    } catch (e) {
      logger.warn({ err: e.message, matriculaId, origen: origen.origen }, 'Certifex: la firma no se pudo leer');
      throw new AppError('La firma guardada no se puede leer: súbela de nuevo.', 422, 'FIRMA_ILEGIBLE');
    }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.send(png);
  } catch (err) { next(err); }
}

/**
 * Referencias de curso de lo que se crea desde el CRM: 900.000.000 + el id de la formación.
 * Es el rango que Certifex reserva a lo que no viene de Moodle (REF_CURSO_CRM): ni un
 * barrido del campus lo pisa ni se busca en Moodle al emitir.
 */
const REF_CURSO_CRM = 900_000_000;

/**
 * POST /diplomas/nuevo { centro, leadId, productoId, nombre?, dni } — «Nuevo diploma»: crea la
 * solicitud DESDE CERO, eligiendo al cliente y la formación (Diego, 19/10: «Academia IA está
 * sin Moodle, así que tiene que crear el diploma desde 0, seleccionando el cliente; igual para
 * los demás»). Queda en «Por decidir» y se aprueba y emite como las que llegan de Moodle.
 *
 * La formación se guarda como «revisada a mano» (productoId): el diploma sale con su temario
 * y sus horas del catálogo, sin buscar la venta.
 *
 * El DNI es obligatorio (20/10). Va a Certifex como en «Editar» (`/solicitudes/dni`), en cuanto
 * existe la matrícula. Si Certifex no lo acepta (otra ficha ya lo tiene, o no contesta), la
 * solicitud ya está creada y no se deshace: se devuelve igual, con `avisoDni` diciendo por qué,
 * y no se podrá emitir hasta ponerlo con «Sin DNI · Poner».
 */
export async function nuevo(req, res, next) {
  try {
    const d = parsear(nuevoDiplomaSchema, req.body);
    const cod = d.centro.toUpperCase();
    exigirCentro(await alcanceDe(req.user), cod, 'Campus no encontrado.');
    const { proyecto, motivo } = await proyectoDeCentro(cod);
    if (!proyecto) throw new AppError(motivo || 'Ese campus no tiene proyecto en el CRM.', 404, 'NOT_FOUND');
    const { rows: [lead] } = await query(
      'SELECT id, nombre, email FROM leads WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL',
      [d.leadId, proyecto.id],
    );
    if (!lead) throw new AppError('Ese cliente no es de este campus.', 404, 'NOT_FOUND');
    const email = String(lead.email ?? '').trim().toLowerCase();
    if (!email) throw new AppError('Ese cliente no tiene correo: añádelo en su ficha para poder enviarle el diploma.', 400, 'VALIDATION_ERROR');
    const { rows: [p] } = await query('SELECT id, nombre FROM products WHERE id = $1 AND project_id = $2', [d.productoId, proyecto.id]);
    if (!p) throw new AppError('Esa formación no es del catálogo de este campus.', 404, 'NOT_FOUND');
    const nombre = d.nombre ?? String(lead.nombre ?? '').trim();

    const r = await certifex('POST', '/matriculas', {
      centro: cod, nombre, email, curso: p.nombre, cursoRef: REF_CURSO_CRM + p.id, creadoPor: quien(req),
    });
    // Con el diploma ya emitido (lo era de antes) el DNI ya no cambia: no se toca.
    let dni = null;
    let avisoDni = null;
    if (!r.nexpediente) {
      try {
        const rd = await certifex('POST', '/solicitudes/dni', { matriculaId: r.matriculaId, dni: d.dni, editadoPor: quien(req) });
        dni = rd?.dni ?? d.dni;
      } catch (e) {
        logger.warn({ err: e.message, matriculaId: r.matriculaId }, 'Certifex: el DNI del nuevo diploma no se pudo guardar');
        avisoDni = `El diploma se ha creado, pero Certifex no ha guardado su DNI: ${String(e.message || 'no contesta').replace(/\.\s*$/, '')}. Ponlo con «Sin DNI · Poner»: sin él no se puede emitir.`;
      }
    }
    await model.guardarEdicion(r.matriculaId, { productoId: p.id }, quien(req), {
      centro: cod,
      cursoRef: r.cursoRef ?? REF_CURSO_CRM + p.id,
      cursoNombre: p.nombre,
      nombreDiploma: nombre,
      nombreMoodle: null,
      email,
      solicitadaEn: new Date().toISOString(),
    });
    logger.info({ userId: req.user.userId, centro: cod, matriculaId: r.matriculaId, productoId: p.id, yaExistia: !!r.yaExistia, conDni: !!dni }, 'Certifex: nuevo diploma desde el CRM');
    res.json({
      success: true,
      data: { matriculaId: r.matriculaId, yaExistia: !!r.yaExistia, vinculadaMoodle: !!r.vinculadaMoodle, centro: cod, curso: p.nombre, nombre, dni, avisoDni },
    });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── pasar a pendientes

/**
 * La fila de Certifex de una matrícula de ese campus, la haya pedido o no el alumno (null
 * si no está). `cursoRef`, si llega, solo acota la búsqueda.
 */
async function candidatoDe(matriculaId, centro, cursoRef) {
  const r = await recorrer('/candidatos', { estado: 'todas', centro, curso: cursoRef }, {
    filtro: (c) => c.matriculaId === matriculaId && String(c.centro).toUpperCase() === centro,
    completo: (hallados) => hallados.length >= 1,
  });
  return r.filas[0] ?? null;
}

/**
 * POST /diplomas/pedir { matriculaId, centro, cursoRef? } — «Pasar a pendientes». Diego,
 * 22/10/2026: «que se pueda pasar de sin emitir a pendientes». Hay alumnos con su
 * matrícula de Moodle (y su nota) que no salen en Pendientes porque Moodle no los da por
 * terminados o porque no han pedido el diploma: en Emisiones salen como «Sin emitir» o
 * «Propuesto», y en «Terminaron sin pedir» solo se veían. Esto pide el diploma desde el
 * CRM sobre ESA matrícula, como si lo pidiera el alumno: queda en «Por decidir» y desde
 * ahí se revisa, se aprueba y se emite como cualquier otra.
 *
 * Se hace con el «Nuevo diploma» de Certifex (`POST /matriculas`), mandándole el curso
 * con el nombre TAL CUAL está en Moodle: así Certifex engancha esa misma matrícula
 * (`matriculaDelMismoCurso`) en vez de crear una del CRM. El nombre, el correo, el DNI y
 * el curso salen de Certifex, nunca del panel. El nombre que se imprimirá es el de Moodle;
 * se revisa con «Editar» antes de aprobar.
 *
 * Si Certifex no devuelve esa matrícula (`vinculadaMoodle` y el mismo `matriculaId`), NO
 * se da por hecho: error claro, diciendo lo que ha hecho en su lugar. Si ya tenía diploma
 * o ya estaba pedida, se dice y no se pide otra vez.
 */
export async function pedir(req, res, next) {
  try {
    const d = parsear(pedirDiplomaSchema, req.body);
    const cod = d.centro.toUpperCase();
    exigirCentro(await alcanceDe(req.user), cod, `${NO_ENCONTRADA} (${d.matriculaId})`);
    const c = await candidatoDe(d.matriculaId, cod, d.cursoRef);
    if (!c) throw new AppError(`${NO_ENCONTRADA} (${d.matriculaId})`, 404, 'NOT_FOUND');
    if (c.nexpediente) {
      throw new AppError(`Ya tiene el diploma emitido (${c.nexpediente}): está en Emitidos.`, 409, 'YA_EMITIDO');
    }
    if (c.solicitud) {
      throw new AppError('Ya está pedido: búscalo en Pendientes (o en Rechazados, si se rechazó).', 409, 'YA_PEDIDO');
    }
    // Lo creado desde el CRM («Nuevo diploma») no es de Moodle: no hay matrícula que enganchar.
    if (Number(c.curso?.ref) >= REF_CURSO_CRM) {
      throw new AppError('Esta matrícula no viene de Moodle: se creó desde el CRM. Búscala en Pendientes.', 409, 'NO_ES_DE_MOODLE');
    }
    const email = String(c.titular?.email ?? '').trim().toLowerCase() || null;
    const dni = String(c.titular?.dni ?? '').trim() || null;
    if (!email && !dni) {
      throw new AppError('Este alumno no tiene correo ni DNI en Moodle: Certifex no puede encontrarlo para pedir su diploma.', 400, 'SIN_CORREO');
    }
    const curso = String(c.curso?.nombre ?? '').trim();
    if (!curso) throw new AppError('Certifex no da el nombre del curso de esta matrícula: no se puede pedir el diploma.', 502, 'CERTIFEX_SIN_CURSO');
    const nombre = normalizarNombreDiploma(c.titular?.nombre ?? '');
    if (!nombre) {
      throw new AppError(
        `El nombre que tiene en Moodle («${String(c.titular?.nombre ?? '').trim() || 'vacío'}») no vale para un diploma: hace falta nombre y apellidos, solo con letras. Corrígelo en Moodle y vuelve a intentarlo.`,
        400, 'NOMBRE_NO_VALIDO',
      );
    }

    const r = await certifex('POST', '/matriculas', {
      centro: cod, nombre, email, ...(dni ? { dni } : {}), curso, creadoPor: quien(req),
    });
    const misma = Number(r?.matriculaId) === d.matriculaId;
    if (!r?.vinculadaMoodle || !misma) {
      logger.error({
        userId: req.user.userId, centro: cod, matriculaId: d.matriculaId,
        devuelta: r?.matriculaId ?? null, vinculadaMoodle: !!r?.vinculadaMoodle, nexpediente: r?.nexpediente ?? null,
      }, 'Certifex: «Pasar a pendientes» no enganchó la matrícula de Moodle');
      const queHizo = !r?.matriculaId
        ? 'Certifex no ha dicho qué matrícula ha usado.'
        : r.nexpediente
          ? `Ha encontrado otra matrícula de ese alumno en el mismo curso (nº ${r.matriculaId}) que ya tiene el diploma ${r.nexpediente}.`
          : r.vinculadaMoodle
            ? `Ha usado otra matrícula de Moodle de ese alumno en el mismo curso (nº ${r.matriculaId}): revisa en Pendientes cuál es la buena antes de aprobar.`
            : `Ha creado una solicitud aparte (nº ${r.matriculaId}), sin lo de Moodle, que saldrá en Pendientes: no la apruebes y pide a administración que la rechace.`;
      throw new AppError(`Certifex no ha enganchado esta matrícula de Moodle, así que no se ha pasado a Pendientes. ${queHizo}`, 502, 'CERTIFEX_NO_ENGANCHA');
    }
    if (r.nexpediente) {
      throw new AppError(`Ya tiene el diploma emitido (${r.nexpediente}): está en Emitidos.`, 409, 'YA_EMITIDO');
    }
    logger.info({ userId: req.user.userId, centro: cod, matriculaId: d.matriculaId, yaPedido: !!r.yaExistia }, 'Certifex: pasado a Pendientes desde el CRM');
    res.json({
      success: true,
      data: { matriculaId: d.matriculaId, centro: cod, curso, nombre, yaPedido: !!r.yaExistia },
    });
  } catch (err) { next(err); }
}

/** Las formaciones del catalogo del campus, para elegir a mano la vendida. */
export async function formaciones(req, res, next) {
  try {
    const { centro } = parsear(formacionesSchema, req.query);
    exigirCentro(await alcanceDe(req.user), centro, 'Campus no encontrado.');
    res.json({ success: true, data: await formacionesDeCentro(centro.toUpperCase()) });
  } catch (err) { next(err); }
}

/**
 * POST /diplomas/formaciones/sincronizar { centro, productoId } — los módulos de esa
 * formación, leídos de la página del curso y guardados en el catálogo (12/10, Diego:
 * «sincronizar a un producto»). Solo una formación del proyecto de ese campus. Devuelve la
 * formación como la da `formaciones`, para que el panel la cargue y se pueda editar.
 */
export async function sincronizarFormacion(req, res, next) {
  try {
    const { centro, productoId } = parsear(sincronizarTemarioSchema, req.body);
    const cod = centro.toUpperCase();
    exigirCentro(await alcanceDe(req.user), cod, 'Campus no encontrado.');
    const { proyecto, motivo } = await proyectoDeCentro(cod);
    if (!proyecto) throw new AppError(motivo || 'Ese campus no tiene proyecto en el CRM.', 404, 'NOT_FOUND');
    const { rows: [p] } = await query('SELECT id FROM products WHERE id = $1 AND project_id = $2', [productoId, proyecto.id]);
    if (!p) throw new AppError('Esa formación no es del catálogo de este campus.', 404, 'NOT_FOUND');
    const r = await sincronizarTemario(productoId);
    const { formaciones: lista } = await formacionesDeCentro(cod);
    res.json({ success: true, data: { formacion: lista.find((f) => f.id === productoId) ?? null, modulos: r.modulos.length, fuente: r.fuente, motivo: r.motivo } });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── diplomas emitidos

/**
 * ¿Lo emitio este CRM? Certifex apunta quien emitio como «persona (CRM X)» cuando viene
 * del CRM. Lo emitido fuera (desde el panel de Certifex, o los antiguos de 2023 y 2024)
 * no esta «pendiente de aviso»: nadie del CRM lo aprobo ni tiene que mandarlo.
 */
export const emitidoPorElCrm = (d) => /\(CRM\b[^)]*\)\s*$/i.test(String(d?.emitidaPor ?? ''));

const AVISO = {
  pendiente: (d) => !d.aviso && emitidoPorElCrm(d),
  fuera: (d) => !d.aviso && !emitidoPorElCrm(d),
  enviado: (d) => d.aviso?.resultado === 'enviado',
  no_salio: (d) => !!d.aviso && d.aviso.resultado !== 'enviado',
};

/**
 * Antes de esto el CRM no emitia (la integracion es de finales de septiembre de 2026):
 * un diploma anterior no puede ser «del CRM», y en cuanto el listado (lo mas reciente
 * primero) pasa de aqui ya no hace falta seguir contando.
 */
const INICIO_CRM = '2026-09-01T00:00:00.000Z';

/** «Por enviar al alumno»: lo mismo que el filtro «Pendiente de aviso» de Emitidos. */
async function contarPorEnviar(ambito) {
  const r = await recorrer('/diplomas', { estado: 'vigentes', centro: ambito.centro }, {
    filtro: (d) => AVISO.pendiente(d) && (!ambito.centros || ambito.centros.has(String(d.centro).toUpperCase())),
    fecha: (d) => d.emitidoEn,
    antiguo: (d) => !!d.emitidoEn && d.emitidoEn < INICIO_CRM,
  });
  return r.filas.length;
}

/** Los diplomas emitidos: vigentes (pestaña Enviados) o revocados, con su aviso. */
export async function diplomas(req, res, next) {
  try {
    const f = parsear(listarDiplomasSchema, req.query);
    const ambito = acotar(await alcanceDe(req.user), f.centro);
    if (ambito.vacio) return res.json({ success: true, data: paginaVacia(f) });
    const filtros = [];
    if (f.curso !== undefined) filtros.push((d) => Number(d.cursoRef) === f.curso);
    if (f.aviso) filtros.push(AVISO[f.aviso]);
    const data = await listado('/diplomas', {
      estado: f.estado ?? 'vigentes', centro: ambito.centro, q: f.q,
    }, f, { fecha: (d) => d?.emitidoEn, extra: ambos(filtros.length ? (d) => filtros.every((fn) => fn(d)) : null, deMisCentros(ambito)) });
    for (const d of data.filas) d.emitidoEnCrm = emitidoPorElCrm(d);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Revocar con motivo. La verificacion publica pasa a decir «revocado». No avisa a nadie. */
export async function revocar(req, res, next) {
  try {
    const d = parsear(revocarSchema, req.body);
    await exigirExpedientes(await alcanceDe(req.user), [d.nexpediente]);
    const data = await certifex('POST', '/revocar', { nexpediente: d.nexpediente, motivo: d.motivo, revocadaPor: quien(req) });
    logger.info({ userId: req.user.userId, nexpediente: d.nexpediente }, 'Certifex: diploma revocado');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Corregir el nombre (o la titulacion): mismo numero y mismo QR, queda quien y por que. */
export async function corregir(req, res, next) {
  try {
    const d = parsear(corregirSchema, req.body);
    await exigirExpedientes(await alcanceDe(req.user), [d.nexpediente]);
    const data = await certifex('POST', '/corregir', {
      nexpediente: d.nexpediente, campo: d.campo, valor: d.valor, motivo: d.motivo, corregidoPor: quien(req),
    });
    logger.info({ userId: req.user.userId, nexpediente: d.nexpediente, campo: d.campo }, 'Certifex: diploma corregido');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── terminaron sin pedir

/**
 * «Terminaron sin pedir»: Moodle da la formacion por terminada, pero el alumno aun no ha
 * pedido su diploma (ni lo tiene). Aqui no se aprueba ni se emite nada, porque lo que se
 * imprime sale de la solicitud. En cuanto la hace el alumno —o alguien del CRM con
 * «Pasar a pendientes» (`pedir`, 22/10/2026)—, sale de esta lista y pasa a Pendientes. Cada fila trae lo que el CRM sabe de ese correo (`crm`)
 * y, si llego, el aviso de Certifex (`aviso`: cuando lo dio Moodle por terminado y
 * cuando llego al CRM).
 */
export async function terminados(req, res, next) {
  try {
    const f = parsear(listarTerminadosSchema, req.query);
    const ambito = acotar(await alcanceDe(req.user), f.centro);
    if (ambito.vacio) return res.json({ success: true, data: paginaVacia(f) });
    const data = await listado('/candidatos', {
      terminados: '1', estado: 'todas', centro: ambito.centro, curso: f.curso, q: f.q,
    }, f, { fecha: null, extra: deMisCentros(ambito) });
    await conLoDelCrm(data.filas, req.user);
    for (const c of data.filas) c.aviso = null;
    try {
      const m = await model.completadosDe(data.filas.map((c) => c.matriculaId));
      for (const c of data.filas) c.aviso = m.get(c.matriculaId) ?? null;
    } catch (e) {
      // La lista sale igual: no saber cuando llego el aviso no bloquea nada.
      logger.warn({ err: e.message }, 'Certifex: no se pudo leer el aviso de terminado');
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
