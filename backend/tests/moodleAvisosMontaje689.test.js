import {
  describe, it, expect, vi, afterEach,
} from 'vitest';
import supertest from 'supertest';

/**
 * `app.js` monta `/api/moodle-avisos` (lo que llama el plugin desde cada Moodle) solo con
 * el plugin aprobado (PLUGIN_MOODLE_EN_PRODUCCION; revisión de la PR #689, punto 1).
 *
 * La app entera no se puede cargar con NODE_ENV=production (arrancaría el servidor y las
 * tareas), así que aquí se le da el interruptor ya resuelto: apagado, la ruta no existe
 * (404); encendido, existe y pide firma (401). Lo que decide el interruptor según el
 * entorno lo prueba moodlePluginSoloEnPruebas689.test.js.
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

async function appCon(activo) {
  vi.resetModules();
  vi.doMock('../src/shared/config/soloEnPruebas.js', async (importOriginal) => ({
    ...(await importOriginal()),
    pluginMoodleActivo: () => activo,
  }));
  const { default: app } = await import('../src/app.js');
  return supertest(app);
}

afterEach(() => { vi.doUnmock('../src/shared/config/soloEnPruebas.js'); });

describe('/api/moodle-avisos en app.js', () => {
  it('apagado: no existe (404), ni el aviso, ni conectar, ni la actualización', async () => {
    const api = await appCon(false);
    expect((await api.post('/api/moodle-avisos/1').send('{}')).status).toBe(404);
    expect((await api.post('/api/moodle-avisos/conectar').send({})).status).toBe(404);
    expect((await api.get('/api/moodle-avisos/plugin/ultima')).status).toBe(404);
  });

  it('encendido: existe y sin firma no entra (401)', async () => {
    const api = await appCon(true);
    const r = await api.post('/api/moodle-avisos/1').set('Content-Type', 'application/json').send('{}');
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_SIGNATURE');
  });
});
