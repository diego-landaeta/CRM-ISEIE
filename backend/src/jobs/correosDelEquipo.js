import { query } from '../shared/config/db.js';
import { CRM_CORREOS } from '../shared/config/crm.js';
import * as informes from '../modules/reports/report.model.js';
import { resumenDelDia } from '../modules/reports/resumenDelDia.js';
import { resumenDeLaCola } from '../modules/proceso/proceso.model.js';
// Por el espacio de nombres y no por nombre: ISEIE no tiene los contadores del
// listado (`contarFiltrosRapidos`) y un import por nombre tumbaria el modulo.
// Sin ellos, el correo de la gestora sale sin el bloque de recordatorios.
import * as leadModel from '../modules/leads/lead.model.js';
import { versionDe } from '../modules/feedback/cabecera.js';

/**
 * Los correos al equipo, con datos y con la marca (Diego, 28/09):
 *
 *   «mejora los correos de notificación, muestra los datos, con el logo; en
 *    ISEIE el logo de ISEIE; a los superadmin por empresa: si tiene 3 empresas,
 *    1 correo con las 3; y a la gestora cómo le fue la semana, y el correo del
 *    día, para el día siguiente».
 *
 * Cuatro correos, con un mismo diseño:
 *
 *   · GESTORA, cada noche — «Tu día y lo de mañana»: lo de hoy, lo que le toca
 *     mañana en la cola y sus recordatorios (con enlaces que abren el CRM ya
 *     filtrado) y cómo va el mes.
 *   · GESTORA, los lunes — «Tu semana»: sus números contra la semana anterior y
 *     contra la media del equipo, y su puesto.
 *   · DIRECCIÓN, cada tarde — «Resumen del día» POR EMPRESA.
 *   · DIRECCIÓN, los lunes — «Reporte semanal» POR EMPRESA.
 *
 * POR EMPRESA: las empresas de cada persona son las de los campus que tiene
 * asignados (una sociedad agrupa sus campus; un campus sin sociedad va solo).
 * Un superadmin las ve todas, tenga los campus que tenga. Tres empresas = un correo
 * con tres secciones.
 *
 * NINGUNA CIFRA SE CUENTA AQUÍ: salen de las mismas funciones que pintan las
 * pantallas —«Ayer y hoy» (`resumenDelDia`), «Lo que toca» (`resumenDeLaCola`),
 * los contadores del listado (`contarFiltrosRapidos`), Reportes (`overview`) y
 * «Cómo voy» (`miPuesto`)—. Si el correo y la pantalla no dicen lo mismo, en
 * dos semanas nadie abre el correo. La única excepción es lo COBRADO, que sale
 * de los pagos registrados (`conversion_payments`) y no del campo de la venta,
 * que declara de más (ver `reporteSemanalScheduler`).
 *
 * Diseño: tablas y estilos en línea —lo único que se ve igual en Gmail, Outlook
 * y el móvil—, 600 px, la cabecera de la marca como imagen (la que dibuja el
 * CRM: ni el modo oscuro ni el proxy de Gmail la estropean).
 */

const CRM = CRM_CORREOS;
const R = CRM.rutas;

export function base() {
  return (process.env.FEEDBACK_BASE_URL || process.env.CRM_BASE_URL || 'http://localhost:5173/crm').replace(/\/+$/, '');
}

