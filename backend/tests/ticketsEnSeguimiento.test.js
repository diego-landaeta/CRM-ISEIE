import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cambiarEstadoSchema, listarSchema, ESTADO } from '../src/modules/soporte/soporte.validation.js';

/**
 * Soporte: estados «En proceso» (in_review) y «En seguimiento» (follow_up)
 * (Diego, 24/11/2026). La migración amplía el CHECK de la tabla, la validación
 * los acepta y la pantalla los nombra.
 */
const aqui = path.dirname(fileURLToPath(import.meta.url));
const lib = fs.readFileSync(path.resolve(aqui, '../../frontend/src/modules/soporte/lib/tickets.ts'), 'utf8');
const mig = fs.readdirSync(path.resolve(aqui, '../migrations')).find((f) => f.endsWith('_tickets_en_seguimiento.sql'));

describe('tickets en seguimiento', () => {
  it('la validación acepta «follow_up» al cambiar de estado y al filtrar', () => {
    expect(ESTADO).toContain('follow_up');
    expect(cambiarEstadoSchema.safeParse({ status: 'follow_up' }).success).toBe(true);
    expect(listarSchema.safeParse({ estado: 'follow_up' }).success).toBe(true);
    expect(cambiarEstadoSchema.safeParse({ status: 'seguimiento' }).success).toBe(false);
  });

  it('la pantalla dice «En proceso» y «En seguimiento»', () => {
    expect(lib).toMatch(/in_review:\s*\{ label: 'En proceso'/);
    expect(lib).toMatch(/follow_up:\s*\{ label: 'En seguimiento'/);
  });

  it('hay migración que amplía el CHECK de la tabla', () => {
    expect(mig).toBeTruthy();
    const sql = fs.readFileSync(path.resolve(aqui, '../migrations', mig), 'utf8');
    expect(sql).toMatch(/'follow_up'/);
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS tickets_estado_check/);
  });
});
