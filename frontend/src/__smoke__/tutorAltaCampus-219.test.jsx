// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

/*
  Gemela de CRM#219 · «+ Nuevo tutor» desactivado si arriba no hay un campus.

  Terminada cuando: sin un campus arriba, «+ Nuevo tutor» abre el formulario con
  un desplegable de campus (los suyos); al elegirlo se cargan sus formaciones,
  y al guardar se guardan. En ISEIE la cabecera no elige empresa: el caso sin
  campus es «Todos» (-1) o una cuenta sin campus activo.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' } }) }));

// La cabecera: sin campus elegido, con dos campus suyos.
const CAMPUS = vi.hoisted(() => ({ lista: [{ id: 1, nombre: 'ISEIE' }, { id: 2, nombre: 'Campus Dos' }] }));
const CABECERA = vi.hoisted(() => ({ activeProject: { id: -1 } }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: CABECERA.activeProject, projects: CAMPUS.lista }),
}));
vi.mock('@/shared/hooks/useAmbito', () => ({ useProyectosDelAmbito: () => CAMPUS.lista }));

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get } }));
vi.mock('@/modules/tutores/components/Entregables', () => ({ default: () => null }));
vi.mock('@/modules/tutores/components/ConsultasDelTutor', () => ({ default: () => null }));
const api = vi.hoisted(() => ({
  listar: vi.fn(), colaboraciones: vi.fn(), ajustes: vi.fn(), alta: vi.fn(), crearColaboracion: vi.fn(),
}));
vi.mock('@/modules/tutores/api/tutores.api', () => ({ tutoresApi: api }));

import TutoresPage from '@/modules/tutores/pages/TutoresPage';

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
const FORMACIONES = {
  1: [{ id: 11, nombre: 'Máster en Psicología', precio: 900 }],
  2: [{ id: 21, nombre: 'Logopedia infantil', precio: 600 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  CAMPUS.lista = [{ id: 1, nombre: 'ISEIE' }, { id: 2, nombre: 'Campus Dos' }];
  CABECERA.activeProject = { id: -1 };
  get.mockImplementation((url) => {
    const m = url.match(/projectId=(\d+)/);
    return Promise.resolve({ success: true, data: m ? (FORMACIONES[m[1]] || []) : [] });
  });
  api.listar.mockResolvedValue({ success: true, data: [] });
  api.colaboraciones.mockResolvedValue({ success: true, data: [] });
  api.ajustes.mockResolvedValue({ success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10 } });
  api.alta.mockResolvedValue({ success: true, data: { id: 9, entraYa: true } });
  api.crearColaboracion.mockResolvedValue({ success: true });
});

async function abrirAlta() {
  const r = render(<TutoresPage />);
  await esperar();
  const boton = screen.getByRole('button', { name: /Nuevo tutor/ });
  expect(boton.disabled).toBe(false);
  fireEvent.click(boton);
  await esperar();
  const form = r.container.querySelector('input[name="nombre"]').closest('form');
  fireEvent.change(form.querySelector('input[name="nombre"]'), { target: { value: 'Ana Tutora' } });
  fireEvent.change(form.querySelector('input[name="email"]'), { target: { value: 'ana@prueba.local' } });
  return form;
}

describe('Nuevo tutor sin un campus arriba (#219)', () => {
  it('el botón no está gris, y el formulario pide el campus entre los suyos', async () => {
    const form = await abrirAlta();
    const campus = form.querySelector('#alta-campus');
    expect(campus).toBeTruthy();
    expect([...campus.options].map((o) => o.textContent)).toEqual(['Elige el campus…', 'ISEIE', 'Campus Dos']);
    expect(screen.queryByText(/no tienes ningún campus/i)).toBeNull();
  });

  it('sin campus no se da de alta, y lo dice', async () => {
    const form = await abrirAlta();
    await act(async () => { fireEvent.submit(form); });
    expect(api.alta).not.toHaveBeenCalled();
    expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Falta el campus' }));
  });

  it('al elegir el campus se cargan SUS formaciones, y al guardar entra en él con su curso', async () => {
    const form = await abrirAlta();
    fireEvent.change(form.querySelector('#alta-campus'), { target: { value: '2' } });
    await esperar();
    expect(get).toHaveBeenCalledWith('/products?projectId=2&limit=500');

    // El curso sale del catálogo de Campus Dos, no del de ISEIE.
    const curso = form.querySelector('#alta-curso');
    fireEvent.focus(curso);
    fireEvent.change(curso, { target: { value: 'logo' } });
    await esperar();
    expect(screen.queryByText('Máster en Psicología')).toBeNull();
    fireEvent.click(screen.getByText('Logopedia infantil'));
    await esperar();

    await act(async () => { fireEvent.submit(form); });
    await esperar();
    expect(api.alta).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [2] }));
    expect(api.crearColaboracion).toHaveBeenCalledWith(expect.objectContaining({ tutorId: 9, productId: 21 }));
  });

  it('con un solo campus, ya viene elegido', async () => {
    CAMPUS.lista = [{ id: 2, nombre: 'Campus Dos' }];
    const form = await abrirAlta();
    expect(form.querySelector('#alta-campus').value).toBe('2');
    await act(async () => { fireEvent.submit(form); });
    await esperar();
    expect(api.alta).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [2] }));
  });

  it('con un campus arriba no pregunta: es ese', async () => {
    CABECERA.activeProject = { id: 1 };
    const form = await abrirAlta();
    expect(form.querySelector('#alta-campus')).toBeNull();
    await act(async () => { fireEvent.submit(form); });
    await esperar();
    expect(api.alta).toHaveBeenCalledWith(expect.objectContaining({ projectIds: [1] }));
  });

  it('sin ningún campus, el botón sigue gris y dice por qué', async () => {
    CAMPUS.lista = [];
    CABECERA.activeProject = null;
    render(<TutoresPage />);
    await esperar();
    const boton = screen.getByRole('button', { name: /Nuevo tutor/ });
    expect(boton.disabled).toBe(true);
    expect(boton.getAttribute('title')).toMatch(/ningún campus/);
  });
});
