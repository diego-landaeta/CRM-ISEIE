/*
  Facturas de colaboradores (#202) · la base de datos, simulada en memoria.

  En MultiCRM estas pruebas van contra Postgres. En ISEIE las pruebas corren con
  `db.js` simulado (como egresosParidad.test.js), así que aquí se reproduce, una
  por una, cada consulta del módulo: se reconoce por su texto y se responde con
  las mismas columnas y los mismos tipos que daría Postgres (NUMERIC como texto,
  los importes de `json_build_object` como número, las fechas como Date).

  Una consulta que no está aquí LANZA: si el módulo cambia una consulta, la
  prueba lo dice en vez de responder vacío y pasar en verde.

  Las transacciones guardan una copia al BEGIN y la reponen en el ROLLBACK, para
  que un error a medias deje la base como estaba (lo que comprueban las pruebas
  de «nadie se queda sin empresa» o «anular una pagada»). No hay concurrencia de
  verdad: las carreras entre dos peticiones a la vez quedan en las pruebas de
  MultiCRM, contra Postgres.

  Uso, en cada fichero de pruebas:

    vi.mock('../src/shared/config/db.js', async () =>
      (await import('./facturasColaborador.base.js')).moduloDb);
    import { base } from './facturasColaborador.base.js';
*/

const t0 = () => ({
  users: [],
  projects: [],
  user_projects: [],
  issuers: [],
  colaboradores: [],
  ce: [],
  facturas: [],
  registro: [],
  lineas: [],
  notificaciones: [],
  sec: { colaborador: 0, factura: 0, registro: 0, linea: 0, notificacion: 0 },
});

let datos = t0();
let copia = null;

const n2 = (v) => (v === null || v === undefined ? null : Number(v).toFixed(2));
const num = (v) => (v === null || v === undefined ? null : Number(v));
const fecha = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const mes = (d) => (d ? fecha(d).slice(0, 7) : null);
const enLista = (lista, v) => lista === null || lista === undefined || lista.includes(Number(v));

/** El primer día del mes de hoy, en Madrid (como `date_trunc('month', NOW() AT TIME ZONE 'Europe/Madrid')`). */
function primerDiaDeHoy() {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  return `${hoy.slice(0, 7)}-01`;
}

const activo = (c) => !c.baja_desde || fecha(c.baja_desde) > primerDiaDeHoy();

/** ESTADO de facturas.model.js, en JS. */
function estado(f) {
  if (f.anulada_at) return 'anulada';
  if (f.subida_at) return 'recibida';
  if (f.caduca_at && new Date(f.caduca_at) < new Date()) return 'caducado';
  if (f.abierto_at) return 'abierto';
  if (f.enviado_at) return 'enviado';
  const envios = datos.registro
    .filter((r) => r.factura_id === f.id && ['enviado', 'recordatorio', 'no_enviado', 'reenviado'].includes(r.evento))
    .sort((a, b) => b.id - a.id);
  if (envios[0]?.evento === 'no_enviado') return 'no_enviado';
  return 'sin_enviar';
}

const colaborador = (id) => datos.colaboradores.find((c) => c.id === Number(id));
const emisor = (id) => datos.issuers.find((e) => e.id === Number(id));
const factura = (id) => datos.facturas.find((f) => f.id === Number(id));
const cobro = (f) => datos.ce.find((x) => x.colaborador_id === f.colaborador_id && x.issuer_id === f.issuer_id) || {};
const usuario = (id) => datos.users.find((u) => u.id === Number(id));

/** CAMPOS_ENLACE de facturas.model.js. */
function filaEnlace(f) {
  const c = colaborador(f.colaborador_id);
  const ii = emisor(f.issuer_id);
  const ce = cobro(f);
  return {
    id: f.id, colaborador_id: f.colaborador_id, issuer_id: f.issuer_id, periodo: f.periodo,
    importe_esperado: n2(f.importe_esperado), importe: n2(f.importe), numero_factura: f.numero_factura,
    numero_recepcion: f.numero_recepcion, subida_at: f.subida_at, abierto_at: f.abierto_at, caduca_at: f.caduca_at,
    anulada_at: f.anulada_at, nombre_original: f.nombre_original,
    estado: estado(f),
    colaborador_nombre: c.nombre, colaborador_email: c.email, area: c.area, colaborador_nif: c.nif,
    razon_social: ii.razon_social, empresa_nif: ii.nif, direccion: ii.direccion ?? null, cp: ii.cp ?? null,
    ciudad: ii.ciudad ?? null, pais: ii.pais ?? null, logo_url: ii.logo_url ?? null,
    modalidad: ce.modalidad ?? null, importe_fijo: n2(ce.importe_fijo), tarifa_hora: n2(ce.tarifa_hora),
    iva_pct: n2(ce.iva_pct), irpf_pct: n2(ce.irpf_pct),
    base: n2(f.base), iva: n2(f.iva), irpf: n2(f.irpf), total: n2(f.total), horas: n2(f.horas),
    cuadra: f.cuadra ?? null, importe_pdf: n2(f.importe_pdf), mime: f.mime ?? null,
    pagada_at: f.pagada_at ?? null, pagada_por: f.pagada_por ?? null, forma_pago: f.forma_pago ?? null,
    referencia_pago: f.referencia_pago ?? null, justificante: f.justificante ?? null,
  };
}

