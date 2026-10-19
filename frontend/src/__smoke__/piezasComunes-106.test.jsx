// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  Las piezas comunes de los formularios (#106), las que salieron en la
  revisión:
  - `cn` juntaba mal los tamaños con nombre: `text-secundario` se tomaba por un
    color y se borraba, y la etiqueta de Field perdía sus 12 px;
  - el desplegable del CRM no dejaba enlazar su etiqueta (no tenía `id`) ni
    saltar con una letra, como el del navegador;
  - con un desplegable abierto, Escape cerraba el diálogo entero.
*/

import { cn } from '@/shared/lib/utils';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import { inputClass } from '@/shared/lib/ui';
import BuscadorCurso from '@/modules/tutores/components/BuscadorCurso';
import { avisoDeLoQueFalta, numerosMalEscritos } from '@/shared/lib/loQueFalta';

// Lo que hace el navegador cuando en una casilla de número hay «2-»: la da por
// vacía y marca validity.badInput. jsdom no lo hace solo.
const conAlgoQueNoEsNumero = (casilla) => Object.defineProperty(casilla, 'validity', { value: { badInput: true }, configurable: true });

describe('numerosMalEscritos (#106)', () => {
  it('recoge las casillas de número con algo que no es un número, con su etiqueta limpia', () => {
    const raiz = document.createElement('div');
    raiz.innerHTML = '<label for="a">Precio base (EUR) <span> *<span> (obligatorio)</span></span></label><input id="a" type="number">'
      + '<input id="b" type="number" aria-label="Cantidad del producto 1"><input id="c" type="number">';
    conAlgoQueNoEsNumero(raiz.querySelector('#a'));
    conAlgoQueNoEsNumero(raiz.querySelector('#b'));
    const malos = numerosMalEscritos(raiz);
    expect(malos.map((m) => m.que)).toEqual(['un número válido en «Precio base (EUR)»', 'un número válido en «Cantidad del producto 1»']);
    expect(malos[0]).toMatchObject({ title: 'Número no válido', description: 'En «Precio base (EUR)», escribe solo un número.' });
    expect(numerosMalEscritos(null)).toEqual([]);
  });
});

describe('avisoDeLoQueFalta: todo lo que falta, en un aviso (#106)', () => {
  const nombre = { title: 'Falta el nombre', description: 'Escríbelo en «Nombre».', que: 'el nombre en «Nombre»' };
  const email = { title: 'Falta el email', description: 'Escríbelo en «Email».', que: 'el email en «Email»' };
  const proyecto = { title: 'Falta el proyecto', description: 'Asigna uno.', que: 'al menos un proyecto' };

  it('si no falta nada, no hay aviso', () => {
    expect(avisoDeLoQueFalta([])).toBeNull();
  });

  it('si falta una cosa, su aviso de siempre', () => {
    expect(avisoDeLoQueFalta([nombre])).toEqual({ title: 'Falta el nombre', description: 'Escríbelo en «Nombre».', variant: 'destructive' });
  });

  it('si faltan varias, todas juntas y bien enlazadas', () => {
    expect(avisoDeLoQueFalta([nombre, email])?.description).toBe('Falta el nombre en «Nombre» y el email en «Email».');
    expect(avisoDeLoQueFalta([nombre, email, proyecto])).toEqual({
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre», el email en «Email» y al menos un proyecto.',
      variant: 'destructive',
    });
  });
});

const PAISES = [
  { value: '', label: 'Sin especificar' },
  { value: 'es', label: 'España' },
  { value: 'mx', label: 'México' },
  { value: 'pe', label: 'Perú' },
  { value: 'pt', label: 'Portugal' },
];

