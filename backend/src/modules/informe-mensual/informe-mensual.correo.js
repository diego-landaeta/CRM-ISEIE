import * as P from '../../shared/services/email-plantilla.service.js';

/**
 * El correo del mes a la gestoría (#772), con la plantilla y la marca de la
 * empresa, como todos (NORMA 10/10). Lleva lo justo: qué va dentro, las cifras
 * del mes y el informe por equipo. Lo demás está en el ZIP.
 */

const eur = (v) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(v || 0));
const miles = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const megas = (bytes) => `${(Number(bytes) / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;

export const asuntoDelMes = (empresa, periodo) => `Facturas e informe de ventas · ${empresa} · ${periodo}`;

const T = P.T;
const celda = (texto, { derecha = false, fuerte = false } = {}) =>
  `<td class="txt" style="padding:7px 8px;border-bottom:1px solid ${T.borde};font-family:${T.fuente};font-size:13px;
     line-height:18px;color:${T.texto};${derecha ? 'text-align:right;white-space:nowrap;' : ''}${fuerte ? 'font-weight:600;' : ''}">${P.esc(texto)}</td>`;
const cabecera = (texto, derecha = false) =>
  `<th class="tenue" style="padding:0 8px 6px;font-family:${T.fuente};font-size:11px;font-weight:700;letter-spacing:.4px;
     text-transform:uppercase;color:${T.tenue};text-align:${derecha ? 'right' : 'left'}">${P.esc(texto)}</th>`;

/** La tabla por equipo: lo que cabe en un correo. Por comercial va en el Excel. */
function tablaDeEquipos(equipos, total) {
  if (!equipos.length) return P.parrafo('No hay ventas ni cobros de ninguna comercial en el mes.');
  const filas = equipos.map((e) => `<tr>${celda(e.equipo)}${celda(miles(e.ventas), { derecha: true })}${celda(eur(e.cobrado), { derecha: true })}${celda(eur(e.facturado), { derecha: true })}</tr>`).join('');
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 14px">
    <tr>${cabecera('Equipo')}${cabecera('Ventas', true)}${cabecera('Cobrado', true)}${cabecera('Facturado', true)}</tr>
    ${filas}
    <tr>${celda('Total', { fuerte: true })}${celda(miles(total.ventas), { derecha: true, fuerte: true })}${celda(eur(total.cobrado), { derecha: true, fuerte: true })}${celda(eur(total.facturado), { derecha: true, fuerte: true })}</tr>
  </table>`;
}

/**
 * @param {object} c
 * @param {string} c.empresa   nombre corto («CEDIA»)
 * @param {string} c.periodo   «2026-10»
 * @param {string} c.mes       «octubre de 2026»
 * @param {object} c.zip       lo que devuelve `zipDelMes`
 * @param {{ url: string, caduca: Date } | null} c.enlace  null = va adjunto
 * @param {object|null} c.marca
 * @param {string} c.zona
 */
export function correoDelMes({ empresa, mes, zip, enlace, marca, zona = 'Europe/Madrid' }) {
  const r = zip.resumen;
  const inf = zip.informe;
  const caduca = enlace
    ? enlace.caduca.toLocaleString('es-ES', { timeZone: zona, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : null;
  const bloques = [
    P.parrafo(`Os mandamos las facturas emitidas por <strong>${P.esc(empresa)}</strong> en ${P.esc(mes)} y el informe de ventas del mes.`),
    P.tarjetas([
      { etiqueta: 'Facturas emitidas', valor: miles(r.facturas) },
      { etiqueta: 'Rectificativas', valor: miles(r.rectificativas) },
      { etiqueta: 'Total facturado', valor: eur(r.total) },
      { etiqueta: 'Cobrado en el mes', valor: eur(inf.total.cobrado) },
    ]),
    enlace
      ? P.parrafo(`El ZIP pesa ${P.esc(megas(zip.buffer.length))} y no cabe en el correo: se descarga con este enlace, que caduca el ${P.esc(caduca)}.`)
      : P.parrafo(`Va <strong>adjunto</strong>: ${P.esc(zip.nombre)}.`),
    enlace ? P.boton({ texto: 'Descargar las facturas y el informe', url: enlace.url }) : '',
    P.parrafo('Dentro van los PDF de las facturas (las rectificativas en su carpeta), el listado de facturas en Excel y el informe de ventas por equipo y por comercial.'),
    r.anuladas ? P.nota(`${miles(r.anuladas)} ${r.anuladas === 1 ? 'factura del mes está anulada' : 'facturas del mes están anuladas'}: salen en el listado, sin PDF y sin sumar.`) : '',
    r.sinPdf ? P.nota(`${miles(r.sinPdf)} ${r.sinPdf === 1 ? 'factura no lleva' : 'facturas no llevan'} PDF porque no se pudo generar; el listado dice cuál y por qué.`) : '',
    P.seccion('Ventas del mes por equipo'),
    tablaDeEquipos(inf.equipos, inf.total),
    P.nota('Lo cobrado es la suma de los pagos registrados con fecha de cobro dentro del mes; lo facturado, por la fecha de emisión de cada factura, con los abonos restando.'),
  ];
  return P.correo({
    proyecto: marca || { nombre: empresa },
    titulo: `Facturas e informe de ${mes}`,
    resumen: `${miles(r.facturas)} facturas · ${eur(r.total)} · ${enlace ? 'con enlace de descarga' : 'ZIP adjunto'}`,
    bloques,
  });
}
