import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * «Revertir» (#351): la migración 280 y el registro en el CRM, contra la base.
 *
 *  · la 280 se aplica y se puede pasar otra vez;
 *  · no admite una reversión sin motivo, sin quién o sin campus;
 *  · un número solo se apunta una vez: la segunda no lo duplica ni cambia lo apuntado;
 *  · de varias reversiones de una matrícula (se reemitió y se volvió a revertir), vale la
 *    última; y una sin matrícula no aparece en ninguna;
 *  · sin hora de Certifex, se apunta con la de ahora.
 *
 *   npx vitest run tests/certifexRevertir624Base.test.js
 */

process.env.LOG_LEVEL = 'silent';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');
const model = await import('../src/modules/certifex/certifex.model.js');

const SQL_280 = fs.readFileSync(path.join(AQUI, '../migrations/280_certifex_reversiones.sql'), 'utf8');
// Números y matrículas únicos por ejecución, para no chocar con nada (ni con otra ejecución a la vez).
const MARCA = Date.now().toString(36).toUpperCase().slice(-4).padStart(4, 'X');
const EXP = (n) => `ZPRUE-2026-00000${n}-${MARCA}`;
const MATRICULA = 9_000_000_000 + (Date.now() % 1_000_000);

beforeAll(async () => { await pool.query(SQL_280); });
afterAll(async () => {
  try { await pool.query('DELETE FROM certifex_reversiones WHERE nexpediente LIKE $1', [`ZPRUE-2026-%-${MARCA}`]); } catch { /* sin la tabla */ }
  await pool.end();
});

const base = (extra = {}) => ({
  nexpediente: EXP(1), matriculaId: MATRICULA, centro: 'ZPRUE', alumno: 'Marta López Gil', titulacion: 'Curso en Nutrición',
  motivo: 'Con lo de Moodle', revertidoPor: null, revertidoPorEmail: 'ana@prueba.test', revertidoEn: '2026-11-13T09:30:00.000Z', ...extra,
});

describe('la migración 280', () => {
  it('se puede pasar dos veces más sin error', async () => {
    await pool.query(SQL_280);
    await pool.query(SQL_280);
    expect(await model.tablaReversionesExiste()).toBe(true);
  });

  it('deja la tabla con sus columnas', async () => {
    const { rows } = await pool.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'certifex_reversiones' ORDER BY ordinal_position`);
    expect(rows.map((r) => r.column_name)).toEqual(
      ['id', 'nexpediente', 'matricula_id', 'centro', 'alumno', 'titulacion', 'motivo', 'revertido_por', 'revertido_por_email', 'revertido_en', 'apuntado_en']);
    const obligatorias = rows.filter((r) => r.is_nullable === 'NO').map((r) => r.column_name);
    expect(obligatorias).toEqual(['id', 'nexpediente', 'centro', 'motivo', 'revertido_por_email', 'revertido_en', 'apuntado_en']);
  });

  it('no admite una reversión sin motivo, sin quién o sin campus', async () => {
    await expect(model.apuntarReversion(base({ nexpediente: EXP(9), motivo: '   ' }))).rejects.toThrow(/certifex_reversiones_motivo/);
    await expect(model.apuntarReversion(base({ nexpediente: EXP(9), revertidoPorEmail: null }))).rejects.toThrow(/revertido_por_email/);
    await expect(model.apuntarReversion(base({ nexpediente: EXP(9), centro: null }))).rejects.toThrow(/centro/);
    expect(await model.reversionDe(EXP(9))).toBeNull();
  });
});

describe('el registro', () => {
  it('apunta la reversión con la hora de Certifex', async () => {
    const r = await model.apuntarReversion(base());
    expect(r).toMatchObject({ nueva: true, nexpediente: EXP(1), matriculaId: MATRICULA, centro: 'ZPRUE', motivo: 'Con lo de Moodle', por: 'ana@prueba.test' });
    expect(new Date(r.en).toISOString()).toBe('2026-11-13T09:30:00.000Z');
  });

  it('un número solo se apunta una vez: la segunda no duplica ni cambia lo apuntado', async () => {
    const r = await model.apuntarReversion(base({ motivo: 'otro motivo', revertidoPorEmail: 'pepe@prueba.test' }));
    expect(r).toMatchObject({ nueva: false, motivo: 'Con lo de Moodle', por: 'ana@prueba.test' });
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM certifex_reversiones WHERE nexpediente = $1', [EXP(1)]);
    expect(rows[0].n).toBe(1);
  });

  it('de varias reversiones de una matrícula vale la última; una sin matrícula no sale en ninguna', async () => {
    await model.apuntarReversion(base({ nexpediente: EXP(2), revertidoEn: '2026-11-14T09:30:00.000Z', motivo: 'el segundo' }));
    await model.apuntarReversion(base({ nexpediente: EXP(3), matriculaId: null, revertidoEn: '2026-11-15T09:30:00.000Z' }));
    const m = await model.ultimasReversionesDe([MATRICULA, MATRICULA + 1, 'x']);
    expect([...m.keys()]).toEqual([MATRICULA]);
    expect(m.get(MATRICULA)).toMatchObject({ nexpediente: EXP(2), motivo: 'el segundo' });
    expect(await model.ultimasReversionesDe([])).toEqual(new Map());
  });

  it('sin hora de Certifex, se apunta con la de ahora', async () => {
    const antes = Date.now();
    const r = await model.apuntarReversion(base({ nexpediente: EXP(4), revertidoEn: null }));
    expect(new Date(r.en).getTime()).toBeGreaterThanOrEqual(antes - 60_000);
  });
});
