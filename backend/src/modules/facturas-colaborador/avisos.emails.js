import { conMoneda, porMoneda } from './moneda.js';
import { despachar, empresaCorta, MARCA_POR_DEFECTO } from './facturas.emails.js';
import {
  correo, parrafo, boton, nota, tarjetas, esc, enlace, T,
} from '../../shared/services/email-plantilla.service.js';

/*
  Facturas de colaboradores (#202) · los correos a la empresa (Diego, 04/11).

    · «Han llegado N facturas»: al correo de facturación de la empresa
      (`invoice_issuers.email`) cuando los colaboradores suben las suyas. Si
      suben varias seguidas, van juntas en un correo (CRM#613 / CRM-ISEIE#348).
    · «Faltan N facturas por pagar»: una vez al día, a la misma dirección, con
      las recibidas y sin pagar, cuánto suman y cuánto llevan esperando.

  Con la plantilla y la marca del campus (norma del 10/10) y detrás del mismo
  interruptor que los demás correos del módulo (FACTURAS_COLABORADOR_CORREOS_ACTIVOS).
*/

// La lista de Facturas de colaboradores en el CRM: en ISEIE, Finanzas vive en /accounting
// (en MultiCRM, /finanzas).
const RUTA_LISTA = 'accounting/facturas-colaboradores';
export const urlDeLaLista = (vista) => enlace(`${RUTA_LISTA}?vista=${vista}`);

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** «2026-10-01» → «octubre 2026». */
const mesDe = (periodo) => `${MESES[Number(String(periodo).slice(5, 7)) - 1]} ${String(periodo).slice(0, 4)}`;
const tz = () => process.env.APP_TIMEZONE || 'Europe/Madrid';
/** «04/11 · 09:42», en hora de Madrid. */
const diaYHora = (d) => {
  const f = new Date(d);
  const dia = f.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', timeZone: tz() });
  const hora = f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz() });
  return `${dia} · ${hora}`;
};
const importeDe = (f) => (f.importe === null || f.importe === undefined ? '—' : conMoneda(f.importe, f.moneda));
/** «1.272,00 € · 300,00 US$»: cada moneda por su lado (247). */
const totalDe = (facturas) => porMoneda(facturas, { total: (f) => f.importe })
  .map((s) => conMoneda(s.total, s.moneda)).join(' · ') || '—';
const plural = (n, una, varias) => (n === 1 ? una : varias);