/** FILA_DE_LISTA de facturas.model.js. */
function filaLista(f) {
  const c = colaborador(f.colaborador_id);
  const diferencia = f.importe !== null && f.importe !== undefined && f.importe_esperado !== null && f.importe_esperado !== undefined
    ? n2(Number(f.base ?? f.importe) - Number(f.importe_esperado)) : null;
  return {
    id: f.id, colaborador_id: f.colaborador_id, issuer_id: f.issuer_id, periodo: f.periodo.slice(0, 7),
    colaborador_nombre: c.nombre, email: c.email, area: c.area, empresa: emisor(f.issuer_id).razon_social,
    importe_esperado: n2(f.importe_esperado), importe: n2(f.importe), diferencia,
    numero_factura: f.numero_factura ?? null, numero_recepcion: f.numero_recepcion ?? null,
    subida_at: f.subida_at ?? null, enviado_at: f.enviado_at ?? null, abierto_at: f.abierto_at ?? null,
    caduca_at: f.caduca_at ?? null, anulada_at: f.anulada_at ?? null, motivo_anulacion: f.motivo_anulacion ?? null,
    nombre_original: f.nombre_original ?? null, tamano: f.tamano ?? null,
    base: n2(f.base), total: n2(f.total), horas: n2(f.horas), cuadra: f.cuadra ?? null,
    importe_pdf: n2(f.importe_pdf), mime: f.mime ?? null,
    pagada_at: f.pagada_at ?? null, forma_pago: f.forma_pago ?? null, referencia_pago: f.referencia_pago ?? null,
    con_justificante: Boolean(f.justificante),
    estado: estado(f),
  };
}

/** CAMPOS_COLABORADOR + EMPRESAS_VISIBLES + COMPARTIDO (facturas-colaborador.model.js). */
function filaColaborador(c, issuerIds) {
  const suyas = datos.ce.filter((x) => x.colaborador_id === c.id);
  const visibles = suyas.filter((x) => enLista(issuerIds, x.issuer_id))
    .map((x) => ({
      issuer_id: x.issuer_id, razon_social: emisor(x.issuer_id).razon_social,
      importe_acordado: num(x.importe_acordado), modalidad: x.modalidad ?? null,
      importe_fijo: num(x.importe_fijo), tarifa_hora: num(x.tarifa_hora),
      iva_pct: num(x.iva_pct), irpf_pct: num(x.irpf_pct),
    }))
    .sort((a, b) => a.razon_social.localeCompare(b.razon_social));
  return {
    id: c.id, nombre: c.nombre, email: c.email, nif: c.nif ?? null, area: c.area, notas: c.notas ?? null,
    user_id: c.user_id ?? null, activo: activo(c), alta_desde: mes(c.alta_desde), baja_desde: mes(c.baja_desde),
    created_at: c.created_at, updated_at: c.updated_at,
    usuario_nombre: c.user_id ? usuario(c.user_id)?.nombre ?? null : null,
    empresas: visibles,
    compartido: issuerIds !== null && issuerIds !== undefined && suyas.some((x) => !issuerIds.includes(x.issuer_id)),
  };
}

const visible = (c, issuerIds) => issuerIds === null || issuerIds === undefined
  || datos.ce.some((x) => x.colaborador_id === c.id && issuerIds.includes(x.issuer_id));

const filas = (rows) => ({ rows, rowCount: rows.length });
const nada = () => filas([]);

