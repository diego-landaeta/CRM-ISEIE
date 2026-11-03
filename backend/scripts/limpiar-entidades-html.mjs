// Busca (y, si se pide, limpia) los textos guardados con la entidad HTML dentro: «Coaching &amp; Liderazgo».
//
//   node scripts/limpiar-entidades-html.mjs
//       SOLO MIRA. Dice en qué columnas hay entidades, cuántas filas y un ejemplo.
//
//   node scripts/limpiar-entidades-html.mjs --aplicar --columnas products.nombre,product_categories.nombre
//       ESCRIBE, solo en esas columnas y en una transacción: o todas o ninguna.
//       Deja en `limpieza-entidades-AAAA-MM-DD.json` el valor de antes de cada fila, por si hay que deshacerlo.
//
// Para #234 (nombres de curso con «&amp;» guardados antes del arreglo del import).
// Usa DATABASE_URL del entorno (.env); contra un servidor de verdad lo lanza quien tiene
// acceso a él, DESPUÉS de hacer una copia (pg_dump). Elegir las columnas es decisión de quien
// lo lanza: hay columnas donde la entidad es lo correcto (el cuerpo HTML de un correo).
import 'dotenv/config';
import fs from 'node:fs';
import pg from 'pg';
import { buscar, limpiar } from '../src/shared/utils/limpiarEntidades.js';
import { decodificarEntidades } from '../src/shared/utils/entidadesHtml.js';

const args = process.argv.slice(2);
const aplicar = args.includes('--aplicar');
const iColumnas = args.indexOf('--columnas');
const columnas = iColumnas >= 0 ? String(args[iColumnas + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : [];

if (!process.env.DATABASE_URL) {
  console.error('\n  Falta DATABASE_URL (en el entorno o en backend/.env).\n');
  process.exit(1);
}
if (aplicar && !columnas.length) {
  console.error('\n  --aplicar necesita --columnas tabla.columna[,tabla.columna…]: se limpia lo que se nombra, nada más.');
  console.error('  Primero lanza el script sin --aplicar para ver dónde hay entidades.\n');
  process.exit(1);
}

/** Un trozo del texto alrededor de la primera entidad, en una línea: los cuerpos de correo ocupan páginas. */
const recorte = (texto) => {
  const t = String(texto ?? '');
  const i = t.search(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/);
  const desde = Math.max(0, i - 25);
  return `${desde ? '…' : ''}${t.slice(desde, desde + 60).replace(/\s+/g, ' ').trim()}`;
};

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
try {
  const donde = new URL(process.env.DATABASE_URL);
  console.log(`\n  Base: ${donde.hostname}:${donde.port || 5432}${donde.pathname}\n`);

  if (!aplicar) {
    const hallazgos = await buscar(cli);
    if (!hallazgos.length) {
      console.log('  Ninguna columna de texto tiene entidades HTML. No hay nada que limpiar.\n');
    } else {
      console.log('  Columnas con entidades (no se ha cambiado nada):\n');
      for (const h of hallazgos) {
        console.log(`  ${`${h.tabla}.${h.columna}`.padEnd(44)} ${String(h.filas).padStart(6)} filas   «${recorte(h.ejemplo)}» → «${recorte(decodificarEntidades(recorte(h.ejemplo)))}»`);
      }
      console.log('\n  Para limpiar unas columnas:  --aplicar --columnas tabla.columna[,tabla.columna…]');
      console.log('  Ojo con las de cuerpos HTML (plantillas de correo, mensajes): ahí la entidad es correcta.\n');
    }
  } else {
    const fichero = `limpieza-entidades-${new Date().toISOString().slice(0, 10)}.json`;
    // La copia se escribe ANTES de confirmar: si no se puede guardar, no se cambia nada.
    const { porColumna } = await limpiar(cli, columnas, { guardarCopia: (cambios) => fs.writeFileSync(fichero, JSON.stringify(cambios, null, 2)) });
    for (const [col, n] of Object.entries(porColumna)) console.log(`  ${col.padEnd(44)} ${String(n).padStart(6)} filas limpiadas`);
    console.log(`\n  Hecho en una transacción. Los valores de antes están en ${fichero}.\n`);
  }
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await cli.end();
}
