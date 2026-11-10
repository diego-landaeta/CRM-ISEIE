import { query } from '../../shared/config/db.js';
import { proyectosDeCentro } from './certifex.programa.js';

/*
  El apartado Certifex del CRM: las consultas que llegan desde la web de Certifex.

  Un centro que quiere inscribir su campus, o cualquier otra consulta. Certifex las
  guarda y las reenvia aqui; ver la migracion 173 para el porque de una tabla propia.
*/

export const ESTADOS = ['nueva', 'en_curso', 'resuelta', 'spam'];

function fila(r) {
  if (!r) return null;
  return {
    id: r.id,
    certifexId: Number(r.certifex_id),
    tipo: r.tipo,
    nombre: r.nombre,
    email: r.email,
    telefono: r.telefono,
    organizacion: r.organizacion,
    urlCampus: r.url_campus,
    mensaje: r.mensaje,
    idioma: r.idioma,
    estado: r.estado,
    notaInterna: r.nota_interna,
    atendidaPor: r.atendida_por_nombre || null,
    recibidaEn: r.recibida_en,
    creadaEnCertifex: r.creada_en_certifex,
    updatedAt: r.updated_at,
  };
}

/**
 * Guarda una consulta que llega de Certifex. Si ya estaba (un reintento de Certifex
 * tras un corte trae el mismo `certifex_id`), no la duplica: devuelve `nueva: false`
 * para que no vuelva a sonar la campana.
 */
export async function recibir(c) {
  const { rows } = await query(
    `INSERT INTO certifex_consultas
       (certifex_id, tipo, nombre, email, telefono, organizacion, url_campus, mensaje, idioma, creada_en_certifex)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (certifex_id) DO NOTHING
     RETURNING *`,
    [c.certifexId, c.tipo, c.nombre, c.email, c.telefono || null, c.organizacion || null,
      c.urlCampus || null, c.mensaje, c.idioma || null, c.creadoEn || null],
  );
  if (rows[0]) return { consulta: fila(rows[0]), nueva: true };
  const ya = await query(`SELECT * FROM certifex_consultas WHERE certifex_id = $1`, [c.certifexId]);
  return { consulta: fila(ya.rows[0]), nueva: false };
}

export async function listar({ estado = null, tipo = null, pagina = 1, limite = 30 } = {}) {
  const lim = Math.min(100, Math.max(1, parseInt(limite, 10) || 30));
  const pag = Math.max(1, parseInt(pagina, 10) || 1);
  const { rows } = await query(
    `SELECT c.*, u.nombre AS atendida_por_nombre, COUNT(*) OVER() AS total
       FROM certifex_consultas c
       LEFT JOIN users u ON u.id = c.atendida_por
      WHERE ($1::text IS NULL OR c.estado = $1) AND ($2::text IS NULL OR c.tipo = $2)
      ORDER BY (c.estado = 'nueva') DESC, c.recibida_en DESC, c.id DESC
      LIMIT $3 OFFSET $4`,
    [estado, tipo, lim, (pag - 1) * lim],
  );
  return { filas: rows.map(fila), total: rows[0] ? Number(rows[0].total) : 0, pagina: pag, limite: lim };
}

export async function recuentoNuevas() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM certifex_consultas WHERE estado = 'nueva'`);
  return rows[0]?.n ?? 0;
}

export async function actualizar(id, { estado, notaInterna }, userId) {
  const sets = ['atendida_por = $2', 'updated_at = NOW()'];
  const params = [id, userId];
  if (estado !== undefined) { params.push(estado); sets.push(`estado = $${params.length}`); }
  if (notaInterna !== undefined) { params.push(notaInterna); sets.push(`nota_interna = $${params.length}`); }
  const { rows } = await query(
    `UPDATE certifex_consultas SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params,
  );
  if (!rows[0]) return null;
  const u = await query(`SELECT nombre FROM users WHERE id = $1`, [userId]);
  return fila({ ...rows[0], atendida_por_nombre: u.rows[0]?.nombre || null });
}

