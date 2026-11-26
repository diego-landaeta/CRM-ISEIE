import { query, getClient } from '../../shared/config/db.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import * as P from '../../shared/services/email-plantilla.service.js';
import { marcaDeLosCampus, remitenteDe, nombreCortoDeEmpresa } from '../../shared/services/marca.service.js';
import { comisiones, resumenComisiones } from './tutor.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';

/**
 * «Avisar al tutor»: el correo mensual de facturación, desde Comisiones.
 * CRM#165 y su gemela CRM-ISEIE#188. El mismo fichero en los dos CRM.
 *
 * Diego, 25/11/2026:
 *
 *     «En Comisiones, botón "Avisar al tutor" que le manda el correo de
 *      facturación (con la plantilla P.correo y la marca del campus, como todos
 *      los correos), con el detalle de lo que se le debe y lo que tiene que
 *      facturar. Queda anotado quién y cuándo lo mandó, y avisa si ya se le
 *      mandó ese mes. Permiso del catálogo.»
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DONDE SALE CADA NUMERO
 *
 * De `comisiones()` y `resumenComisiones()`, las MISMAS que pinta el panel y con
 * el MISMO recorte (el campus o la empresa elegidos, dentro de los de quien lo
 * manda). Si el correo dijera una cifra y la pantalla otra no habría forma de
 * saber cuál vale, y la que se queda el tutor es la del correo (#187).
 *
 * Se manda lo que SE LE DEBE del mes —lo que no está pagado ni revertido—, no
 * todo lo generado: es por lo que tiene que facturar. Antes se leían solo las
 * líneas en `pendiente`, y un segundo aviso (ya en `notificada`) salía sin
 * ninguna formación.
 *
 * A QUIÉN FACTURA
 *
 * Cada campus es de una empresa (`projects.sociedad_emisora_id`), y el tutor
 * factura a la empresa, no al campus. Si en el mes cobró de campus de dos
 * empresas, son dos facturas: el correo lleva una cuenta y unos datos fiscales
 * por empresa. Antes llevaba los de CEDIA escritos a mano para todos.
 *
 * LA MARCA
 *
 * La regla de todos los correos (`marcaDeLosCampus`): un campus, el suyo; varios
 * de una empresa, la empresa; si mezclan empresas, la del CRM.
 *
 * LA CUENTA VA DENTRO
 *
 * Decirle «mándame tu factura + IVA − retención» sin darle el número es lo que
 * provoca las facturas mal hechas. El redondeo es POR LÍNEA: con 17,82 el IVA es
 * 3,7422 y la retención 2,673; redondeando al final el total se va un céntimo.
 * El 15 % es una suposición (hay quien aplica el 7 %): el aviso sale siempre.
 */

/** Los dos porcentajes, en un solo sitio. */
export const IVA_PCT = 21;
export const RETENCION_PCT = 15;

/** Hasta dónde se deja escribir en la nota y en el asunto (lo valida también Zod). */
export const MAX_NOTA = 2000;
export const MAX_ASUNTO = 200;

const eur = (v) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
  .format(Number(v) || 0);

const dosDecimales = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;

const tz = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/** «12/11/2026 a las 10:20», en hora de Madrid. */
export function cuandoEnLetra(fecha) {
  const f = new Date(fecha);
  if (Number.isNaN(f.getTime())) return '';
  const dia = f.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: tz() });
  const hora = f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
  return `${dia} a las ${hora}`;
}

/** Comisión + IVA − retención, redondeando CADA LÍNEA. */
export function cuentaAFacturar(comision) {
  const base = dosDecimales(comision);
  const iva = dosDecimales(base * (IVA_PCT / 100));
  const retencion = dosDecimales(base * (RETENCION_PCT / 100));
  return { base, iva, retencion, total: dosDecimales(base + iva - retencion) };
}

/** Varias cuentas (una por empresa), sumadas línea a línea: el total es lo que suman las facturas. */
export function sumarCuentas(cuentas = []) {
  const s = (k) => dosDecimales(cuentas.reduce((a, c) => a + Number(c[k] || 0), 0));
  return { base: s('base'), iva: s('iva'), retencion: s('retencion'), total: s('total') };
}

