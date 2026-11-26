import { describe, it, expect } from 'vitest';
import { filtrarAlumnos, ordenarFormaciones, textoEstado, totalesDelCampus } from '../modules/products/lib/alumnosFormacion';
import type { AlumnoFormacion, ResumenAlumnos } from '../modules/products/api/alumnos.api';

/** CRM-ISEIE#767 (gemela de CRM#1113) · alumnos de cada formación: filtros, orden de la lista y totales. */

const alumno = (id: number, estado: AlumnoFormacion['estado'], pago: AlumnoFormacion['pago']): AlumnoFormacion => ({
  lead_id: id, nombre: `A${id}`, email: null, gestora: null, venta_id: id, ventas: [id], fecha_venta: '2026-11-01',
  inicio: '2026-11-01', fin_acceso: '2027-01-01', origen_fin: 'duracion', detalle_fin: '', estado, motivo_fuera: estado === 'fuera' ? 'anulada' : null, pago,
});
const cifra = (activos: number, impago: number): ResumenAlumnos => ({ activos, impago, terminados: 0, total: activos, fuera: 0, al_dia: activos - impago, pendiente: 0 });

describe('alumnos de una formación', () => {
  const lista = [alumno(1, 'activo', 'impago'), alumno(2, 'activo', 'al_dia'), alumno(3, 'terminado', 'al_dia'), alumno(4, 'fuera', null), alumno(5, 'activo', 'pendiente')];
  it('filtros', () => {
    expect(filtrarAlumnos(lista, 'activos').map((a) => a.venta_id)).toEqual([1, 2, 5]);
    expect(filtrarAlumnos(lista, 'impago').map((a) => a.venta_id)).toEqual([1]);
    expect(filtrarAlumnos(lista, 'pendiente').map((a) => a.venta_id)).toEqual([5]);
    expect(filtrarAlumnos(lista, 'terminados').map((a) => a.venta_id)).toEqual([3]);
    expect(filtrarAlumnos(lista, 'todos')).toHaveLength(5);
  });
  it('estado en texto', () => {
    expect(textoEstado({ estado: 'activo', motivo_fuera: null })).toBe('Activo');
    expect(textoEstado({ estado: 'fuera', motivo_fuera: 'devuelta' })).toBe('Devuelta');
    expect(textoEstado({ estado: 'fuera', motivo_fuera: 'anulada' })).toBe('Anulada');
    // La baja apuntada en la venta (25/11): «Baja (motivo)».
    expect(textoEstado({ estado: 'baja', motivo_fuera: null, motivo_baja: 'desistimiento' })).toBe('Baja (Desistimiento en plazo)');
    expect(textoEstado({ estado: 'baja', motivo_fuera: null, motivo_baja: 'impago' })).toBe('Baja (Impago)');
    expect(textoEstado({ estado: 'baja', motivo_fuera: null })).toBe('Baja (Otro)');
  });
  it('filtro «De baja»', () => {
    const conBaja = [...lista, { ...alumno(6, 'baja', 'al_dia'), motivo_baja: 'voluntaria' as const }];
    expect(filtrarAlumnos(conBaja, 'baja').map((a) => a.venta_id)).toEqual([6]);
    expect(filtrarAlumnos(conBaja, 'activos').map((a) => a.venta_id)).toEqual([1, 2, 5]);
  });
});

describe('la lista de formaciones', () => {
  const filas = [{ id: 1, nombre: 'Curso B' }, { id: 2, nombre: 'Curso A' }, { id: 3, nombre: 'Curso C' }];
  const cifras = { 1: cifra(5, 0), 3: cifra(5, 2) };
  it('por nombre, por activos y por impago (a igualdad, por nombre)', () => {
    expect(ordenarFormaciones(filas, 'nombre', cifras).map((f) => f.id)).toEqual([2, 1, 3]);
    expect(ordenarFormaciones(filas, 'activos', cifras).map((f) => f.id)).toEqual([1, 3, 2]);
    expect(ordenarFormaciones(filas, 'impago', cifras).map((f) => f.id)).toEqual([3, 2, 1]);
    expect(ordenarFormaciones(filas, 'activos', null).map((f) => f.id)).toEqual([2, 1, 3]);
  });
  it('totales del campus', () => {
    expect(totalesDelCampus(cifras)).toEqual({ activos: 10, impago: 2, baja: 0 });
    expect(totalesDelCampus({ ...cifras, 4: { ...cifra(1, 0), baja: 3 } })).toEqual({ activos: 11, impago: 2, baja: 3 });
    expect(totalesDelCampus(null)).toEqual({ activos: 0, impago: 0, baja: 0 });
  });
});
