import { describe, it, expect } from 'vitest';
import { colasQueSeVen } from './colasDeFacturacion';

/*
  25/11, Ana: con «Todos los proyectos» arriba, Finanzas › Facturas no pintaba
  ninguna cola (la tarjeta recibía projectId null). El cobro 1008 de la venta
  540 estaba en la cola de Psiko y no había dónde emitirlo.
*/
const suyos = [{ id: 3, nombre: 'Fono' }, { id: 2, nombre: 'Psiko' }];

describe('colasQueSeVen · una cola por campus también con «Todos»', () => {
  it('con «Todos» (-1), una por cada campus suyo, ocultando las vacías', () => {
    const r = colasQueSeVen({ pid: -1, porSociedad: false, sociedadProjects: [], filterProject: '', projects: suyos });
    expect(r?.campus.map((p) => p.id)).toEqual([3, 2]);
    expect(r?.varias).toBe(true);
  });
  it('con «Todos» y un solo campus, esa cola sin ocultarla', () => {
    const r = colasQueSeVen({ pid: -1, porSociedad: false, sociedadProjects: [], filterProject: '', projects: [suyos[1]] });
    expect(r).toEqual({ campus: [suyos[1]], varias: false });
  });
  it('con un campus elegido, la tarjeta de siempre (null = la del campus activo)', () => {
    expect(colasQueSeVen({ pid: 2, porSociedad: false, sociedadProjects: [], filterProject: '', projects: suyos })).toBeNull();
  });
  it('con empresa, como antes: las de la empresa, o la del campus filtrado', () => {
    const conEmpresa = { pid: -1, porSociedad: true, sociedadProjects: suyos, projects: suyos };
    expect(colasQueSeVen({ ...conEmpresa, filterProject: '' })).toEqual({ campus: suyos, varias: true });
    expect(colasQueSeVen({ ...conEmpresa, filterProject: '2' })).toEqual({ campus: [suyos[1]], varias: false });
  });
});