describe('piezas comunes de los formularios (#106)', () => {
  afterEach(() => cleanup());
  it('cn conserva los tamaños con nombre al lado de un color', () => {
    expect(cn('text-secundario', 'text-muted-foreground')).toBe('text-secundario text-muted-foreground');
    expect(cn('text-tabla uppercase', 'text-destructive')).toBe('text-tabla uppercase text-destructive');
    // Entre dos tamaños, o dos espacios, sigue ganando el último.
    expect(cn('text-secundario', 'text-sm')).toBe('text-sm');
    expect(cn('gap-tarjeta', 'gap-fila')).toBe('gap-fila');
  });

  it('la etiqueta de Field mantiene sus 12 px (text-secundario)', () => {
    render(<Field label="Nombre" htmlFor="x"><input id="x" /></Field>);
    const etiqueta = screen.getByText('Nombre');
    expect(etiqueta.className).toMatch(/\btext-secundario\b/);
    expect(etiqueta.className).toMatch(/\btext-muted-foreground\b/);
  });

  it('el desplegable acepta id: su etiqueta lo nombra', () => {
    render(
      <Field label="País" htmlFor="pais">
        <Select id="pais" value="" onChange={vi.fn()} options={PAISES} />
      </Field>,
    );
    expect(screen.getByLabelText('País').getAttribute('role')).toBe('combobox');
  });

  it('una letra salta a la opción que empieza por ella, sin mirar tildes', () => {
    const onChange = vi.fn();
    render(<Select value="" onChange={onChange} options={PAISES} ariaLabel="País" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'País' }));
    const lista = screen.getByRole('listbox');
    fireEvent.keyDown(lista, { key: 'p' });
    fireEvent.keyDown(lista, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('pe');
    // Otra vez la misma letra: la siguiente que empieza igual.
    fireEvent.click(screen.getByRole('combobox', { name: 'País' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'p' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'p' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('pt');
    // «e» encuentra «España»: la tilde no cuenta.
    fireEvent.click(screen.getByRole('combobox', { name: 'País' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'e' });
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('es');
  });

  it('con el desplegable abierto, Escape lo cierra a él y no al diálogo', () => {
    const cerrar = vi.fn();
    function Dialogo() {
      useEscapeKey(cerrar, true);
      const [v, setV] = useState('');
      return <Select value={v} onChange={setV} options={PAISES} ariaLabel="País" />;
    }
    render(<Dialogo />);
    fireEvent.click(screen.getByRole('combobox', { name: 'País' }));
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(cerrar).not.toHaveBeenCalled();
    // Ya cerrado el desplegable, Escape sí cierra el diálogo.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  // Visto en la prueba a mano: con una sección del menú lateral desplegada
  // (también lleva aria-expanded), el segundo Escape no cerraba el diálogo.
  // Visto en la prueba a mano: al saltar con «p», la lista se desplazaba bajo
  // el ratón quieto y «entraba» en otra opción, que pisaba la del teclado.
  it('el ratón quieto no pisa la opción elegida con el teclado; moviéndolo, sí', () => {
    function Uno() {
      const [v, setV] = useState('');
      return <Select value={v} onChange={setV} options={PAISES} ariaLabel="País" />;
    }
    render(<Uno />);
    const boton = screen.getByRole('combobox', { name: 'País' });
    fireEvent.click(boton);
    const lista = screen.getByRole('listbox');
    fireEvent.keyDown(lista, { key: 'p' });
    const otra = screen.getAllByRole('option').find((o) => !/^P/i.test(o.textContent.trim()));
    fireEvent.mouseEnter(otra);
    fireEvent.keyDown(lista, { key: 'Enter' });
    expect(boton.textContent).toMatch(/^P/i);
    // Moviendo el ratón de verdad sí manda el ratón.
    fireEvent.click(boton);
    fireEvent.mouseMove(screen.getAllByRole('option').find((o) => o.textContent.trim() === otra.textContent.trim()));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(boton.textContent).toBe(otra.textContent);
  });

  it('una sección desplegada del menú no impide que Escape cierre el diálogo', () => {
    const cerrar = vi.fn();
    function Pantalla() {
      useEscapeKey(cerrar, true);
      const [v, setV] = useState('');
      return (
        <>
          <button type="button" aria-expanded="true">Prospectos</button>
          <Select value={v} onChange={setV} options={PAISES} ariaLabel="País" />
        </>
      );
    }
    render(<Pantalla />);
    fireEvent.click(screen.getByRole('combobox', { name: 'País' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cerrar).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it('el desplegable y los buscadores se ven como una casilla: mismo fondo y esquinas', () => {
    // Al lado de una casilla de texto, el desplegable salía casi blanco y más
    // redondeado, y la caja del buscador, blanca (lo vio la revisión en el
    // navegador, 16/10).
    const comunes = ['bg-muted/50', 'rounded-md', 'border-border'];
    for (const c of comunes) expect(inputClass).toContain(c);
    render(<Select value="" onChange={vi.fn()} options={PAISES} ariaLabel="País" />);
    const desplegable = screen.getByRole('combobox', { name: 'País' });
    for (const c of comunes) expect(desplegable.className).toContain(c);
    const { container } = render(<BuscadorCurso cursos={[{ id: 1, nombre: 'Máster', precio: '900' }]} valor={null} onElegir={vi.fn()} id="buscar" />);
    const caja = container.querySelector('#buscar').parentElement;
    for (const c of comunes) expect(caja.className).toContain(c);
    expect(caja.className).not.toContain('bg-background');
  });
});
