import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/**
 * El PDF de las novedades de una versión (Diego, 28/09: «manda un pdf con todo
 * lo que se hizo»).
 *
 * Con pdf-lib, la misma librería que las facturas, y no con Chrome: en el
 * servidor de MultiCRM el Chrome de puppeteer no arranca. Se maqueta a mano:
 * portada con la marca del CRM, índice, cada grupo con sus novedades —y dónde
 * está cada una en el CRM— y los arreglos al final. Pie con la página.
 *
 * Helvetica solo sabe escribir los caracteres de Windows-1252 (las tildes, la
 * ñ, «», ¿, ¡ y — sí; la flecha → no): `seguro()` cambia la flecha por › y
 * quita lo que no pueda escribir, en vez de dejar que pdf-lib reviente.
 */

const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 52;
const UTIL = ANCHO - MARGEN * 2;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function fechaLarga(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return a && m && d ? `${d} de ${MESES[m - 1]} de ${a}` : String(iso || '');
}

function color(hex) {
  const n = parseInt(String(hex || '#1f4e79').slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function pdfDeVersion(v, { crm, baseUrl }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Novedades ${crm.nombre} · versión ${v.version}`);
  doc.setAuthor(crm.nombre);
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const acento = color(crm.color);
  const tinta = rgb(0.11, 0.15, 0.19);
  const gris = rgb(0.36, 0.40, 0.45);
  const blanco = rgb(1, 1, 1);

  const conocidos = new Map();
  const seguro = (fuente, texto) => [...String(texto ?? '').replace(/→/g, '›')].map((ch) => {
    const k = `${fuente === negrita ? 'b' : 'n'}${ch}`;
    if (!conocidos.has(k)) {
      try { fuente.encodeText(ch); conocidos.set(k, ch); } catch { conocidos.set(k, ''); }
    }
    return conocidos.get(k);
  }).join('');

  let pagina;
  let y;
  const nueva = () => {
    pagina = doc.addPage([ANCHO, ALTO]);
    // Una tira del color del CRM arriba, para que cada hoja se reconozca suelta.
    pagina.drawRectangle({ x: 0, y: ALTO - 6, width: ANCHO, height: 6, color: acento });
    y = ALTO - MARGEN;
  };
  const hueco = (alto) => { if (y - alto < MARGEN + 24) nueva(); };

  /** Escribe un párrafo partido en líneas; salta de página si no cabe. */
  function parrafo(texto, { fuente = normal, tam = 10.5, tinte = tinta, x = MARGEN, ancho = UTIL, interlinea = 1.38, despues = 6 } = {}) {
    const palabras = seguro(fuente, texto).split(/\s+/).filter(Boolean);
    const lineas = [];
    let actual = '';
    for (const p of palabras) {
      const prueba = actual ? `${actual} ${p}` : p;
      if (fuente.widthOfTextAtSize(prueba, tam) <= ancho || !actual) actual = prueba;
      else { lineas.push(actual); actual = p; }
    }
    if (actual) lineas.push(actual);
    const alto = tam * interlinea;
    for (const l of lineas) {
      hueco(alto);
      pagina.drawText(l, { x, y: y - tam, size: tam, font: fuente, color: tinte });
      y -= alto;
    }
    y -= despues;
  }

  // ── Portada ────────────────────────────────────────────────────────────
  pagina = doc.addPage([ANCHO, ALTO]);
  pagina.drawRectangle({ x: 0, y: ALTO - 190, width: ANCHO, height: 190, color: acento });
  pagina.drawText(seguro(negrita, crm.nombre.toUpperCase()), { x: MARGEN, y: ALTO - 70, size: 11, font: negrita, color: blanco });
  pagina.drawText(seguro(negrita, 'Novedades'), { x: MARGEN, y: ALTO - 118, size: 34, font: negrita, color: blanco });
  pagina.drawText(seguro(normal, `Versión ${v.version} · ${fechaLarga(v.fecha)}`), { x: MARGEN, y: ALTO - 150, size: 13, font: normal, color: blanco });
  y = ALTO - 230;
  parrafo(v.intro, { tam: 12.5, despues: 18 });

  const total = v.grupos.reduce((s, g) => s + g.items.length, 0);
  parrafo(`${total} novedades en ${v.grupos.length} apartados y ${v.arreglos.length} arreglos.`, { fuente: negrita, tam: 11, tinte: acento, despues: 16 });

  parrafo('Índice', { fuente: negrita, tam: 13, despues: 4 });
  v.grupos.forEach((g, i) => parrafo(`${i + 1}.  ${g.titulo}  (${g.items.length})`, { tam: 11, despues: 1 }));
  parrafo(`${v.grupos.length + 1}.  Arreglos  (${v.arreglos.length})`, { tam: 11, despues: 18 });
  parrafo(`Todo esto se lee también dentro del CRM, en «Novedades», con un botón para ir a cada pantalla: ${baseUrl}/novedades`, { tam: 10, tinte: gris });

  // ── Los grupos ─────────────────────────────────────────────────────────
  v.grupos.forEach((g, i) => {
    nueva();
    parrafo(`${i + 1}. ${g.titulo}`, { fuente: negrita, tam: 17, tinte: acento, despues: 2 });
    pagina.drawLine({ start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y }, thickness: 0.8, color: acento });
    y -= 14;
    for (const it of g.items) {
      hueco(60);
      parrafo(it.titulo, { fuente: negrita, tam: 12, despues: 2 });
      parrafo(it.texto, { tam: 10.5, despues: 3 });
      if (it.ruta) {
        parrafo(`› ${it.boton || 'Abrir'}: ${baseUrl}${it.ruta}`, { tam: 9, tinte: acento, despues: 12 });
      } else {
        y -= 9;
      }
    }
  });

  // ── Arreglos ───────────────────────────────────────────────────────────
  nueva();
  parrafo(`${v.grupos.length + 1}. Arreglos`, { fuente: negrita, tam: 17, tinte: acento, despues: 2 });
  pagina.drawLine({ start: { x: MARGEN, y }, end: { x: ANCHO - MARGEN, y }, thickness: 0.8, color: acento });
  y -= 14;
  for (const a of v.arreglos) {
    hueco(24);
    pagina.drawCircle({ x: MARGEN + 3, y: y - 6.5, size: 1.8, color: acento });
    parrafo(a, { x: MARGEN + 14, ancho: UTIL - 14, tam: 10.5, despues: 5 });
  }

  // ── Pie: el CRM y la página, en todas menos la portada ─────────────────
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    if (i === 0) return;
    const izq = seguro(normal, `${crm.nombre} · Novedades ${v.version}`);
    const der = `Página ${i + 1} de ${paginas.length}`;
    p.drawText(izq, { x: MARGEN, y: 28, size: 8.5, font: normal, color: gris });
    p.drawText(der, { x: ANCHO - MARGEN - normal.widthOfTextAtSize(der, 8.5), y: 28, size: 8.5, font: normal, color: gris });
  });

  return Buffer.from(await doc.save());
}
