// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

/*
  Los recorridos para probar las funciones nuevas de staging (CRM-ISEIE#522,
  gemela de CRM#856). Diego, 17/11: «no tiene que escribir el tutorial, sino que
  haga un tutorial guiado». Se comprueba:

    · que cada recorrido existe, con permisos del catálogo, y que su pantalla lo
      ofrece con «Ver cómo funciona»;
    · que cada paso apunta a un `data-recorrido` que sigue en su pantalla;
    · que cada uno dice lo que tiene que fallar a propósito y termina con cómo
      dejarlo limpio;
    · que sin permiso no sale, que apagada lo dice, que NUNCA se abre solo y que
      no tapa lo que señala ni deja capa al cerrarse.
*/

const { permisos, yo } = vi.hoisted(() => ({
  permisos: new Set(),
  yo: { current: { id: 7, role: 'admin' } },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }),
}));

const { RECORRIDOS_DE_PRUEBA, APAGADA, pasosDePruebaPara } = await import('@/shared/lib/recorridosDePrueba');
const { default: VerComoFunciona } = await import('@/shared/components/ui/VerComoFunciona');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const SRC = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const nombreDe = (donde) => /^\[data-recorrido="([a-z0-9-]+)"\]$/.exec(donde)?.[1];
const lista = (p) => (p == null ? [] : Array.isArray(p) ? p : [p]);
const RECORRIDOS = Object.values(RECORRIDOS_DE_PRUEBA);
const PARES = RECORRIDOS.map((r) => [r.id, r]);

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  yo.current = { id: 7, role: 'admin' };
  document.body.innerHTML = '';
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('cada recorrido existe y tiene sus pasos', () => {
  it('son los de la tabla de #522 elegidos para esta tanda', () => {
    expect(Object.keys(RECORRIDOS_DE_PRUEBA).sort()).toEqual(['cobros-paypal', 'extractos-banco', 'informe-mensual', 'monitask']);
  });

  it.each(PARES)('%s: presenta, cuenta sus pasos y termina con cómo dejarlo limpio', (id, r) => {
    expect(r.id).toBe(id);
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos[0].texto).toContain('{pasos}');
    const ultimo = r.pasos.at(-1);
    expect(ultimo.titulo).toMatch(/limpio/);
    expect(ultimo.texto).toMatch(/«Ver cómo funciona»/);
    for (const p of r.pasos) {
      expect(p.titulo.length).toBeGreaterThan(3);
      // Frases cortas, de las que se leen en un cartel.
      expect(p.texto.length, p.titulo).toBeLessThan(330);
      expect(p.texto).not.toMatch(/endpoint|payload|API key|token de acceso/i);
    }
  });

  it.each(PARES)('%s: dice qué tiene que fallar a propósito', (_id, r) => {
    expect(r.pasos.some((p) => /A propósito/.test(p.texto))).toBe(true);
  });

  it.each(PARES)('%s: sus permisos existen en el catálogo', (_id, r) => {
    for (const k of [...lista(r.permiso), ...r.pasos.flatMap((p) => lista(p.permiso))]) {
      expect(CLAVES.has(k), `${k} no está en el catálogo`).toBe(true);
    }
  });

  it.each(PARES)('%s: su pantalla lo ofrece con «Ver cómo funciona»', (id, r) => {
    const codigo = leer(r.pantalla[0]);
    expect(codigo).toMatch(/<VerComoFunciona\b/);
    expect(codigo).toMatch(new RegExp(`['"]${id}['"]`));
  });
});

describe('cada paso apunta a algo que está en su pantalla', () => {
  it.each(PARES)('%s: cada anclaje sigue en el código de su pantalla', (_id, r) => {
    const codigo = r.pantalla.map(leer).join('\n');
    for (const p of r.pasos.filter((x) => x.donde)) {
      const n = nombreDe(p.donde);
      expect(n, `«${p.donde}» no es un data-recorrido`).toBeTruthy();
      // `data-recorrido="x"`, o `recorrido="x"` cuando lo pinta un componente de la pantalla.
      expect(codigo, `falta data-recorrido="${n}" en ${r.pantalla.join(', ')}`)
        .toMatch(new RegExp(`recorrido=(?:"${n}"|\\{[^}]*'${n}')`));
    }
  });
});

