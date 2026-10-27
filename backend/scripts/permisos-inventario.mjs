// Regenera docs/PERMISOS.md y el inventario en JSON (#423).
//   npm run permisos:inventario
// No toca la base: solo monta los routers y los recorre.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
const aqui = path.dirname(fileURLToPath(import.meta.url));
const { construirInventario, inventarioEnMarkdown, inventarioEnJson } =
  await import('../src/modules/permissions/inventario/index.js');

const filas = await construirInventario();
const md = path.resolve(aqui, '../../docs/PERMISOS.md');
const json = path.resolve(aqui, '../src/modules/permissions/inventario/inventario.json');
fs.writeFileSync(md, inventarioEnMarkdown(filas));
fs.writeFileSync(json, inventarioEnJson(filas));
const sin = filas.filter((f) => f.guardias?.some((g) => g.tipo === 'sin_regla'));
console.log(`${filas.length} filas → docs/PERMISOS.md e inventario.json${sin.length ? ` · ${sin.length} SIN CLASIFICAR` : ''}`);
process.exit(0);
