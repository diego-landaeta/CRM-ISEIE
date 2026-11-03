import { describe, it, expect, vi } from 'vitest';
import { query } from '../src/shared/config/db.js';
import { tasaDeCierre, seguimientoYTiempos, detalleTasaDeCierre } from '../src/modules/reports/report.model.js';

/**
 * «Cuántos compraron» se cuenta UNA vez, no tres (#39).
 *
 * El ticket lo dice sin rodeos:
 *
 *     «Hoy la misma pantalla puede enseñar dos porcentajes distintos de lo
 *      mismo. Eso es exactamente lo que hace que no se crea ninguno de los
 *      dos.»
 *
 * Y había tres cuentas conviviendo en Reportes:
 *
 *   tasa de cierre     ventas con cobro, posteriores a la entrada, sin cuotas
 *   seguimiento        conversiones a secas — sin exigir cobro ni fecha
 *   «Tasa conversión»  los leads con status = 'convertido', puesto a mano
 *
 * En la base local daban 10 %, 15 % y 15 %, una debajo de otra en la misma
 * pantalla. La tercera se quitó (era un campo manual, no una venta) y las dos
 * primeras se unificaron. Esta prueba es lo que impide que vuelvan a separarse:
 * no comprueba un número concreto, comprueba que los dos caminos coincidan.
 *
 * CONTRA LA BASE DE VERDAD, como su hermana `resumenCuadraConReportes`. Un
 * doble no distingue una conversión con cobro de una sin él, que es justo la
 * diferencia que separaba las dos cuentas.
 */

async function hayBase() {
  try { await query('SELECT 1'); return true; } catch { return false; }
}

/** El proyecto con más leads: comparar sobre uno vacío es comparar 0 con 0. */
async function proyectoConDatos() {
  const { rows } = await query(
    `SELECT project_id, COUNT(*)::int AS n
       FROM leads
      WHERE deleted_at IS NULL
        AND project_id NOT IN (SELECT id FROM projects WHERE es_prueba)
      GROUP BY 1 ORDER BY n DESC LIMIT 1`);
  return rows[0]?.project_id ?? null;
}

const RANGO = { from: '2020-01-01', to: '2099-12-31' };

/**
 * Las dos cuentas se leen con dos consultas seguidas, y el proyecto con mas
 * leads es compartido: si OTRA prueba mete un lead justo entre las dos,
 * salen cifras que difieren en uno sin que ninguna definicion haya cambiado
 * (en CI, con las pruebas en paralelo, pasaba a menudo). Se repite hasta que
 * las dos lecturas vean la misma base. Una divergencia de verdad no depende
 * del momento: falla en todos los intentos y la prueba sigue en rojo.
 */
const hastaQueCuadre = (comprobar) => vi.waitFor(comprobar, { timeout: 8000, interval: 150 });

describe('una sola definición de «compraron»', () => {
  it('la tasa de cierre y el panel de seguimiento dicen lo mismo', async () => {
    if (!await hayBase()) {
      console.warn('Sin base: esta prueba no comprueba nada. Levanta docker-compose.dev.yml.');
      return;
    }
    const projectId = await proyectoConDatos();
    if (!projectId) { console.warn('Sin leads con los que comparar.'); return; }

    await hastaQueCuadre(async () => {
      const tasa = await tasaDeCierre({ projectId, ...RANGO });
      const seg = await seguimientoYTiempos({ projectId, ...RANGO });

      // El mismo universo de personas...
      expect(seg.cohorte.entraron).toBe(tasa.leads);
      // ...y el mismo recuento de las que compraron.
      expect(seg.cohorte.compraron).toBe(tasa.cerrados);
    });
  });

  it('el desglose tiene exactamente las personas que dice el número', async () => {
    if (!await hayBase()) return;
    const projectId = await proyectoConDatos();
    if (!projectId) return;

    await hastaQueCuadre(async () => {
    const tasa = await tasaDeCierre({ projectId, ...RANGO });
    const cerrados = await detalleTasaDeCierre({ projectId, ...RANGO, lado: 'cerrados' });
    const todos = await detalleTasaDeCierre({ projectId, ...RANGO, lado: 'todos' });

    // Es lo que hace comprobable el porcentaje: si la lista trae otra cantidad,
    // quien la abra para contar se encuentra con que no cuadra y deja de
    // creerse el número — que es el problema que el ticket venía a resolver.
    expect(cerrados.length).toBe(tasa.cerrados);
    expect(todos.length).toBe(tasa.leads);
    });
  });

  it('nadie del desglose compró ANTES de entrar', async () => {
    if (!await hayBase()) return;
    const projectId = await proyectoConDatos();
    if (!projectId) return;

    const cerrados = await detalleTasaDeCierre({ projectId, ...RANGO, lado: 'cerrados' });
    // La regla que evita que una carga de clientes viejos —metidos con fecha de
    // hoy y venta de enero— parezca que compran nada más llegar.
    for (const p of cerrados) {
      expect(p.fecha_venta).not.toBeNull();
      expect(new Date(p.fecha_venta) >= new Date(p.entrada)).toBe(true);
    }
  });

  it('el porcentaje es el de los dos sumandos, no otro', async () => {
    if (!await hayBase()) return;
    const projectId = await proyectoConDatos();
    if (!projectId) return;

    const t = await tasaDeCierre({ projectId, ...RANGO });
    const esperado = t.leads > 0 ? Math.round((t.cerrados * 10000) / t.leads) / 100 : 0;
    expect(t.tasa).toBe(esperado);
  });
});
