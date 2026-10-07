// @vitest-environment jsdom
// Traída de MultiCRM. ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CifrasProspectos from '@/modules/leads/components/CifrasProspectos';

// Las cuatro cifras vivían dentro de «Salud comercial». Se separaron al pasar
// ese bloque a una de las tres columnas: ahí no cabían y las etiquetas salían
// cortadas. Estas pruebas se mudaron con ellas.

const STATS = { total: 128, convertido: 15, sin_asignar: 9 };
const URGENCIAS = { overdue: 6, today: 2, urgent: 10 };

afterEach(cleanup);

describe('Las cuatro cifras de Prospectos', () => {
  it('saca los números que antes solo estaban dentro del desplegable de filtros', () => {
    render(<CifrasProspectos stats={STATS} urgencias={URGENCIAS} />);
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    // 15 de 128 = 11,7% → 12%
    expect(screen.getByText('12% de los visibles')).toBeInTheDocument();
  });

  it('avisa cuando hay prospectos que no trabaja nadie, y calla cuando no los hay', () => {
    const { rerender } = render(<CifrasProspectos stats={STATS} urgencias={URGENCIAS} />);
    expect(screen.getByText('no los trabaja nadie')).toBeInTheDocument();

    rerender(<CifrasProspectos stats={{ ...STATS, sin_asignar: 0 }} urgencias={URGENCIAS} />);
    expect(screen.getByText('todos tienen gestora')).toBeInTheDocument();
  });

  it('sin prospectos no pinta una fila de ceros', () => {
    // Ocupa sitio y no dice nada: la tabla ya avisa de que no hay ninguno.
    const { container } = render(
      <CifrasProspectos stats={{ total: 0 }} urgencias={{ overdue: 0, today: 0, urgent: 0 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('no divide por cero cuando el total es 0 pero hay urgencias', () => {
    const { container } = render(
      <CifrasProspectos stats={{ total: 0, convertido: 0 }} urgencias={{ overdue: 2, today: 1, urgent: 3 }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('la que filtra es un botón; las que no, no lo fingen', () => {
    render(<CifrasProspectos stats={STATS} urgencias={URGENCIAS} onFiltroRapido={() => {}} />);
    expect(screen.getByRole('button', { name: /piden atención/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Prospectos/ })).toBeNull();
  });

  it('pulsar dos veces la misma cifra quita el filtro en vez de repetirlo', () => {
    const onFiltroRapido = vi.fn();
    const { rerender } = render(
      <CifrasProspectos stats={STATS} urgencias={URGENCIAS} onFiltroRapido={onFiltroRapido} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /piden atención/i }));
    expect(onFiltroRapido).toHaveBeenCalledWith('urgent');

    rerender(
      <CifrasProspectos
        stats={STATS} urgencias={URGENCIAS}
        filtroRapido="urgent" onFiltroRapido={onFiltroRapido}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /piden atención/i }));
    expect(onFiltroRapido).toHaveBeenLastCalledWith(null);
  });
});
