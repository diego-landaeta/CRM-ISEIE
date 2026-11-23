import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * El cobro automático, encendido en todos los campus, y el aviso «Conectar
 * Stripe para cobros automáticos» (CRM#992; Diego, 21/11/2026).
 *
 * Sin base: la base, el servidor y Stripe, de mentira.
 *
 *   · la migración 312: encendido de serie y en los campus que ya hay, y se
 *     puede pasar dos veces;
 *   · cada «no se puede» de las cuotas lleva su código: `sin_clave` y
 *     `clave_sin_permiso` (los del aviso), `apagado_entorno` (el interruptor del
 *     servidor) y los demás;
 *   · `campusPorConectar`: de una lista de campus, los que no pueden por la
 *     clave, con su nombre; los que no admiten cuotas en euros, fuera.
 *
 *   npx vitest run tests/conectarStripe992.test.js
 */

process.env.LOG_LEVEL = 'silent';

const delCampus = vi.hoisted(() => vi.fn());
const claveDeEscritura = vi.hoisted(() => vi.fn());
const claveObligatoria = vi.hoisted(() => vi.fn());
const config = vi.hoisted(() => vi.fn());
const nombreDelCampus = vi.hoisted(() => vi.fn());
const comprobarPermisosDeCobro = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/links-pago/links-pago.cobro-auto.model.js', async (orig) => ({ ...(await orig()), delCampus }));
vi.mock('../src/modules/links-pago/links-pago.service.js', async (orig) => ({ ...(await orig()), claveDeEscritura, claveObligatoria }));
vi.mock('../src/modules/links-pago/links-pago.model.js', async (orig) => ({ ...(await orig()), config, nombreDelCampus }));
vi.mock('../src/modules/links-pago/links-pago.stripe.js', async (orig) => ({ ...(await orig()), comprobarPermisosDeCobro }));

const cobroAuto = await import('../src/modules/links-pago/links-pago.cobro-auto.js');
const { ErrorDeStripe } = await import('../src/modules/links-pago/links-pago.stripe.js');
const { AppError } = await import('../src/shared/utils/AppError.js');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(AQUI, '..', 'migrations', '312_cobro_automatico_en_todos_los_campus.sql'), 'utf8');
const sinComentarios = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const CFG = { cuotas_admitidas: true, cuotas_max: 12, monedas: ['EUR'] };
const ENV = ['NODE_ENV', 'LINKS_PAGO_EN_PRODUCCION', 'COBRO_AUTOMATICO_EN_PRODUCCION', 'CRM_BASE_URL'];
let antes;

