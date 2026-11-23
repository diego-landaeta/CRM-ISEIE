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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tieneWhatsapp, PERMISOS_DE_LOS_AVISOS, PERMISO_DEL_AVISO } from '@/shared/lib/roles';

/**
 * QA de Diego, 22/10, punto 8: «El tutor recibe 403 cada pocos segundos en
 * `/api/whatsapp/sin-leer`: no llamar para quien no tiene WhatsApp.»
 *
 * Los avisos de mensajes y de llamadas viven en AppLayout, en todas las
 * pantallas y para todos. Solo se montan para quien tiene WhatsApp, con el
 * mismo criterio que el servidor: desde #423, su permiso (`usaOSupervisa` en
 * whatsapp.routes.js), el del mapa que llega con el login.
 */

describe('a quién le corresponde WhatsApp', () => {
  it('al tutor, no: es el caso del QA (su rol nunca lo trae)', () => {
    expect(tieneWhatsapp({ 'tutores.ver_lo_suyo': true })).toBe(false);
  });

  it('ni al colaborador (QA del 07/10)', () => {
    expect(tieneWhatsapp({ 'facturas_colaborador.subir': true })).toBe(false);
  });

  it('sí a quien tiene «Usar su WhatsApp»', () => {
    expect(tieneWhatsapp({ 'whatsapp.usar': true })).toBe(true);
  });

  // Errores de producción del 23/11: la ruta le deja pasar, pero `/sin-leer` es su
  // línea propia y el controlador pide «Usar su WhatsApp»: 403 SIN_WHATSAPP.
  it('a quien solo supervisa el de otras, no: sin línea propia no hay avisos suyos', () => {
    expect(tieneWhatsapp({ 'whatsapp.usar': false, 'whatsapp.supervisar': true })).toBe(false);
  });

  it('con la casilla «usa WhatsApp» apagada en su ficha, no (aunque el mapa sea de antes)', () => {
    expect(tieneWhatsapp({ 'whatsapp.usar': true }, { usa_whatsapp: false })).toBe(false);
    // null = la columna no está o nunca se tocó: manda el permiso.
    expect(tieneWhatsapp({ 'whatsapp.usar': true }, { usa_whatsapp: null })).toBe(true);
    expect(tieneWhatsapp({ 'whatsapp.usar': true }, { usa_whatsapp: true })).toBe(true);
  });

  it('a quien se lo han quitado en «Ver permisos», no', () => {
    expect(tieneWhatsapp({ 'whatsapp.usar': false })).toBe(false);
  });

  it('el superadmin con su WhatsApp apagado tampoco (#503): el mapa, no `can()`', () => {
    expect(tieneWhatsapp({ 'whatsapp.usar': false, 'whatsapp.supervisar': false, 'leads.view': true })).toBe(false);
  });

  it('sin mapa todavía, o sin sesión, no pregunta', () => {
    expect(tieneWhatsapp(null)).toBe(false);
    expect(tieneWhatsapp(undefined)).toBe(false);
  });
});

describe('el mismo criterio que el servidor', () => {
  const servidor = readFileSync(resolve(process.cwd(), '../backend/src/modules/whatsapp/whatsapp.routes.js'), 'utf8');

  it('las claves son las de `usaOSupervisa`', () => {
    const guarda = servidor.match(/const usaOSupervisa = puede\(([^{]*)\{/);
    expect(guarda, 'no se encuentra usaOSupervisa en whatsapp.routes.js').toBeTruthy();
    const claves = [...guarda[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...PERMISOS_DE_LOS_AVISOS].sort()).toEqual(claves.sort());
  });

  it('y para la línea propia el controlador pide «Usar su WhatsApp», que es lo que mira el aviso', () => {
    const chat = readFileSync(resolve(process.cwd(), '../backend/src/modules/whatsapp/chat.controller.js'), 'utf8');
    expect(PERMISOS_DE_LOS_AVISOS).toContain(PERMISO_DEL_AVISO);
    expect(chat).toContain(`if (!(await puedeWa(req, '${PERMISO_DEL_AVISO}'))) {`);
  });

  it('y `usaOSupervisa` es lo que protege lo que preguntan los avisos', () => {
    expect(servidor).toMatch(/router\.get\('\/sin-leer', usaOSupervisa,/);
    expect(servidor).toMatch(/router\.get\('\/respuesta-llamada', usaOSupervisa,/);
  });

  // En ISEIE solo está el aviso de mensajes (el de llamadas es de MultiCRM).
  it('AppLayout monta el aviso según tieneWhatsapp, con el mapa de permisos', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/shared/components/layout/AppLayout.jsx'), 'utf8');
    expect(layout).toMatch(/const sinWhatsapp = !tieneWhatsapp\(permissions, user\)/);
    expect(layout).toMatch(/\{!sinWhatsapp && \(\s*<Suspense fallback=\{null\}>\s*<AvisoDeMensaje \/>/);
    // Ya no se decide por el rol: el tutor también recibía un 403 (QA del 22/10).
    expect(layout).not.toMatch(/soloEsColaborador/);
  });
});
