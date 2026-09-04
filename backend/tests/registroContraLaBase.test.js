import { describe, it, expect } from 'vitest';
import { listar, NOMBRES_FUENTE, tablasQueHay } from '../src/modules/registro/registro.model.js';

/**
 * Las seis consultas del registro, contra la BASE DE VERDAD (#111).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE ESTE FICHERO
 *
 * `registro.test.js` simula la base, y por eso se le colo esto:
 *
 *     SELECT ... w.nombre AS webhook FROM make_webhook_deliveries d
 *                LEFT JOIN make_webhooks w ...
 *
 * La columna se llama `label` desde la migracion 063. En los dos CRMs. La
 * consulta reventaba entera, y como cada fuente se lee dentro de su propio
 * `try`, la pantalla enseñaba «Webhooks» en los filtros y devolvia cero filas.
 *
 * Cero filas es exactamente lo que se espera ver un dia tranquilo. Por eso no
 * lo vio nadie — ni yo, que la escribi y la probe: mire la pantalla, habia cero
 * webhooks, y me parecio bien.
 *
 * Una prueba con la base simulada NUNCA va a coger un nombre de columna. Esta
 * ejecuta las consultas contra el esquema real, que es la unica forma.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * SIN BASE, ESTO NO PRUEBA NADA — Y HAY QUE DECIRLO
 *
 * Al escribir este fichero paso justo lo que viene a vigilar: con la base
 * apagada, `tablasQueHay()` no encuentra ninguna tabla, no se ejecuta ninguna
 * consulta, `fallaron` sale vacio y las cinco comprobaciones pasaban en verde.
 * Una prueba que aprueba cuando no puede comprobar nada es peor que no tenerla.
 *
 * Asi que lo primero es exigir la base. Si falta, se dice como levantarla en vez
 * de dejar pasar el resto.
 */
describe('la base tiene que estar', () => {
  it('se ve el esquema, o esto no vale', async () => {
    const hay = await tablasQueHay();
    expect(
      hay.size,
      'sin base no se comprueba nada. Levantala: docker compose up -d'
    ).toBeGreaterThan(0);
  });
});

describe('las consultas se ejecutan contra el esquema real', () => {
  it('ninguna fuente falla al leerse', async () => {
    expect((await tablasQueHay()).size, 'sin base').toBeGreaterThan(0);
    // `fallaron` es la lista de las que reventaron. Vacia o no hay registro.
    const r = await listar({ vista: 'todos', limite: 5 });
    expect(r.fallaron, `fuentes que no se pudieron leer: ${r.fallaron.join(', ')}`).toEqual([]);
  });

  it('y se prueban TODAS, no solo las que hoy tienen filas', async () => {
    // Si una fuente se cayera del catalogo por un descuido, la de arriba
    // pasaria sin haberla mirado.
    const hay = await tablasQueHay();
    const r = await listar({ vista: 'todos', limite: 5 });
    expect(r.fuentes.sort()).toEqual(NOMBRES_FUENTE.filter((f) => hay.has(f)).sort());
  });

  it('una por una, para que el fallo diga cual', async () => {
    // Con todas juntas, `fallaron` dice el nombre pero no el error. Asi cada
    // una tiene su linea en la salida.
    for (const f of NOMBRES_FUENTE) {
      const hay = await tablasQueHay();
      if (!hay.has(f)) continue;
      const r = await listar({ vista: 'todos', fuentes: [f], limite: 5 });
      expect(r.fallaron, `la fuente «${f}» no se pudo leer`).toEqual([]);
    }
  });

  it('con filtros puestos tampoco: son otras consultas', async () => {
    // Las condiciones se arman aparte, asi que un fallo puede aparecer solo con
    // filtro. Se prueban las combinaciones que cambian el SQL.
    const casos = [
      { desde: '2020-01-01' },
      { hasta: '2030-01-01' },
      { desde: '2020-01-01', hasta: '2030-01-01' },
      { usuarioId: 1 },
    ];
    for (const filtros of casos) {
      const r = await listar({ vista: 'todos', limite: 5, ...filtros });
      expect(r.fallaron, `fallo con ${JSON.stringify(filtros)}`).toEqual([]);
    }
  });
});

describe('lo que devuelve tiene la forma que la pantalla espera', () => {
  it('cada fila trae lo que se pinta', async () => {
    const r = await listar({ vista: 'todos', limite: 20 });
    for (const fila of r.filas) {
      expect(fila, `fila de ${fila.fuente}`).toMatchObject({
        id: expect.any(String),
        fuente: expect.any(String),
        resumen: expect.any(String),
        ok: expect.any(Boolean),
      });
      expect(fila.cuando).toBeTruthy();
      expect(new Date(fila.cuando).toString()).not.toBe('Invalid Date');
    }
  });
});