beforeEach(() => {
  antes = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  process.env.NODE_ENV = 'test';
  for (const f of [delCampus, claveDeEscritura, claveObligatoria, config, nombreDelCampus, comprobarPermisosDeCobro]) f.mockReset();
  delCampus.mockResolvedValue({ permitido: true, reintento_dias: 3 });
  claveDeEscritura.mockResolvedValue('rk_test_x');
  claveObligatoria.mockResolvedValue('rk_test_x');
  comprobarPermisosDeCobro.mockResolvedValue(undefined);
  config.mockResolvedValue(CFG);
  nombreDelCampus.mockImplementation(async (id) => `Campus ${id}`);
});
afterEach(() => {
  for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('la migración 312', () => {
  it('encendido de serie y en todos los campus, en una transacción, sin borrar nada', () => {
    expect(sinComentarios).toMatch(/ALTER TABLE projects ALTER COLUMN links_pago_cobro_auto SET DEFAULT true;/);
    expect(sinComentarios).toMatch(/UPDATE projects SET links_pago_cobro_auto = true WHERE links_pago_cobro_auto IS DISTINCT FROM true;/);
    expect(sinComentarios).toMatch(/^BEGIN;/m);
    expect(sinComentarios).toMatch(/^COMMIT;/m);
    expect(sinComentarios).not.toMatch(/\bDROP\b|\bDELETE\b|TRUNCATE/i);
    // Ni otra columna ni otra tabla.
    expect(sinComentarios.match(/UPDATE /g)).toHaveLength(1);
    expect(sinComentarios).not.toMatch(/links_pago_cobro_auto_reintento_dias/);
  });
});

describe('los motivos de «Inicial + cuotas», con su código', () => {
  const para = (o = {}) => cobroAuto.paraUnLinkEnCuotas(1, { cfg: CFG, puedeCobroAuto: true, ...o });

  it('todo en orden: disponible, sin código', async () => {
    expect(await para()).toEqual({ disponible: true, codigo: null, motivo: null, cuotas_max: 12 });
  });

  it('sin clave de links: `sin_clave`, sin preguntar a Stripe', async () => {
    claveDeEscritura.mockResolvedValue(null);
    const r = await para();
    expect(r).toMatchObject({ disponible: false, codigo: 'sin_clave' });
    expect(r.motivo).toMatch(/no tiene la clave de links de pago de Stripe/);
    expect(comprobarPermisosDeCobro).not.toHaveBeenCalled();
  });

  it('clave sin permiso de suscripciones (403 o 401 de Stripe): `clave_sin_permiso`, con los permisos que faltan', async () => {
    for (const status of [403, 401]) {
      comprobarPermisosDeCobro.mockRejectedValueOnce(new ErrorDeStripe(status, 'The provided key does not have the required permissions'));
      const r = await para();
      expect(r).toMatchObject({ disponible: false, codigo: 'clave_sin_permiso' });
      expect(r.motivo).toMatch(/no tiene permiso de suscripciones/);
      expect(r.motivo).toMatch(/Subscription Schedules/);
    }
  });

  it('el interruptor del servidor apagado: `apagado_entorno`, sin mirar el campus ni la clave', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', LINKS_PAGO_EN_PRODUCCION: '1', CRM_BASE_URL: 'https://360crm.tech/crm' });
    delete process.env.COBRO_AUTOMATICO_EN_PRODUCCION;
    const r = await para();
    expect(r).toMatchObject({ disponible: false, codigo: 'apagado_entorno', motivo: cobroAuto.MOTIVO_APAGADO });
    expect(r.motivo).toMatch(/no está activo en este entorno/);
    expect(delCampus).not.toHaveBeenCalled();
    expect(claveDeEscritura).not.toHaveBeenCalled();
    // Con el interruptor, sí.
    process.env.COBRO_AUTOMATICO_EN_PRODUCCION = '1';
    expect((await para()).disponible).toBe(true);
  });

  it('los demás motivos, con el suyo (no son del aviso)', async () => {
    expect((await para({ cfg: null })).codigo).toBe('campus_no_encontrado');
    expect((await para({ cfg: { ...CFG, cuotas_admitidas: false } })).codigo).toBe('cuotas_no_admitidas');
    expect((await para({ cfg: { ...CFG, monedas: ['USD'] } })).codigo).toBe('sin_euros');
    expect((await para({ puedeCobroAuto: false })).codigo).toBe('sin_permiso');
    delCampus.mockResolvedValueOnce({ permitido: false, reintento_dias: 3 });
    expect((await para()).codigo).toBe('campus_no_permitido');
    claveObligatoria.mockRejectedValueOnce(new AppError('En pruebas solo se crean links con una clave de test (rk_test_…).', 409, 'CLAVE_LIVE_EN_PRUEBAS'));
    expect((await para()).codigo).toBe('clave_live_en_pruebas');
    comprobarPermisosDeCobro.mockRejectedValueOnce(new ErrorDeStripe(500, 'caído'));
    expect((await para()).codigo).toBe('stripe_no_contesta');
    expect(cobroAuto.CODIGOS_DE_CONECTAR).toEqual(['sin_clave', 'clave_sin_permiso']);
  });
});

describe('los campus por conectar (el aviso de «Links de pago»)', () => {
  it('solo los que no pueden por la clave, con su nombre y su motivo, por nombre', async () => {
    claveDeEscritura.mockImplementation(async (id) => (id === 7 ? null : 'rk_test_x'));
    comprobarPermisosDeCobro.mockImplementation(async () => undefined);
    claveObligatoria.mockImplementation(async (id) => `rk_test_${id}`);
    comprobarPermisosDeCobro.mockImplementation(async (clave) => {
      if (clave === 'rk_test_5') throw new ErrorDeStripe(403, 'sin permiso');
    });
    nombreDelCampus.mockImplementation(async (id) => ({ 5: 'ACADEMIA IA', 7: 'Campus Siete', 8: 'Campus Ocho' }[id]));
    const r = await cobroAuto.campusPorConectar([8, 7, 5, 5, -1]);
    expect(r).toEqual([
      { project_id: 5, nombre: 'ACADEMIA IA', codigo: 'clave_sin_permiso', motivo: expect.stringMatching(/permiso de suscripciones/) },
      { project_id: 7, nombre: 'Campus Siete', codigo: 'sin_clave', motivo: expect.stringMatching(/no tiene la clave/) },
    ]);
  });

  it('un campus sin cuotas o sin euros no sale: no le hace falta', async () => {
    claveDeEscritura.mockResolvedValue(null);
    config.mockImplementation(async (id) => (id === 1 ? { ...CFG, cuotas_admitidas: false } : id === 2 ? { ...CFG, monedas: ['MXN'] } : null));
    expect(await cobroAuto.campusPorConectar([1, 2, 3])).toEqual([]);
  });

  it('un campus que no tiene permitido el cobro automático no sale (es otra cosa)', async () => {
    delCampus.mockResolvedValue({ permitido: false, reintento_dias: 3 });
    claveDeEscritura.mockResolvedValue(null);
    expect(await cobroAuto.campusPorConectar([1])).toEqual([]);
  });
});