// ── Solicitudes de diploma (#272, migracion 230) ─────────────────────────────

function solicitud(r) {
  if (!r) return null;
  return {
    id: r.id,
    matriculaId: Number(r.matricula_id),
    centro: r.centro,
    curso: { ref: r.curso_ref == null ? null : Number(r.curso_ref), nombre: r.curso_nombre },
    nombreDiploma: r.nombre_diploma,
    nombreMoodle: r.nombre_moodle,
    email: r.email,
    leadId: r.lead_id,
    solicitadaEn: r.solicitada_en,
    veces: r.veces,
    recibidaEn: r.recibida_en,
  };
}

/**
 * La ficha del CRM con ese correo, si hay: la mas reciente, sin las borradas ni las
 * de los proyectos de prueba. Es la misma clave que usa el cruce de Emisiones.
 */
export async function leadPorCorreo(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const { rows } = await query(
    `SELECT l.id FROM leads l
      WHERE l.deleted_at IS NULL AND lower(l.email) = $1
        AND l.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)
      ORDER BY l.id DESC LIMIT 1`,
    [e],
  );
  return rows[0]?.id ?? null;
}

/**
 * Guarda la solicitud que avisa Certifex. Una fila por matricula:
 *  · `nueva`: no estaba.
 *  · `actualizada`: el alumno lo ha vuelto a pedir (otra fecha u otro nombre). Se
 *    actualiza la que habia y el aviso de rechazo anterior deja de valer.
 *  · `repetida`: un reintento identico de Certifex. No cambia nada ni debe avisar.
 */
export async function recibirSolicitud(s) {
  const leadId = await leadPorCorreo(s.alumno.email);
  const { rows } = await query(
    `INSERT INTO certifex_solicitudes
       (matricula_id, centro, curso_ref, curso_nombre, nombre_diploma, nombre_moodle, email, lead_id, solicitada_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (matricula_id) DO UPDATE SET
       centro = EXCLUDED.centro,
       curso_ref = EXCLUDED.curso_ref,
       curso_nombre = EXCLUDED.curso_nombre,
       nombre_diploma = EXCLUDED.nombre_diploma,
       nombre_moodle = EXCLUDED.nombre_moodle,
       email = EXCLUDED.email,
       lead_id = COALESCE(EXCLUDED.lead_id, certifex_solicitudes.lead_id),
       solicitada_en = EXCLUDED.solicitada_en,
       veces = CASE WHEN certifex_solicitudes.solicitada_en IS NULL THEN 1 ELSE certifex_solicitudes.veces + 1 END,
       aviso_rechazo_en = NULL,
       aviso_rechazo_por = NULL,
       aviso_rechazo_resultado = NULL,
       updated_at = NOW()
     WHERE certifex_solicitudes.solicitada_en IS DISTINCT FROM EXCLUDED.solicitada_en
        OR certifex_solicitudes.nombre_diploma IS DISTINCT FROM EXCLUDED.nombre_diploma
     RETURNING *, (xmax = 0) AS insertada`,
    [s.matriculaId, s.centro.toUpperCase(), s.curso?.ref ?? null, s.curso?.nombre ?? null,
      s.alumno.nombreDiploma, s.alumno.nombreMoodle || null, s.alumno.email || null, leadId, s.solicitadaEn],
  );
  if (rows[0]) return { solicitud: solicitud(rows[0]), estado: rows[0].insertada ? 'nueva' : 'actualizada' };
  const ya = await query(`SELECT * FROM certifex_solicitudes WHERE matricula_id = $1`, [s.matriculaId]);
  return { solicitud: solicitud(ya.rows[0]), estado: 'repetida' };
}

/** Los usuarios activos de administracion: a quienes suena la campana de una solicitud. */
export async function idsAdministracion() {
  const { rows } = await query(
    `SELECT id FROM users
      WHERE active = true
        AND (role IN ('admin', 'superadmin') OR roles_extra && ARRAY['admin', 'superadmin']::user_role[])`,
  );
  return rows.map((r) => r.id);
}

