import { sendEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { conMoneda } from './moneda.js';
import {
  correo, parrafo, boton, nota, esc, enlace,
} from '../../shared/services/email-plantilla.service.js';

/*
  Facturas de colaboradores (#202) · los correos.

  Con la plantilla común del CRM y detrás de un interruptor del .env,
  FACTURAS_COLABORADOR_CORREOS_ACTIVOS, APAGADO por defecto (ficha de Diego,
  07/10): apagado, el CRM arma el correo entero y lo registra, pero no llama a
  Brevo. Lo enciende Diego en producción. Igual que los de tareas de Hugo.

  Los textos, de la «Definición acordada · Diego, 01/10» → «Ideas de formato».
  El aviso de pago, de su «Añadido 01/10 (tarde)» (segunda PR).
*/

/**
 * La marca de la cabecera cuando la empresa no tiene un campus activo con la
 * suya: la de ISEIE, como el resto de correos de este CRM (brevo.service.js,
 * MARCA_CORREOS). En MultiCRM esto quedaba sin marca («CRM»).
 */
export const MARCA_POR_DEFECTO = { nombre: 'ISEIE', slug: 'iseie' };

export const correosActivos = () => {
  const v = String(process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS || '').toLowerCase();
  return v === 'true' || v === '1';
};

/** Todos los correos de facturas de colaboradores salen por aquí. */
export async function despachar({ to, subject, htmlContent, textContent, fromName, attachment, tags, clave, projectId = null }) {
  if (!correosActivos()) {
    logger.info({ to: to[0]?.email, subject, clave },
      'Correo de facturas de colaboradores registrado sin enviar (FACTURAS_COLABORADOR_CORREOS_ACTIVOS apagado)');
    return { sent: false, simulated: true };
  }
  // Con el campus de la marca, Brevo usa su cuenta y su remitente «no contestar».
  return sendEmail({ to, subject, htmlContent, textContent, fromName, attachment, tags, clave, projectId });
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesDe = (periodo) => MESES[Number(periodo.slice(5, 7)) - 1];
const anioDe = (periodo) => periodo.slice(0, 4);

// En la moneda de la factura (247): «1.113,00 €» o «356,03 US$».
const euros = (n, f) => conMoneda(n, f?.moneda);
const tz = () => process.env.APP_TIMEZONE || 'Europe/Madrid';
const diaMes = (d) => new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: tz() });

/** «CEDIA Formación, S.L.» → «CEDIA»: como firma la empresa en el remitente y el asunto. */
export const empresaCorta = (razonSocial) => String(razonSocial || '').trim().split(/[\s,]+/)[0] || 'Facturación';

const CONCEPTOS = {
  desarrollo: 'Servicios de desarrollo web',
  wordpress: 'Servicios de WordPress',
  seo: 'Servicios de SEO',
  contenido: 'Servicios de contenido',
  soporte: 'Servicios de soporte',
  otra: 'Servicios profesionales',
};

/** El concepto que se le sugiere: «Servicios de desarrollo web · septiembre 2026». */
export const conceptoSugerido = (area, periodo) =>
  `${CONCEPTOS[area] || CONCEPTOS.otra} · ${mesDe(periodo)} ${anioDe(periodo)}`;

/** La dirección de la página del enlace. */
export const urlDelEnlace = (token) => enlace(`factura-colaborador/${token}`);

function aNombreDe(e) {
  const lineas = [
    `<strong>${esc(e.razon_social)}</strong>`,
    e.nif ? `NIF ${esc(e.nif)}` : null,
    e.direccion ? esc(e.direccion) : null,
    [e.cp, e.ciudad].filter(Boolean).map(esc).join(' ') || null,
    e.pais ? esc(e.pais) : null,
  ].filter(Boolean);
  return nota(`Factura a nombre de:<br>${lineas.join('<br>')}`);
}

/**
 * El correo del mes y el recordatorio del día 5: lo mismo, cambia el asunto.
 * `f`: la fila con colaborador y empresa (CAMPOS_ENLACE de facturas.model.js).
 */
export function armarCorreoDelMes({ f, token, recordatorio = false, nuevo = false, marca = null }) {
  const mes = mesDe(f.periodo);
  const corta = empresaCorta(f.razon_social);
  const acordado = f.importe_esperado === null || f.importe_esperado === undefined ? null : Number(f.importe_esperado);

  let asunto = recordatorio
    ? `Falta tu factura de ${mes} para ${corta}`
    : `Tu factura de ${mes} para ${corta}`;
  if (!recordatorio && acordado !== null) asunto += ` · ${euros(acordado, f)}`;

  const { htmlContent, textContent } = correo({
    // La misma cabecera con logo que el resumen diario (definición del 01/10).
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo: recordatorio ? `Falta tu factura de ${mes}` : `Tu factura de ${mes}`,
    saludo: f.colaborador_nombre,
    resumen: `Súbela desde tu enlace personal: ${mes} ${anioDe(f.periodo)} · ${corta}`,
    bloques: [
      nuevo ? parrafo('Te mandamos un enlace nuevo para subir esta factura. El anterior ya no sirve.') : null,
      acordado !== null ? parrafo(`Importe acordado: <strong>${esc(euros(acordado, f))}</strong>`) : null,
      aNombreDe({
        razon_social: f.razon_social, nif: f.empresa_nif, direccion: f.direccion,
        cp: f.cp, ciudad: f.ciudad, pais: f.pais,
      }),
      parrafo(`Concepto sugerido: <strong>${esc(conceptoSugerido(f.area, f.periodo))}</strong>`),
      boton({ texto: `Subir mi factura de ${mes}`, url: urlDelEnlace(token) }),
      f.caduca_at ? parrafo(`El enlace es solo tuyo y caduca el ${esc(diaMes(f.caduca_at))}.`) : null,
    ],
  });
  return { asunto, htmlContent, textContent, fromName: `${corta} · Facturación` };
}

