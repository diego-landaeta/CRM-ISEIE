import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSIONES, ACTUAL } from '../src/modules/novedades/versiones.js';

/**
 * v3.0.1 · cada novedad con «recorrido» apunta a un recorrido que EXISTE en el
 * frontal, y lleva su pantalla («ruta»): sin ella no sale ni «Ir a…» ni
 * «Ver recorrido». Un id mal escrito daría un botón que no abre nada.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(aqui, '../../frontend/src/shared/lib');
const idsDelFrontal = new Set(
  fs.readdirSync(lib)
    .filter((f) => /^recorridos.*\.ts$/.test(f))
    .flatMap((f) => [...fs.readFileSync(path.join(lib, f), 'utf8').matchAll(/^\s+id: '([a-z0-9-]+)',/gm)].map((m) => m[1])),
);

const conRecorrido = VERSIONES.flatMap((v) => v.grupos.flatMap((g) => g.items.filter((it) => it.recorrido).map((it) => ({ v: v.version, ...it }))));

describe('Novedades con «Ver recorrido» (3.0.1)', () => {
  it('la actual es la 3.0.1 o posterior', () => {
    expect(ACTUAL.version.localeCompare('3.0.1', undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
  });

  it('hay novedades con recorrido', () => {
    expect(conRecorrido.length).toBeGreaterThan(5);
    expect(idsDelFrontal.size).toBeGreaterThan(20);
  });

  it('cada recorrido existe en el frontal y la novedad trae su pantalla', () => {
    const mal = conRecorrido.filter((it) => !idsDelFrontal.has(it.recorrido) || !it.ruta).map((it) => `${it.v} · ${it.titulo} → ${it.recorrido}`);
    expect(mal).toEqual([]);
  });
});
