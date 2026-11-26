import { describe, it, expect } from 'vitest';
import { datosDeForm, formDesde, moduloVacio, moverModulo, problemaDelForm, sumaDeHoras } from './formacionForm';
import type { Formacion } from '../api/formaciones.api';

/** El formulario de Productos › Formaciones (CRM#1113), sin pintar la pantalla. */

const formacion = (cambios: Partial<Formacion> = {}): Formacion => ({
  id: 7, project_id: 3, nombre: 'Máster en Voz', tipo_formacion: null, tipo_por_nombre: 'master',
  horas_totales: 1500, horas_texto: '1.500 horas', precio: 2400, moneda: 'EUR', modalidad: 'Online',
  fecha_inicio: '2027-01-15', fecha_fin: null, fecha_inicio_texto: null, activa: true, de_la_web: true,
  url_info: null, horas_de_los_modulos: 0, tutoras: [], cursos_moodle: [],
  modulos: [{ id: 11, orden: 0, titulo: 'Fundamentos', descripcion: null, horas: 500 }],
  ...cambios,
});

describe('formulario de una formación', () => {
  it('sin tipo guardado, propone el que dice el nombre', () => {
    expect(formDesde(formacion()).tipo).toBe('master');
    expect(formDesde(formacion({ tipo_formacion: 'curso' })).tipo).toBe('curso');
  });

  it('de lo escrito a lo que se guarda: vacíos a null, números y moneda en mayúsculas', () => {
    const f = formDesde(formacion());
    f.precio = '1990,5';
    f.moneda = 'usd';
    f.fecha_fin = '';
    f.modulos.push({ ...moduloVacio(), titulo: ' Trabajo final ', horas: '' });
    expect(datosDeForm(f)).toEqual({
      nombre: 'Máster en Voz', tipo_formacion: 'master', horas_totales: 1500, precio: 1990.5, moneda: 'USD',
      modalidad: 'Online', fecha_inicio: '2027-01-15', fecha_fin: null,
      modulos: [
        { id: 11, titulo: 'Fundamentos', horas: 500, descripcion: null },
        { titulo: 'Trabajo final', horas: null, descripcion: null },
      ],
    });
  });

  it('dice lo que impide guardar', () => {
    const f = formDesde(null);
    expect(problemaDelForm(f)).toMatch(/nombre/);
    f.nombre = 'Curso';
    f.modulos = [moduloVacio()];
    expect(problemaDelForm(f)).toMatch(/módulo 1/);
    f.modulos[0].titulo = 'Uno';
    f.fecha_inicio = '2027-02-01';
    f.fecha_fin = '2027-01-01';
    expect(problemaDelForm(f)).toMatch(/fin/);
    f.fecha_fin = '';
    expect(problemaDelForm(f)).toBeNull();
  });

  it('suma las horas de los módulos y los mueve sin salirse', () => {
    const f = formDesde(formacion());
    f.modulos.push({ ...moduloVacio(), titulo: 'Dos', horas: '250' });
    expect(sumaDeHoras(f.modulos)).toBe(750);
    expect(moverModulo(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moverModulo(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