/** «2026-08» → «agosto de 2026». */
export function mesEnLetra(periodo) {
  const [a, m] = String(periodo || '').split('-');
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const nombre = nombres[Number(m) - 1];
  return nombre ? `${nombre} de ${a}` : String(periodo || '');
}

/** Lo que se le debe: ni pagado ni revertido (lo mismo que suma «Por pagar»). */
export const seLeDebe = (l) => l.estado !== 'pagada' && l.estado !== 'revertida';

/** Los datos fiscales están para imprimirse: sin NIF, o con el marcador de la 102, no. */
export function datosFiscalesCompletos(e) {
  const nif = String(e?.nif || '').trim();
  return Boolean(e?.razon_social && nif && !/^PENDIENTE/i.test(nif) && e?.direccion);
}

/**
 * Las líneas que se le deben, agrupadas por la empresa a la que factura.
 *
 * `empresas`: una fila por campus con su empresa (`empresasDeLosCampus`). Una
 * línea sin campus, o de un campus sin empresa, va en un grupo sin empresa: el
 * correo le dice que pregunte antes de facturar, en vez de inventarse a quién.
 */
export function agruparPorEmpresa(lineas = [], empresas = []) {
  const porCampus = new Map(empresas.map((e) => [Number(e.project_id), e]));
  const grupos = new Map();
  for (const l of lineas.filter(seLeDebe)) {
    const e = porCampus.get(Number(l.project_id)) || null;
    const clave = e?.issuer_id ? `e${e.issuer_id}` : 'sin';
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        empresa: e?.issuer_id ? {
          id: Number(e.issuer_id),
          nombre: nombreCortoDeEmpresa(e),
          razon_social: e.razon_social,
          nif: e.nif,
          direccion: e.direccion,
          cp: e.cp,
          ciudad: e.ciudad,
          pais: e.pais,
          email: e.email,
        } : null,
        campus: [], formaciones: [], comisiones: [], base: 0,
      });
    }
    const g = grupos.get(clave);
    if (l.proyecto && !g.campus.includes(l.proyecto)) g.campus.push(l.proyecto);
    // Sin repetir: si cobró tres veces del mismo curso, necesita saber de qué
    // curso viene, no verlo tres veces.
    if (l.formacion && !g.formaciones.includes(l.formacion)) g.formaciones.push(l.formacion);
    g.comisiones.push(Number(l.id));
    g.base += Number(l.importe) || 0;
  }
  // Primero lo que más pesa: es la factura que más le importa.
  return [...grupos.values()]
    .map(({ base, ...g }) => ({ ...g, cuenta: cuentaAFacturar(base) }))
    .sort((a, b) => b.cuenta.base - a.cuenta.base);
}