/** Apunta el aviso de rechazo que aprobo alguien del CRM, haya salido o no. */
export async function registrarAvisosRechazo(resultados, por) {
  for (const r of resultados) {
    if (!r?.matriculaId || !r.resultado) continue;
    await query(
      `INSERT INTO certifex_solicitudes (matricula_id, aviso_rechazo_en, aviso_rechazo_por, aviso_rechazo_resultado)
       VALUES ($1, NOW(), $2, $3)
       ON CONFLICT (matricula_id) DO UPDATE SET
         aviso_rechazo_en = NOW(), aviso_rechazo_por = $2, aviso_rechazo_resultado = $3, updated_at = NOW()`,
      [r.matriculaId, por, r.resultado],
    );
  }
}

/** El ultimo aviso de rechazo aprobado de cada matricula, por id. */
export async function avisosRechazoDe(matriculaIds) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT matricula_id, aviso_rechazo_en, aviso_rechazo_por, aviso_rechazo_resultado
       FROM certifex_solicitudes
      WHERE matricula_id = ANY($1::bigint[]) AND aviso_rechazo_en IS NOT NULL`,
    [matriculaIds],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), {
    en: r.aviso_rechazo_en, por: r.aviso_rechazo_por, resultado: r.aviso_rechazo_resultado,
  }]));
}

/**
 * Lo que el CRM guardo de cada solicitud (correo, campus, curso), por matricula, con lo
 * revisado a mano en el panel (correo del CRM, formacion elegida, programa editado).
 *
 * Tambien las filas a medias (sin campus: las crea el aviso de rechazo sin webhook
 * previo): quien llama completa con Certifex lo que falte, SIN perder lo revisado.
 */
export async function datosDeSolicitudes(matriculaIds) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT matricula_id, centro, email, curso_nombre, email_crm, producto_id, programa_editado
       FROM certifex_solicitudes
      WHERE matricula_id = ANY($1::bigint[])`,
    [matriculaIds],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), {
    matriculaId: Number(r.matricula_id), centro: r.centro ?? null, email: r.email, curso: r.curso_nombre ?? '',
    emailCrm: r.email_crm ?? null, productoId: r.producto_id ?? null, programaEditado: r.programa_editado ?? null,
  }]));
}

// ── Lo revisado a mano antes de aprobar (migracion 230, «Editar») ────────────

function edicion(r) {
  if (!r) return null;
  if (!r.email_crm && r.producto_id == null && r.programa_editado == null) return null;
  return {
    emailCrm: r.email_crm ?? null,
    productoId: r.producto_id ?? null,
    programaEditado: r.programa_editado ?? null,
    por: r.editado_por ?? null,
    en: r.editado_en ?? null,
  };
}

