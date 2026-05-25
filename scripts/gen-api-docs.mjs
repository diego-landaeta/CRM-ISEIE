#!/usr/bin/env node
// Genera docs/03-api-endpoints.md leyendo todos los `router.METHOD(...)`
// del backend. No requiere arrancar la API; analiza estáticamente los routes.
//
// Uso: node scripts/gen-api-docs.mjs

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(__dirname, '../backend/src/modules');
const OUTPUT = path.resolve(__dirname, '../docs/03-api-endpoints.md');

async function walk(dir, files = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, files);
    else if (e.name.endsWith('.routes.js') || e.name === 'index.js') files.push(full);
  }
  return files;
}

function extractRoutes(content, prefix) {
  const routes = [];
  // router.METHOD('path', ..., handler)  o   router.METHOD('path', handler)
  const re = /router\.(get|post|patch|put|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]([^)]*)\)/g;
  let m;
  while ((m = re.exec(content))) {
    const method = m[1].toUpperCase();
    const rawPath = m[2];
    const middlewareBlob = m[3] || '';
    const isAuthOnly = middlewareBlob.includes('verifyToken') && !middlewareBlob.includes('roleGuard');
    let roleGuardMatch = middlewareBlob.match(/roleGuard\s*\(([^)]+)\)/);
    let roles = '';
    if (roleGuardMatch) {
      roles = roleGuardMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).join(', ');
    }
    if (method === 'USE') continue; // router.use(verifyToken) etc.
    routes.push({
      method,
      path: prefix + rawPath,
      roles,
      isPublic: !isAuthOnly && !roleGuardMatch && (middlewareBlob.trim() === '' || middlewareBlob.startsWith(',')),
    });
  }
  return routes;
}

async function findPrefix(indexPath) {
  try {
    const content = await fs.readFile(indexPath, 'utf8');
    const m = content.match(/prefix:\s*['"`]([^'"`]+)['"`]/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function main() {
  const files = await walk(BACKEND_DIR);
  const moduleDirs = new Set(files.map((f) => path.dirname(f)));

  const byModule = {};
  for (const dir of moduleDirs) {
    const indexFile = path.join(dir, 'index.js');
    const prefix = await findPrefix(indexFile);
    if (!prefix) continue;
    const moduleName = path.basename(dir);
    const routesFiles = files.filter((f) => f.startsWith(dir) && f.endsWith('.routes.js'));
    if (routesFiles.length === 0) continue;
    const allRoutes = [];
    for (const rf of routesFiles) {
      const content = await fs.readFile(rf, 'utf8');
      allRoutes.push(...extractRoutes(content, prefix));
    }
    if (allRoutes.length > 0) byModule[moduleName] = { prefix, routes: allRoutes };
  }

  const sortedModules = Object.keys(byModule).sort();
  const lines = [];
  lines.push('# 03 — API endpoints (auto-generado)');
  lines.push('');
  lines.push(`> Generado por \`scripts/gen-api-docs.mjs\` desde el código de \`backend/src/modules\`.`);
  lines.push(`> Última generación: ${new Date().toISOString().slice(0, 10)}.`);
  lines.push('');
  lines.push('Convención: todos los endpoints (excepto los marcados "público") requieren `Authorization: Bearer <accessToken>` en el header.');
  lines.push('');
  lines.push(`Total: **${sortedModules.length}** módulos · **${Object.values(byModule).reduce((s, m) => s + m.routes.length, 0)}** endpoints.`);
  lines.push('');
  lines.push('## Índice');
  lines.push('');
  for (const mod of sortedModules) {
    lines.push(`- [\`${byModule[mod].prefix}\`](#${mod.replace(/[^a-z0-9]/g, '-')}) — ${byModule[mod].routes.length} endpoints`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const mod of sortedModules) {
    const { prefix, routes } = byModule[mod];
    lines.push(`## ${mod}`);
    lines.push('');
    lines.push(`Prefix: \`${prefix}\``);
    lines.push('');
    lines.push('| Método | Path | Roles |');
    lines.push('|---|---|---|');
    routes.forEach((r) => {
      const rolesCol = r.isPublic ? '_público_' : (r.roles ? `\`${r.roles}\`` : 'autenticado');
      lines.push(`| ${r.method} | \`${r.path}\` | ${rolesCol} |`);
    });
    lines.push('');
  }

  await fs.writeFile(OUTPUT, lines.join('\n'));
  console.log(`✓ ${OUTPUT}`);
  console.log(`  ${sortedModules.length} módulos · ${Object.values(byModule).reduce((s, m) => s + m.routes.length, 0)} endpoints`);
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
