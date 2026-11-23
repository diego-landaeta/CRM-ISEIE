import { describe, it, expect } from 'vitest';
import { opcionesDeTipo, tipoValido, etiquetaDeTipo, TODOS_LOS_TIPOS } from './tiposDeEquipo';

// «Que el admin pueda filtrar por los dos equipos» (CRM-ISEIE#687).
describe('el filtro por tipo de equipo', () => {
  it('con un solo tipo de equipo no sale', () => {
    expect(opcionesDeTipo([{ tipo: 'colaboradores', is_active: true }, { tipo: 'colaboradores', is_active: true }])).toEqual([]);
    expect(opcionesDeTipo([])).toEqual([]);
  });

  it('con desarrollo y redactoras, «Todos», «Equipo de desarrollo» y «Tutoras redactoras»', () => {
    const o = opcionesDeTipo([{ tipo: 'redactoras', is_active: true }, { tipo: 'colaboradores', is_active: true }]);
    expect(o.map((x) => x.value)).toEqual(['', 'colaboradores', 'redactoras']);
    expect(o[0].label).toBe(TODOS_LOS_TIPOS);
    expect(o[2].label).toBe('Tutoras redactoras');
  });

  it('un equipo archivado no cuenta y sin tipo es de desarrollo', () => {
    expect(opcionesDeTipo([{ is_active: true }, { tipo: 'redactoras', is_active: false }])).toEqual([]);
    expect(opcionesDeTipo([{ is_active: true }, { tipo: 'tutores', is_active: true }]).map((x) => x.value)).toEqual(['', 'colaboradores', 'tutores']);
  });

  it('de la dirección solo vale un tipo conocido', () => {
    expect(tipoValido('redactoras')).toBe('redactoras');
    expect(tipoValido('otro')).toBe('');
    expect(tipoValido(null)).toBe('');
  });

  it('la etiqueta de la lista de equipos', () => {
    expect(etiquetaDeTipo('redactoras')).toBe('Redactoras');
    expect(etiquetaDeTipo('colaboradores')).toBeNull();
  });
});
