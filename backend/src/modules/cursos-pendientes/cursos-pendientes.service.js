import { getClient, query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { campusDeLaPersona, veTodoElCrm } from '../../shared/utils/ambito.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import * as model from './cursos-pendientes.model.js';
import { notificar } from './cursos-pendientes.correos.js';

/**
 * Cursos pendientes (#336): las reglas.
 *
 * Una formación por crear es UN registro dentro de su campus, con tutora, fecha
 * comprometida y estado; las alumnas en espera cuelgan de él.
 *
 * ESTADOS: pendiente_asignar → asignado → en_desarrollo → publicado → cerrado, y
 * cancelado. «Retrasado» no es un estado: es una marca que sale sola.
 *
 *   · asignar tutora (solo admin) pasa de pendiente_asignar a asignado;
 *   · «en desarrollo» exige fecha comprometida (también lo defiende la base);
 *   · mover la fecha ya puesta exige un MOTIVO, y a la segunda avisa al admin;
 *   · cancelar exige motivo (solo admin);
 *   · «publicado» solo por `publicar`, que pide la URL definitiva, comprueba que es
 *     del dominio del campus y que responde;
 *   · cuando todas las alumnas dejan de estar «en espera» y el curso está
 *     publicado, pasa solo a «cerrado».
 *
 * QUIÉN PUEDE QUÉ
 *   · tutora: los que tiene asignados. Estado, avance, fecha (con motivo), notas
 *     y marcar a cada alumna. No asigna ni cancela.
 *   · gestora / comercial: los de sus campus. Crear uno al vender algo que no
 *     existe y sumar alumnas.
 *   · admin: sus campus, todo. Super admin y soporte: todos.
 */

export const ABIERTOS = ['pendiente_asignar', 'asignado', 'en_desarrollo', 'publicado'];
const TIPOS = ['curso', 'diplomado', 'master'];

const esJefe = (user) => ['admin', 'superadmin'].includes(user?.role);
const esTutora = (user) => user?.role === 'tutor';
const puedeCrear = (user) => ['admin', 'superadmin', 'soporte', 'gestor'].includes(user?.role);

/** Los campus que la persona puede ver; null = todos. */
async function campusPermitidos(user) {
  if (veTodoElCrm(user)) return null;
  return campusDeLaPersona(user.userId);
}

/** ¿Puede esta persona ver ese pendiente? Una tutora, solo los suyos. */
async function puedeVer(user, curso) {
  if (esTutora(user)) return curso.tutor_id === user.userId;
  const campus = await campusPermitidos(user);
  return campus === null || campus.includes(Number(curso.project_id));
}

async function cargarVisible(user, id) {
  const curso = await model.porId(Number(id));
  // Un 404 y no un 403: no se confirma que exista a quien no puede verlo.
  if (!curso || !(await puedeVer(user, curso))) throw new AppError('Curso pendiente no encontrado', 404, 'NOT_FOUND');
  return curso;
}

// ── Lectura ───────────────────────────────────────────────────────────────

/** `projectIds`: lo que pide la pantalla, ya recortado a sus campus por el controlador. */
export async function listar(user, { projectIds = null, estado = null, abiertos = null, soloRetrasados = false, tipo = null, tutorId = null }) {
  return model.listar({
    projectIds,
    // Una tutora no puede pedir los de otra: manda la sesión.
    tutorId: esTutora(user) ? user.userId : tutorId,
    estado, abiertos, soloRetrasados, tipo,
  });
}

export async function resumen(user, { projectIds = null }) {
  const tutorId = esTutora(user) ? user.userId : null;
  const campus = await model.resumenPorCampus({ projectIds, tutorId });
  const supervision = esJefe(user) || user.role === 'soporte';
  return {
    campus,
    total: campus.reduce((t, c) => ({
      abiertos: t.abiertos + c.abiertos, retrasados: t.retrasados + c.retrasados,
      sin_tutora: t.sin_tutora + c.sin_tutora, alumnas_esperando: t.alumnas_esperando + c.alumnas_esperando,
    }), { abiertos: 0, retrasados: 0, sin_tutora: 0, alumnas_esperando: 0 }),
    // La carga y los tiempos son de supervisión.
    carga_por_tutora: supervision ? await model.cargaPorTutora({ projectIds }) : null,
    indicadores: supervision ? await model.indicadores({ projectIds }) : null,
  };
}

export async function detalle(user, id) {
  const curso = await cargarVisible(user, id);
  const [alumnas, historial] = await Promise.all([model.alumnasDe(curso.id), model.historialDe(curso.id)]);
  return { ...curso, alumnas, historial };
}

// ── Crear / sumar alumnas ─────────────────────────────────────────────────

async function comprobarAlumna(client, { projectId, leadId, conversionId }) {
  const { rows: [lead] } = await client.query(`SELECT id, project_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
  if (!lead || Number(lead.project_id) !== Number(projectId)) {
    throw new AppError('Esa persona no es de este campus', 400, 'VALIDATION_ERROR');
  }
  if (conversionId) {
    const { rows: [v] } = await client.query(`SELECT id FROM conversions WHERE id = $1 AND lead_id = $2`, [conversionId, leadId]);
    if (!v) throw new AppError('Esa venta no es de esa persona', 400, 'VALIDATION_ERROR');
  }
}

async function sumarAlumnaTx(client, user, curso, { leadId, conversionId = null }) {
  await comprobarAlumna(client, { projectId: curso.project_id, leadId, conversionId });
  const { rows } = await client.query(
    `INSERT INTO cursos_pendientes_alumnas (curso_id, lead_id, conversion_id) VALUES ($1, $2, $3)
     ON CONFLICT (curso_id, lead_id) DO NOTHING RETURNING id`,
    [curso.id, leadId, conversionId]
  );
  if (!rows.length) return { id: null, repetida: true };
  await model.apuntar(curso.id, user.userId, 'alumna_sumada', { lead_id: leadId, conversion_id: conversionId }, null, client);
  return { id: rows[0].id, repetida: false };
}

/**
 * Un pendiente nuevo en un campus, o —si ya hay uno abierto de esa formación en ese
 * campus— se suma la alumna a ese. Una formación, un pendiente abierto por campus.
 */
export async function crear(user, { project_id, nombre, tipo = 'curso', product_id = null, url_prevista = null, lead_id = null, conversion_id = null }) {
  if (!puedeCrear(user)) throw new AppError('No puedes crear cursos pendientes', 403, 'FORBIDDEN');
  const campus = await campusPermitidos(user);
  if (campus !== null && !campus.includes(Number(project_id))) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
  if (!TIPOS.includes(tipo)) throw new AppError('Tipo no válido', 400, 'VALIDATION_ERROR');
  const limpio = String(nombre || '').trim();
  if (!limpio) throw new AppError('Falta el nombre de la formación', 400, 'VALIDATION_ERROR');

  if (product_id) {
    const { rows: [p] } = await query(`SELECT id FROM products WHERE id = $1 AND project_id = $2`, [product_id, project_id]);
    if (!p) throw new AppError('Esa formación no es de este campus', 400, 'VALIDATION_ERROR');
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    let cursoId = await model.abiertoDe({ projectId: project_id, productId: product_id, nombre: limpio });
    const nuevo = !cursoId;
    if (nuevo) {
      const { rows: [c] } = await client.query(
        `INSERT INTO cursos_pendientes (project_id, product_id, nombre, url_prevista, tipo, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [project_id, product_id, limpio, url_prevista, tipo, user.userId]
      );
      cursoId = c.id;
      await model.apuntar(cursoId, user.userId, 'creado', { nombre: limpio, tipo }, null, client);
    }
    let alumna = null;
    if (lead_id) alumna = await sumarAlumnaTx(client, user, { id: cursoId, project_id }, { leadId: lead_id, conversionId: conversion_id });
    await client.query('COMMIT');

    const curso = await model.porId(cursoId);
    if (!nuevo && alumna && !alumna.repetida && curso.tutor_id) await avisarAlumnaNueva(curso, user);
    return { curso, nuevo, alumna_sumada: !!alumna && !alumna.repetida };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

export async function sumarAlumna(user, id, { lead_id, conversion_id = null }) {
  if (!puedeCrear(user) && !esTutora(user)) throw new AppError('No puedes sumar alumnas', 403, 'FORBIDDEN');
  const curso = await cargarVisible(user, id);
  if (!ABIERTOS.includes(curso.estado)) throw new AppError('Ese curso pendiente ya está cerrado o cancelado', 409, 'CONFLICT');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const r = await sumarAlumnaTx(client, user, curso, { leadId: lead_id, conversionId: conversion_id });
    await client.query('COMMIT');
    if (!r.repetida && curso.tutor_id) await avisarAlumnaNueva(curso, user);
    return { ...r, curso: await model.porId(curso.id) };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

// ── Cambios ───────────────────────────────────────────────────────────────

const fechaOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));
const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid' });

/**
 * Cambia un pendiente. `cambios` admite: tutor_id (solo admin), fecha_comprometida,
 * motivo, estado ('en_desarrollo' | 'cancelado' | 'cerrado'), tipo, avance_foto,
 * avance_video, avance_modulos, notas.
 */
export async function modificar(user, id, cambios) {
  const curso = await cargarVisible(user, id);
  const jefe = esJefe(user) || user.role === 'soporte';
  if (!jefe && !esTutora(user)) throw new AppError('No puedes modificar cursos pendientes', 403, 'FORBIDDEN');
  if (!ABIERTOS.includes(curso.estado)) throw new AppError('Ese curso pendiente ya está cerrado o cancelado', 409, 'CONFLICT');

  const set = {};
  const apuntes = [];
  const avisos = [];
  const motivo = cambios.motivo ? String(cambios.motivo).trim() : null;

  // Tutora: solo admin. Pasa de pendiente_asignar a asignado y avisa a la tutora.
  if ('tutor_id' in cambios && cambios.tutor_id !== curso.tutor_id) {
    if (!jefe) throw new AppError('Solo un administrador asigna la tutora', 403, 'FORBIDDEN');
    if (cambios.tutor_id) {
      const { rows: [t] } = await query(`SELECT id FROM users WHERE id = $1 AND role = 'tutor' AND active`, [cambios.tutor_id]);
      if (!t) throw new AppError('Esa persona no es una tutora activa', 400, 'VALIDATION_ERROR');
    }
    set.tutor_id = cambios.tutor_id || null;
    if (!cambios.tutor_id && curso.estado === 'asignado') set.estado = 'pendiente_asignar';
    else if (cambios.tutor_id && curso.estado === 'pendiente_asignar') set.estado = 'asignado';
    apuntes.push(['tutora_cambiada', { de: curso.tutor_id, a: cambios.tutor_id || null }, motivo]);
    if (cambios.tutor_id) avisos.push(['asignado', cambios.tutor_id]);
  }

  // Fecha comprometida: la primera sin motivo; moverla, con motivo.
  let fechaMovida = false;
  if ('fecha_comprometida' in cambios && String(cambios.fecha_comprometida || '') !== String(curso.fecha_comprometida || '').slice(0, 10)) {
    const f = cambios.fecha_comprometida;
    if (!fechaOk(f)) throw new AppError('La fecha tiene que ser AAAA-MM-DD', 400, 'VALIDATION_ERROR');
    if (!jefe && f < hoyISO()) throw new AppError('La fecha comprometida no puede estar en el pasado', 400, 'VALIDATION_ERROR');
    if (curso.fecha_comprometida && !motivo) throw new AppError('Mover la fecha exige un motivo', 400, 'MOTIVO_REQUERIDO');
    set.fecha_comprometida = f;
    if (curso.fecha_comprometida) { fechaMovida = true; set.veces_movida_fecha = curso.veces_movida_fecha + 1; }
    apuntes.push(['fecha_movida', { de: curso.fecha_comprometida, a: f }, motivo]);
  }

  // Estado
  if ('estado' in cambios && cambios.estado !== curso.estado) {
    const e = cambios.estado;
    if (e === 'publicado') throw new AppError('Para publicar usa «Marcar publicado», que pide la URL', 400, 'VALIDATION_ERROR');
    if (e === 'en_desarrollo') {
      if (curso.estado !== 'asignado' && curso.estado !== 'en_desarrollo') throw new AppError('Primero hay que asignarle una tutora', 409, 'CONFLICT');
      if (!(set.fecha_comprometida || curso.fecha_comprometida)) throw new AppError('Para pasar a «en desarrollo» hace falta la fecha comprometida', 400, 'FECHA_REQUERIDA');
      set.estado = 'en_desarrollo';
    } else if (e === 'cancelado') {
      if (!jefe) throw new AppError('Solo un administrador cancela', 403, 'FORBIDDEN');
      if (!motivo) throw new AppError('Cancelar exige un motivo', 400, 'MOTIVO_REQUERIDO');
      set.estado = 'cancelado';
    } else if (e === 'cerrado') {
      if (!jefe) throw new AppError('Solo un administrador cierra a mano', 403, 'FORBIDDEN');
      if (curso.estado !== 'publicado') throw new AppError('Solo se cierra un curso ya publicado', 409, 'CONFLICT');
      set.estado = 'cerrado';
    } else {
      throw new AppError('Estado no válido para este cambio', 400, 'VALIDATION_ERROR');
    }
    apuntes.push(['estado_cambiado', { de: curso.estado, a: set.estado }, motivo]);
  }

  if ('tipo' in cambios && cambios.tipo !== curso.tipo) {
    if (!jefe) throw new AppError('Solo un administrador cambia el tipo', 403, 'FORBIDDEN');
    if (!TIPOS.includes(cambios.tipo)) throw new AppError('Tipo no válido', 400, 'VALIDATION_ERROR');
    set.tipo = cambios.tipo;
  }
  for (const k of ['avance_foto', 'avance_video']) {
    if (k in cambios && Boolean(cambios[k]) !== curso[k]) { set[k] = Boolean(cambios[k]); apuntes.push(['avance', { [k]: set[k] }, null]); }
  }
  if ('avance_modulos' in cambios && Number(cambios.avance_modulos) !== curso.avance_modulos) {
    if (![0, 25, 50, 75, 100].includes(Number(cambios.avance_modulos))) throw new AppError('Los módulos van al 0, 25, 50, 75 o 100 %', 400, 'VALIDATION_ERROR');
    set.avance_modulos = Number(cambios.avance_modulos);
    apuntes.push(['avance', { avance_modulos: set.avance_modulos }, null]);
  }
  if ('notas' in cambios && (cambios.notas || null) !== (curso.notas || null)) set.notas = cambios.notas || null;

  const columnas = Object.keys(set);
  if (!columnas.length) return model.porId(curso.id);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    const sets = columnas.map((c, i) => `${c} = $${i + 2}`).join(', ');
    await client.query(`UPDATE cursos_pendientes SET ${sets}, updated_at = NOW() WHERE id = $1`, [curso.id, ...columnas.map((c) => set[c])]);
    for (const [accion, detalle, m] of apuntes) await model.apuntar(curso.id, user.userId, accion, detalle, m, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }

  const nuevo = await model.porId(curso.id);
  for (const [tipo, quien] of avisos) await avisarTutora(tipo, nuevo, quien, user);
  if (fechaMovida && nuevo.veces_movida_fecha >= 2) await avisarFechaMovida(nuevo, user, motivo);
  return nuevo;
}

// ── Publicar ──────────────────────────────────────────────────────────────

const hostDe = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

/**
 * ¿La URL es del dominio del campus y responde? Solo se pide a un host que ya es
 * un dominio conocido del campus (los de los enlaces de sus formaciones): nunca a
 * una dirección que haya escrito la persona. Sin seguir redirecciones.
 */
export async function comprobarUrl(projectId, url) {
  let u;
  try { u = new URL(url); } catch { throw new AppError('La URL no es válida', 400, 'URL_INVALIDA'); }
  if (u.protocol !== 'https:') throw new AppError('La URL tiene que empezar por https://', 400, 'URL_INVALIDA');
  const dominios = await model.dominiosDelCampus(projectId);
  if (!dominios.length) {
    throw new AppError('No conozco el dominio de este campus (ninguna formación suya tiene enlace). Pídele a un administrador que lo publique sin comprobar.', 409, 'DOMINIO_DESCONOCIDO');
  }
  const host = hostDe(url);
  if (!dominios.some((d) => host === d || host.endsWith(`.${d}`))) {
    throw new AppError(`La URL no es de este campus (${dominios.join(', ')})`, 400, 'URL_OTRO_DOMINIO');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'CRM-comprobador/1.0' } });
    if (r.status >= 400) throw new AppError(`La URL contesta ${r.status}: todavía no está publicada`, 409, 'URL_NO_RESPONDE');
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('La URL no responde', 409, 'URL_NO_RESPONDE');
  } finally { clearTimeout(t); }
}

