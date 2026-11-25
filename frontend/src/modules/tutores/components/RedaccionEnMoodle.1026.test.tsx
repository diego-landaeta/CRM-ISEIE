// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * CRM#1026 (porte del 360) · La redactora en Moodle (Diego, CRM#1059):
 *   · el rol correcto es «Profesor» (`editingteacher`), el de las tutoras de hoy; «Profesor
 *     sin permiso de edición» sale aparte y no cuenta como listo;
 *   · en la ficha, el enlace para matricularla o cambiarle el rol;
 *   · la propia redactora ve lo suyo en «Mi campus», por la ruta sin id, sin enlaces para
 *     matricularse; a una tutora que no redacta no se le pinta nada.
 */

const pedidas: string[] = [];
let datos: any;
vi.mock('@/shared/api/client', () => ({
  default: { get: async (url: string) => { pedidas.push(url); return { success: true, data: datos }; } },
}));

const { default: RedaccionEnMoodle } = await import('./RedaccionEnMoodle');

const curso = (id: number, estado: string, roles: string[] = []) => ({
  product_id: id, producto: `Producto ${id}`, producto_activo: true, por: ['responsable'],
  curso_moodle_id: id, curso_nombre: `Curso ${id}`, estado, roles, enlace: `https://campus.test/user/index.php?id=${id}`,
});
const conCursos = (es_redactora = true) => ({
  es_redactora, rol_moodle: 'editingteacher', lista: false, sin_curso: [],
  campus: [{
    project_id: 3, campus: 'Fono', tiene_campus: true, campus_conectado: true, vinculada_en_crm: true,
    cuenta: { id: 9, nombre: 'Yaibeth', suspendida: false, vinculada: true }, problemas: [],
    cursos: [curso(1, 'profesora', ['editingteacher']), curso(2, 'sin_edicion', ['teacher']), curso(3, 'sin_matricula')],
  }],
});

beforeEach(() => { pedidas.length = 0; datos = null; });
// Sin globals de vitest, testing-library no limpia sola entre pruebas.
afterEach(() => { cleanup(); });

describe('#1026 · la redactora en Moodle', () => {
  it('en la ficha: «Profesor» es lo correcto; sin edición o sin matrícula, con su enlace', async () => {
    datos = conCursos();
    render(<MemoryRouter><RedaccionEnMoodle tutorId={5} /></MemoryRouter>);
    expect(await screen.findByText('Profesor sin permiso de edición')).toBeTruthy();
    expect(pedidas).toEqual(['/tutores/5/redaccion-moodle']);
    expect(screen.getByText('editingteacher')).toBeTruthy();
    expect(screen.getByText('2 cursos sin su rol «Profesor», o con algo que revisar en el campus.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Cambiarle el rol en Moodle/ }).getAttribute('href')).toContain('id=2');
    expect(screen.getByRole('link', { name: /Matricularla en Moodle/ }).getAttribute('href')).toContain('id=3');
  });

  it('en «Mi campus»: lo suyo, por la ruta sin id y sin enlaces para matricularse', async () => {
    datos = conCursos();
    render(<MemoryRouter><RedaccionEnMoodle propia /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: /Los cursos que redactas/ })).toBeTruthy();
    expect(pedidas).toEqual(['/tutores/mi-campus/redaccion-moodle']);
    expect(screen.getByText('2 cursos sin tu rol «Profesor», o con algo que revisar en el campus.')).toBeTruthy();
    expect(screen.getByText(/pídeselo a coordinación/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Moodle/ })).toBeNull();
  });

  it('en «Mi campus», a una tutora que no redacta no se le pinta nada', async () => {
    datos = conCursos(false);
    const { container } = render(<MemoryRouter><RedaccionEnMoodle propia /></MemoryRouter>);
    await waitFor(() => expect(pedidas).toEqual(['/tutores/mi-campus/redaccion-moodle']));
    await new Promise((r) => { setTimeout(r, 0); });
    expect(container.textContent).toBe('');
  });

  it('con un rol de MOODLE_ROLES_TUTORA («Gestor» en ISEIE) está lista, pero no se llama «Profesor»', async () => {
    datos = conCursos();
    datos.campus[0].cursos = [curso(1, 'profesora', ['editingteacher']), curso(4, 'profesora', ['manager'])];
    render(<MemoryRouter><RedaccionEnMoodle tutorId={5} /></MemoryRouter>);
    expect(await screen.findByText('Rol de tutora')).toBeTruthy();
    expect(screen.getByText('(manager)')).toBeTruthy();
    expect(screen.getByText('Profesor')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Moodle/ })).toBeNull();
  });
});