// ─── Formatos ────────────────────────────────────────────────────────────────

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0);
export const eur = (v) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n(v));
const entero = (v) => new Intl.NumberFormat('es-ES').format(Math.round(n(v) * 10) / 10);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const bonita = (isoDia) => { const [a, m, d] = isoDia.split('-').map(Number); return `${d} de ${MESES[m - 1]}`; };
const diaSemana = (d) => `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
const primerNombre = (s) => String(s || '').trim().split(/\s+/)[0] || '';

// La hora de la aplicacion: la de Reportes y los listados.
const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';
const horaEspana = (d) => new Intl.DateTimeFormat('es-ES', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

/*
  EL TRAMO DE HORAS DE «HOY», con la hora de España.

  Diego, 29/09: «deberías de incluir el plazo de horas que salió eso». El
  resumen sale a media tarde, y «hoy» son las horas que van del día, no uno
  entero: por eso salía «−56 % vs. ayer» con 31 prospectos, comparados con el
  día ENTERO de ayer. Sin decirlo, parecía que el día había ido a la mitad.

  El día empieza a las 00:00 de la base, que está en UTC: es como cuentan
  Reportes y «Ayer y hoy», y este correo tiene que decir lo mismo que ellos. En
  España eso son las 02:00 en verano y la 01:00 en invierno, y así se dice.
*/
export function tramoDeHoy(ahora = new Date()) {
  const inicio = new Date(`${iso(ahora)}T00:00:00Z`);
  return `de ${horaEspana(inicio)} a ${horaEspana(ahora)} (hora de España)`;
}

/** ▲ +12 % / ▼ −5 % / «nuevo» respecto a antes. */
export function comparar(ahora, antes) {
  const a = n(ahora); const b = n(antes);
  if (b === 0) return a === 0 ? { texto: 'igual', signo: 'igual' } : { texto: 'nuevo', signo: 'sube' };
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return { texto: 'igual', signo: 'igual' };
  return { texto: `${pct > 0 ? '+' : ''}${pct} %`, signo: pct > 0 ? 'sube' : 'baja' };
}

// ─── Piezas del diseño ───────────────────────────────────────────────────────

const GRIS = '#5b6572';
const TINTA = '#1d2530';
const LINEA = '#e6e9ee';

/** El correo entero: cabecera de marca, título, contenido y pie. */
export function envoltorio({ cabeceraUrl = null, preTitulo, titulo, subtitulo = '', contenido, pie = '' }) {
  const cabecera = cabeceraUrl
    ? `<img src="${esc(cabeceraUrl)}" width="600" alt="${esc(CRM.nombre)}" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:12px 12px 0 0">`
    : `<div style="background:${CRM.color};border-radius:12px 12px 0 0;padding:20px 28px;color:#ffffff;font:bold 18px Arial,Helvetica,sans-serif">${esc(CRM.nombre)}</div>`;
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f4f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
    <tr><td>${cabecera}</td></tr>
    <tr><td style="background:#ffffff;padding:26px 28px 30px;border-radius:0 0 12px 12px;font-family:Arial,Helvetica,sans-serif;color:${TINTA}">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:${CRM.color};font-weight:bold">${esc(preTitulo)}</div>
      <div style="font-size:22px;font-weight:bold;line-height:1.3;margin:6px 0 4px">${esc(titulo)}</div>
      ${subtitulo ? `<div style="font-size:14px;color:${GRIS};line-height:1.5">${subtitulo}</div>` : ''}
      ${contenido}
    </td></tr>
    <tr><td style="padding:16px 8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8a939e;text-align:center">
      ${pie ? `${pie}<br>` : ''}Correo automático de ${esc(CRM.nombre)}: no lo contestes. Puedes apagarlo en «Mis preferencias».
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

/** Un título de apartado, con el logo de la empresa si lo tiene. */
export function apartado(titulo, { logoUrl = null, detalle = '' } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0 10px"><tr>
    ${logoUrl ? `<td style="padding-right:14px;vertical-align:middle;width:1%;white-space:nowrap"><img src="${esc(logoUrl)}" alt="" height="40" style="display:block;height:40px;width:auto;max-width:150px;border:0"></td>` : ''}
    <td style="vertical-align:middle;border-left:${logoUrl ? '0' : `4px solid ${CRM.color}`};padding-left:${logoUrl ? '0' : '10px'}">
      <div style="font-size:16px;font-weight:bold;color:${TINTA}">${esc(titulo)}</div>
      ${detalle ? `<div style="font-size:12px;color:${GRIS};margin-top:2px">${detalle}</div>` : ''}
    </td></tr></table>`;
}

/** Tarjetas de cifras, dos por fila (en el móvil no hay sitio para cuatro). */
export function tarjetas(lista) {
  const celda = (k) => {
    const cmp = k.cmp;
    const color = !cmp ? GRIS : cmp.signo === 'sube' ? '#047857' : cmp.signo === 'baja' ? '#b91c1c' : GRIS;
    const flecha = !cmp ? '' : cmp.signo === 'sube' ? '▲ ' : cmp.signo === 'baja' ? '▼ ' : '';
    return `<td width="50%" style="padding:5px;vertical-align:top">
      <div style="border:1px solid ${LINEA};border-radius:10px;padding:12px 14px">
        <div style="font-size:12px;color:${GRIS}">${esc(k.etiqueta)}</div>
        <div style="font-size:24px;font-weight:bold;color:${k.destaca ? CRM.color : TINTA};margin-top:2px">${k.valor}</div>
        ${cmp || k.nota ? `<div style="font-size:12px;color:${color};margin-top:2px">${cmp ? `${flecha}${esc(cmp.texto)}${k.nota ? ' · ' : ''}` : ''}${k.nota ? `<span style="color:${GRIS}">${k.nota}</span>` : ''}</div>` : ''}
      </div></td>`;
  };
  const filas = [];
  for (let i = 0; i < lista.length; i += 2) filas.push(`<tr>${celda(lista[i])}${lista[i + 1] ? celda(lista[i + 1]) : '<td width="50%"></td>'}</tr>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px -5px 0">${filas.join('')}</table>`;
}

