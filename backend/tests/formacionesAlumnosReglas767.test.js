import { describe, it, expect } from 'vitest';
import {
  MESES_DE_SERIE, alumnosDeVentas, duracionDeTexto, estadoDePago, finDeAcceso, motivoFuera,
  ordenarAlumnos, reglaDelCampus, resumenDeAlumnos, sumarDuracion,
} from '../src/modules/products/formacion-alumnos.reglas.js';

/**
 * CRM-ISEIE#767 (gemela de CRM#1113) · alumnos activos por formación: las reglas, sin base.
 *
 *   npx vitest run tests/formacionesAlumnosReglas767.test.js
 */

const HOY = '2026-11-24';

describe('duración publicada de la formación', () => {
  it.each([
    ['2 meses', { meses: 2, dias: 0 }],
    ['1 Mes', { meses: 1, dias: 0 }],
    ['1-2 meses', { meses: 2, dias: 0 }],
    ['6-7 meses', { meses: 7, dias: 0 }],
    ['De 3 a 4 meses', { meses: 4, dias: 0 }],
    ['1 año', { meses: 12, dias: 0 }],
    ['2 años', { meses: 24, dias: 0 }],
    ['4 semanas', { meses: 0, dias: 28 }],
    ['12', { meses: 12, dias: 0 }],
    ['1.5', { meses: 1, dias: 15 }],
  ])('«%s»', (texto, esperado) => {
    expect(duracionDeTexto(texto)).toEqual(esperado);
  });

  it.each(['200 Horas', '', null, 'Próximamente', '700'])('«%s» no es una duración', (texto) => {
    expect(duracionDeTexto(texto)).toBeNull();
  });
});

describe('sumar la duración', () => {
  it('meses y días, y del 31 al mes corto, su último día', () => {
    expect(sumarDuracion('2026-09-15', { meses: 2, dias: 0 })).toBe('2026-11-15');
    expect(sumarDuracion('2026-01-31', { meses: 1, dias: 0 })).toBe('2026-02-28');
    expect(sumarDuracion('2026-10-01', { meses: 1, dias: 15 })).toBe('2026-11-16');
    expect(sumarDuracion('2026-12-20', { meses: 0, dias: 28 })).toBe('2027-01-17');
    expect(sumarDuracion('no', { meses: 1 })).toBeNull();
  });
});

describe('regla del campus', () => {
  it('sin guardar, la de serie; lo guardado manda tipo a tipo; basura, la de serie', () => {
    expect(reglaDelCampus(null)).toEqual({ ...MESES_DE_SERIE, configurada: false });
    expect(reglaDelCampus({ curso: 4 })).toEqual({ curso: 4, diplomado: 6, master: 12, configurada: true });
    expect(reglaDelCampus({ curso: 0, master: 'x', diplomado: 500 })).toEqual({ ...MESES_DE_SERIE, configurada: false });
  });
});

describe('fin del acceso', () => {
  const regla = reglaDelCampus(null);
  it('1) la fecha de fin de la formación, si no es de antes de empezar el alumno', () => {
    expect(finDeAcceso({ inicio: '2026-03-01', producto: { fecha_fin: '2026-12-31', duracion: '2 meses' }, regla }))
      .toMatchObject({ fin: '2026-12-31', origen: 'fin_formacion' });
    expect(finDeAcceso({ inicio: '2027-01-10', producto: { fecha_fin: '2026-12-31', duracion: '2 meses' }, regla }))
      .toMatchObject({ fin: '2027-03-10', origen: 'duracion' });
  });
  it('2) la duración publicada, desde el inicio', () => {
    expect(finDeAcceso({ inicio: '2026-10-01', producto: { duracion: '1 año' }, regla }))
      .toMatchObject({ fin: '2027-10-01', origen: 'duracion', detalle: 'Duración de la formación: 1 año' });
  });
  it('3) sin duración, la regla del tipo (el guardado o el del nombre); configurada, la del campus', () => {
    expect(finDeAcceso({ inicio: '2026-10-01', producto: { nombre: 'Máster en Disfagia', duracion: '1500 horas' }, regla }))
      .toMatchObject({ fin: '2027-10-01', origen: 'regla_de_serie' });
    expect(finDeAcceso({ inicio: '2026-10-01', producto: { nombre: 'Algo', tipo_formacion: 'diplomado' }, regla: reglaDelCampus({ diplomado: 9 }) }))
      .toMatchObject({ fin: '2027-07-01', origen: 'regla_campus', detalle: 'Regla del campus: diplomado, 9 meses' });
  });
});