/** El acuse, con la copia de la factura adjunta. */
export function armarAcuse({ f, marca = null }) {
  const mes = mesDe(f.periodo);
  const corta = empresaCorta(f.razon_social);
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo: 'Factura recibida',
    saludo: f.colaborador_nombre,
    resumen: `${f.numero_recepcion} · ${mes} ${anioDe(f.periodo)} · ${corta}`,
    bloques: [
      parrafo(`Hemos recibido tu factura de ${esc(mes)} para ${esc(corta)}. Te adjuntamos la copia.`),
      nota([
        `Número de recepción: <strong>${esc(f.numero_recepcion)}</strong>`,
        f.importe !== null && f.importe !== undefined ? `Importe: <strong>${esc(euros(f.importe, f))}</strong>` : null,
        f.numero_factura ? `Número de factura: <strong>${esc(f.numero_factura)}</strong>` : null,
      ].filter(Boolean).join('<br>')),
    ],
  });
  return {
    asunto: `Factura recibida · ${mes} ${anioDe(f.periodo)} · ${corta}`,
    htmlContent, textContent, fromName: `${corta} · Facturación`,
  };
}

// «transferencia del 05/10» (segunda parte, «Aviso al colaborador»).
const FORMAS_PAGO = { transferencia: 'transferencia', bizum: 'Bizum', paypal: 'PayPal', efectivo: 'efectivo', otro: 'pago' };

/**
 * El aviso de pago: «Tu factura de septiembre para CEDIA está pagada ·
 * 636,00 € · transferencia del 05/10» (el ejemplo de Diego, 01/10 tarde).
 */
export function armarAvisoDePago({ f, marca = null }) {
  const mes = mesDe(f.periodo);
  const corta = empresaCorta(f.razon_social);
  // La fecha del pago es un día («2026-10-05»): «05/10», con sus dos cifras, como en el ejemplo.
  const dia = String(f.pagada_at).slice(0, 10);
  const como = `${FORMAS_PAGO[f.forma_pago] || 'pago'} del ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const linea = [`Tu factura de ${mes} para ${corta} está pagada`,
    f.importe !== null && f.importe !== undefined ? euros(f.importe, f) : null, como].filter(Boolean).join(' · ');
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo: 'Factura pagada',
    saludo: f.colaborador_nombre,
    resumen: linea,
    bloques: [
      parrafo(esc(linea) + '.'),
      nota([
        f.numero_factura ? `Tu factura: <strong>${esc(f.numero_factura)}</strong>` : null,
        f.numero_recepcion ? `Número de recepción: <strong>${esc(f.numero_recepcion)}</strong>` : null,
        f.referencia_pago ? `Referencia del pago: <strong>${esc(f.referencia_pago)}</strong>` : null,
      ].filter(Boolean).join('<br>')),
    ],
  });
  return { asunto: linea, htmlContent, textContent, fromName: `${corta} · Facturación` };
}

const para = (f) => [{ email: f.colaborador_email, name: f.colaborador_nombre }];

/**
 * Manda el aviso de pago. La clave lleva la vez que se paga: un reintento no lo
 * repite, y si se deshace y se vuelve a pagar (aunque sea el mismo día) sale otro.
 */
export async function enviarAvisoDePago({ f, vez = 1, marca = null }) {
  const c = armarAvisoDePago({ f, marca });
  return despachar({
    projectId: marca?.id ?? null,
    to: para(f), subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName,
    tags: ['facturas-colaborador', 'pago'],
    clave: `facturas-colaborador-pago-${f.id}-${vez}`,
  });
}

/** Manda el del mes (o el recordatorio, o el enlace nuevo). La clave evita repetirlo. */
export async function enviarCorreoDelMes({ f, token, recordatorio = false, nuevo = false, clave, marca = null }) {
  const c = armarCorreoDelMes({ f, token, recordatorio, nuevo, marca });
  return despachar({
    projectId: marca?.id ?? null,
    to: para(f), subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName, tags: ['facturas-colaborador', recordatorio ? 'recordatorio' : 'enlace-del-mes'], clave,
  });
}

export async function enviarAcuse({ f, archivo, marca = null }) {
  const c = armarAcuse({ f, marca });
  return despachar({
    projectId: marca?.id ?? null,
    to: para(f), subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName,
    attachment: archivo ? [{ name: archivo.nombre, content: archivo.buffer.toString('base64') }] : undefined,
    tags: ['facturas-colaborador', 'acuse'],
    clave: `facturas-colaborador-acuse-${f.id}`,
  });
}
