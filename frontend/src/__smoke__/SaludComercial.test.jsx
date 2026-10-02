// @vitest-environment jsdom
// Traída de MultiCRM. ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SaludComercial from '@/modules/leads/components/SaludComercial';

// Las cuatro cifras se fueron a `CifrasProspectos` y sus pruebas con ellas.
// Aquí queda el reparto por estado, que es lo que ocupa la columna.

const STATS = {
  total: 128,
  nuevo: 31,
  por_contactar: 24,
  contactado: 33,
  en_seguimiento: 19,
  convertido: 15,
  no_interesado: 6,
};

afterEach(cleanup);

describe('Salud comercial', () => {
  it('el reparto por estado suma lo que hay, en porcentaje sobre el total', () => {
    render(<SaludComercial stats={STATS} />);
    expect(screen.getByText('31 · 24%')).toBeInTheDocument();  // nuevos
    expect(screen.getByText('33 · 26%')).toBeInTheDocument();  // contactados
    expect(screen.getByText('6 · 5%')).toBeInTheDocument();    // no interesados
  });

  it('están los seis estados, y en el orden del embudo', () => {
    // «Por contactar» va antes que «Contactados» aunque la letra diga lo
    // contrario: el orden es el del embudo, no el alfabético.
    render(<SaludComercial stats={STATS} />);
    const etiquetas = screen.getAllByText(
      /^(Nuevos|Por contactar|Contactados|En seguimiento|Convertidos|No interesados)$/,
    ).map((e) => e.textContent);
    expect(etiquetas).toEqual([
      'Nuevos', 'Por contactar', 'Contactados', 'En seguimiento', 'Convertidos', 'No interesados',
    ]);
  });

  it('sin prospectos no pinta un bloque de ceros', () => {
    const { container } = render(<SaludComercial stats={{ total: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('cada estado filtra la tabla al pulsarlo', () => {
    const onFiltroEstado = vi.fn();
    render(<SaludComercial stats={STATS} onFiltroEstado={onFiltroEstado} />);
    fireEvent.click(screen.getByText('Convertidos').closest('button'));
    expect(onFiltroEstado).toHaveBeenCalledWith('convertido');
  });

  it('sin `onFiltroEstado` las filas no fingen ser pulsables', () => {
    render(<SaludComercial stats={STATS} />);
    expect(screen.queryByRole('button', { name: /convertidos/i })).toBeNull();
  });
});
