import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * «Revertir» (#351, gemela de CRM#624) con la confirmación de datos del alumno (#456), contra la base.
 *
 * #456 apunta en `diploma_confirmaciones` con qué número salió el diploma, pero solo si la
 * fila aún no tiene número. Un diploma revertido vuelve a «Aprobados sin diploma» y sale con
 * OTRO número: si el anulado se quedara apuntado, el nuevo no se apuntaría y su envío no se
 * encontraría. Al revertir se suelta:
 *
 *  · tras soltar el anulado, la nueva emisión apunta su número y su envío se encuentra;
 *  · lo ya enviado no se suelta (un diploma enviado no se revierte);
 *  · `soltarEmisionRevertida` no falla nunca, ni sin número.
 *
 *   npx vitest run tests/certifexRevertirConfirmacion351.test.js
 */

process.env.LOG_LEVEL = 'silent';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const { default: pool } = await import('../src/shared/config/db.js');
const model = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.model.js');
const { soltarEmisionRevertida } = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.puerta.js');

const SQL_308 = fs.readFileSync(path.join(AQUI, '../migrations/308_confirmacion_datos_diploma.sql'), 'utf8');
const MARCA = Date.now().toString(36).toUpperCase().slice(-4).padStart(4, 'X');
const EXP = (n) => `ZPRUE-2026-00000${n}-${MARCA}`;
const MATRICULA = 9_100_000_000 + (Date.now() % 1_000_000);

beforeAll(async () => { await pool.query(SQL_308); });
afterAll(async () => {
  await pool.query('DELETE FROM diploma_confirmaciones WHERE matricula_id IN ($1, $2)', [MATRICULA, MATRICULA + 1]);
  await pool.end();
});

const fila = async (matricula) => (await pool.query(
  'SELECT nexpediente, emitido_at, datos_emision, diploma_enviado_at FROM diploma_confirmaciones WHERE matricula_id = $1', [matricula])).rows[0];

async function confirmada(matricula) {
  await pool.query(
    `INSERT INTO diploma_confirmaciones (matricula_id, centro, estado, caduca_at, nombre_propuesto)
     VALUES ($1, 'ZPRUE', 'confirmado', NOW() + INTERVAL '7 days', 'Marta López Gil')`, [matricula]);
}

describe('revertir con la confirmación del alumno (#456)', () => {
  it('tras soltar el número anulado, la nueva emisión se apunta y su envío se encuentra', async () => {
    await confirmada(MATRICULA);
    expect(await model.registrarEmision(MATRICULA, { nexpediente: EXP(1), datos: { horas: 20 } })).toBeTruthy();
    // Sin soltar, la nueva emisión no se apuntaría (así lo hace #456).
    expect(await model.registrarEmision(MATRICULA, { nexpediente: EXP(2), datos: {} })).toBeNull();

    await soltarEmisionRevertida(EXP(1));
    expect(await fila(MATRICULA)).toMatchObject({ nexpediente: null, emitido_at: null, datos_emision: null });

    expect(await model.registrarEmision(MATRICULA, { nexpediente: EXP(2), datos: { horas: 20 } })).toBeTruthy();
    expect((await fila(MATRICULA)).nexpediente).toBe(EXP(2));
    expect(await model.registrarEnvioDiploma([EXP(2)])).toBe(1);
    expect((await fila(MATRICULA)).diploma_enviado_at).not.toBeNull();
  });

  it('lo ya enviado no se suelta', async () => {
    await confirmada(MATRICULA + 1);
    await model.registrarEmision(MATRICULA + 1, { nexpediente: EXP(3), datos: {} });
    await model.registrarEnvioDiploma([EXP(3)]);
    expect(await model.soltarEmision(EXP(3))).toBe(0);
    expect((await fila(MATRICULA + 1)).nexpediente).toBe(EXP(3));
  });

  it('no falla nunca: sin número, o con uno que no está', async () => {
    await expect(soltarEmisionRevertida(null)).resolves.toBeUndefined();
    await expect(soltarEmisionRevertida(EXP(9))).resolves.toBeUndefined();
  });
});
