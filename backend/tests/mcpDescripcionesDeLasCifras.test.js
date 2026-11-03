import { describe, it, expect } from 'vitest';
import { HERRAMIENTAS, INFORMES } from '../src/modules/mcp/mcp.tools.js';

/**
 * Cada cifra dice de dónde sale (#325, incidencias de datos).
 *
 * Manuel encontró tres cifras de «cobros pendientes» y dos de «ingresos del mes»
 * que parecían contradecirse y no lo eran: contaban cosas distintas, y ninguna
 * pantalla ni consulta lo decía. Claude, además, tenía que adivinarlo. Aquí se
 * fija que las descripciones que él lee nombran la fecha por la que cuenta cada
 * una y a cuál mirar para la pregunta de al lado.
 */
describe('las consultas dicen por qué fecha cuentan', () => {
  it('resumen_general y resumen_mensual: por fecha de VENTA, y mandan a cobros_mensuales para el dinero que entró', () => {
    for (const n of ['resumen_general', 'resumen_mensual']) {
      expect(INFORMES[n].descripcion, n).toMatch(/fecha de venta|mes de VENTA/);
      expect(INFORMES[n].descripcion, n).toContain('cobros_mensuales');
    }
  });

  it('cobros_mensuales: por fecha de COBRO', () => {
    expect(INFORMES.cobros_mensuales.descripcion).toMatch(/FECHA DE COBRO/);
  });

  it('cobros_pendientes explica por qué no coincide con el Dashboard ni con listar_ventas', () => {
    const d = HERRAMIENTAS.find((h) => h.nombre === 'cobros_pendientes').descripcion;
    expect(d).toMatch(/Dashboard/);
    expect(d).toMatch(/listar_ventas/);
  });

  it('el informe del MCP, sin fechas, es el histórico; lo dice la herramienta', () => {
    // La pantalla de Reportes arranca en «Este mes»; el MCP sin desde/hasta cubre todo.
    const informe = HERRAMIENTAS.find((h) => h.nombre === 'informe');
    expect(informe.descripcion).toMatch(/histórico|desde.*hasta/i);
  });
});