/** Una tabla sencilla: cabeceras y filas (la primera columna a la izquierda). */
export function tabla(cabeceras, filas) {
  if (!filas.length) return '';
  const th = cabeceras.map((c, i) => `<th style="text-align:${i ? 'right' : 'left'};font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:${GRIS};padding:6px 8px;border-bottom:1px solid ${LINEA}">${esc(c)}</th>`).join('');
  const tr = filas.map((f) => `<tr>${f.map((v, i) => `<td style="text-align:${i ? 'right' : 'left'};font-size:13px;padding:7px 6px;border-bottom:1px solid #f1f3f6;color:${TINTA}${i ? ';white-space:nowrap' : ''}">${v}</td>`).join('')}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">${`<tr>${th}</tr>`}${tr}</table>`;
}

/** Una línea con su número y un enlace «abrir →» al CRM ya filtrado. */
export function lineaConEnlace(valor, texto, url) {
  return `<tr><td style="padding:7px 0;font-size:14px;color:${TINTA};border-bottom:1px solid #f1f3f6">
    <strong style="font-size:16px">${entero(valor)}</strong> ${texto}</td>
    <td style="padding:7px 0;text-align:right;border-bottom:1px solid #f1f3f6">
      <a href="${esc(url)}" style="color:${CRM.color};font-weight:bold;font-size:13px;text-decoration:none">abrir →</a></td></tr>`;
}

/**
 * Los recordatorios de una persona, uno por uno, para el correo de la noche
 * (Diego, 09/10: «que vayan en el reporte, no un correo por recordatorio: eso es
 * gastar Brevo por gusto»). Los vencidos, los de hoy y los de mañana, de los
 * prospectos que lleva en sus campus. Sale de su propia consulta y no de los
 * contadores del listado, que ISEIE no tiene.
 */
export async function recordatoriosPendientes(personaId, projectIds, hastaIso, tope = 15) {
  const { rows } = await query(
    `SELECT r.id, r.lead_id, r.fecha_recordatorio::text AS fecha, r.nota, l.nombre AS lead_nombre,
            p.nombre AS campus, count(*) OVER () AS total
       FROM lead_reminders r
       JOIN leads l ON l.id = r.lead_id
       JOIN projects p ON p.id = l.project_id
      WHERE l.responsable_id = $1
        AND l.project_id = ANY($2::int[])
        AND l.deleted_at IS NULL
        AND r.completado = false
        AND r.fecha_recordatorio <= $3::date
      ORDER BY r.fecha_recordatorio, r.id
      LIMIT $4`,
    [personaId, projectIds, hastaIso, tope]
  );
  return { filas: rows, total: rows.length ? Number(rows[0].total) : 0 };
}

/** La lista de recordatorios: cuándo toca, el prospecto (enlace a su ficha) y la nota. */
export function bloqueRecordatorios({ filas, total }, { hoyIso, mananaIso, variosCampus = false }) {
  if (!filas.length) return '';
  const cuando = (f) => (f.fecha < hoyIso
    ? `<span style="color:#b3261e;font-weight:bold">vencido · ${esc(bonita(f.fecha))}</span>`
    : f.fecha === hoyIso ? '<strong>hoy</strong>' : f.fecha === mananaIso ? '<strong>mañana</strong>' : esc(bonita(f.fecha)));
  const tr = filas.map((f) => `<tr>
    <td style="padding:7px 8px 7px 0;font-size:13px;color:${TINTA};border-bottom:1px solid #f1f3f6;white-space:nowrap;vertical-align:top">${cuando(f)}</td>
    <td style="padding:7px 0;font-size:13px;color:${TINTA};border-bottom:1px solid #f1f3f6;vertical-align:top">
      <a href="${esc(`${base()}${R.prospectos}/${f.lead_id}`)}" style="color:${CRM.color};font-weight:bold;text-decoration:none">${esc(f.lead_nombre || 'Sin nombre')}</a>${variosCampus ? ` <span style="color:${GRIS}">· ${esc(f.campus)}</span>` : ''}
      ${f.nota ? `<div style="color:${GRIS};margin-top:2px">${esc(f.nota)}</div>` : ''}</td></tr>`).join('');
  const resto = total > filas.length ? `<p style="font-size:13px;color:${GRIS};margin:8px 0 0">Y ${entero(total - filas.length)} más en el CRM.</p>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px">${tr}</table>${resto}`;
}

export function boton(texto, url) {
  return `<p style="margin:22px 0 4px"><a href="${esc(url)}" style="background:${CRM.color};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:7px;font-weight:bold;font-size:14px;display:inline-block">${esc(texto)}</a></p>`;
}

const parrafo = (html) => `<p style="font-size:14px;line-height:1.55;color:${TINTA};margin:14px 0 0">${html}</p>`;

// ─── Quién es quién ──────────────────────────────────────────────────────────

/** Los campus de una persona (los de pruebas, fuera). */
export async function proyectosDe(userId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.sociedad_emisora_id AS sociedad_id
       FROM user_projects up JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = $1 AND up.active AND p.active AND NOT COALESCE(p.es_prueba, false)
      ORDER BY p.nombre`, [userId]);
  return rows;
}

/**
 * Las EMPRESAS de una persona: sus campus agrupados por sociedad. Un campus sin
 * sociedad va como su propia «empresa». Un SUPERADMIN recibe todas, tenga los
 * campus que tenga asignados: Manuel tiene los de CEDIA para trabajar y no le
 * llegaban ni ICTESS ni Academia IA (Diego, 07/10: «faltan los reportes de
 * academia y ictess que lleguen a manuelcasas»).
 */
export async function empresasDe(persona) {
  let campus = await proyectosDe(persona.id);
  if (persona.role === 'superadmin') {
    ({ rows: campus } = await query(
      `SELECT p.id, p.nombre, p.sociedad_emisora_id AS sociedad_id FROM projects p
        WHERE p.active AND NOT COALESCE(p.es_prueba, false) ORDER BY p.nombre`));
  }
  const ids = [...new Set(campus.map((c) => c.sociedad_id).filter(Boolean))];
  const { rows: socs } = ids.length
    ? await query('SELECT id, razon_social FROM invoice_issuers WHERE id = ANY($1::int[])', [ids])
    : { rows: [] };
  const grupos = new Map();
  for (const c of campus) {
    const s = socs.find((x) => x.id === c.sociedad_id);
    const clave = s ? `s${s.id}` : `p${c.id}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        nombre: s ? s.razon_social : c.nombre,
        logoUrl: null,
        campus: [],
      });
    }
    grupos.get(clave).campus.push(c);
  }
  /*
    EL LOGO DE LA EMPRESA ES EL DE SU MARCA, no la imagen de facturacion de la
    sociedad: en ISEIE esa es el SELLO. Diego, 29/09: «pusiste el logo y sello,
    pon el logo en ambos». Va dibujado sobre el color de la marca (la insignia
    de `cabecera.js`), porque el logo de ISEIE es blanco.

    Solo si la empresa es un campus. Una con varios (CEDIA, siete) no tiene un
    logo suyo, y poner el de uno de sus campus seria decir que es ese.
  */
  const solos = [...grupos.values()].filter((g) => g.campus.length === 1).map((g) => g.campus[0].id);
  const { rows: marcas } = solos.length
    ? await query(
      `SELECT id, nombre, logo_url, theme_color, to_jsonb(p) ->> 'color_cabecera' AS color_cabecera
         FROM projects p WHERE id = ANY($1::int[])`, [solos])
    : { rows: [] };
  for (const g of grupos.values()) {
    const m = g.campus.length === 1 ? marcas.find((x) => x.id === g.campus[0].id) : null;
    if (m?.logo_url) g.logoUrl = `${base()}/api/f/insignia/${m.id}?v=${versionDe({ ...m, proyecto: m.nombre })}`;
  }
  // La que tiene mas campus, primero: suele ser la que mas pesa.
  return [...grupos.values()].sort((a, b) => b.campus.length - a.campus.length || a.nombre.localeCompare(b.nombre, 'es'));
}

