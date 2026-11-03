import { decodificarEntidades } from './entidadesHtml.js';

/**
 * Limpiar de la base los textos que se guardaron con la entidad HTML dentro (#234).
 *
 * El import de WooCommerce ya decodifica al entrar y el frontal al pintar, pero los
 * nombres guardados antes del arreglo siguen con «&amp;» en la base. Esto los busca
 * y, si se pide, los arregla.
 *
 * DOS PASOS, A PROPÓSITO:
 *   · `buscar` solo LEE: recorre las columnas de texto y dice dónde hay entidades.
 *   · `limpiar` ESCRIBE, y solo en las columnas que se le nombran una a una.
 *
 * No se limpia «todo lo que lo parezca»: hay columnas donde la entidad es lo
 * correcto —el cuerpo HTML de una plantilla de correo, un mensaje formateado—, y
 * decodificarlas las rompería. Quien lanza esto mira el informe y elige.
 *
 * `limpiar` va en UNA transacción: o se cambian todas las filas pedidas o ninguna.
 * Si dos nombres acaban iguales y chocan con un índice único, se deshace todo y se dice cuál.
 *
 * Las filas se BLOQUEAN al leerlas (`FOR UPDATE`): con la aplicación en marcha, nadie puede
 * cambiarlas entre que se leen y se escriben. Sin eso, la fila se localiza por `ctid`, que
 * puede cambiar —o reutilizarse tras un vacuum— y se acabaría pisando OTRA fila.
 *
 * La copia de lo de antes se entrega ANTES de confirmar (`guardarCopia`): si no se puede
 * guardar, se deshace todo. Nada se cambia sin copia.
 *
 * Recibe un cliente de `pg` (algo con `.query`), no la conexión del CRM, para poder
 * usarse desde un script suelto y desde las pruebas.
 */

/** Lo mismo que reconoce `decodificarEntidades`: la entidad entera, con su `&` y su `;`. */
const HAY_ENTIDAD = String.raw`&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});`;

/** Los identificadores de SQL, entre comillas dobles y sin que nada se cuele. */
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** «tabla.columna» → { tabla, columna }; null si no tiene esa forma. */
export function partirColumna(texto) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(String(texto).trim());
  return m ? { tabla: m[1], columna: m[2] } : null;
}

/** Las columnas de texto de las tablas (no vistas) de un esquema. */
async function columnasDeTexto(cli, esquema) {
  const { rows } = await cli.query(
    `SELECT c.table_name AS tabla, c.column_name AS columna
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = $1 AND c.data_type IN ('text', 'character varying', 'character')
      ORDER BY c.table_name, c.ordinal_position`, [esquema]);
  return rows;
}

/**
 * Dónde hay entidades: `[{ tabla, columna, filas, ejemplo, queda }]`, las de más filas primero.
 * `queda` es el ejemplo ya decodificado, para ver de un vistazo qué cambiaría.
 */
export async function buscar(cli, { esquema = 'public' } = {}) {
  const hallazgos = [];
  for (const { tabla, columna } of await columnasDeTexto(cli, esquema)) {
    const t = `${ident(esquema)}.${ident(tabla)}`; const c = ident(columna);
    const { rows: [r] } = await cli.query(
      `SELECT count(*)::int AS filas, min(${c}) AS ejemplo FROM ${t} WHERE ${c} ~ $1`, [HAY_ENTIDAD]);
    if (r.filas > 0) {
      hallazgos.push({ tabla, columna, filas: r.filas, ejemplo: r.ejemplo, queda: decodificarEntidades(r.ejemplo) });
    }
  }
  return hallazgos.sort((a, b) => b.filas - a.filas || `${a.tabla}.${a.columna}`.localeCompare(`${b.tabla}.${b.columna}`));
}

/**
 * Decodifica las columnas pedidas (`['products.nombre', …]`). Devuelve
 * `{ cambios: [{ tabla, columna, antes, despues }], porColumna: { 'tabla.col': n } }`:
 * los valores de antes, para poder deshacerlo. `guardarCopia(cambios)` se llama con ellos
 * justo antes de confirmar; si lanza un error, no se confirma nada.
 *
 * Una columna que no existe o no es de texto es un error ANTES de tocar nada.
 */
export async function limpiar(cli, columnas, { esquema = 'public', guardarCopia = null } = {}) {
  const pedidas = columnas.map((x) => ({ texto: x, ...(partirColumna(x) || {}) }));
  const malas = pedidas.filter((p) => !p.tabla);
  if (malas.length) throw new Error(`Columna con formato raro: ${malas.map((m) => m.texto).join(', ')} (tiene que ser «tabla.columna»)`);
  const validas = new Set((await columnasDeTexto(cli, esquema)).map((c) => `${c.tabla}.${c.columna}`));
  const noEsta = pedidas.filter((p) => !validas.has(`${p.tabla}.${p.columna}`));
  if (noEsta.length) throw new Error(`No es una columna de texto de una tabla: ${noEsta.map((m) => m.texto).join(', ')}`);

  const cambios = []; const porColumna = {};
  await cli.query('BEGIN');
  try {
    for (const { tabla, columna } of pedidas) {
      const t = `${ident(esquema)}.${ident(tabla)}`; const c = ident(columna);
      const { rows } = await cli.query(`SELECT ctid::text AS fila, ${c} AS valor FROM ${t} WHERE ${c} ~ $1 FOR UPDATE`, [HAY_ENTIDAD]);
      let n = 0;
      for (const { fila, valor } of rows) {
        const despues = decodificarEntidades(valor);
        if (despues === valor) continue;
        try {
          await cli.query(`UPDATE ${t} SET ${c} = $1 WHERE ctid = $2::tid`, [despues, fila]);
        } catch (err) {
          throw new Error(`${tabla}.${columna}: «${valor}» → «${despues}» no se puede guardar (${err.message}). No se ha cambiado nada.`);
        }
        cambios.push({ tabla, columna, antes: valor, despues });
        n += 1;
      }
      porColumna[`${tabla}.${columna}`] = n;
    }
    if (guardarCopia) await guardarCopia(cambios);
    await cli.query('COMMIT');
  } catch (err) {
    await cli.query('ROLLBACK');
    throw err;
  }
  return { cambios, porColumna };
}