/** Lo revisado a mano de cada matricula, por id. Sin nada revisado, no sale. */
export async function edicionesDe(matriculaIds) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT matricula_id, email_crm, producto_id, programa_editado, editado_por, editado_en
       FROM certifex_solicitudes
      WHERE matricula_id = ANY($1::bigint[])
        AND (email_crm IS NOT NULL OR producto_id IS NOT NULL OR programa_editado IS NOT NULL)`,
    [matriculaIds],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), edicion(r)]));
}

/**
 * Guarda lo revisado a mano de una matricula. `cambios` trae solo lo que se toca
 * (`emailCrm`, `productoId`, `programa`); null en un campo es quitar esa edicion.
 *
 * La fila puede no existir si Certifex no aviso por el webhook: se crea con lo que dice
 * Certifex de la matricula (`base`: campus, curso, correo, nombres, fecha), y en una que
 * ya existe solo se rellena lo que faltaba. Devuelve la edicion que queda (o null).
 */
export async function guardarEdicion(matriculaId, cambios, por, base = {}) {
  const params = [
    matriculaId, base.centro ?? null, base.cursoRef ?? null, base.cursoNombre ?? null,
    base.nombreDiploma ?? null, base.nombreMoodle ?? null, base.email ?? null, base.solicitadaEn ?? null, por,
  ];
  const cols = [];
  const phs = [];
  const campo = (col, valor) => { params.push(valor); cols.push(col); phs.push(`$${params.length}`); };
  if (cambios.emailCrm !== undefined) campo('email_crm', cambios.emailCrm);
  if (cambios.productoId !== undefined) campo('producto_id', cambios.productoId);
  if (cambios.programa !== undefined) campo('programa_editado', cambios.programa == null ? null : JSON.stringify(cambios.programa));
  const sets = cols.map((c, i) => `${c} = ${phs[i]}`);
  const { rows } = await query(
    `INSERT INTO certifex_solicitudes
       (matricula_id, centro, curso_ref, curso_nombre, nombre_diploma, nombre_moodle, email, solicitada_en,
        editado_por, editado_en${cols.map((c) => `, ${c}`).join('')})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()${phs.map((v) => `, ${v}`).join('')})
     ON CONFLICT (matricula_id) DO UPDATE SET
       centro = COALESCE(certifex_solicitudes.centro, EXCLUDED.centro),
       curso_ref = COALESCE(certifex_solicitudes.curso_ref, EXCLUDED.curso_ref),
       curso_nombre = COALESCE(certifex_solicitudes.curso_nombre, EXCLUDED.curso_nombre),
       nombre_diploma = COALESCE(certifex_solicitudes.nombre_diploma, EXCLUDED.nombre_diploma),
       nombre_moodle = COALESCE(certifex_solicitudes.nombre_moodle, EXCLUDED.nombre_moodle),
       email = COALESCE(certifex_solicitudes.email, EXCLUDED.email),
       solicitada_en = COALESCE(certifex_solicitudes.solicitada_en, EXCLUDED.solicitada_en),
       editado_por = EXCLUDED.editado_por,
       editado_en = NOW(),
       updated_at = NOW()${sets.map((s) => `,\n       ${s}`).join('')}
     RETURNING *`,
    params,
  );
  // Quitarlo todo tambien queda apuntado (editado_por/en), aunque ya no haya edicion.
  return edicion(rows[0]);
}

// ── La firma del alumno (migracion 207, CRM #349) ────────────────────────────

/** Las firmas subidas a mano, por matricula: Map id → { key, por, en }. */
export async function firmasSubidasDe(matriculaIds) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT matricula_id, firma_key, firma_por, firma_en
       FROM certifex_solicitudes
      WHERE matricula_id = ANY($1::bigint[]) AND firma_key IS NOT NULL`,
    [matriculaIds],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), { key: r.firma_key, por: r.firma_por ?? null, en: r.firma_en ?? null }]));
}

/**
 * La firma de la matricula de admision de cada `{ matriculaId, projectId, email }`: la
 * mas reciente con firma de ese proyecto y ese correo. Las que llegan por el formulario de
 * admision no tienen ficha ni venta (solo `dedupe_key` y `datos_admision`), asi que el
 * correo se busca en las cuatro. Map matriculaId → { key, matriculaCrm }.
 *
 * SOLO DE UNA ADMISIÓN ACEPTADA/EN VIGOR (QA de Diego, 22/10): «Validada». «Datos
 * validados» es el paso de en medio (aún falta «Validar matrícula»), así que no vale.
 * El formulario es público: con cualquier solicitud —o una ya rechazada— a nombre del
 * correo de otro, su firma acabaría en el diploma de esa persona.
 */