/** La cabecera de marca: la del campus si solo hay uno; si no, la del CRM. */
async function cabeceraPara(campus) {
  if (campus.length !== 1) {
    // ISEIE es una sola marca: aunque alguien no tenga campus asignados, su
    // cabecera es la de ISEIE.
    const { rows } = await query('SELECT id FROM projects WHERE active AND NOT COALESCE(es_prueba, false)');
    if (rows.length !== 1) return null;
    campus = rows;
  }
  const { rows: [p] } = await query(
    `SELECT id, nombre, logo_url, theme_color, to_jsonb(p) ->> 'color_cabecera' AS color_cabecera FROM projects p WHERE id = $1`, [campus[0].id]);
  if (!p?.logo_url) return null;
  // La misma imagen que el correo de feedback, con su version: cambiar la
  // marca en el panel cambia la direccion y nadie ve una cabecera vieja.
  return `${base()}/api/f/cabecera/${p.id}?v=${versionDe({ ...p, proyecto: p.nombre })}`;
}

/** Lo cobrado de verdad en un rango: de los pagos registrados, no de la venta. */
async function cobrado({ from, to, projectIds }) {
  const { rows } = await query(
    `SELECT ROUND(COALESCE(SUM(p.importe), 0)::numeric, 2) AS cobrado
       FROM conversion_payments p JOIN conversions c ON c.id = p.conversion_id
      WHERE p.fecha >= $1::date AND p.fecha <= $2::date AND c.project_id = ANY($3::int[])`,
    [from, to, projectIds]);
  return n(rows[0]?.cobrado);
}

