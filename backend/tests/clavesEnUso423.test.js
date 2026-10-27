import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EN_USO_ANTES } from '../src/modules/permissions/inventario/en-uso-antes.js';
import { POR_CLAVE } from '../src/modules/permissions/catalogo.js';

/**
 * #423, QA de Diego (22/10) · punto 5: «la 239 no archiva ninguna clave en
 * uso». La lista de claves que ya hacían algo vive en `en-uso-antes.js`; la 239
 * la lleva copiada en SQL. Esto exige que sean la misma y que cada clave exista
 * en el catálogo (si no, lo guardado sobre ella no querría decir nada).
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.resolve(aqui, '../migrations/239_permisos_casillas_a_excepciones.sql'), 'utf8');

describe('claves en uso antes de #423 (punto 5)', () => {
  it('la 239 deja quietas exactamente las de en-uso-antes.js', () => {
    const bloque = SQL.slice(SQL.indexOf('INSERT INTO _aplicadas VALUES'), SQL.indexOf(';', SQL.indexOf('INSERT INTO _aplicadas VALUES')));
    const enLaMigracion = [...bloque.matchAll(/\('([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(enLaMigracion).toEqual([...EN_USO_ANTES].sort());
  });

  it('todas existen en el catálogo', () => {
    const claves = Object.keys(POR_CLAVE);
    const faltan = EN_USO_ANTES.filter((p) => !(p.endsWith('.%') ? claves.some((k) => k.startsWith(p.slice(0, -1))) : claves.includes(p)));
    expect(faltan).toEqual([]);
  });

  it('el frontal de staging no miraba ninguna otra (las de can() del 22/10)', () => {
    // Las de `can('…')` de frontend/src en staging del 22/10, sin las de Tareas,
    // facturas de colaboradores ni diplomas (ya en EN_EL_SERVIDOR) y sin
    // `leads.reassign`, que no existió nunca.
    const deLaPantalla = ['clients.create', 'clients.delete', 'clients.export', 'conversions.edit', 'conversions.sin_gestora',
      'leads.assign', 'leads.create', 'leads.delete', 'leads.edit', 'leads.export', 'products.create', 'products.delete',
      'products.edit', 'woocommerce.sync'];
    const casa = (p, k) => (p.endsWith('.%') ? k.startsWith(p.slice(0, -1)) : p === k);
    expect(deLaPantalla.filter((k) => !EN_USO_ANTES.some((p) => casa(p, k)))).toEqual([]);
  });
});