/** La empresa de cada campus, con sus datos fiscales. */
export async function empresasDeLosCampus(projectIds = []) {
  const ids = [...new Set(projectIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT p.id AS project_id, i.id AS issuer_id, i.razon_social, i.alias, i.nif,
            i.direccion, i.cp, i.ciudad, i.pais, i.email
       FROM projects p
       LEFT JOIN invoice_issuers i ON i.id = p.sociedad_emisora_id
      WHERE p.id = ANY($1::int[])`,
    [ids],
  );
  return rows;
}

/** Los avisos que ya se le mandaron de ese mes, el último primero. */
export async function avisosDelMes({ tutorId, periodo }) {
  const { rows } = await query(
    `SELECT a.id, a.enviado_at, a.email, a.total, u.nombre AS enviado_por
       FROM tutor_avisos_comisiones a
       LEFT JOIN users u ON u.id = a.enviado_por
      WHERE a.tutor_id = $1 AND a.periodo = $2
      ORDER BY a.enviado_at DESC`,
    [tutorId, periodo],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    enviadoAt: r.enviado_at,
    enviadoPor: r.enviado_por || null,
    email: r.email || null,
    total: r.total === null || r.total === undefined ? null : Number(r.total),
  }));
}

/** Lo que va a salir en el correo, sin mandarlo. Es lo que pinta la vista previa. */
export async function datosDelAviso({ tutorId, periodo, projectId = null, projectIds = null }) {
  const ambito = { periodo, tutorId, projectId, projectIds };
  const resumen = (await resumenComisiones(ambito))
    .find((r) => Number(r.tutor_id) === Number(tutorId));
  if (!resumen) throw new AppError('Ese tutor no tiene comisiones en ese mes.', 404, 'SIN_COMISIONES');
  if (!resumen.tutor_email) {
    throw new AppError(`${resumen.tutor} no tiene correo en su ficha.`, 400, 'SIN_CORREO');
  }
  const pendiente = dosDecimales(resumen.pendiente);
  if (pendiente <= 0) {
    throw new AppError('No hay nada pendiente que reclamar en ese mes.', 400, 'NADA_PENDIENTE');
  }

  const lineas = (await comisiones(ambito)).filter(seLeDebe);
  const campusIds = [...new Set(lineas.map((l) => Number(l.project_id)).filter(Boolean))];
  const [empresas, marca, avisos] = await Promise.all([
    empresasDeLosCampus(campusIds),
    marcaDeLosCampus(campusIds),
    avisosDelMes({ tutorId, periodo }),
  ]);
  const grupos = agruparPorEmpresa(lineas, empresas);

  return {
    tutorId: Number(tutorId),
    nombre: resumen.tutor,
    email: resumen.tutor_email,
    tieneIban: Boolean(resumen.tutor_iban),
    periodo,
    mes: mesEnLetra(periodo),
    pendiente,
    formaciones: [...new Set(lineas.map((l) => l.formacion).filter(Boolean))],
    grupos,
    cuenta: sumarCuentas(grupos.map((g) => g.cuenta)),
    comisiones: lineas.map((l) => Number(l.id)),
    campus: campusIds,
    marca: marca ? { id: marca.id ?? null, nombre: marca.nombre || null, slug: marca.slug || null,
      logo_url: marca.logo_url || null, emoji: marca.emoji || null } : null,
    avisos,
  };
}

/**
 * La cuenta, con aspecto de factura: el tutor copia estas cuatro líneas en la
 * suya. Tabla con estilos en línea, que es lo único que se ve igual en Gmail y
 * en Outlook; los colores, los del CRM (`P.T`).
 */
export function tablaDeLaCuenta({ base, iva, retencion, total }) {
  const celda = `padding:9px 14px;font-family:${P.T.fuente};font-size:14px;line-height:20px`;
  const fila = (rotulo, valor, o = {}) => `<tr${o.fondo ? ` style="background-color:${o.fondo}"` : ''}>`
    + `<td class="txt linea" style="${celda};border-top:1px solid ${P.T.borde};color:${o.color || P.T.texto}">`
    + `${o.fuerte ? `<strong>${rotulo}</strong>` : rotulo}</td>`
    + `<td class="txt linea" align="right" style="${celda};border-top:1px solid ${P.T.borde};text-align:right;white-space:nowrap;`
    + `color:${o.color || P.T.texto}">`
    + `${o.fuerte ? `<strong>${valor}</strong>` : valor}</td></tr>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="border-collapse:collapse;margin:0 0 10px;max-width:440px;border:1px solid ${P.T.borde};border-radius:${P.T.radio.md}">
    <tr style="background-color:${P.T.suaveFondo}">
      <th align="left" class="tenue" style="${celda};font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:${P.T.tenue};font-weight:700">Concepto</th>
      <th align="right" class="tenue" style="${celda};font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:${P.T.tenue};font-weight:700">Importe</th>
    </tr>
    ${fila('Comisión del mes', eur(base))}
    ${fila(`IVA ${IVA_PCT} %`, `+ ${eur(iva)}`)}
    ${fila(`Retención IRPF ${RETENCION_PCT} %`, `− ${eur(retencion)}`)}
    ${fila('Total a facturar', eur(total), { fuerte: true, fondo: P.T.suaveFondo })}
  </table>`;
}

/** La misma cuenta en líneas «concepto: importe», para la versión en texto plano. */
const cuentaEnTexto = ({ base, iva, retencion, total }) => P.parrafo([
  `Comisión del mes: ${eur(base)}`,
  `IVA ${IVA_PCT} %: + ${eur(iva)}`,
  `Retención IRPF ${RETENCION_PCT} %: − ${eur(retencion)}`,
  `Total a facturar: ${eur(total)}`,
].join('<br>'));

const lista = (items) => `<ul class="txt" style="font-family:${P.T.fuente};font-size:14px;line-height:22px;color:${P.T.texto};margin:0 0 14px;padding-left:20px">${
  items.map((f) => `<li style="margin:0 0 2px">${P.esc(f)}</li>`).join('')}</ul>`;

/** Los datos para la factura, o la advertencia de que faltan. */
function datosDeLaEmpresa(e) {
  if (!e) {
    return P.nota('Una parte de estas comisiones no tiene empresa asignada en el CRM. '
      + '<strong>Contesta a este correo antes de hacer la factura</strong> y te decimos a nombre de quién va.');
  }
  if (!datosFiscalesCompletos(e)) {
    return P.nota(`Factura a nombre de <strong>${P.esc(e.razon_social)}</strong>. Sus datos fiscales no están completos `
      + 'en el CRM: <strong>contesta a este correo</strong> y te los mandamos antes de que hagas la factura.');
  }
  const lugar = [e.cp, e.ciudad].filter(Boolean).join(' ');
  return P.nota([
    `Factura a nombre de <strong>${P.esc(e.razon_social)}</strong>`,
    `NIF: ${P.esc(e.nif)}`,
    [e.direccion, lugar, e.pais].filter(Boolean).map(P.esc).join(' · '),
  ].join('<br>'));
}

/**
 * El asunto por defecto. Lleva la marca: un tutor que da clase en dos campus
 * tiene que saber de cuál le escriben sin abrirlo.
 */
export const asuntoDe = (datos) => `Tus comisiones de ${datos.mes}${datos.marca?.nombre ? ` · ${datos.marca.nombre}` : ''}`;

/**
 * Arma el correo con la plantilla común (`P.correo`) y la marca de su campus.
 * Sin base y sin red: es una función, y así se puede ver el correo exacto sin
 * mandarlo ni sembrar nada.
 *
 * `nota`: lo que quien lo manda quiera añadirle (una devolución, algo que
 * explicarle). Va escapada y en su recuadro: es texto, no HTML, y no puede
 * tocar ni la cuenta ni a quién va.
 */
export function componerCorreo({ datos, asunto = null, nota = null }) {
  const varias = datos.grupos.length > 1;
  const notaLimpia = String(nota || '').trim().slice(0, MAX_NOTA);

  const bloques = (enTexto) => [
    P.parrafo(`Durante <strong>${P.esc(datos.mes)}</strong> has generado <strong>${eur(datos.pendiente)}</strong> en comisiones`
      + `${varias ? ` con ${datos.grupos.length} empresas, así que son <strong>${datos.grupos.length} facturas</strong>, una para cada una` : ''}.`),
    ...datos.grupos.flatMap((g) => [
      varias ? P.seccion(g.empresa ? `Factura a ${g.empresa.nombre}` : 'Sin empresa asignada') : null,
      g.formaciones.length ? P.parrafo(g.formaciones.length === 1 ? 'De la formación:' : 'De las formaciones:') : null,
      g.formaciones.length ? (enTexto ? P.parrafo(g.formaciones.map((x) => `- ${P.esc(x)}`).join('<br>')) : lista(g.formaciones)) : null,
      enTexto ? cuentaEnTexto(g.cuenta) : tablaDeLaCuenta(g.cuenta),
      datosDeLaEmpresa(g.empresa),
    ]),
    varias ? P.parrafo(`En total, <strong>${eur(datos.cuenta.total)}</strong> entre las ${datos.grupos.length} facturas.`) : null,
    P.parrafo('Contesta a este mismo correo con tu factura <strong>+ IVA − retención</strong>.'),
    datos.tieneIban ? null
      : P.nota('<strong>Envíanos tu IBAN</strong> si no nos lo has dado todavía: sin él no se te puede pagar.'),
    notaLimpia ? P.nota(P.esc(notaLimpia).replace(/\r?\n/g, '<br>')) : null,
    P.parrafo(`<span class="tenue" style="font-size:12px;color:${P.T.tenue}">La comisión lleva IVA (${IVA_PCT} %). `
      + `La retención de IRPF es orientativa: cada profesional aplica la suya, y el ${RETENCION_PCT} % es la más común.</span>`),
    P.parrafo('Muchas gracias.'),
  ];

  const comun = {
    proyecto: datos.marca || {},
    titulo: `Tus comisiones de ${datos.mes}`,
    saludo: primerNombre(datos.nombre),
    resumen: `${eur(datos.cuenta.total)} a facturar · ${datos.mes}`,
    pie: `Te lo manda el equipo de facturación${datos.marca?.nombre ? ` de <strong class="txt">${P.esc(datos.marca.nombre)}</strong>` : ''}. `
      + 'Para cualquier duda, contesta a este correo.',
  };
  const { htmlContent } = P.correo({ ...comun, bloques: bloques(false) });
  // El texto plano sale del mismo correo, con la cuenta en líneas «concepto:
  // importe» en vez de en celdas (que en texto quedarían pegadas).
  const { textContent } = P.correo({ ...comun, bloques: bloques(true) });

  const a = String(asunto || '').trim().slice(0, MAX_ASUNTO);
  return { asunto: a || asuntoDe(datos), html: htmlContent, texto: textContent };
}

export async function previsualizar({ tutorId, periodo, projectId = null, projectIds = null }) {
  const datos = await datosDelAviso({ tutorId, periodo, projectId, projectIds });
  return { ...datos, ...componerCorreo({ datos }) };
}

/**
 * ¿Se puede mandar? Si ya se le mandó el de ese mes, solo con `repetir`: un
 * tutor que perdió el correo necesita que se le vuelva a mandar, pero mandarlo
 * dos veces sin querer es pedirle dos facturas.
 */
export function comprobarRepetido(datos, repetir) {
  const ultimo = datos.avisos?.[0];
  if (!ultimo || repetir) return;
  throw new AppError(
    `Ya se le mandó el aviso de ${datos.mes} el ${cuandoEnLetra(ultimo.enviadoAt)}`
      + `${ultimo.enviadoPor ? ` (${ultimo.enviadoPor})` : ''}. Confírmalo para mandarlo otra vez.`,
    409, 'YA_AVISADO');
}

/**
 * El buzón de facturación del que sale y al que contesta el tutor con su
 * factura. Por orden:
 *
 *   1. `AVISO_TUTOR_FROM`, si está en el `.env`.
 *   2. El correo de la empresa (`invoice_issuers.email`), si factura a una sola.
 *      En CEDIA es `facturacion@cediaidsl.com`, el de siempre (migración 161),
 *      y así sigue saliendo por su buzón cuando lo tiene (`correo-buzon`).
 *   3. Nada: sale con el remitente de la marca, como cualquier otro correo.
 *
 * Tiene que estar verificado en Brevo. Si no lo está, `sendEmail` lo reintenta
 * por la cuenta del CRM: llega igual, con otro remitente.
 */
export function buzonDeFacturacion(datos) {
  const propio = String(process.env.AVISO_TUTOR_FROM || '').trim();
  if (propio) return propio;
  const correos = [...new Set(datos.grupos
    .map((g) => String(g.empresa?.email || '').trim().toLowerCase())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
  return correos.length === 1 ? correos[0] : undefined;
}

/** Deja anotado quién lo mandó y cuándo, y mueve sus líneas a «notificada». */
export async function anotarAviso({ datos, userId, asunto, brevoMsgId = null }) {
  const cliente = await getClient();
  try {
    await cliente.query('BEGIN');
    const { rows: [fila] } = await cliente.query(
      `INSERT INTO tutor_avisos_comisiones
         (tutor_id, periodo, enviado_por, email, pendiente, total, asunto, project_ids, comisiones, brevo_msg_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int[], $9::int[], $10)
       RETURNING id, enviado_at`,
      [datos.tutorId, datos.periodo, userId || null, datos.email, datos.pendiente, datos.cuenta.total,
        asunto, datos.campus, datos.comisiones, brevoMsgId],
    );
    // El estado dice POR DÓNDE VA el trámite; `avisado_at`, CUÁNDO. Avisar no es
    // cobrar: `notificada` sigue contando en «Por pagar». Solo las líneas que
    // iban en el correo, no las de otros campus que no se le reclamaron.
    await cliente.query(
      `UPDATE tutor_commissions
          SET estado = CASE WHEN estado = 'pendiente' THEN 'notificada' ELSE estado END,
              avisado_at = $2, avisado_por = $3, updated_at = NOW()
        WHERE id = ANY($1::int[]) AND estado NOT IN ('pagada', 'revertida')`,
      [datos.comisiones, fila.enviado_at, userId || null],
    );
    await cliente.query('COMMIT');
    return fila;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
}

/**
 * Manda el correo y deja anotado cuándo y quién.
 *
 * El destinatario sale SIEMPRE del tutor, en el servidor: de fuera solo se
 * acepta el asunto y una nota. Por eso esto no sirve para mandar un correo
 * cualquiera a cualquiera.
 */
export async function avisar({
  tutorId, periodo, userId, projectId = null, projectIds = null, asunto = null, nota = null, repetir = false,
}) {
  const datos = await datosDelAviso({ tutorId, periodo, projectId, projectIds });
  comprobarRepetido(datos, repetir);
  const correo = componerCorreo({ datos, asunto, nota });

  // El freno de los correos a tutores (15/09). Se corta aquí, después de
  // calcular, para que la vista previa siga funcionando.
  if (NO_ESCRIBIR_A_TUTORES) {
    throw new AppError(
      'Los correos a tutores están parados. Puedes ver la vista previa, pero no se envía nada hasta que Diego lo levante.',
      423, 'CORREOS_A_TUTORES_PARADOS');
  }

  // Sale como todos los correos: por la cuenta y con el nombre de su marca
  // (`remitenteDe`), y desde el buzón de facturación si lo hay.
  // Sin `clave` a propósito: con ella `sendEmail` no dejaría reenviarlo; el
  // «ya se le mandó» lo decide `comprobarRepetido`, con confirmación.
  const { projectId: cuentaDe, fromName } = remitenteDe(datos.marca);
  const buzon = buzonDeFacturacion(datos);
  const r = await sendEmail({
    to: { email: datos.email, name: datos.nombre },
    subject: correo.asunto,
    htmlContent: correo.html,
    textContent: correo.texto,
    tags: ['aviso-tutor'],
    projectId: cuentaDe,
    fromEmail: buzon,
    fromName: process.env.AVISO_TUTOR_FROM_NAME || (fromName ? `${fromName} · Facturación` : 'Facturación'),
    // Le pide que CONTESTE con su factura: la respuesta tiene que caer en el
    // buzón de facturación, no en el «no responder» de la marca.
    replyTo: buzon,
  });

  if (!r?.sent) {
    // Cada motivo con sus palabras: se arreglan en sitios distintos.
    const porque = {
      FRENO_DE_PRUEBAS: `Fuera de producción solo salen correos a la lista blanca, y ${datos.email} no está en ella. Se añade en EMAIL_LISTA_BLANCA.`,
      NO_API_KEY: 'No hay clave de Brevo configurada en este entorno.',
      YA_ENVIADO: 'Brevo lo tiene por repetido.',
    }[r?.reason] || r?.motivo || r?.detalle
      || 'Brevo no lo aceptó. Lo primero que hay que mirar es si el remitente está verificado allí: sin verificar, no sale y no avisa.';
    throw new AppError(porque, 502, r?.reason || 'NO_ENVIADO');
  }

  const fila = await anotarAviso({ datos, userId, asunto: correo.asunto, brevoMsgId: r.messageId || null });
  return {
    enviado: true,
    a: datos.email,
    total: datos.cuenta.total,
    avisadoAt: fila?.enviado_at || null,
    repetido: datos.avisos.length > 0,
  };
}