export async function firmasDeAdmision(pares) {
  if (!pares.length) return new Map();
  const { rows } = await query(
    `SELECT x.matricula_id, f.id AS matricula_crm, f.firma_key
       FROM unnest($1::bigint[], $2::int[], $3::text[]) AS x(matricula_id, project_id, email)
       JOIN LATERAL (
         SELECT m.id, m.firma_key
           FROM matriculas m
           LEFT JOIN leads l ON l.id = m.lead_id
           LEFT JOIN conversions cv ON cv.id = m.conversion_id
           LEFT JOIN leads lc ON lc.id = cv.lead_id
          WHERE m.project_id = x.project_id
            AND m.firma_key IS NOT NULL
            AND m.estado = 'validada'
            -- m.email: el correo del formulario ya mapeado (#198); el de datos_admision
            -- solo vale si el formulario lo manda con el nombre «email».
            AND x.email IN (lower(l.email), lower(lc.email), lower(m.dedupe_key), lower(m.email), lower(m.datos_admision->>'email'))
          ORDER BY m.updated_at DESC NULLS LAST, m.id DESC
          LIMIT 1
       ) f ON true`,
    [pares.map((p) => p.matriculaId), pares.map((p) => p.projectId), pares.map((p) => p.email)],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), { key: r.firma_key, matriculaCrm: r.matricula_crm }]));
}

/**
 * Apunta la firma subida a mano de una matricula (la fila se crea si no existe, con lo
 * que dice Certifex en `base`, como guardarEdicion). Devuelve la key ANTERIOR, para
 * borrar ese archivo, o null.
 */
export async function guardarFirma(matriculaId, key, por, base = {}) {
  const { rows } = await query(
    `WITH antes AS (SELECT firma_key FROM certifex_solicitudes WHERE matricula_id = $1)
     INSERT INTO certifex_solicitudes
       (matricula_id, centro, curso_ref, curso_nombre, nombre_diploma, nombre_moodle, email, solicitada_en,
        firma_key, firma_por, firma_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (matricula_id) DO UPDATE SET
       centro = COALESCE(certifex_solicitudes.centro, EXCLUDED.centro),
       curso_ref = COALESCE(certifex_solicitudes.curso_ref, EXCLUDED.curso_ref),
       curso_nombre = COALESCE(certifex_solicitudes.curso_nombre, EXCLUDED.curso_nombre),
       nombre_diploma = COALESCE(certifex_solicitudes.nombre_diploma, EXCLUDED.nombre_diploma),
       nombre_moodle = COALESCE(certifex_solicitudes.nombre_moodle, EXCLUDED.nombre_moodle),
       email = COALESCE(certifex_solicitudes.email, EXCLUDED.email),
       solicitada_en = COALESCE(certifex_solicitudes.solicitada_en, EXCLUDED.solicitada_en),
       firma_key = EXCLUDED.firma_key,
       firma_por = EXCLUDED.firma_por,
       firma_en = NOW(),
       updated_at = NOW()
     RETURNING (SELECT firma_key FROM antes) AS anterior`,
    [
      matriculaId, base.centro ?? null, base.cursoRef ?? null, base.cursoNombre ?? null, base.nombreDiploma ?? null,
      base.nombreMoodle ?? null, base.email ?? null, base.solicitadaEn ?? null, key, por,
    ],
  );
  return rows[0]?.anterior ?? null;
}

// ── Quien recibe la campana de un campus (#272) ──────────────────────────────

/**
 * Los usuarios activos de administracion que deben enterarse de algo de ese campus de
 * Certifex: super admin siempre, y los admin que tienen activo el proyecto del CRM que
 * casa con el campus (la regla de `proyectosDeCentro`). Si el campus no casa con un
 * unico proyecto, solo super admin: no se avisa a quien luego no lo podra ver.
 */
export async function idsAdministracionDeCentro(centro) {
  const { rows: proyectos } = await query(`SELECT id, nombre, slug FROM projects WHERE NOT COALESCE(es_prueba, false)`);
  const proys = proyectosDeCentro(centro, proyectos);
  const projectId = proys.length === 1 ? proys[0].id : null;
  const { rows } = await query(
    `SELECT u.id FROM users u
      WHERE u.active = true
        AND (u.role = 'superadmin' OR u.roles_extra && ARRAY['superadmin']::user_role[]
             OR ($1::int IS NOT NULL
                 AND (u.role = 'admin' OR u.roles_extra && ARRAY['admin']::user_role[])
                 AND EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.active AND up.project_id = $1)))`,
    [projectId],
  );
  return rows.map((r) => r.id);
}

