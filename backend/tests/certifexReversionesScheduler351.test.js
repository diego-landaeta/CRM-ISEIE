import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';

/**
 * #351 · El repaso de diplomas revertidos va en una tarea programada (no en la carga de una
 * pantalla: un GET no escribe). Con CERTIFEX_REVERSIONES_DISABLED=1 no arranca; sin Certifex
 * conectado, tampoco; con él, cada 10 minutos y una vuelta a los 2 minutos de arrancar.
 *
 *   npx vitest run tests/certifexReversionesScheduler351.test.js
 */
process.env.LOG_LEVEL = 'silent';
const latido = vi.hoisted(() => ({ vigilar: vi.fn() }));
vi.mock('../src/jobs/latido.js', () => latido);
vi.mock('../src/modules/certifex/certifex.revertir.js', () => ({ completarReversiones: vi.fn(async () => ({ apuntadas: 0 })) }));
const { startCertifexReversionesScheduler } = await import('../src/jobs/certifexReversionesScheduler.js');
const { completarReversiones } = await import('../src/modules/certifex/certifex.revertir.js');

afterEach(() => { vi.unstubAllEnvs(); latido.vigilar.mockClear(); });

describe('#351 · la tarea del repaso de reversiones', () => {
  it('con CERTIFEX_REVERSIONES_DISABLED=1, o sin Certifex conectado, no arranca', () => {
    vi.stubEnv('CERTIFEX_API_URL', 'https://certifex.test');
    vi.stubEnv('CERTIFEX_CRM_CLAVE', 'cfx_crm_x');
    vi.stubEnv('CERTIFEX_REVERSIONES_DISABLED', '1');
    startCertifexReversionesScheduler();
    vi.stubEnv('CERTIFEX_REVERSIONES_DISABLED', '');
    vi.stubEnv('CERTIFEX_API_URL', '');
    startCertifexReversionesScheduler();
    expect(latido.vigilar).not.toHaveBeenCalled();
  });

  it('con Certifex: cada 10 minutos, la primera a los 2 de arrancar, y la vuelta es el repaso', async () => {
    vi.stubEnv('CERTIFEX_API_URL', 'https://certifex.test');
    vi.stubEnv('CERTIFEX_CRM_CLAVE', 'cfx_crm_x');
    startCertifexReversionesScheduler();
    expect(latido.vigilar).toHaveBeenCalledTimes(1);
    const [nombre, , vuelta, cada, opts] = latido.vigilar.mock.calls[0];
    expect(nombre).toBe('certifex_reversiones');
    expect(cada).toBe(10 * 60 * 1000);
    expect(opts).toEqual({ alArrancarMs: 2 * 60 * 1000 });
    expect(await vuelta()).toEqual({ apuntadas: 0 });
    expect(completarReversiones).toHaveBeenCalledTimes(1);
  });

  it('arranca con el servidor, y su interruptor está en .env.example', () => {
    const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
    // En este CRM los trabajos arrancan desde una lista de [nombre, función].
    expect(app).toMatch(/\['diplomas revertidos', startCertifexReversionesScheduler\]/);
    expect(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')).toContain('CERTIFEX_REVERSIONES_DISABLED');
  });
});
