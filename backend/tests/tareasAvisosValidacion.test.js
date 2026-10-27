import { describe, it, expect } from 'vitest';
import { createTaskSchema } from '../src/modules/tasks/tasks.validation.js';
import { mensajeDeValidacion } from '../src/modules/tasks/tasks.controller.js';

// Diego, 27/10/2026: «que si falta algo, por ejemplo faltó el nombre, que diga eso, no ese error así».
const aviso = (datos) => mensajeDeValidacion(createTaskSchema.safeParse(datos).error.errors[0]);

describe('los avisos al guardar una tarea dicen qué falta o qué está mal', () => {
  it('sin título: «El título es obligatorio» / «Falta el título»', () => {
    expect(aviso({ title: '' })).toBe('El título es obligatorio');
    expect(aviso({})).toBe('Falta el título');
  });
  it('un responsable que no es un número: dice el campo, en castellano', () => {
    expect(aviso({ title: 'x', assigned_to: 'Ruth' })).toBe('El responsable no es válido');
  });
  it('una prioridad que no existe: elige de la lista', () => {
    expect(aviso({ title: 'x', priority: 'urgentisima' })).toBe('La prioridad no es válida: elige una opción de la lista');
  });
  it('los mensajes propios se quedan tal cual', () => {
    expect(aviso({ title: 'x', project_id: 1, external_project_id: 2 })).toMatch(/proyecto del catálogo y un proyecto propio/);
  });
});