/** Una tabla sencilla, en <table> y con el estilo en cada celda (Outlook). */
function tabla(cabeceras, filas) {
  const celda = 'font-family:' + T.fuente + ';font-size:13px;line-height:18px;padding:8px 6px;vertical-align:top;'
    + `border-bottom:1px solid ${T.borde}`;
  const th = cabeceras.map(([texto, alin = 'left']) => `
      <th align="${alin}" class="tenue" style="${celda};font-size:11px;font-weight:700;letter-spacing:.4px;
          text-transform:uppercase;color:${T.tenue}">${esc(texto)}</th>`).join('');
  const tr = filas.map((celdas) => `
    <tr>${celdas.map(([html, alin = 'left']) => `
      <td align="${alin}" class="txt" style="${celda};color:${T.texto}">${html}</td>`).join('')}
    </tr>`).join('');
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 14px">
    <tr>${th}</tr>${tr}
  </table>`;
}
const pequeno = (html) => `<br><span class="tenue" style="font-size:12px;color:${T.tenue}">${html}</span>`;

/** Varias direcciones en el campo de la empresa («a@x.com, b@x.com»): una por destinatario. */
export function destinatariosDe(email) {
  return String(email || '').split(/[,;\s]+/).map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
    .map((e) => ({ email: e }));
}

/**
 * «Han llegado 3 facturas de colaboradores». Con una sola, el asunto es el del
 * comprobante de CRM#613: «Factura recibida · Laura Pérez · octubre 2026 · REC-…».
 */
export function armarLlegadas({ empresa, facturas, marca = null, adjuntas = 0 }) {
  const n = facturas.length;
  const corta = empresaCorta(empresa.razon_social);
  const una = facturas[0];
  const asunto = n === 1
    ? ['Factura recibida', una.colaborador_nombre, mesDe(una.periodo), una.numero_recepcion].filter(Boolean).join(' · ')
    : `Han llegado ${n} facturas de colaboradores · ${corta}`;
  const titulo = n === 1 ? 'Ha llegado 1 factura de colaborador' : `Han llegado ${n} facturas de colaboradores`;
  const total = totalDe(facturas);

  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo,
    resumen: `${n} ${plural(n, 'factura', 'facturas')} para ${corta} · ${total}`,
    bloques: [
      parrafo(`${n === 1 ? 'Un colaborador ha subido su factura' : 'Los colaboradores han subido sus facturas'} para <strong>${esc(empresa.razon_social)}</strong>.`),
      tabla(
        [['Colaborador'], ['Mes'], ['Importe', 'right'], ['Recibida']],
        facturas.map((f) => [
          [`<strong>${esc(f.colaborador_nombre)}</strong>${f.numero_factura ? pequeno(`Factura ${esc(f.numero_factura)}`) : ''}`],
          [esc(mesDe(f.periodo))],
          [`<span style="white-space:nowrap">${esc(importeDe(f))}</span>`, 'right'],
          [`${esc(f.numero_recepcion || '')}${f.subida_at ? pequeno(esc(diaYHora(f.subida_at))) : ''}`],
        ]),
      ),
      nota(`Total: <strong>${esc(total)}</strong>${adjuntas ? `<br>Van adjuntas ${adjuntas === n ? (n === 1 ? 'la copia' : 'las copias') : `${adjuntas} de las ${n} copias (las demás, en el CRM)`}.` : ''}`),
      boton({ texto: n === 1 ? 'Ver la factura en el CRM' : 'Ver las facturas en el CRM', url: urlDeLaLista('enviadas') }),
    ],
  });
  return { asunto, htmlContent, textContent, fromName: `${corta} · Facturación` };
}

/**
 * Manda el aviso de llegada. La clave lleva las facturas que van dentro: un
 * reintento con las mismas no lo repite.
 */
export async function enviarLlegadas({ empresa, facturas, marca = null, para, adjuntos = [] }) {
  const c = armarLlegadas({ empresa, facturas, marca, adjuntas: adjuntos.length });
  return despachar({
    projectId: marca?.id ?? null,
    to: para, subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName,
    attachment: adjuntos.length ? adjuntos : undefined,
    tags: ['facturas-colaborador', 'aviso-empresa'],
    clave: `facturas-colaborador-aviso-empresa-${empresa.id}-${facturas.map((f) => f.id).join('-')}`.slice(0, 200),
  });
}

/** «Faltan 4 facturas de colaboradores por pagar»: cuántas, cuánto y desde cuándo. */
export function armarPorPagar({ empresa, facturas, marca = null }) {
  const n = facturas.length;
  const corta = empresaCorta(empresa.razon_social);
  const total = totalDe(facturas);
  const masVieja = Math.max(...facturas.map((f) => Number(f.dias) || 0));
  const dias = (d) => (d === 0 ? 'hoy' : `${d} ${plural(d, 'día', 'días')}`);
  const asunto = n === 1
    ? `Falta 1 factura de colaborador por pagar · ${corta}`
    : `Faltan ${n} facturas de colaboradores por pagar · ${corta}`;

  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo: n === 1 ? 'Falta 1 factura por pagar' : `Faltan ${n} facturas por pagar`,
    resumen: `${n} ${plural(n, 'factura', 'facturas')} de colaboradores sin pagar en ${corta} · ${total}`,
    bloques: [
      parrafo(`Estas facturas de colaboradores de <strong>${esc(empresa.razon_social)}</strong> están recibidas y todavía sin pagar.`),
      tarjetas([
        { etiqueta: 'Por pagar', valor: String(n) },
        { etiqueta: 'Total', valor: total },
        { etiqueta: 'La más antigua', valor: masVieja === 0 ? 'Hoy' : `${masVieja} ${plural(masVieja, 'día', 'días')}` },
      ]),
      tabla(
        [['Colaborador'], ['Mes'], ['Importe', 'right'], ['Esperando', 'right']],
        facturas.map((f) => [
          [`<strong>${esc(f.colaborador_nombre)}</strong>${f.numero_recepcion ? pequeno(esc(f.numero_recepcion)) : ''}`],
          [esc(mesDe(f.periodo))],
          [`<span style="white-space:nowrap">${esc(importeDe(f))}</span>`, 'right'],
          [`<span style="white-space:nowrap">${esc(dias(Number(f.dias) || 0))}</span>`, 'right'],
        ]),
      ),
      boton({ texto: 'Ir a «Por pagar»', url: urlDeLaLista('por_pagar') }),
      parrafo(`<span class="tenue" style="color:${T.tenue};font-size:12px">Este resumen sale cada mañana mientras quede alguna por pagar.</span>`),
    ],
  });
  return { asunto, htmlContent, textContent, fromName: `${corta} · Facturación` };
}

/** Manda el resumen del día. La clave lleva el día: uno por empresa y día. */
export async function enviarPorPagar({ empresa, facturas, marca = null, para, dia }) {
  const c = armarPorPagar({ empresa, facturas, marca });
  return despachar({
    projectId: marca?.id ?? null,
    to: para, subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName,
    tags: ['facturas-colaborador', 'por-pagar'],
    clave: `facturas-colaborador-por-pagar-${empresa.id}-${dia}`,
  });
}

const FORMAS_PAGO = { transferencia: 'Transferencia', bizum: 'Bizum', paypal: 'PayPal', efectivo: 'Efectivo', otro: 'Otra' };
/** «2026-11-03» → «03/11/2026». */
const fechaCorta = (dia) => (dia ? `${String(dia).slice(8, 10)}/${String(dia).slice(5, 7)}/${String(dia).slice(0, 4)}` : '—');

/**
 * «El colaborador dice que no ha recibido el pago» (Diego, 04/11): al correo de
 * facturación de la empresa, en cuanto pulsa «No lo he recibido» en el correo de
 * «Factura pagada». Con la factura, el pago (fecha, forma y referencia) y lo que
 * haya escrito.
 */
export function armarNoRecibido({ empresa, f, comentario = null, marca = null }) {
  const corta = empresaCorta(empresa.razon_social);
  const asunto = `${f.colaborador_nombre} dice que no ha recibido el pago · ${mesDe(f.periodo)} · ${corta}`;
  const { htmlContent, textContent } = correo({
    proyecto: marca || MARCA_POR_DEFECTO,
    titulo: 'Un colaborador dice que no ha recibido el pago',
    resumen: `${f.colaborador_nombre} · ${importeDe(f)} · pago del ${fechaCorta(f.pagada_at)}`,
    bloques: [
      parrafo(`<strong>${esc(f.colaborador_nombre)}</strong> ha pulsado «No lo he recibido» en el correo de «Factura pagada» de <strong>${esc(empresa.razon_social)}</strong>.`),
      nota([
        `Factura: <strong>${esc(f.numero_factura || '—')}</strong>${f.numero_recepcion ? ` · ${esc(f.numero_recepcion)}` : ''}`,
        `Mes: <strong>${esc(mesDe(f.periodo))}</strong>`,
        `Importe: <strong>${esc(importeDe(f))}</strong>`,
        `Pago: <strong>${esc(FORMAS_PAGO[f.forma_pago] || 'Pago')} del ${esc(fechaCorta(f.pagada_at))}</strong>`,
        f.referencia_pago ? `Referencia del pago: <strong>${esc(f.referencia_pago)}</strong>` : null,
      ].filter(Boolean).join('<br>')),
      comentario ? parrafo(`Lo que dice: «${esc(comentario)}»`) : parrafo('No ha dejado ningún comentario.'),
      boton({ texto: 'Ver la factura en el CRM', url: urlDeLaLista('pagadas') }),
      parrafo(`<span class="tenue" style="color:${T.tenue};font-size:12px">Si después confirma que lo ha recibido, lo verás en la lista como «Pago confirmado por el colaborador».</span>`),
    ],
  });
  return { asunto, htmlContent, textContent, fromName: `${corta} · Facturación` };
}

/** Manda el aviso. La clave lleva la vez que se pagó: uno por pago. */
export async function enviarNoRecibido({ empresa, f, comentario = null, marca = null, para, vez = 1 }) {
  const c = armarNoRecibido({ empresa, f, comentario, marca });
  return despachar({
    projectId: marca?.id ?? null,
    to: para, subject: c.asunto, htmlContent: c.htmlContent, textContent: c.textContent,
    fromName: c.fromName,
    tags: ['facturas-colaborador', 'pago-no-recibido'],
    clave: `facturas-colaborador-no-recibido-${f.id}-${vez}`,
  });
}
