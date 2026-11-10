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
import { renderHook, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

/*
  Gemela de CRM#218, tanda 3 · `useCampusDeLaPantalla`: el campus de una
  pantalla que es de UN campus (Buscar duplicados, Meta Ads, Plantillas de
  email). Con un campus arriba, ese; sin él, el que se elija en la propia
  pantalla; si el ámbito tiene uno solo, ya viene elegido.

  En ISEIE la cabecera casi siempre trae un campus; el hook tiene que funcionar
  igual cuando el contexto no trae `activeIssuerId` (no hay selector de empresa).
*/

const CTX = vi.hoisted(() => ({ activeProject: null, activeIssuerId: null, projects: [] }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => CTX }));

const { useCampusDeLaPantalla } = await import('@/shared/hooks/useCampusDeLaPantalla');

const UNO = { id: 10, nombre: 'ISEIE', sociedad_emisora_id: 1 };
const DOS = { id: 11, nombre: 'Campus Dos', sociedad_emisora_id: 1 };
const TRES = { id: 20, nombre: 'Campus Tres', sociedad_emisora_id: 2 };
const PRUEBAS = { id: 30, nombre: 'Pruebas', sociedad_emisora_id: 3, es_prueba: true };

beforeEach(() => {
  CTX.activeProject = null; CTX.activeIssuerId = null; CTX.projects = [UNO, DOS, TRES, PRUEBAS];
});

describe('el campus de una pantalla de un solo campus (#218)', () => {
  it('con un campus en la cabecera, ese, sin nada que elegir', () => {
    CTX.activeProject = { id: 11, nombre: 'Campus Dos' };
    const { result } = renderHook(() => useCampusDeLaPantalla());
    expect(result.current).toMatchObject({ id: 11, nombre: 'Campus Dos', fijo: true });
  });

  it('con «Todos», falta elegirlo; las opciones son los suyos sin los de pruebas', () => {
    CTX.activeProject = { id: -1 };
    const { result } = renderHook(() => useCampusDeLaPantalla());
    expect(result.current.id).toBeNull();
    expect(result.current.fijo).toBe(false);
    expect(result.current.opciones.map((c) => c.nombre)).toEqual(['ISEIE', 'Campus Dos', 'Campus Tres']);
    act(() => result.current.elegir(20));
    expect(result.current).toMatchObject({ id: 20, nombre: 'Campus Tres' });
  });

  it('sin campus arriba ni `activeIssuerId` en el contexto (ISEIE), igual', () => {
    delete CTX.activeIssuerId;
    const { result } = renderHook(() => useCampusDeLaPantalla());
    expect(result.current.id).toBeNull();
    expect(result.current.opciones.map((c) => c.id)).toEqual([10, 11, 20]);
  });

  it('con una empresa, solo sus campus', () => {
    CTX.activeProject = { id: -1 }; CTX.activeIssuerId = 1;
    const { result } = renderHook(() => useCampusDeLaPantalla());
    expect(result.current.opciones.map((c) => c.nombre)).toEqual(['ISEIE', 'Campus Dos']);
  });

  it('si el ámbito tiene un solo campus, ya viene elegido', () => {
    CTX.activeProject = { id: -1 }; CTX.projects = [UNO, PRUEBAS];
    const { result } = renderHook(() => useCampusDeLaPantalla());
    expect(result.current).toMatchObject({ id: 10, nombre: 'ISEIE', fijo: false });
  });

  it('al cambiar la cabecera, lo elegido aquí se olvida', () => {
    CTX.activeProject = { id: -1 };
    const { result, rerender } = renderHook(() => useCampusDeLaPantalla());
    act(() => result.current.elegir(10));
    expect(result.current.id).toBe(10);
    CTX.activeIssuerId = 2;
    rerender();
    expect(result.current.id).toBe(20);
  });
});

describe('las pantallas de un campus lo usan (#218, tanda 3)', () => {
  const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

  it.each([
    ['modules/leads/pages/DuplicatesPage.tsx', 'sus duplicados'],
    ['modules/meta-ads/pages/MetaAdsPage.tsx', 'sus anuncios'],
    ['modules/email-templates/pages/EmailTemplatesPage.tsx', 'sus plantillas'],
  ])('%s pide el campus dentro', (f, que) => {
    const src = leer(f);
    expect(src).toMatch(/useCampusDeLaPantalla\(\)/);
    expect(src).toContain(`<ElegirCampus campus={campus} que="${que}" />`);
  });
});
