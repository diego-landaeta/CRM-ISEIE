import { describe, it, expect } from 'vitest';
import * as ctrl from '../src/modules/tutores/tutor.controller.js';

/**
 * Comisiones y Pagos sin formación, en ISEIE, daban 500: «proyectosDelAmbito is
 * not defined». El controlador la usaba sin importarla (Manuel, 02/10, ocho
 * veces seguidas en un minuto). Esta prueba llama a las dos como lo hace la
 * pantalla, con y sin empresa, y no tiene que lanzar ese error.
 */

async function llamar(handler, query) {
  const res = { cuerpo: null };
  res.status = () => res;
  res.json = (c) => { res.cuerpo = c; return res; };
  let error = null;
  await handler({ user: { userId: 1, role: 'superadmin' }, query, params: {}, headers: {} }, res, (e) => { error = e; });
  return { res, error };
}

describe('Comisiones y Pagos sin formación, sin «proyectosDelAmbito is not defined»', () => {
  for (const [nombre, handler] of [['comisiones/resumen', ctrl.resumenComisiones], ['pagos-sin-formacion', ctrl.pagosSinFormacion]]) {
    it(`${nombre} con un campus`, async () => {
      const { error } = await llamar(handler, { projectId: '1', periodo: '2026-09' });
      expect(error?.message || '').not.toMatch(/is not defined/);
    });
    it(`${nombre} con una empresa`, async () => {
      const { error } = await llamar(handler, { issuerId: '1', periodo: '2026-09' });
      expect(error?.message || '').not.toMatch(/is not defined/);
    });
  }
});
