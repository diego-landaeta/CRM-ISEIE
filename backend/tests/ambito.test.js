import test from 'node:test';
import assert from 'node:assert/strict';
import { proyectosDelAmbito, comoLista, SIN_PRUEBAS } from '../src/shared/utils/ambito.js';

/*
  El ámbito de una consulta: un proyecto, una sociedad entera, o todo.

  Se prueba porque de esto cuelgan ya Reportes, Ventas y Tutores, y un fallo
  aquí NO SE VE: no rompe nada, solo hace que una pantalla enseñe de más o de
  menos. Es justo lo que costó encontrar cuando el «Resumen del periodo» daba
  las cifras de los nueve proyectos con el título de CEDIA puesto.

  Va con el corredor que trae Node —`node --test`— y no con vitest: el backend
  no tiene vitest instalado en ningún entorno, así que un test de vitest aquí
  sería un test que nadie puede ejecutar.

  `proyectosDelAmbito` se prueba contra la base de verdad, que es donde vive lo
  que puede fallar: solo lee.

    cd backend && node --test tests/ambito.test.js
*/

test('comoLista · un proyecto suelto se convierte en lista de uno', () => {
  assert.deepEqual(comoLista(7, null), [7]);
});

test('comoLista · la lista manda sobre el proyecto suelto', () => {
  // Con una sociedad elegida llegan las dos cosas; gana la sociedad.
  assert.deepEqual(comoLista(7, [1, 2, 3]), [1, 2, 3]);
});

test('comoLista · sin nada devuelve null, que significa «todo»', () => {
  assert.equal(comoLista(null, null), null);
  assert.equal(comoLista(null, []), null);
});

test('comoLista · los ids llegan como número aunque vengan de la URL', () => {
  // De `req.query` llegan cadenas, y `= ANY($1::int[])` con textos revienta.
  assert.deepEqual(comoLista(null, ['4', '9']), [4, 9]);
  assert.deepEqual(comoLista('7', null), [7]);
});

test('SIN_PRUEBAS · excluye los proyectos marcados de pruebas', () => {
  assert.match(SIN_PRUEBAS(), /es_prueba/);
  assert.match(SIN_PRUEBAS(), /project_id NOT IN/);
  // En unas consultas la columna es `c.project_id` y en otras `l.project_id`.
  assert.match(SIN_PRUEBAS('c.project_id'), /c\.project_id NOT IN/);
});

test('proyectosDelAmbito · sin issuerId, pasa el proyecto tal cual', async () => {
  assert.deepEqual(await proyectosDelAmbito({ query: { projectId: '7' } }),
    { projectId: 7, projectIds: null });
});

test('proyectosDelAmbito · sin nada, es «todos»', async () => {
  assert.deepEqual(await proyectosDelAmbito({ query: {} }),
    { projectId: null, projectIds: null });
});

test('proyectosDelAmbito · una sociedad se traduce a sus campus', async () => {
  const { query } = await import('../src/shared/config/db.js');
  const { rows } = await query(
    `SELECT sociedad_emisora_id AS id, count(*)::int n FROM projects
      WHERE sociedad_emisora_id IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 1`);
  if (!rows.length) return; // Sin sociedades configuradas no hay nada que probar.
  const { id, n } = rows[0];

  const r = await proyectosDelAmbito({ query: { issuerId: String(id), projectId: '7' } });
  assert.equal(r.projectIds.length, n);
  // El proyecto se descarta: lo que se pidió fue la sociedad entera.
  assert.equal(r.projectId, null);
});

test('proyectosDelAmbito · una sociedad SIN campus no puede significar «todos»', async () => {
  // Es el fallo peligroso: devolver null aquí enseñaría el CRM entero justo
  // cuando se pidió acotar. Se devuelve una lista que no casa con nada.
  const r = await proyectosDelAmbito({ query: { issuerId: '999999' } });
  assert.deepEqual(r.projectIds, [-1]);
  assert.notEqual(r.projectIds, null);
});