/**
 * «Marcar publicado»: pide la URL definitiva y comprueba que es del campus y que
 * responde. Enlaza la ficha de Productos si la URL es la de una formación del campus.
 * `sinComprobar` (solo admin): para un campus sin dominio conocido.
 */
export async function publicar(user, id, { url, sinComprobar = false }) {
  const curso = await cargarVisible(user, id);
  const jefe = esJefe(user) || user.role === 'soporte';
  if (!jefe && !esTutora(user)) throw new AppError('No puedes publicar', 403, 'FORBIDDEN');
  if (curso.estado !== 'en_desarrollo') throw new AppError('Solo se publica un curso que está «en desarrollo»', 409, 'CONFLICT');
  if (sinComprobar) {
    if (!jefe) throw new AppError('Solo un administrador publica sin comprobar', 403, 'FORBIDDEN');
    if (!/^https:\/\//.test(String(url || ''))) throw new AppError('La URL tiene que empezar por https://', 400, 'URL_INVALIDA');
  } else {
    await comprobarUrl(curso.project_id, url);
  }

  // Enlaza la ficha del catálogo si la URL es la de una formación del campus Y esa
  // formación no tiene ya OTRO pendiente abierto (la base solo admite uno por
  // formación y campus): en ese caso se publica igual, sin enlazar.
  const { rows: [producto] } = await query(
    `SELECT p.id FROM products p
      WHERE p.project_id = $1 AND p.url_info = $2
        AND NOT EXISTS (SELECT 1 FROM cursos_pendientes x
                         WHERE x.project_id = p.project_id AND x.product_id = p.id
                           AND x.estado NOT IN ('cerrado', 'cancelado') AND x.id <> $3)
      LIMIT 1`, [curso.project_id, url, curso.id]);

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE cursos_pendientes SET estado = 'publicado', url_publicada = $2, fecha_publicacion = (now() AT TIME ZONE $3::text)::date,
              product_id = COALESCE($4::int, product_id), updated_at = NOW() WHERE id = $1`,
      [curso.id, url, process.env.APP_TIMEZONE || 'Europe/Madrid', producto?.id || null]
    );
    await model.apuntar(curso.id, user.userId, 'publicado', { url, comprobada: !sinComprobar, product_id: producto?.id || null }, null, client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
  await cerrarSiToca(curso.id, user.userId);
  return model.porId(curso.id);
}

// ── Alumnas ───────────────────────────────────────────────────────────────

/** Cuando todas las alumnas dejan de estar «en espera» y el curso está publicado, pasa solo a «cerrado». */
export async function cerrarSiToca(cursoId, userId = null) {
  const { rows: [c] } = await query(
    `SELECT c.id, c.estado,
            (SELECT count(*) FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id) AS total,
            (SELECT count(*) FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id AND a.estado = 'en_espera') AS esperando
       FROM cursos_pendientes c WHERE c.id = $1`, [cursoId]);
  // Sin alumnas no hay nada que cerrar solo: «todas habilitadas» no puede ser cierto por vacío.
  if (!c || c.estado !== 'publicado' || Number(c.total) === 0 || Number(c.esperando) > 0) return false;
  await query(`UPDATE cursos_pendientes SET estado = 'cerrado', updated_at = NOW() WHERE id = $1 AND estado = 'publicado'`, [cursoId]);
  await model.apuntar(cursoId, userId, 'cerrado_solo', { motivo: 'todas las alumnas habilitadas' });
  return true;
}

/**
 * Marca a una alumna: `estado` ('habilitada' | 'cancelada' | 'en_espera') y/o
 * `avisada`. Habilitar solo tiene sentido con el curso publicado.
 */
export async function marcarAlumna(user, cursoId, alumnaId, { estado, avisada }) {
  const curso = await cargarVisible(user, cursoId);
  if (!esJefe(user) && !esTutora(user) && user.role !== 'soporte') throw new AppError('No puedes marcar alumnas', 403, 'FORBIDDEN');
  const { rows: [a] } = await query(`SELECT * FROM cursos_pendientes_alumnas WHERE id = $1 AND curso_id = $2`, [alumnaId, curso.id]);
  if (!a) throw new AppError('Alumna no encontrada', 404, 'NOT_FOUND');
  if (estado === 'habilitada' && !['publicado', 'cerrado'].includes(curso.estado)) {
    throw new AppError('Solo se habilita a una alumna cuando el curso está publicado', 409, 'CONFLICT');
  }
  const sets = []; const params = [alumnaId];
  if (estado && estado !== a.estado) {
    if (!['en_espera', 'habilitada', 'cancelada'].includes(estado)) throw new AppError('Estado no válido', 400, 'VALIDATION_ERROR');
    params.push(estado); sets.push(`estado = $${params.length}`);
    if (estado === 'habilitada') { params.push(user.userId); sets.push(`habilitada_at = NOW()`, `habilitada_por = $${params.length}`); }
    else sets.push('habilitada_at = NULL', 'habilitada_por = NULL');
  }
  if (typeof avisada === 'boolean' && avisada !== a.avisada) {
    params.push(avisada); sets.push(`avisada = $${params.length}`, avisada ? 'avisada_at = NOW()' : 'avisada_at = NULL');
  }
  if (!sets.length) return { alumna: a, curso: await model.porId(curso.id) };
  await query(`UPDATE cursos_pendientes_alumnas SET ${sets.join(', ')} WHERE id = $1`, params);
  await model.apuntar(curso.id, user.userId, 'alumna_marcada', { alumna_id: alumnaId, estado: estado || undefined, avisada }, null);
  const cerrado = await cerrarSiToca(curso.id, user.userId);
  return { alumnas: await model.alumnasDe(curso.id), curso: await model.porId(curso.id), cerrado };
}

// ── Avisos ────────────────────────────────────────────────────────────────

const enlace = (id) => `/productos/pendientes?curso=${id}`;

async function avisarTutora(tipo, curso, tutorId, user) {
  if (tipo !== 'asignado') return;
  await notificar({
    clave: `cp-asignado-${curso.id}-${tutorId}`, project_id: curso.project_id,
    targetUserIds: [tutorId], type: 'curso_pendiente_asignado',
    title: `Te han asignado un curso: ${curso.nombre}`,
    message: `${curso.campus}${curso.alumnas_esperando ? ` · ${curso.alumnas_esperando} alumna${curso.alumnas_esperando === 1 ? '' : 's'} esperando` : ''}. Pon la fecha comprometida.`,
    link_path: enlace(curso.id), triggered_by_user_id: user?.userId || null,
  }).catch(() => {});
}

async function avisarAlumnaNueva(curso, user) {
  await notifyUsers({
    targetUserIds: [curso.tutor_id], type: 'curso_pendiente_alumna',
    title: `Una alumna más espera: ${curso.nombre}`,
    message: `${curso.campus} · ya son ${curso.alumnas_esperando}.`,
    link_path: enlace(curso.id), triggered_by_user_id: user?.userId || null,
  }).catch(() => {});
}

async function avisarFechaMovida(curso, user, motivo) {
  const admins = await model.adminsDelCampus(curso.project_id);
  if (!admins.length) return;
  await notifyUsers({
    targetUserIds: admins, type: 'curso_pendiente_fecha_movida',
    title: `Fecha movida por segunda vez: ${curso.nombre}`,
    message: `${curso.campus}. Nueva fecha: ${String(curso.fecha_comprometida).slice(0, 10)}. Motivo: ${motivo}`,
    link_path: enlace(curso.id), triggered_by_user_id: user?.userId || null,
  }).catch(() => {});
}

/**
 * Los avisos por fecha (lo ejecuta el job una vez al día; cada uno, una sola vez
 * por curso y fecha):
 *   · a 3 días de la fecha comprometida → la tutora;
 *   · la fecha ha pasado y no está publicado → la tutora y el admin del campus;
 *   · más de 48 h sin tutora → el admin del campus;
 *   · publicado con alumnas sin habilitar más de 48 h → la tutora y el admin.
 */
export async function avisarVencimientos() {
  const zona = process.env.APP_TIMEZONE || 'Europe/Madrid';
  const { rows } = await query(
    `SELECT c.id, c.nombre, c.project_id, p.nombre AS campus, c.tutor_id, c.estado, c.fecha_comprometida::text AS fecha,
            c.fecha_solicitud::text AS solicitada, c.fecha_publicacion::text AS publicada,
            (c.created_at < now() - interval '48 hours') AS lleva_48h,
            (c.fecha_comprometida - (now() AT TIME ZONE $1::text)::date) AS dias,
            (SELECT count(*)::int FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id AND a.estado = 'en_espera') AS esperando
       FROM cursos_pendientes c JOIN projects p ON p.id = c.project_id
      WHERE c.estado IN ('pendiente_asignar', 'asignado', 'en_desarrollo', 'publicado')`,
    [zona]
  );
  let enviados = 0;
  const unaVez = async (cursoId, tipo, dia) => {
    const { rowCount } = await query(
      `INSERT INTO cursos_pendientes_avisos (curso_id, tipo, dia) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [cursoId, tipo, dia]);
    return rowCount > 0;
  };
  for (const c of rows) {
    const admins = async () => model.adminsDelCampus(c.project_id);
    const dest = async () => [...new Set([...(c.tutor_id ? [c.tutor_id] : []), ...(await admins())])];
    if (['asignado', 'en_desarrollo'].includes(c.estado) && c.fecha && c.dias === 3 && c.tutor_id && await unaVez(c.id, 'vence_3d', c.fecha)) {
      await notificar({ clave: `cp-vence_3d-${c.id}-${c.fecha}`, project_id: c.project_id, targetUserIds: [c.tutor_id], type: 'curso_pendiente_vence', title: `Faltan 3 días: ${c.nombre}`,
        message: `${c.campus}. Fecha comprometida: ${c.fecha}.`, link_path: enlace(c.id) }).catch(() => {});
      enviados += 1;
    }
    if (['pendiente_asignar', 'asignado', 'en_desarrollo'].includes(c.estado) && c.fecha && c.dias < 0 && await unaVez(c.id, 'retrasado', c.fecha)) {
      await notificar({ clave: `cp-retrasado-${c.id}-${c.fecha}`, project_id: c.project_id, targetUserIds: await dest(), type: 'curso_pendiente_retrasado', title: `Retrasado: ${c.nombre}`,
        message: `${c.campus}. Tenía que estar el ${c.fecha}${c.esperando ? ` y hay ${c.esperando} alumna${c.esperando === 1 ? '' : 's'} esperando` : ''}.`,
        link_path: enlace(c.id) }).catch(() => {});
      enviados += 1;
    }
    if (c.estado === 'pendiente_asignar' && c.lleva_48h && await unaVez(c.id, 'sin_tutora', c.solicitada)) {
      const a = await admins();
      if (a.length) {
        await notificar({ clave: `cp-sin_tutora-${c.id}-${c.solicitada}`, project_id: c.project_id, targetUserIds: a, type: 'curso_pendiente_sin_tutora', title: `Más de 48 h sin tutora: ${c.nombre}`,
          message: `${c.campus}${c.esperando ? ` · ${c.esperando} alumna${c.esperando === 1 ? '' : 's'} esperando` : ''}.`, link_path: enlace(c.id) }).catch(() => {});
        enviados += 1;
      }
    }
    if (c.estado === 'publicado' && c.esperando > 0 && c.publicada
      && c.publicada <= new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) && await unaVez(c.id, 'sin_habilitar', c.publicada)) {
      await notificar({ clave: `cp-sin_habilitar-${c.id}-${c.publicada}`, project_id: c.project_id, targetUserIds: await dest(), type: 'curso_pendiente_sin_habilitar', title: `Publicado y con alumnas sin habilitar: ${c.nombre}`,
        message: `${c.campus} · ${c.esperando} sin habilitar desde hace más de 48 h.`, link_path: enlace(c.id) }).catch(() => {});
      enviados += 1;
    }
  }
  if (enviados) logger.info({ enviados }, 'Cursos pendientes: avisos de fecha enviados');
  return { revisados: rows.length, enviados };
}