/** Lunes a domingo de la semana que acaba de cerrar, y la anterior. */
export function semanas(hoy = new Date()) {
  const d = new Date(hoy); d.setHours(12, 0, 0, 0);
  const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const fin = new Date(lunes); fin.setDate(lunes.getDate() - 1);
  const ini = new Date(fin); ini.setDate(fin.getDate() - 6);
  const finA = new Date(ini); finA.setDate(ini.getDate() - 1);
  const iniA = new Date(finA); iniA.setDate(finA.getDate() - 6);
  return { semana: { from: iso(ini), to: iso(fin) }, anterior: { from: iso(iniA), to: iso(finA) } };
}

// ─── GESTORA, cada noche: «Tu día y lo de mañana» ────────────────────────────

export async function correoDiarioGestora(persona, ahora = new Date()) {
  const campus = await proyectosDe(persona.id);
  const ids = campus.map((c) => c.id);
  if (!ids.length) return null;
  const hoyIso = iso(ahora);
  const mesIni = `${hoyIso.slice(0, 7)}-01`;
  const manana = new Date(ahora); manana.setDate(ahora.getDate() + 1);

  const [dia, cola, mes, contactos] = await Promise.all([
    // `referencia`: el dia que cuenta como «hoy» lo dice quien llama, no el
    // reloj de la base. Asi el correo de las 19:00 no depende de la hora del
    // servidor, y una muestra de ayer se puede rehacer tal cual.
    resumenDelDia({ projectIds: ids, asesoraId: persona.id, referencia: hoyIso }),
    resumenDeLaCola({ projectIds: ids, asesoraId: persona.id }),
    informes.miPuesto({ userId: persona.id, projectIds: ids, from: mesIni, to: hoyIso }).catch(() => null),
    query(`SELECT count(*)::int AS n FROM lead_interactions i JOIN leads l ON l.id = i.lead_id
            WHERE l.responsable_id = $1 AND l.project_id = ANY($2::int[]) AND i.fecha::date = $3::date`, [persona.id, ids, hoyIso])
      .then((r) => r.rows[0].n),
  ]);
  const hoy = dia.find((x) => x.dia === 'hoy') || {};
  const ayer = dia.find((x) => x.dia === 'ayer') || {};

  // Recordatorios y sin contactar, por campus: el listado trabaja sobre uno, y
  // el enlace tiene que abrir exactamente lo que cuenta la línea.
  const avisos = [];
  for (const c of (leadModel.contarFiltrosRapidos ? campus : [])) {
    const f = await leadModel.contarFiltrosRapidos({ projectId: c.id, responsableId: persona.id });
    const url = (qf) => `${base()}${R.prospectos}?projectId=${c.id}&qf=${qf}`;
    const lineas = [
      f.tomorrow ? lineaConEnlace(f.tomorrow, 'con recordatorio para mañana', url('tomorrow')) : '',
      f.overdue ? lineaConEnlace(f.overdue, 'con el recordatorio vencido', url('overdue')) : '',
      f.no_contact ? lineaConEnlace(f.no_contact, 'sin contactar todavía', url('no-contact')) : '',
    ].filter(Boolean);
    if (lineas.length) avisos.push({ campus: c, lineas });
  }
  // Y los recordatorios uno por uno: ya no llega un correo por cada uno.
  const recordatorios = await recordatoriosPendientes(persona.id, ids, iso(manana));

  const colaUrl = `${base()}${R.cola}`;
  const contenido = [
    apartado('Hoy', { detalle: `${diaSemana(ahora)} · ${tramoDeHoy(ahora)}` }),
    tarjetas([
      { etiqueta: 'Prospectos nuevos', valor: entero(hoy.leads), cmp: comparar(hoy.leads, ayer.leads), nota: 'vs. ayer' },
      { etiqueta: 'Contactos apuntados', valor: entero(contactos) },
      { etiqueta: 'Ventas', valor: entero(hoy.ventas), destaca: n(hoy.ventas) > 0 },
      { etiqueta: 'Sin contactar', valor: entero(hoy.sin_tocar), nota: n(hoy.sin_tocar) ? 'de los que entraron hoy' : 'ninguno de hoy' },
    ]),
    apartado('Mañana', { detalle: `${diaSemana(manana)} · tu cola del proceso comercial` }),
    tarjetas([
      { etiqueta: 'Pasos para mañana', valor: entero(cola.manana), destaca: true },
      { etiqueta: 'Atrasados', valor: entero(cola.atrasados), nota: n(cola.atrasados) ? 'mejor a primera hora' : 'ninguno' },
      { etiqueta: 'Quedan de hoy', valor: entero(cola.hoy) },
      { etiqueta: 'Esta semana', valor: entero(cola.esta_semana) },
    ]),
    boton('Abrir mi cola', colaUrl),
    ...(avisos.length || recordatorios.filas.length ? [
      apartado('Recordatorios y pendientes'),
      ...avisos.map((a) => `${campus.length > 1 ? `<div style="font-size:13px;font-weight:bold;color:${GRIS};margin:12px 0 2px">${esc(a.campus.nombre)}</div>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${a.lineas.join('')}</table>`),
      bloqueRecordatorios(recordatorios, { hoyIso, mananaIso: iso(manana), variosCampus: campus.length > 1 }),
    ] : []),
    ...(mes && mes.puesto ? [
      apartado('Tu mes', { detalle: `del 1 al ${ahora.getDate()} de ${MESES[ahora.getMonth()]}` }),
      tarjetas([
        { etiqueta: 'Tu puesto', valor: `${mes.puesto}.º`, nota: `de ${mes.de} · por lo cobrado`, destaca: mes.puesto <= 3 },
        { etiqueta: 'Cobrado', valor: eur(mes.cobrado), nota: mes.faltan_para_subir > 0 ? `${eur(mes.faltan_para_subir)} para subir un puesto` : `${entero(mes.ventas)} ventas` },
        { etiqueta: 'Tu conversión', valor: `${entero(mes.tasa)} %`, nota: `equipo ${entero(mes.tasa_equipo)} %` },
        { etiqueta: 'Vendido', valor: eur(mes.vendido) },
      ]),
    ] : []),
  ].join('');

  return {
    asunto: `Tu día y lo de mañana · ${bonita(hoyIso)}`,
    html: envoltorio({
      cabeceraUrl: await cabeceraPara(campus),
      preTitulo: 'Tu día y lo de mañana',
      titulo: `${primerNombre(persona.nombre) ? `${primerNombre(persona.nombre)}, así` : 'Así'} va tu trabajo`,
      subtitulo: 'Lo que hiciste hoy y lo que te espera mañana. Cada «abrir» te deja en el CRM con eso puesto, y el número de allí es el mismo que el de aquí.',
      contenido,
    }),
  };
}

// ─── GESTORA, los lunes: «Tu semana» ─────────────────────────────────────────

export async function correoSemanalGestora(persona, ahora = new Date()) {
  const campus = await proyectosDe(persona.id);
  const ids = campus.map((c) => c.id);
  if (!ids.length) return null;
  const { semana, anterior } = semanas(ahora);
  const [s, a, puesto, puestoAntes, cola] = await Promise.all([
    informes.overview({ projectIds: ids, ...semana, asesoraId: persona.id }),
    informes.overview({ projectIds: ids, ...anterior, asesoraId: persona.id }),
    informes.miPuesto({ userId: persona.id, projectIds: ids, ...semana }).catch(() => null),
    informes.miPuesto({ userId: persona.id, projectIds: ids, ...anterior }).catch(() => null),
    resumenDeLaCola({ projectIds: ids, asesoraId: persona.id }),
  ]);
  const ls = s.leads || {}; const la = a.leads || {};
  const cs = s.conversions || {}; const ca = a.conversions || {};

  const contenido = [
    apartado('Tu semana', { detalle: `del ${bonita(semana.from)} al ${bonita(semana.to)} · comparada con la anterior` }),
    tarjetas([
      { etiqueta: 'Prospectos recibidos', valor: entero(ls.total), cmp: comparar(ls.total, la.total) },
      { etiqueta: 'Ventas', valor: entero(cs.total), cmp: comparar(cs.total, ca.total), destaca: n(cs.total) > 0 },
      { etiqueta: 'Tu conversión', valor: `${entero(puesto?.tasa)} %`, nota: puesto ? `equipo ${entero(puesto.tasa_equipo)} %` : '' },
      { etiqueta: 'Tu puesto', valor: puesto?.puesto ? `${puesto.puesto}.º` : '—', nota: puesto?.puesto ? `de ${puesto.de} por lo cobrado${puestoAntes?.puesto ? ` · la semana anterior ${puestoAntes.puesto}.º` : ''}` : 'sin ventas ni prospectos' },
    ]),
    parrafo(puesto?.faltan_para_subir > 0
      ? `Cobraste <strong>${eur(puesto.cobrado)}</strong>. Te faltaron <strong>${eur(puesto.faltan_para_subir)}</strong> para subir un puesto; la mejor de la semana cobró ${eur(puesto.mejor_cobrado)}.`
      : (puesto?.puesto === 1 ? '<strong>Fuiste la primera de la semana.</strong> Enhorabuena.' : '')),
    apartado('La semana que empieza', { detalle: 'tu cola del proceso comercial' }),
    tarjetas([
      { etiqueta: 'Pasos esta semana', valor: entero(cola.esta_semana), destaca: true },
      { etiqueta: 'Atrasados', valor: entero(cola.atrasados), nota: n(cola.atrasados) ? 'empieza por aquí' : 'ninguno' },
    ]),
    boton('Abrir mi cola', `${base()}${R.cola}`),
  ].join('');

  return {
    asunto: `Tu semana · del ${bonita(semana.from)} al ${bonita(semana.to)}`,
    html: envoltorio({
      cabeceraUrl: await cabeceraPara(campus),
      preTitulo: 'Tu semana',
      titulo: `${primerNombre(persona.nombre) ? `${primerNombre(persona.nombre)}, así` : 'Así'} fue tu semana`,
      subtitulo: 'Tus números, los de la semana anterior y la media del equipo. Cuentan igual que «Cómo voy» y Reportes.',
      contenido,
    }),
  };
}

// ─── DIRECCIÓN, cada tarde: «Resumen del día», por empresa ───────────────────

async function porGestoraHoy(ids, dia) {
  const { rows } = await query(
    `SELECT u.nombre,
            (SELECT count(*)::int FROM leads l WHERE l.responsable_id = u.id AND l.deleted_at IS NULL
               AND l.project_id = ANY($1::int[]) AND l.created_at::date = $2::date) AS leads,
            (SELECT count(*)::int FROM lead_interactions i JOIN leads l ON l.id = i.lead_id
              WHERE l.responsable_id = u.id AND l.project_id = ANY($1::int[]) AND i.fecha::date = $2::date) AS contactos
       FROM users u
      WHERE u.active AND u.role = 'gestor'
        AND EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.active AND up.project_id = ANY($1::int[]))
      ORDER BY u.nombre`, [ids, dia]);
  return rows;
}

export async function correoDiarioDireccion(persona, ahora = new Date()) {
  const empresas = await empresasDe(persona);
  if (!empresas.length) return null;
  const hoyIso = iso(ahora);
  const partes = [];
  for (const e of empresas) {
    const ids = e.campus.map((c) => c.id);
    const [dia, cola, cobradoHoy, ventas, gestoras] = await Promise.all([
      resumenDelDia({ projectIds: ids, referencia: hoyIso }),
      resumenDeLaCola({ projectIds: ids }),
      cobrado({ from: hoyIso, to: hoyIso, projectIds: ids }),
      informes.ventasVendedora({ projectIds: ids, from: hoyIso, to: hoyIso }).catch(() => []),
      porGestoraHoy(ids, hoyIso),
    ]);
    const hoy = dia.find((x) => x.dia === 'hoy') || {};
    const ayer = dia.find((x) => x.dia === 'ayer') || {};
    const ventasDe = (nombre) => n((ventas.find((v) => v.vendedora === nombre) || {}).ventas);
    const filas = gestoras
      .map((g) => ({ ...g, ventas: ventasDe(g.nombre) }))
      .filter((g) => g.leads || g.contactos || g.ventas)
      .map((g) => [esc(g.nombre), entero(g.leads), entero(g.contactos), entero(g.ventas)]);
    // Por campus, cuando la empresa tiene varios: dónde entra y dónde se vende.
    let porCampus = '';
    if (e.campus.length > 1) {
      const filasCampus = [];
      for (const c of e.campus) {
        const d = (await resumenDelDia({ projectIds: [c.id], referencia: hoyIso })).find((x) => x.dia === 'hoy') || {};
        if (d.leads || d.ventas) filasCampus.push([esc(c.nombre), entero(d.leads), entero(d.ventas)]);
      }
      porCampus = filasCampus.length ? `<div style="font-size:13px;font-weight:bold;color:${GRIS};margin:18px 0 0">Por campus</div>${tabla(['Campus', 'Prospectos', 'Ventas'], filasCampus)}` : '';
    }
    partes.push([
      apartado(e.nombre, { logoUrl: e.logoUrl, detalle: e.campus.length > 1 ? `${e.campus.length} campus: ${e.campus.map((c) => esc(c.nombre)).join(', ')}` : '' }),
      tarjetas([
        { etiqueta: 'Prospectos nuevos', valor: entero(hoy.leads), cmp: comparar(hoy.leads, ayer.leads), nota: 'vs. ayer' },
        { etiqueta: 'Ventas', valor: entero(hoy.ventas), cmp: comparar(hoy.ventas, ayer.ventas), destaca: n(hoy.ventas) > 0 },
        { etiqueta: 'Cobrado hoy', valor: eur(cobradoHoy) },
        { etiqueta: 'Pasos atrasados', valor: entero(cola.atrasados), nota: `${entero(hoy.sin_tocar)} de hoy sin contactar` },
      ]),
      filas.length ? `<div style="font-size:13px;font-weight:bold;color:${GRIS};margin:18px 0 0">Por gestora</div>${tabla(['Gestora', 'Prospectos', 'Contactos', 'Ventas'], filas)}` : parrafo(`<span style="color:${GRIS}">Hoy no hay actividad de gestoras que contar.</span>`),
      porCampus,
    ].join(''));
  }
  return {
    asunto: `Resumen del día · ${bonita(hoyIso)}${empresas.length > 1 ? ` · ${empresas.length} empresas` : ` · ${empresas[0].nombre}`}`,
    html: envoltorio({
      cabeceraUrl: empresas.length === 1 ? await cabeceraPara(empresas[0].campus) : await cabeceraPara([]),
      preTitulo: 'Resumen del día',
      titulo: `${diaSemana(ahora)[0].toUpperCase()}${diaSemana(ahora).slice(1)}`,
      subtitulo: `${empresas.length > 1 ? `Tus ${empresas.length} empresas, cada una con sus cifras.` : 'Cómo ha ido el día.'} Hoy cuenta <strong>${tramoDeHoy(ahora)}</strong>, y «vs. ayer» lo compara con el día entero de ayer. Ventas y cobrado: los que llevan fecha de hoy.`,
      contenido: partes.join('') + boton('Abrir Reportes', `${base()}${R.informes}`),
    }),
  };
}

// ─── DIRECCIÓN, los lunes: «Reporte semanal», por empresa ────────────────────

export async function correoSemanalDireccion(persona, ahora = new Date()) {
  const empresas = await empresasDe(persona);
  if (!empresas.length) return null;
  const { semana, anterior } = semanas(ahora);
  const partes = [];
  for (const e of empresas) {
    const ids = e.campus.map((c) => c.id);
    const [s, a, cob, cobA, puesto] = await Promise.all([
      informes.overview({ projectIds: ids, ...semana }),
      informes.overview({ projectIds: ids, ...anterior }),
      cobrado({ ...semana, projectIds: ids }),
      cobrado({ ...anterior, projectIds: ids }),
      informes.miPuesto({ userId: persona.id, projectIds: ids, ...semana, esJefe: true }).catch(() => null),
    ]);
    const ls = s.leads || {}; const la = a.leads || {};
    const cs = s.conversions || {}; const ca = a.conversions || {};
    const tasa = n(ls.total) ? Math.round((n(ls.convertido) / n(ls.total)) * 1000) / 10 : 0;
    const tasaA = n(la.total) ? Math.round((n(la.convertido) / n(la.total)) * 1000) / 10 : 0;
    // Por lo cobrado (Diego, 08/10), que es por lo que ordena `miPuesto`.
    const filas = (puesto?.tabla || []).slice(0, 12).map((g) => [
      `${g.puesto}. ${esc(g.nombre || '—')}`, eur(g.cobrado), entero(g.ventas), `${entero(g.tasa)} %`, eur(g.facturado),
    ]);
    partes.push([
      apartado(e.nombre, { logoUrl: e.logoUrl, detalle: e.campus.length > 1 ? `${e.campus.length} campus` : '' }),
      tarjetas([
        { etiqueta: 'Prospectos', valor: entero(ls.total), cmp: comparar(ls.total, la.total) },
        { etiqueta: 'Ventas', valor: entero(cs.total), cmp: comparar(cs.total, ca.total), destaca: true },
        { etiqueta: 'Cobrado', valor: eur(cob), cmp: comparar(cob, cobA) },
        { etiqueta: 'Conversión', valor: `${entero(tasa)} %`, nota: `la anterior ${entero(tasaA)} %` },
      ]),
      filas.length ? `<div style="font-size:13px;font-weight:bold;color:${GRIS};margin:18px 0 0">Ranking de la semana</div>${tabla(['Gestora', 'Cobrado', 'Ventas', 'Conv.', 'Facturado'], filas)}` : '',
    ].join(''));
  }
  return {
    asunto: `Reporte semanal · del ${bonita(semana.from)} al ${bonita(semana.to)}${empresas.length > 1 ? ` · ${empresas.length} empresas` : ` · ${empresas[0].nombre}`}`,
    html: envoltorio({
      cabeceraUrl: empresas.length === 1 ? await cabeceraPara(empresas[0].campus) : await cabeceraPara([]),
      preTitulo: 'Reporte semanal',
      titulo: `Semana del ${bonita(semana.from)} al ${bonita(semana.to)}`,
      subtitulo: `${empresas.length > 1 ? `Tus ${empresas.length} empresas, cada una con sus cifras. ` : ''}Comparada con la semana anterior. El ranking es por lo cobrado, como en «Cómo voy»; prospectos y ventas cuentan como Reportes, y lo cobrado sale de los pagos registrados.`,
      contenido: partes.join('') + boton('Abrir Reportes', `${base()}${R.informes}`),
    }),
  };
}
