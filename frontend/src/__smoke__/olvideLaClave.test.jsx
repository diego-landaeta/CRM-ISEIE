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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

/**
 * «He olvidado la contraseña», en la pantalla de entrar (#37).
 *
 * Tres cosas que no se ven leyendo el componente:
 *
 *   - que NO pinte un <form>. Vive dentro del formulario de entrar, y un
 *     formulario dentro de otro no es HTML valido: el navegador lo desanida y
 *     el boton acaba enviando el de fuera, o sea intentando entrar con la
 *     clave que la persona no recuerda. Se ve como «al pedir la recuperacion
 *     me dice credenciales incorrectas», que no se parece en nada a la causa.
 *   - que el mensaje de «hecho» sea el mismo pase lo que pase con el correo.
 *     El servidor contesta igual exista o no la cuenta (esa es la regla del
 *     ticket); si la pantalla se pusiera a distinguir, la tiraria por tierra.
 *   - que el freno de intentos se explique en vez de quedarse mudo.
 */

const post = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { post: (...a) => post(...a) } }));

const OlvideLaClave = (await import('@/shared/components/OlvideLaClave')).default;

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ success: true, data: { message: 'ok' } });
});

function abrir(props = {}) {
  const r = render(<OlvideLaClave {...props} />);
  fireEvent.click(screen.getByText('¿Has olvidado tu contraseña?'));
  return r;
}

describe('no rompe el formulario de entrar', () => {
  it('no pinta ningun <form> propio', () => {
    const { container } = abrir();
    // Si algun dia alguien lo envuelve en <form> «para que funcione el enter»,
    // esto se pone rojo y explica por que no se puede.
    expect(container.querySelector('form')).toBeNull();
  });

  it('su boton no es de tipo submit', () => {
    abrir();
    // Un submit dentro del formulario de entrar lo enviaria igual, aunque no
    // haya <form> propio: el de fuera lo recoge.
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('type')).toBe('button');
    }
  });
});

describe('pedir el enlace', () => {
  it('arranca cerrado: solo el enlace', () => {
    render(<OlvideLaClave />);
    expect(screen.getByText('¿Has olvidado tu contraseña?')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Correo para recuperar/)).toBeNull();
  });

  it('hereda el correo ya escrito en la pantalla de entrar', () => {
    abrir({ correoInicial: 'laura@empresa.com' });
    expect(screen.getByLabelText(/Correo para recuperar/)).toHaveValue('laura@empresa.com');
  });

  it('lo pide y avisa de que mire el correo', async () => {
    abrir({ correoInicial: 'laura@empresa.com' });
    fireEvent.click(screen.getByText('Enviar'));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/auth/forgot-password', { email: 'laura@empresa.com' },
    ));
    expect(await screen.findByText('Mira tu correo')).toBeInTheDocument();
  });

  it('el mensaje no promete que el correo exista', async () => {
    abrir({ correoInicial: 'nadie@ejemplo.com' });
    fireEvent.click(screen.getByText('Enviar'));

    const aviso = await screen.findByRole('status');
    // «Si ese correo tiene una cuenta activa...» — condicional a proposito.
    expect(aviso.textContent).toMatch(/si ese correo tiene una cuenta activa/i);
    expect(aviso.textContent).not.toMatch(/te hemos enviado|hemos mandado/i);
  });

  it('sin correo no llama al servidor', async () => {
    abrir();
    fireEvent.click(screen.getByText('Enviar'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escribe tu correo');
    expect(post).not.toHaveBeenCalled();
  });
});

describe('cuando el servidor dice que no', () => {
  it('el freno de intentos se explica, no se queda mudo', async () => {
    post.mockRejectedValue({ message: 'Demasiadas peticiones. Intenta de nuevo en 15 minutos.' });
    abrir({ correoInicial: 'laura@empresa.com' });
    fireEvent.click(screen.getByText('Enviar'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/15 minutos/);
    // Y NO se enseña el «hecho»: seria mentir sobre un correo que no ha salido.
    expect(screen.queryByText('Mira tu correo')).toBeNull();
  });
});
