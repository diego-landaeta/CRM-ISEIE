#!/usr/bin/env node
/**
 * Cambia UNA línea de texto dentro de un PDF hecho con Chromium («Imprimir →
 * Guardar como PDF»), sin recomponer el documento.
 *
 *   node scripts/cambiar-texto-de-pdf.cjs <entrada.pdf> <salida.pdf> "<texto viejo>" "<texto nuevo>"
 *
 * Nació en el #209: el PDF del proceso comercial llevaba un enlace de Opynio que
 * daba 404, y el original de Carlos no está en el repositorio. Recomponer el PDF
 * desde su `.txt` habría sido adivinar a qué columna va cada viñeta; esto cambia
 * solo la línea que hace falta.
 *
 * CÓMO FUNCIONA. Skia/Chromium dibuja el texto LETRA A LETRA (`<código> Tj`, con un
 * avance `dx 0 Td` entre cada una), con fuentes que son subconjuntos: solo traen
 * las letras que el documento usa, así que no se puede añadir una «v» o un «_» a
 * esa fuente. Por eso se localiza el bloque `BT … ET` cuyo texto, decodificado con
 * la tabla de caracteres de su fuente, es EXACTAMENTE el viejo, y se sustituye por
 * otro en la misma posición, tamaño y estado gráfico, con Helvetica.
 *
 * LO QUE HACE Y NO HACE
 *  · Solo si el texto viejo es UN bloque entero y aparece UNA sola vez; si no, se
 *    niega. Cambiar «una parte» de una línea o varias a la vez no está soportado.
 *  · La línea cambia de tipografía (Helvetica) y no se reajusta su ancho: si el
 *    texto nuevo es más largo, hay que mirar que quepa en su caja.
 *  · No toca enlaces pulsables (anotaciones): si el texto viejo es uno, hay que
 *    cambiar también su `/URI`; el script avisa si la página las tiene.
 *  · Conserva los metadatos (título, Creator, Producer, fechas). La versión del PDF
 *    sube a 1.7 al reescribirse.
 *
 * Probado con el PDF del proceso comercial. Antes de subir el resultado, abrir la
 * página tocada y comparar con el original.
 */
const fs = require('fs');
const path = require('path');

// pdf-lib vive en el backend; se busca ahí aunque el script se lance desde fuera.
const { PDFDocument, PDFName, decodePDFRawStream, PDFDict, PDFRawStream, StandardFonts } = require(
  require.resolve('pdf-lib', { paths: [path.join(__dirname, '..', 'backend')] })
);

/** La tabla «código de glifo → carácter» de una fuente (su `/ToUnicode`). */
function leerToUnicode(txt) {
  const mapa = new Map();
  const aTexto = (s) => { let r = ''; for (let i = 0; i < s.length; i += 4) r += String.fromCharCode(parseInt(s.slice(i, i + 4), 16)); return r; };
  for (const bloque of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloque[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) mapa.set(parseInt(m[1], 16), aTexto(m[2]));
  }
  for (const bloque of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloque[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const a = parseInt(m[1], 16); const b = parseInt(m[2], 16); const base = parseInt(m[3], 16);
      for (let i = a; i <= b; i++) mapa.set(i, String.fromCharCode(base + (i - a)));
    }
  }
  return mapa;
}

const escapar = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

async function main() {
  const [, , entrada, salida, viejo, nuevo] = process.argv;
  if (!entrada || !salida || !viejo || nuevo === undefined) {
    console.error('Uso: node scripts/cambiar-texto-de-pdf.cjs <entrada.pdf> <salida.pdf> "<texto viejo>" "<texto nuevo>"');
    process.exit(2);
  }
  if (/[^\x20-\x7e]/.test(nuevo)) {
    console.error('El texto nuevo lleva caracteres fuera de ASCII; Helvetica estándar no los dibujaría bien. Se niega.');
    process.exit(2);
  }

  // `updateMetadata: false`: que no cambie el Producer ni las fechas del documento.
  const doc = await PDFDocument.load(fs.readFileSync(entrada), { updateMetadata: false });
  const encontrados = [];

  for (const [indice, pagina] of doc.getPages().entries()) {
    const fuentes = pagina.node.Resources().lookup(PDFName.of('Font'), PDFDict);
    const mapas = {};
    for (const clave of fuentes.keys()) {
      const tu = fuentes.lookup(clave, PDFDict).lookup(PDFName.of('ToUnicode'));
      if (tu instanceof PDFRawStream) mapas[clave.decodeText()] = leerToUnicode(Buffer.from(decodePDFRawStream(tu).decode()).toString('latin1'));
    }
    const contenido = Buffer.from(decodePDFRawStream(doc.context.lookup(pagina.node.Contents())).decode()).toString('latin1');
    for (const m of contenido.matchAll(/BT\n([\s\S]*?)\nET/g)) {
      const cuerpo = m[1];
      const fuente = cuerpo.match(/\/(F\d+)\s+([\d.]+)\s+Tf/);
      const matriz = cuerpo.match(/(1 0 0 -1 [-\d.]+ [-\d.]+) Tm/);
      if (!fuente || !matriz || !mapas[fuente[1]]) continue;
      let texto = '';
      for (const g of cuerpo.matchAll(/<([0-9a-fA-F]{4})> Tj/g)) texto += mapas[fuente[1]].get(parseInt(g[1], 16)) ?? '?';
      if (texto === viejo) encontrados.push({ indice, pagina, contenido, ini: m.index, fin: m.index + m[0].length, tam: fuente[2], matriz: matriz[1] });
    }
  }

  if (encontrados.length !== 1) {
    console.error(`Se esperaba EXACTAMENTE un bloque con ese texto y hay ${encontrados.length}. No se toca nada.`);
    process.exit(1);
  }

  const { indice, pagina, contenido, ini, fin, tam, matriz } = encontrados[0];
  if (pagina.node.get(PDFName.of('Annots'))) {
    console.warn(`AVISO: la página ${indice + 1} tiene anotaciones (enlaces pulsables). Si el texto viejo es uno, hay que cambiar también su /URI.`);
  }
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const nombre = pagina.node.newFontDictionary('FTextoCambiado', helvetica.ref).toString().replace('/', '');
  const bloque = `BT\n/${nombre} ${tam} Tf\n${matriz} Tm\n(${escapar(nuevo)}) Tj\nET`;
  const nuevoContenido = contenido.slice(0, ini) + bloque + contenido.slice(fin);
  pagina.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(Buffer.from(nuevoContenido, 'latin1'))));

  fs.writeFileSync(salida, await doc.save({ useObjectStreams: false }));
  console.log(`Página ${indice + 1}: «${viejo}» → «${nuevo}» (${matriz}, ${tam} pt). Guardado en ${salida}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
