// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BloquePlegable from '@/shared/components/ui/BloquePlegable';

/**
 * Diego, 24/11: «¿por qué todos los bloques y gráficas salen minimizados y hay
 * que tocarlos? Todo abierto como antes». Con la 3.0.0 nacían cerrados y,
 * además, se guardaba «cerrado» nada más entrar, sin que nadie lo plegara.
 */
const pintar = () => render(<BloquePlegable clave="prueba" titulo="Bloque"><p>Dentro</p></BloquePlegable>);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('BloquePlegable nace abierto y solo recuerda lo que se pliega', () => {
  it('abierto de entrada, sin guardar nada al entrar', () => {
    pintar();
    expect(screen.getByRole('button', { name: /Bloque/ }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Dentro')).toBeTruthy();
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it('el «cerrado» que la 3.0.0 guardaba solo ya no cuenta', () => {
    localStorage.setItem('crm.bloque.prueba', '0');
    pintar();
    expect(screen.getByRole('button', { name: /Bloque/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('quien lo pliega lo sigue viendo plegado', () => {
    pintar();
    fireEvent.click(screen.getByRole('button', { name: /Bloque/ }));
    expect(localStorage.getItem('crm.bloque.v2.prueba')).toBe('0');
    cleanup();
    pintar();
    expect(screen.getByRole('button', { name: /Bloque/ }).getAttribute('aria-expanded')).toBe('false');
  });
});
