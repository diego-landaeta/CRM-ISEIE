// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * #847 · La página pública de confirmación de datos del diploma, con un enlace
 * que no vale (QA de /testeo del 18/11). Con un `%2F` el router lo descodifica a
 * «/», la petición iba a otra ruta, volvía algo que no era JSON y la página
 * decía «Vuelve a intentarlo en un rato»: tiene que decir que el enlace no vale.
 */

const { default: ConfirmarDiplomaPage } = await import('@/modules/diploma-confirmacion/pages/ConfirmarDiplomaPage');

const NO_VALE = /Este enlace ya no es válido/;
const BUENO = `${'a'.repeat(32)}.${'b'.repeat(22)}`;
const abrir = (ruta) => render(
  <MemoryRouter initialEntries={[ruta]}>
    <Routes><Route path="/confirmar-diploma/:token" element={<ConfirmarDiplomaPage />} /></Routes>
  </MemoryRouter>,
);

let fetchOriginal;
beforeEach(() => { fetchOriginal = globalThis.fetch; globalThis.fetch = vi.fn(); });
afterEach(() => { cleanup(); globalThis.fetch = fetchOriginal; });

describe('ConfirmarDiplomaPage › enlace que no vale', () => {
  it('con %2F dice «no es válido» sin preguntar al servidor', async () => {
    abrir(`/confirmar-diploma/${'a'.repeat(20)}%2F${'b'.repeat(20)}`);
    expect(await screen.findByText(NO_VALE)).toBeTruthy();
    expect(screen.queryByText(/Vuelve a intentarlo/)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('con otra forma cualquiera, igual', async () => {
    abrir('/confirmar-diploma/no-es-un-enlace');
    expect(await screen.findByText(NO_VALE)).toBeTruthy();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('con la forma buena pregunta, codificado, y un 404 sin JSON también es «no válido»', async () => {
    globalThis.fetch.mockResolvedValue({ status: 404, json: async () => { throw new SyntaxError('no es JSON'); } });
    abrir(`/confirmar-diploma/${BUENO}`);
    expect(await screen.findByText(NO_VALE)).toBeTruthy();
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(new RegExp(`/api/cd/${BUENO.replace('.', '\\.')}$`));
  });

  it('un fallo de red de verdad sigue diciendo «vuelve a intentarlo»', async () => {
    globalThis.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    abrir(`/confirmar-diploma/${BUENO}`);
    expect(await screen.findByText(/Vuelve a intentarlo en un rato/)).toBeTruthy();
  });
});