function registroConUsuario(r) {
  return {
    id: r.id, evento: r.evento, creado_at: r.creado_at, ip: r.ip, detalle: r.detalle,
    factura_id: r.factura_id, usuario_nombre: r.user_id ? usuario(r.user_id)?.nombre ?? null : null,
  };
}
const recientes = (a, b) => (b.creado_at - a.creado_at) || (b.id - a.id);

/* ─────────────────────────── las consultas ─────────────────────────── */

const CONSULTAS = [
  // ── transacciones ──
  [(s) => /^\s*BEGIN\s*$/.test(s), () => { copia = structuredClone(datos); return nada(); }],
  [(s) => /^\s*COMMIT\s*$/.test(s), () => { copia = null; return nada(); }],
  [(s) => /^\s*ROLLBACK\s*$/.test(s), () => { if (copia) datos = copia; copia = null; return nada(); }],

  // ── permisos (resolvePermission) ──
  [(s) => s.includes('FROM user_permission_overrides'), () => nada()],
  [(s) => s.includes('FROM custom_roles'), () => nada()],
  // Lo cambiado en Configuración › Roles para cada rol (migración 211, la del tablero): nada.
  [(s) => s.includes('FROM role_permission_overrides'), () => nada()],

  // ── la campana (notifications.service: notifyUsers) ──
  [(s) => s.includes('INSERT INTO admin_notifications'), (p) => {
    const n = { id: ++datos.sec.notificacion, type: p[0], title: p[1], message: p[2], link_path: p[3], metadata: p[4], target_user_ids: p[6] };
    datos.notificaciones.push(n);
    return filas([{ id: n.id, type: n.type, title: n.title, created_at: new Date() }]);
  }],

  // ── facturas-colaborador.model.js ──
  [(s) => s.includes('FROM user_projects up') && s.includes('p.sociedad_emisora_id IS NOT NULL'), ([userId]) => {
    const ids = new Set(datos.user_projects.filter((up) => up.user_id === Number(userId) && up.active !== false)
      .map((up) => datos.projects.find((p) => p.id === up.project_id)?.sociedad_emisora_id)
      .filter((x) => x !== null && x !== undefined));
    return filas([...ids].sort((a, b) => a - b).map((id) => ({ id })));
  }],
  [(s) => s.includes('SELECT id, razon_social, nif') && s.includes('FROM invoice_issuers'), ([issuerIds]) =>
    filas(datos.issuers.filter((e) => e.activo !== false && enLista(issuerIds, e.id))
      .sort((a, b) => a.razon_social.localeCompare(b.razon_social))
      .map((e) => ({ id: e.id, razon_social: e.razon_social, nif: e.nif })))],
  [(s) => s.includes('FROM colaboradores c') && s.includes('ORDER BY activo DESC, c.nombre'), ([issuerIds, issuerId, est, like]) => {
    const patron = like ? new RegExp(String(like).slice(1, -1).replace(/\\([\\%_])|([.*+?^${}()|[\]])|(%)|(_)/g,
      (m, esc, re, pct, und) => (esc ? `\\${esc}` : re ? `\\${re}` : pct ? '.*' : '.')), 'i') : null;
    const lista = datos.colaboradores
      .filter((c) => visible(c, issuerIds))
      .filter((c) => !issuerId || datos.ce.some((x) => x.colaborador_id === c.id && x.issuer_id === Number(issuerId)))
      .filter((c) => est === 'todos' || (est === 'activos') === activo(c))
      .filter((c) => !patron || patron.test(c.nombre) || patron.test(c.email))
      .map((c) => filaColaborador(c, issuerIds))
      .sort((a, b) => (Number(b.activo) - Number(a.activo)) || a.nombre.localeCompare(b.nombre));
    return filas(lista);
  }],
  [(s) => s.includes('FROM colaboradores c') && s.includes('WHERE c.id = $2 AND'), ([issuerIds, id]) => {
    const c = colaborador(id);
    return filas(c && visible(c, issuerIds) ? [filaColaborador(c, issuerIds)] : []);
  }],
  [(s) => s.includes('FROM colaborador_empresas') && s.includes('WHERE colaborador_id = $1 ORDER BY issuer_id'), ([id]) =>
    filas(datos.ce.filter((x) => x.colaborador_id === Number(id)).sort((a, b) => a.issuer_id - b.issuer_id)
      .map((x) => ({
        issuer_id: x.issuer_id, importe_acordado: n2(x.importe_acordado), modalidad: x.modalidad ?? null,
        importe_fijo: n2(x.importe_fijo), tarifa_hora: n2(x.tarifa_hora), iva_pct: n2(x.iva_pct), irpf_pct: n2(x.irpf_pct),
      })))],
  // Rol colaborador, principal o añadido (26/10/2026).
  [(s) => s.includes("FROM users WHERE id = $1 AND (role = 'colaborador'"), ([id]) =>
    filas(usuario(id)?.role === 'colaborador' || (usuario(id)?.roles_extra || []).includes('colaborador') ? [{ '?column?': 1 }] : [])],
  [(s) => s.includes('FROM colaborador_empresas') && s.includes('NOT (issuer_id = ANY($2::int[])) LIMIT 1'), ([id, issuerIds]) =>
    filas(datos.ce.some((x) => x.colaborador_id === Number(id) && !issuerIds.includes(x.issuer_id)) ? [{ '?column?': 1 }] : [])],
  [(s) => s.includes('INSERT INTO colaboradores'), ([nombre, email, nif, area, notas, userId, altaDesde, porUserId]) => {
    const c = {
      id: ++datos.sec.colaborador, nombre, email, nif, area, notas, user_id: userId, activo: true,
      alta_desde: altaDesde, baja_desde: null, creado_por: porUserId, created_at: new Date(), updated_at: new Date(),
    };
    datos.colaboradores.push(c);
    return filas([{ id: c.id }]);
  }],
  [(s) => s.includes('UPDATE colaboradores SET baja_desde = NULL, alta_desde = $2'), ([id, desde]) => {
    Object.assign(colaborador(id), { baja_desde: null, alta_desde: desde, activo: true, updated_at: new Date() });
    return filas([]);
  }],
  [(s) => s.includes('UPDATE colaboradores SET baja_desde = $2'), ([id, desde]) => {
    Object.assign(colaborador(id), { baja_desde: desde, updated_at: new Date() });
    return filas([]);
  }],
  [(s) => s.includes('UPDATE colaboradores SET'), (p, s) => {
    const campos = [...s.matchAll(/(\w+) = \$(\d+)/g)].map((m) => [m[1], Number(m[2])]);
    const c = colaborador(p[0]);
    for (const [k, i] of campos) c[k] = p[i - 1];
    c.updated_at = new Date();
    return filas([]);
  }],
  [(s) => s.includes('INSERT INTO colaborador_empresas'), ([colaboradorId, issuerId, acordado, modalidad, fijo, tarifa, iva, irpf]) => {
    const fila = { colaborador_id: Number(colaboradorId), issuer_id: Number(issuerId), importe_acordado: acordado, modalidad, importe_fijo: fijo, tarifa_hora: tarifa, iva_pct: iva, irpf_pct: irpf };
    const i = datos.ce.findIndex((x) => x.colaborador_id === fila.colaborador_id && x.issuer_id === fila.issuer_id);
    if (i >= 0) datos.ce[i] = fila; else datos.ce.push(fila);
    return filas([]);
  }],
  [(s) => s.includes('DELETE FROM colaborador_empresas'), ([colaboradorId, issuerId]) => {
    datos.ce = datos.ce.filter((x) => !(x.colaborador_id === Number(colaboradorId) && x.issuer_id === Number(issuerId)));
    return filas([]);
  }],
  [(s) => s.includes('INSERT INTO facturas_colaborador_registro'), ([facturaId, colaboradorId, evento, userId, ip, detalle]) => {
    datos.registro.push({
      id: ++datos.sec.registro, factura_id: facturaId, colaborador_id: colaboradorId, evento,
      creado_at: new Date(), user_id: userId, ip, detalle: JSON.parse(detalle),
    });
    return filas([]);
  }],
  [(s) => s.includes('FROM facturas_colaborador_registro r') && s.includes('WHERE r.colaborador_id = $1'), ([id, issuerIds]) => {
    const suyas = new Set(datos.facturas.filter((f) => f.colaborador_id === Number(id) && enLista(issuerIds, f.issuer_id)).map((f) => f.id));
    return filas(datos.registro.filter((r) => r.colaborador_id === Number(id) || suyas.has(r.factura_id))
      .sort(recientes).map(registroConUsuario));
  }],

  // ── facturas.model.js ──
  [(s) => s.includes('SELECT c.id AS colaborador_id, ce.issuer_id, ce.importe_acordado'), ([periodo]) => {
    const lista = [];
    for (const c of [...datos.colaboradores].sort((a, b) => a.id - b.id)) {
      if (c.alta_desde && fecha(c.alta_desde) > periodo) continue;
      if (c.baja_desde && !(fecha(c.baja_desde) > periodo)) continue;
      for (const x of datos.ce.filter((y) => y.colaborador_id === c.id).sort((a, b) => a.issuer_id - b.issuer_id)) {
        if (emisor(x.issuer_id)?.activo === false) continue;
        const viva = datos.facturas.some((f) => f.colaborador_id === c.id && f.issuer_id === x.issuer_id && f.periodo === periodo && !f.anulada_at);
        if (!viva) lista.push({ colaborador_id: c.id, issuer_id: x.issuer_id, importe_acordado: n2(x.importe_acordado) });
      }
    }
    return filas(lista);
  }],
  [(s) => s.includes('INSERT INTO facturas_colaborador') && s.includes('token_semilla'), ([colaboradorId, issuerId, periodo, esperado, hash, caduca, semilla]) => {
    const choca = datos.facturas.some((f) => f.colaborador_id === Number(colaboradorId) && f.issuer_id === Number(issuerId)
      && f.periodo === periodo && !f.anulada_at);
    if (choca) return filas([]);
    const f = {
      id: ++datos.sec.factura, colaborador_id: Number(colaboradorId), issuer_id: Number(issuerId), periodo,
      importe_esperado: esperado, token_hash: hash, caduca_at: caduca, token_semilla: semilla, created_at: new Date(),
      importe: null, subida_at: null, enviado_at: null, abierto_at: null, anulada_at: null,
    };
    datos.facturas.push(f);
    return filas([{ id: f.id }]);
  }],
  [(s) => s.includes('WHERE f.token_hash = $1'), ([hash]) => {
    const f = datos.facturas.find((x) => x.token_hash === hash);
    return filas(f ? [filaEnlace(f)] : []);
  }],
  [(s) => s.includes('WHERE c.user_id = $1 AND f.anulada_at IS NULL'), ([userId]) =>
    filas(datos.facturas.filter((f) => colaborador(f.colaborador_id).user_id === Number(userId) && !f.anulada_at)
      .sort((a, b) => b.periodo.localeCompare(a.periodo) || emisor(a.issuer_id).razon_social.localeCompare(emisor(b.issuer_id).razon_social))
      .map((f) => ({ ...filaEnlace(f), token_semilla: f.token_semilla, token_hash: f.token_hash })))],
  [(s) => s.includes('WHERE f.id = $2 AND c.user_id = $1'), ([userId, id]) => {
    const f = factura(id);
    return filas(f && colaborador(f.colaborador_id).user_id === Number(userId) ? [{ ...filaEnlace(f), archivo_key: f.archivo_key ?? null }] : []);
  }],
  [(s) => s.includes('FROM facturas_colaborador f WHERE f.id = $1 FOR UPDATE'), ([id]) => {
    const f = factura(id);
    return filas(f ? [{
      id: f.id, colaborador_id: f.colaborador_id, issuer_id: f.issuer_id, periodo: f.periodo,
      subida_at: f.subida_at, anulada_at: f.anulada_at, caduca_at: f.caduca_at, token_hash: f.token_hash, pagada_at: f.pagada_at ?? null,
    }] : []);
  }],
  [(s) => s.includes('SET enviado_at = NOW() WHERE id = $1'), ([id]) => { factura(id).enviado_at = new Date(); return filas([]); }],
  [(s) => s.includes('f.enviado_at IS NULL AND f.subida_at IS NULL'), ([periodo]) =>
    filas(datos.facturas.filter((f) => f.periodo === periodo && !f.enviado_at && !f.subida_at && !f.anulada_at
      && (!f.caduca_at || new Date(f.caduca_at) > new Date())).sort((a, b) => a.id - b.id)
      .map((f) => ({ id: f.id, token_semilla: f.token_semilla, token_hash: f.token_hash })))],
  [(s) => s.includes('SELECT f.id, f.token_semilla, f.token_hash FROM facturas_colaborador f'), ([periodo]) =>
    filas(datos.facturas.filter((f) => f.periodo === periodo && !f.subida_at && !f.anulada_at
      && (!f.caduca_at || new Date(f.caduca_at) > new Date())).sort((a, b) => a.id - b.id)
      .map((f) => ({ id: f.id, token_semilla: f.token_semilla, token_hash: f.token_hash })))],
  [(s) => s.includes('ORDER BY (remitente_no_contestar IS NULL)'), ([issuerId]) => {
    const p = datos.projects.filter((x) => x.sociedad_emisora_id === Number(issuerId) && x.active !== false)
      .sort((a, b) => (Number(!a.remitente_no_contestar) - Number(!b.remitente_no_contestar)) || a.id - b.id)[0];
    return filas(p ? [{ id: p.id, nombre: p.nombre, slug: p.slug, logo_url: p.logo_url ?? null, emoji: p.emoji ?? null }] : []);
  }],
  [(s) => s.includes("u.role = 'superadmin'") && s.includes('UNION'), ([issuerId]) => {
    const ids = new Set(datos.users.filter((u) => u.active !== false && u.role === 'superadmin').map((u) => u.id));
    for (const u of datos.users.filter((x) => x.active !== false && x.role === 'admin')) {
      const suyos = datos.user_projects.filter((up) => up.user_id === u.id && up.active !== false);
      if (suyos.some((up) => datos.projects.find((p) => p.id === up.project_id)?.sociedad_emisora_id === Number(issuerId))) ids.add(u.id);
    }
    return filas([...ids].map((id) => ({ id })));
  }],
  [(s) => s.includes("detalle->>'recordatorio' = 'true'"), ([id]) =>
    filas(datos.registro.some((r) => r.factura_id === Number(id) && r.evento === 'no_enviado' && r.detalle?.recordatorio === true) ? [{ '?column?': 1 }] : [])],
  [(s) => s.includes('COUNT(*)::int AS n FROM facturas_colaborador_registro'), ([id, evento]) =>
    filas([{ n: datos.registro.filter((r) => r.factura_id === Number(id) && r.evento === evento).length }])],
  [(s) => s.includes('SELECT 1 FROM facturas_colaborador_registro WHERE factura_id = $1 AND evento = $2'), ([id, evento]) =>
    filas(datos.registro.some((r) => r.factura_id === Number(id) && r.evento === evento) ? [{ '?column?': 1 }] : [])],
  [(s) => s.includes('SET abierto_at = NOW() WHERE id = $1 AND abierto_at IS NULL'), ([id]) => {
    const f = factura(id);
    if (!f || f.abierto_at) return { rows: [], rowCount: 0 };
    f.abierto_at = new Date();
    return { rows: [], rowCount: 1 };
  }],
  [(s) => s.includes('pg_advisory_xact_lock'), () => nada()],
  [(s) => s.includes('WHERE periodo = $1::date AND numero_recepcion IS NOT NULL'), ([periodo]) =>
    filas([{ n: datos.facturas.filter((f) => f.periodo === periodo && f.numero_recepcion).length }])],
  [(s) => s.includes('SET subida_at = NOW(), numero_recepcion = $2'), (p) => {
    const [id, numeroRecepcion, importe, numeroFactura, archivoKey, nombreOriginal, mime, tamano, sha256, b, iva, irpf, total, horas, cuadra, importePdf] = p;
    Object.assign(factura(id), {
      subida_at: new Date(), numero_recepcion: numeroRecepcion, importe, numero_factura: numeroFactura,
      archivo_key: archivoKey, nombre_original: nombreOriginal, mime, tamano, sha256,
      base: b, iva, irpf, total, horas, cuadra, importe_pdf: importePdf,
    });
    return filas([]);
  }],
  [(s) => s.includes('INSERT INTO facturas_colaborador_lineas'), ([facturaId, orden, concepto, projectId, horas, tarifa, importe]) => {
    datos.lineas.push({ id: ++datos.sec.linea, factura_id: Number(facturaId), orden, concepto, project_id: projectId, horas, tarifa, importe });
    return filas([]);
  }],
  [(s) => s.includes('WHERE f.id = ANY($1::int[]) ORDER BY f.id FOR UPDATE'), ([ids]) =>
    filas(datos.facturas.filter((f) => ids.includes(f.id)).sort((a, b) => a.id - b.id)
      .map((f) => ({ id: f.id, subida_at: f.subida_at, anulada_at: f.anulada_at, pagada_at: f.pagada_at ?? null })))],
  [(s) => s.includes('SET pagada_at = $2, pagada_por = $3'), ([id, fechaPago, por, forma, justificante, referencia]) => {
    Object.assign(factura(id), { pagada_at: fechaPago, pagada_por: por, forma_pago: forma, justificante, referencia_pago: referencia });
    return filas([]);
  }],
  [(s) => s.includes('SET pagada_at = NULL, pagada_por = NULL'), ([id]) => {
    Object.assign(factura(id), { pagada_at: null, pagada_por: null, forma_pago: null, justificante: null, referencia_pago: null });
    return filas([]);
  }],
  [(s) => s.includes('NOT COALESCE(es_prueba, false) AND sociedad_emisora_id = $1'), ([issuerId]) =>
    filas(datos.projects.filter((p) => p.active !== false && !p.es_prueba && p.sociedad_emisora_id === Number(issuerId))
      .sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({ id: p.id, nombre: p.nombre })))],
  [(s) => s.includes('FROM facturas_colaborador_lineas l') && s.includes('WHERE l.factura_id = $1'), ([id]) =>
    filas(datos.lineas.filter((l) => l.factura_id === Number(id)).sort((a, b) => a.orden - b.orden).map((l) => ({
      orden: l.orden, concepto: l.concepto, project_id: l.project_id,
      campus: l.project_id ? datos.projects.find((p) => p.id === l.project_id)?.nombre ?? null : null,
      horas: n2(l.horas), tarifa: n2(l.tarifa), importe: n2(l.importe),
    })))],
  [(s) => s.includes('WHERE f.id = $1 AND ($2::int[] IS NULL OR f.issuer_id = ANY($2::int[]))'), ([id, issuerIds]) => {
    const f = factura(id);
    return filas(f && enLista(issuerIds, f.issuer_id) ? [{ ...filaEnlace(f), archivo_key: f.archivo_key ?? null, tamano: f.tamano ?? null }] : []);
  }],
  [(s) => s.includes('SET anulada_at = NOW(), anulada_por = $2'), ([id, por, motivo]) => {
    Object.assign(factura(id), { anulada_at: new Date(), anulada_por: por, motivo_anulacion: motivo });
    return filas([]);
  }],
  [(s) => s.includes('SET token_hash = $2, token_semilla = $3'), ([id, hash, semilla, caduca]) => {
    Object.assign(factura(id), { token_hash: hash, token_semilla: semilla, caduca_at: caduca, abierto_at: null, enviado_at: null });
    return filas([]);
  }],
  [(s) => s.includes("ORDER BY (t.estado = 'anulada')"), ([periodo, issuerIds, issuerId, est, area]) =>
    filas(datos.facturas
      .filter((f) => f.periodo === periodo && enLista(issuerIds, f.issuer_id) && (!issuerId || f.issuer_id === Number(issuerId))
        && (!area || colaborador(f.colaborador_id).area === area))
      .map(filaLista)
      .filter((t) => !est || t.estado === est)
      .sort((a, b) => (Number(a.estado === 'anulada') - Number(b.estado === 'anulada'))
        || a.colaborador_nombre.localeCompare(b.colaborador_nombre) || a.empresa.localeCompare(b.empresa) || a.id - b.id))],
  [(s) => s.includes('LIMIT 1000'), ([issuerIds, issuerId, colaboradorId, periodo, est], s) => {
    let vista;
    if (s.includes('f.pagada_at IS NULL')) vista = (f) => f.subida_at && !f.anulada_at && !f.pagada_at;
    else if (s.includes('WHERE f.pagada_at IS NOT NULL')) vista = (f) => f.pagada_at && !f.anulada_at;
    else if (s.includes('WHERE f.subida_at IS NOT NULL AND f.anulada_at IS NULL')) vista = (f) => f.subida_at && !f.anulada_at;
    else vista = () => true;
    return filas(datos.facturas
      .filter((f) => vista(f) && enLista(issuerIds, f.issuer_id) && (!issuerId || f.issuer_id === Number(issuerId))
        && (!colaboradorId || f.colaborador_id === Number(colaboradorId)) && (!periodo || f.periodo === periodo))
      .map(filaLista)
      .filter((t) => !est || t.estado === est || (est === 'no_cuadra' && t.cuadra === false && t.estado !== 'anulada'))
      .sort((a, b) => b.periodo.localeCompare(a.periodo) || a.colaborador_nombre.localeCompare(b.colaborador_nombre)
        || a.empresa.localeCompare(b.empresa) || a.id - b.id));
  }],
  [(s) => s.includes('GROUP BY f.issuer_id, ii.razon_social, l.project_id, p.nombre'), ([periodo, issuerIds, issuerId]) => {
    const grupos = new Map();
    for (const l of datos.lineas) {
      const f = factura(l.factura_id);
      if (!f || f.periodo !== periodo || !f.subida_at || f.anulada_at) continue;
      if (!enLista(issuerIds, f.issuer_id) || (issuerId && f.issuer_id !== Number(issuerId))) continue;
      const clave = `${f.issuer_id}-${l.project_id ?? ''}`;
      const g = grupos.get(clave) || {
        issuer_id: f.issuer_id, empresa: emisor(f.issuer_id).razon_social, project_id: l.project_id ?? null,
        campus: l.project_id ? datos.projects.find((p) => p.id === l.project_id)?.nombre ?? null : null,
        horas: null, importe: 0, ids: new Set(),
      };
      if (l.horas !== null && l.horas !== undefined) g.horas = (g.horas ?? 0) + Number(l.horas);
      g.importe += Number(l.importe);
      g.ids.add(f.id);
      grupos.set(clave, g);
    }
    return filas([...grupos.values()]
      .map(({ ids, ...g }) => ({ ...g, facturas: ids.size }))
      .sort((a, b) => a.empresa.localeCompare(b.empresa) || (Number(a.project_id === null) - Number(b.project_id === null)) || b.importe - a.importe));
  }],
  [(s) => s.includes('f.archivo_key IS NOT NULL') && s.includes('ORDER BY c.nombre, f.id'), ([periodo, issuerId]) =>
    filas(datos.facturas
      .filter((f) => f.periodo === periodo && f.issuer_id === Number(issuerId) && f.subida_at && !f.anulada_at && f.archivo_key)
      .map((f) => {
        const c = colaborador(f.colaborador_id);
        const l = filaLista(f);
        return {
          id: f.id, colaborador: c.nombre, area: c.area, nif: c.nif ?? null, numero_factura: f.numero_factura,
          importe: n2(f.importe), importe_esperado: n2(f.importe_esperado), diferencia: l.diferencia,
          subida_at: f.subida_at, numero_recepcion: f.numero_recepcion, archivo_key: f.archivo_key,
        };
      })
      .sort((a, b) => a.colaborador.localeCompare(b.colaborador) || a.id - b.id))],
  [(s) => s.includes('SELECT razon_social FROM invoice_issuers WHERE id = $1'), ([id]) =>
    filas(emisor(id) ? [{ razon_social: emisor(id).razon_social }] : [])],
  [(s) => s.includes('FROM facturas_colaborador_registro r') && s.includes('WHERE r.factura_id = $1'), ([id]) =>
    filas(datos.registro.filter((r) => r.factura_id === Number(id)).sort(recientes).map(registroConUsuario))],
];

