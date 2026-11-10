import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { buscar, limpiar, partirColumna } from '../src/shared/utils/limpiarEntidades.js';

/*
  Limpiar de la base los nombres guardados con la entidad HTML (#234), contra Postgres.

  Se crea una tabla propia, con un nombre que no choca con nada, y se borra al acabar:
  la prueba no toca ninguna tabla del CRM.
*/

const T = `prueba_entidades_${Date.now()}`;
let cli;

beforeAll(async () => {
  cli = await pool.connect();
  await cli.query(`CREATE TABLE ${T} (id serial PRIMARY KEY, nombre text, cuerpo_html text, unico varchar(80) UNIQUE, cantidad int)`);
}, 60000);

afterAll(async () => {
  await cli.query(`DROP TABLE IF EXISTS ${T}`);
  cli.release();
  await pool.end();
}, 60000);

const poner = async (filas) => {
  await cli.query(`DELETE FROM ${T}`);
  for (const [n, h, u] of filas) await cli.query(`INSERT INTO ${T} (nombre, cuerpo_html, unico) VALUES ($1, $2, $3)`, [n, h, u]);
};
const nombres = async () => (await cli.query(`SELECT nombre FROM ${T} ORDER BY id`)).rows.map((r) => r.nombre);
const mias = (hallazgos) => hallazgos.filter((h) => h.tabla === T);

describe('buscar: solo mira', () => {
  it('dice en qué columnas hay entidades, cuántas filas y qué quedaría', async () => {
    await poner([['Coaching &amp; Liderazgo', '<p>a &amp; b</p>', null], ['Sin nada', null, null], ['Curso &#8211; Online', null, null]]);
    const h = mias(await buscar(cli));
    expect(h.find((x) => x.columna === 'nombre')).toMatchObject({ filas: 2 });
    expect(h.find((x) => x.columna === 'cuerpo_html')).toMatchObject({ filas: 1 });
    expect(h.find((x) => x.columna === 'nombre').queda).toMatch(/^(Coaching & Liderazgo|Curso – Online)$/);
    // No ha cambiado nada, y una columna que no es de texto ni aparece.
    expect(await nombres()).toEqual(['Coaching &amp; Liderazgo', 'Sin nada', 'Curso &#8211; Online']);
    expect(h.find((x) => x.columna === 'cantidad')).toBeUndefined();
  });

  it('una base sin entidades no da ningún hallazgo de la tabla', async () => {
    await poner([['Limpio', 'texto', null], ['Otro & otro', null, null]]);
    expect(mias(await buscar(cli))).toEqual([]);
  });

  it('un «&» suelto o sin punto y coma no es una entidad', async () => {
    await poner([['Marti & Asociados', null, null], ['AT&T y R&D', null, null], ['a &amp b', null, null]]);
    expect(mias(await buscar(cli))).toEqual([]);
  });
});

describe('limpiar: solo lo que se nombra', () => {
  it('decodifica la columna pedida y NO toca la otra (el cuerpo HTML se queda como está)', async () => {
    await poner([['Coaching &amp; Liderazgo', '<p>a &amp; b</p>', null], ['Limpio', null, null]]);
    const r = await limpiar(cli, [`${T}.nombre`]);
    expect(await nombres()).toEqual(['Coaching & Liderazgo', 'Limpio']);
    expect((await cli.query(`SELECT cuerpo_html FROM ${T} ORDER BY id LIMIT 1`)).rows[0].cuerpo_html).toBe('<p>a &amp; b</p>');
    expect(r.porColumna).toEqual({ [`${T}.nombre`]: 1 });
    expect(r.cambios).toEqual([{ tabla: T, columna: 'nombre', antes: 'Coaching &amp; Liderazgo', despues: 'Coaching & Liderazgo' }]);
  });

  it('una sola pasada: «&amp;lt;» da «&lt;», no «<»', async () => {
    await poner([['A &amp;lt; B', null, null]]);
    await limpiar(cli, [`${T}.nombre`]);
    expect(await nombres()).toEqual(['A &lt; B']);
  });

  it('segunda pasada: no queda nada que cambiar', async () => {
    await poner([['X &amp; Y', null, null]]);
    await limpiar(cli, [`${T}.nombre`]);
    expect((await limpiar(cli, [`${T}.nombre`])).cambios).toEqual([]);
  });

  it('si dos nombres acaban iguales y chocan con un único, NO se cambia nada y se dice cuál', async () => {
    await poner([['a', null, 'M &amp; M'], ['b', null, 'M & M']]);
    await expect(limpiar(cli, [`${T}.nombre`, `${T}.unico`])).rejects.toThrow(/M &amp; M.*no se puede guardar.*No se ha cambiado nada/s);
    expect((await cli.query(`SELECT unico FROM ${T} ORDER BY id`)).rows.map((r) => r.unico)).toEqual(['M &amp; M', 'M & M']);
  });

  it('la copia de lo de antes se entrega antes de confirmar; si no se puede guardar, NO se cambia nada', async () => {
    await poner([['X &amp; Y', null, null], ['Z &amp; W', null, null]]);
    let recibido;
    await limpiar(cli, [`${T}.nombre`], { guardarCopia: (c) => { recibido = c; } });
    expect(recibido.map((c) => c.antes)).toEqual(['X &amp; Y', 'Z &amp; W']);
    await poner([['X &amp; Y', null, null]]);
    await expect(limpiar(cli, [`${T}.nombre`], { guardarCopia: () => { throw new Error('disco lleno'); } })).rejects.toThrow('disco lleno');
    expect(await nombres()).toEqual(['X &amp; Y']);
  });

  it('bloquea las filas al leerlas, ANTES de escribir: otra conexión no puede cambiarlas entre medias', async () => {
    await poner([['Curso &amp; A', null, null]]);
    const otra = await pool.connect();
    const intentos = [];
    // Un cliente que, justo antes de cada UPDATE, intenta desde otra conexión coger la misma fila.
    const espia = {
      query: async (sql, params) => {
        if (/^s*UPDATE/.test(sql)) {
          await otra.query('BEGIN');
          intentos.push(await otra.query(`SELECT 1 FROM ${T} FOR UPDATE NOWAIT`).then(() => 'libre', (e) => e.code));
          await otra.query('ROLLBACK');
        }
        return cli.query(sql, params);
      },
    };
    try {
      await limpiar(espia, [`${T}.nombre`]);
      expect(intentos).toEqual(['55P03']); // lock_not_available: la fila ya estaba cogida
    } finally { otra.release(); }
  });

  it('una columna que no existe o no es de texto es un error ANTES de tocar nada', async () => {
    await poner([['X &amp; Y', null, null]]);
    await expect(limpiar(cli, [`${T}.nombre`, `${T}.no_existe`])).rejects.toThrow(/No es una columna de texto/);
    await expect(limpiar(cli, [`${T}.cantidad`])).rejects.toThrow(/No es una columna de texto/);
    await expect(limpiar(cli, ['con espacios.mal'])).rejects.toThrow(/formato raro/);
    expect(await nombres()).toEqual(['X &amp; Y']);
  });
});

describe('partirColumna', () => {
  it('tabla.columna, y nada que se pueda colar en el SQL', () => {
    expect(partirColumna('products.nombre')).toEqual({ tabla: 'products', columna: 'nombre' });
    expect(partirColumna('products')).toBeNull();
    expect(partirColumna('a.b; DROP TABLE x')).toBeNull();
    expect(partirColumna('a."b"')).toBeNull();
  });
});
