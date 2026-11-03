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

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

/*
  Gemela de CRM#346 · Los filtros de campus enseñaban campus de otras empresas
  y los de pruebas.

  - Con una empresa elegida arriba, solo sus campus.
  - Sin empresa, todos los suyos… menos los de pruebas: «un proyecto de
    pruebas solo se ve si lo eliges» (`SIN_PRUEBAS` en el servidor).
  - Las pantallas con ese filtro siguen la misma regla: la de `useAmbito.ts`,
    no una lista propia.

  En ISEIE la cabecera no elige empresa ni «Todos» (el contexto no trae
  `activeIssuerId`): manda la segunda regla. Prospectos y la Cola del día no
  tienen aquí filtro de campus, así que no se miran.
*/

const CTX = vi.hoisted(() => ({ projects: [], activeIssuerId: null }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => CTX }));

const { delAmbito, useIdsDelAmbito, useProyectosDelAmbito } = await import('@/shared/hooks/useAmbito');

const EMPRESA_A = 1; const EMPRESA_B = 2; const PRUEBAS = 3;
const CAMPUS = [
  { id: 10, nombre: 'ISEIE', sociedad_emisora_id: EMPRESA_A },
  { id: 11, nombre: 'Campus Dos', sociedad_emisora_id: EMPRESA_A },
  { id: 20, nombre: 'Campus Tres', sociedad_emisora_id: EMPRESA_B },
  { id: 30, nombre: 'Pruebas', sociedad_emisora_id: PRUEBAS, es_prueba: true },
];
const nombres = (l) => l.map((p) => p.nombre);

describe('los campus del ámbito (#346)', () => {
  it('con una empresa, solo los suyos', () => {
    expect(nombres(delAmbito(CAMPUS, EMPRESA_A))).toEqual(['ISEIE', 'Campus Dos']);
  });

  it('sin empresa, todos los suyos menos los de pruebas', () => {
    expect(nombres(delAmbito(CAMPUS, null))).toEqual(['ISEIE', 'Campus Dos', 'Campus Tres']);
  });

  it('el de pruebas sí sale si se elige su empresa: se ve si lo eliges', () => {
    expect(nombres(delAmbito(CAMPUS, PRUEBAS))).toEqual(['Pruebas']);
  });

  it('nunca el «-1» de «Todos los proyectos», ni nada con la lista vacía', () => {
    expect(delAmbito([{ id: -1, nombre: 'Todos' }, ...CAMPUS], null).map((p) => p.id)).not.toContain(-1);
    expect(delAmbito(null, null)).toEqual([]);
  });

  it('los dos hooks dicen lo mismo, también sin `activeIssuerId` en el contexto (ISEIE)', () => {
    CTX.projects = CAMPUS;
    CTX.activeIssuerId = EMPRESA_B;
    expect(nombres(renderHook(() => useProyectosDelAmbito()).result.current)).toEqual(['Campus Tres']);
    expect(renderHook(() => useIdsDelAmbito()).result.current).toEqual([20]);
    delete CTX.activeIssuerId;
    expect(renderHook(() => useIdsDelAmbito()).result.current).toEqual([10, 11, 20]);
  });
});

describe('las pantallas con filtro de campus usan esa regla, no la lista entera', () => {
  const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

  it('Cuentas por cobrar, Seguimiento, Proceso comercial, Documentos y Tutores', () => {
    for (const f of ['modules/accounting/pages/ReceivablePage.tsx', 'modules/proceso/pages/SeguimientoPage.tsx',
      'modules/proceso/pages/ProcesoPage.tsx', 'modules/documents/pages/DocumentsConfigPage.tsx',
      'modules/tutores/pages/TutoresPage.tsx']) {
      expect(leer(f), f).toMatch(/useProyectosDelAmbito/);
    }
    expect(leer('modules/accounting/pages/ReceivablePage.tsx')).not.toMatch(/\(projects \|\| \[\]\)\.map/);
  });
});
