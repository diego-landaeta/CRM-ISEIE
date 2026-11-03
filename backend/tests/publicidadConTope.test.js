import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

/**
 * QA de Diego, 22/10, punto 10: «el cruce por `utm_campaign` no tiene […] tope
 * de tiempo». Las dos herramientas de publicidad llevan el mismo tope que los
 * informes del MCP (TOPE_INFORME_MS): si la consulta no acaba, se corta con un
 * aviso a Claude en vez de quedarse colgada.
 */

vi.mock('../src/modules/mcp/mcp.model.js', async (original) => ({
  ...(await original()),
  // Una consulta que no termina nunca.
  resumenPublicidad: vi.fn(() => new Promise(() => {})),
  campanasPublicitarias: vi.fn(() => new Promise(() => {})),
}));

const { HERRAMIENTAS, TOPE_INFORME_MS } = await import('../src/modules/mcp/mcp.tools.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');

const admin = construirAmbito({ id: 999994, nombre: 'Admin de prueba', role: 'admin', active: true },
  [{ id: 1, nombre: 'Campus', sociedad_id: null }]);

afterEach(() => { vi.useRealTimers(); });

describe.each(['resumen_publicidad', 'campanas_publicitarias'])('%s', (nombre) => {
  it('se corta al pasar el tope, con el aviso de periodo más corto', async () => {
    vi.useFakeTimers();
    const h = HERRAMIENTAS.find((x) => x.nombre === nombre);
    const resultado = h.ejecutar(admin, { limite: 50 });
    const esperado = expect(resultado).rejects.toMatchObject({ statusCode: 504, code: 'MCP_LENTO' });
    await vi.advanceTimersByTimeAsync(TOPE_INFORME_MS + 1);
    await esperado;
  });
});