/**
 * El resumen de los lunes (#336), por campus: cursos abiertos, retrasados y
 * alumnas esperando, y la carga de cada tutora. Va a los super admin, como una
 * notificación, UNA vez por semana: si ya hay una de esta semana, no manda otra
 * (repetir la vuelta del job, o reiniciar, no la duplica).
 *
 * Solo se manda si hay algo que contar: un campus a 0 se nombra al final, pero
 * una semana con TODO a 0 no genera aviso (un resumen vacío entrena a no leerlo).
 */
export async function resumenDeLaSemana({ ahora = new Date() } = {}) {
  const zona = process.env.APP_TIMEZONE || 'Europe/Madrid';
  // «Esta semana» = desde el lunes de la zona de la aplicación.
  const hoy = new Date(ahora.toLocaleDateString('en-CA', { timeZone: zona }) + 'T00:00:00Z');
  const lunes = new Date(hoy);
  lunes.setUTCDate(hoy.getUTCDate() - ((hoy.getUTCDay() + 6) % 7));
  const desde = lunes.toISOString().slice(0, 10);
  const { rows: [ya] } = await query(
    `SELECT 1 FROM admin_notifications WHERE type = 'curso_pendiente_semana' AND created_at >= ($1::date AT TIME ZONE $2::text) LIMIT 1`,
    [desde, zona]
  );
  if (ya) return { enviado: false, motivo: 'ya enviado esta semana' };

  const campus = await model.resumenPorCampus({});
  const carga = await model.cargaPorTutora({});
  const total = campus.reduce((s, c) => s + c.abiertos, 0);
  if (!total) return { enviado: false, motivo: 'nada abierto' };

  const lineas = campus.filter((c) => c.abiertos > 0)
    .map((c) => `${c.campus}: ${c.abiertos} abiertos, ${c.retrasados} retrasados, ${c.alumnas_esperando} alumnas esperando`);
  const alDia = campus.filter((c) => c.abiertos === 0).map((c) => c.campus);
  const tutoras = carga.slice(0, 5).map((t) => `${t.tutora} (${t.abiertos}${t.retrasados ? `, ${t.retrasados} retrasados` : ''})`);
  const { rows: supers } = await query(`SELECT id FROM users WHERE role = 'superadmin' AND active`);
  if (!supers.length) return { enviado: false, motivo: 'sin super admin' };
  await notificar({
    clave: `cp-semana-${desde}`,
    targetUserIds: supers.map((u) => u.id), type: 'curso_pendiente_semana',
    title: `Cursos pendientes: ${total} abiertos, ${campus.reduce((s, c) => s + c.retrasados, 0)} retrasados`,
    message: [...lineas, alDia.length ? `Al día: ${alDia.join(', ')}.` : null, tutoras.length ? `Carga: ${tutoras.join('; ')}.` : null].filter(Boolean).join(' · '),
    link_path: '/productos/pendientes',
  });
  return { enviado: true, campus: lineas.length };
}