// ── Terminaron sin pedir el diploma (aviso «ha terminado la formacion») ─────

/**
 * Guarda el aviso de Certifex de que Moodle da la formacion por terminada y el alumno
 * aun no ha pedido el diploma. Una vez por matricula:
 *  · `nueva`: es el primer aviso de esa matricula (haya fila o no: puede existir por
 *    una edicion o un aviso de rechazo). Solo se rellena lo que faltaba de la fila.
 *  · `repetida`: ya habia llegado; un reintento de Certifex no cambia nada.
 */
export async function recibirCompletado(c) {
  const leadId = await leadPorCorreo(c.alumno.email);
  const { rows } = await query(
    `INSERT INTO certifex_solicitudes
       (matricula_id, centro, curso_ref, curso_nombre, nombre_moodle, email, lead_id,
        completado_en, completado_nota, completado_recibido_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (matricula_id) DO UPDATE SET
       centro = COALESCE(certifex_solicitudes.centro, EXCLUDED.centro),
       curso_ref = COALESCE(certifex_solicitudes.curso_ref, EXCLUDED.curso_ref),
       curso_nombre = COALESCE(certifex_solicitudes.curso_nombre, EXCLUDED.curso_nombre),
       nombre_moodle = COALESCE(certifex_solicitudes.nombre_moodle, EXCLUDED.nombre_moodle),
       email = COALESCE(certifex_solicitudes.email, EXCLUDED.email),
       lead_id = COALESCE(certifex_solicitudes.lead_id, EXCLUDED.lead_id),
       completado_en = EXCLUDED.completado_en,
       completado_nota = EXCLUDED.completado_nota,
       completado_recibido_en = NOW(),
       updated_at = NOW()
     WHERE certifex_solicitudes.completado_recibido_en IS NULL
     RETURNING *`,
    [c.matriculaId, c.centro.toUpperCase(), c.curso?.ref ?? null, c.curso?.nombre ?? null,
      c.alumno.nombreMoodle || null, c.alumno.email || null, leadId, c.completadoEn ?? null, c.notaFinal ?? null],
  );
  const fila = rows[0] ?? (await query(`SELECT * FROM certifex_solicitudes WHERE matricula_id = $1`, [c.matriculaId])).rows[0];
  return { completado: completado(fila), estado: rows[0] ? 'nueva' : 'repetida' };
}

function completado(r) {
  if (!r) return null;
  return {
    id: r.id,
    matriculaId: Number(r.matricula_id),
    centro: r.centro,
    curso: { ref: r.curso_ref == null ? null : Number(r.curso_ref), nombre: r.curso_nombre },
    nombreMoodle: r.nombre_moodle,
    email: r.email,
    leadId: r.lead_id,
    completadoEn: r.completado_en,
    nota: r.completado_nota == null ? null : Number(r.completado_nota),
    recibidoEn: r.completado_recibido_en,
  };
}

/** El aviso de «terminado» de cada matricula, por id (cuando lo dio Moodle y cuando llego). */
export async function completadosDe(matriculaIds) {
  if (!matriculaIds.length) return new Map();
  const { rows } = await query(
    `SELECT matricula_id, completado_en, completado_nota, completado_recibido_en
       FROM certifex_solicitudes
      WHERE matricula_id = ANY($1::bigint[]) AND completado_recibido_en IS NOT NULL`,
    [matriculaIds],
  );
  return new Map(rows.map((r) => [Number(r.matricula_id), {
    en: r.completado_en, recibidoEn: r.completado_recibido_en, nota: r.completado_nota == null ? null : Number(r.completado_nota),
  }]));
}