/** Todas las consultas que se hicieron, por si una prueba quiere mirar qué se preguntó. */
export const consultas = [];

export async function query(sql, params = []) {
  const s = String(sql);
  consultas.push({ sql: s, params });
  const h = CONSULTAS.find(([es]) => es(s));
  if (!h) throw new Error(`Consulta no simulada en facturasColaborador.base.js:\n${s.slice(0, 300)}`);
  return h[1](params, s);
}

const cliente = { query, release: () => {} };

/** Lo que exporta `shared/config/db.js`, simulado. */
export const moduloDb = {
  default: { query },
  query,
  getClient: async () => cliente,
};

/* ─────────────────────────── para sembrar y mirar ─────────────────────────── */

export const base = {
  get datos() { return datos; },
  vaciar() { datos = t0(); copia = null; consultas.length = 0; },
  persona(id, { nombre = `Persona ${id}`, email = `p${id}@test.local`, role = 'admin', campus = [], roles_extra = [] } = {}) {
    datos.users.push({ id, nombre, email, role, roles_extra, active: true });
    for (const p of campus) datos.user_projects.push({ user_id: id, project_id: p, active: true });
    return id;
  },
  empresa(id, razonSocial, extra = {}) {
    datos.issuers.push({ id, razon_social: razonSocial, nif: `B${String(id).padStart(8, '0')}`, activo: true, ...extra });
    return id;
  },
  campus(id, nombre, issuerId, extra = {}) {
    datos.projects.push({ id, nombre, slug: nombre.toLowerCase().replace(/\W+/g, '-'), sociedad_emisora_id: issuerId, active: true, es_prueba: false, ...extra });
    return id;
  },
  factura: (id) => factura(id),
  colaborador: (id) => colaborador(id),
  registroDe: (facturaId) => datos.registro.filter((r) => r.factura_id === Number(facturaId)),
};