describe('estado de pago', () => {
  const base = { importe_total: 1000, cobrado: 1000, con_cuotas: false, cuota_vencida: false, cuota_pendiente: false };
  it('al día, pendiente e impago', () => {
    expect(estadoDePago(base, HOY)).toBe('al_dia');
    expect(estadoDePago({ ...base, cobrado: 400, con_cuotas: true, cuota_pendiente: true }, HOY)).toBe('pendiente');
    expect(estadoDePago({ ...base, cobrado: 400, con_cuotas: true, cuota_pendiente: true, cuota_vencida: true }, HOY)).toBe('impago');
  });
  it('sin cuotas: el compromiso de pago vencido con algo por cobrar es impago; sin fecha, pendiente', () => {
    expect(estadoDePago({ ...base, cobrado: 0, fecha_compromiso_pago: '2026-11-01' }, HOY)).toBe('impago');
    expect(estadoDePago({ ...base, cobrado: 0, fecha_compromiso_pago: HOY }, HOY)).toBe('pendiente');
    expect(estadoDePago({ ...base, cobrado: 0 }, HOY)).toBe('pendiente');
  });
  it('la suscripción de Stripe en mora es impago', () => {
    expect(estadoDePago({ ...base, suscripcion_estado: 'past_due' }, HOY)).toBe('impago');
  });
  it('anulada o devuelta no cuenta', () => {
    expect(motivoFuera({ anulada: true })).toBe('anulada');
    expect(motivoFuera({ cobrado: 300, devuelto: 300 })).toBe('devuelta');
    expect(motivoFuera({ cobrado: 300, devuelto: 100 })).toBeNull();
  });
});

describe('alumnos de una formación', () => {
  const producto = { nombre: 'Curso de Coaching', duracion: '2 meses' };
  const regla = reglaDelCampus(null);
  const venta = (id, lead, fecha, extra = {}) => ({
    id, lead_id: lead, fecha_conversion: fecha, importe_total: 100, cobrado: 100, alumno: `Alumno ${lead}`, ...extra,
  });

  it('activos, terminados y fuera; con dos ventas, el acceso más largo y el peor pago', () => {
    const alumnos = alumnosDeVentas([
      venta(1, 10, '2026-10-01'),
      venta(2, 11, '2026-11-10', { cobrado: 0, con_cuotas: true, cuota_pendiente: true, cuota_vencida: true }),
      venta(3, 12, '2026-01-01'),
      venta(4, 13, '2026-11-01', { anulada: true }),
      venta(5, 10, '2026-06-01', { cobrado: 50, con_cuotas: true, cuota_pendiente: true }),
    ], producto, regla, HOY);
    const de = (lead) => alumnos.find((a) => a.lead_id === lead);
    expect(de(10)).toMatchObject({ estado: 'activo', venta_id: 1, fin_acceso: '2026-12-01', pago: 'pendiente', ventas: [1, 5] });
    expect(de(11)).toMatchObject({ estado: 'activo', pago: 'impago' });
    expect(de(12)).toMatchObject({ estado: 'terminado', fin_acceso: '2026-03-01' });
    expect(de(13)).toMatchObject({ estado: 'fuera', motivo_fuera: 'anulada', pago: null });

    expect(resumenDeAlumnos(alumnos)).toEqual({ activos: 2, terminados: 1, baja: 0, total: 3, fuera: 1, al_dia: 0, pendiente: 1, impago: 1 });
    expect(ordenarAlumnos(alumnos).map((a) => a.lead_id)).toEqual([11, 10, 12, 13]);
  });

  it('el inicio pactado manda sobre la fecha de la venta', () => {
    const [a] = alumnosDeVentas([venta(1, 10, '2026-05-01', { fecha_inicio: '2026-11-01' })], producto, regla, HOY);
    expect(a).toMatchObject({ inicio: '2026-11-01', fin_acceso: '2027-01-01', estado: 'activo' });
  });
});
