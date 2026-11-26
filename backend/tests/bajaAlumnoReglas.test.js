import { describe, it, expect } from 'vitest';
import {
  alumnosDeVentas, bajaDe, ordenarAlumnos, reglaDelCampus, resumenDeAlumnos,
} from '../src/modules/products/formacion-alumnos.reglas.js';
import { CLAVES_BAJA, textoMotivoBaja } from '../src/modules/conversions/baja-alumno.motivos.js';

/**
 * Baja del alumno (CRM-ISEIE#767, gemela de CRM#1113) · las reglas, sin base.
 *
 * Una venta con baja deja de ser activa DESDE su fecha; con fecha futura sigue
 * activa hasta entonces; una anulada o devuelta sigue «fuera» aunque tenga baja;
 * con otra venta en curso de la misma formación, el alumno sigue activo.
 *
 *   npx vitest run tests/bajaAlumnoReglas.test.js
 */

const HOY = '2026-11-25';
const producto = { nombre: 'Curso de Coaching', duracion: '2 meses' };
const regla = reglaDelCampus(null);
const venta = (id, lead, fecha, extra = {}) => ({
  id, lead_id: lead, fecha_conversion: fecha, importe_total: 100, cobrado: 100, alumno: `Alumno ${lead}`, ...extra,
});

describe('los motivos de la baja', () => {
  it('cuatro claves con su texto', () => {
    expect(CLAVES_BAJA).toEqual(['desistimiento', 'voluntaria', 'impago', 'otro']);
    expect(textoMotivoBaja('desistimiento')).toBe('Desistimiento en plazo');
    expect(textoMotivoBaja('voluntaria')).toBe('Baja voluntaria');
    expect(textoMotivoBaja('raro')).toBe('Otro');
  });
});

describe('bajaDe', () => {
  it('sin fecha, null; con fecha de hoy o pasada, vigente; futura, programada', () => {
    expect(bajaDe({}, HOY)).toBeNull();
    expect(bajaDe({ baja_fecha: HOY, baja_motivo: 'impago' }, HOY)).toEqual({ fecha: HOY, motivo: 'impago', texto: 'Impago', vigente: true });
    expect(bajaDe({ baja_fecha: '2026-12-01', baja_motivo: 'voluntaria' }, HOY)).toMatchObject({ vigente: false });
  });
});

describe('alumnos con baja', () => {
  const alumnos = alumnosDeVentas([
    venta(1, 10, '2026-11-01', { baja_fecha: '2026-11-10', baja_motivo: 'desistimiento' }),
    venta(2, 11, '2026-11-01', { baja_fecha: '2026-12-15', baja_motivo: 'voluntaria' }),
    venta(3, 12, '2026-11-01', { baja_fecha: HOY, baja_motivo: 'impago', cobrado: 0, con_cuotas: true, cuota_pendiente: true, cuota_vencida: true }),
    venta(4, 13, '2026-11-01', { baja_fecha: '2026-11-05', baja_motivo: 'otro', anulada: true }),
    // El 14 tiene una venta de baja y otra en curso: sigue activo por la segunda.
    venta(5, 14, '2026-10-01', { baja_fecha: '2026-10-15', baja_motivo: 'voluntaria' }),
    venta(6, 14, '2026-11-15'),
    venta(7, 15, '2026-11-01'),
  ], producto, regla, HOY);
  const de = (lead) => alumnos.find((a) => a.lead_id === lead);

  it('desde la fecha de baja deja de ser activo, con su motivo', () => {
    expect(de(10)).toMatchObject({
      estado: 'baja', fecha_baja: '2026-11-10', motivo_baja: 'desistimiento', fin_acceso: '2026-11-10',
      origen_fin: 'baja', detalle_fin: 'Baja: Desistimiento en plazo',
    });
    // El mismo día de la baja ya no cuenta como activo.
    expect(de(12)).toMatchObject({ estado: 'baja', motivo_baja: 'impago' });
  });

  it('con la baja en el futuro sigue activo hasta ese día', () => {
    expect(de(11)).toMatchObject({ estado: 'activo', fin_acceso: '2026-12-15', fecha_baja: '2026-12-15', motivo_baja: 'voluntaria', origen_fin: 'baja' });
  });

  it('anulada o devuelta manda sobre la baja: fuera, sin baja', () => {
    expect(de(13)).toMatchObject({ estado: 'fuera', motivo_fuera: 'anulada', fecha_baja: null, motivo_baja: null });
  });

  it('con otra venta en curso de la misma formación, sigue activo', () => {
    expect(de(14)).toMatchObject({ estado: 'activo', venta_id: 6, fecha_baja: null });
  });

  it('las cifras: «De baja» aparte y dentro del total; el pago, solo de los activos', () => {
    expect(resumenDeAlumnos(alumnos)).toEqual({
      activos: 3, terminados: 0, baja: 2, total: 5, fuera: 1, al_dia: 3, pendiente: 0, impago: 0,
    });
  });

  it('en la lista, los de baja van después de los activos y antes de los anulados', () => {
    const orden = ordenarAlumnos(alumnos).map((a) => a.estado);
    expect(orden.indexOf('baja')).toBeGreaterThan(orden.lastIndexOf('activo'));
    expect(orden.lastIndexOf('baja')).toBeLessThan(orden.indexOf('fuera'));
  });
});