describe('quién lo ve', () => {
  it('sin el permiso del recorrido, ni botón ni recorrido', () => {
    render(<VerComoFunciona id="monitask" />);
    expect(screen.queryByRole('button', { name: /Ver cómo funciona/ })).toBeNull();
  });

  it('sin «editar cobros» no se explican Sincronizar, Enlazar ni Subir', () => {
    const ver = (k) => k === 'cobros_externos.view';
    const editar = (k) => ['cobros_externos.view', 'cobros_externos.edit'].includes(k);
    const t = (id, can) => pasosDePruebaPara(RECORRIDOS_DE_PRUEBA[id], can).map((p) => p.titulo);
    expect(t('cobros-paypal', ver)).not.toContain('Traerlos ahora');
    expect(t('cobros-paypal', ver)).not.toContain('Enlazar a mano');
    expect(t('cobros-paypal', editar)).toEqual(expect.arrayContaining(['Traerlos ahora', 'Enlazar a mano']));
    expect(t('extractos-banco', ver)).not.toContain('Subir un extracto');
    expect(t('extractos-banco', editar)).toContain('Subir un extracto');
  });
});

describe('cómo se abre', () => {
  it('nunca se abre solo: solo al pulsar «Ver cómo funciona»', () => {
    vi.useFakeTimers();
    permisos.add('monitask.view');
    render(<VerComoFunciona id="monitask" />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    expect(screen.getByRole('dialog', { name: 'Actividad del equipo' })).toBeInTheDocument();
  });

  it('apagada, lo dice: «Esta función está apagada: la enciende Diego»', () => {
    permisos.add('cobros_externos.view');
    render(<VerComoFunciona id="cobros-paypal" apagada />);
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    const d = screen.getByRole('dialog');
    expect(d).toHaveTextContent(APAGADA);
    expect(d).toHaveTextContent('1 de 1');
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument();
  });

  it('antes de abrir, deja la pantalla donde empieza (alAbrir)', () => {
    permisos.add('monitask.view');
    const alAbrir = vi.fn();
    render(<VerComoFunciona id="monitask" alAbrir={alAbrir} />);
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    expect(alAbrir).toHaveBeenCalledTimes(1);
  });

  it('Escape lo cierra y no deja capa encima', () => {
    permisos.add('reports.informe_mensual');
    render(<VerComoFunciona id="informe-mensual" />);
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('.fixed.inset-0')).toBeNull();
  });

  it('va en el body (fuera de la cabecera) y no tapa lo que señala', () => {
    vi.useFakeTimers();
    permisos.add('reports.informe_mensual');
    const objetivo = document.createElement('section');
    objetivo.setAttribute('data-recorrido', 'informe-mensual');
    objetivo.getBoundingClientRect = () => ({ x: 100, y: 100, left: 100, top: 100, width: 600, height: 80, right: 700, bottom: 180, toJSON() {} });
    objetivo.scrollIntoView = () => {};
    document.body.appendChild(objetivo);
    const cabecera = document.body.appendChild(document.createElement('header'));
    render(<VerComoFunciona id="informe-mensual" />, { container: cabecera });
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    act(() => { vi.advanceTimersByTime(10); });
    const d = screen.getByRole('dialog', { name: 'Informe mensual para la gestoría' });
    expect(cabecera.contains(d)).toBe(false);
    // El cartel, debajo de lo que señala; el recuadro no recibe clics.
    expect(parseFloat(d.style.top)).toBeGreaterThanOrEqual(180);
    expect(document.querySelector('.ring-2.ring-primary')).toHaveClass('pointer-events-none');
  });

  it('si se abre otra ventana encima, se cierra', () => {
    vi.useFakeTimers();
    permisos.add('monitask.view');
    render(<VerComoFunciona id="monitask" />);
    fireEvent.click(screen.getByRole('button', { name: /Ver cómo funciona/ }));
    expect(screen.getByRole('dialog', { name: 'Actividad del equipo' })).toBeInTheDocument();
    const otra = document.createElement('div');
    otra.setAttribute('role', 'alertdialog');
    document.body.appendChild(otra);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole('dialog', { name: 'Actividad del equipo' })).toBeNull();
  });
});
