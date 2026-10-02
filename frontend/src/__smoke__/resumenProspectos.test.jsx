// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BloquePlegable from '@/shared/components/ui/BloquePlegable';
import SiguientesAcciones from '@/modules/leads/components/SiguientesAcciones';

/*
  El «Resumen del día» de Prospectos, traído de MultiCRM.

  Diego, repaso del 15/09: «tiene que nacer cerrado, no desplegado». Ocupa la
  primera pantalla entera y empuja la tabla abajo; quien lo quiera abierto lo
  abre una vez y se le queda así.

  Se prueba con las mismas props que le pone LeadsPage.
*/

const ALMACEN = 'crm.bloque.prospectos-resumen';

function Resumen() {
  return (
    <BloquePlegable
      clave="prospectos-resumen"
      abiertoPorDefecto={false}
      titulo="Resumen del dia"
      resumen="3 piden atención"
    >
      <p>dentro del resumen</p>
    </BloquePlegable>
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe('el Resumen del día', () => {
  it('nace cerrado cuando no hay nada guardado', () => {
    render(<Resumen />);
    expect(screen.getByRole('button', { name: /resumen del dia/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('dentro del resumen')).toBeNull();
    // Cerrado, dice si vale la pena abrirlo.
    expect(screen.getByText('3 piden atención')).toBeInTheDocument();
  });

  it('quien lo dejó abierto lo sigue viendo abierto', () => {
    localStorage.setItem(ALMACEN, '1');
    render(<Resumen />);
    expect(screen.getByRole('button', { name: /resumen del dia/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('dentro del resumen')).toBeInTheDocument();
  });

  it('abrirlo se recuerda para la próxima vez', () => {
    render(<Resumen />);
    fireEvent.click(screen.getByRole('button', { name: /resumen del dia/i }));
    expect(screen.getByText('dentro del resumen')).toBeInTheDocument();
    expect(localStorage.getItem(ALMACEN)).toBe('1');
  });
});

describe('Siguientes acciones', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 16, 10, 0)); // 16/09/2026
  });
  afterEach(() => { vi.useRealTimers(); });

  it('empieza por lo más atrasado, no por lo más cercano', () => {
    render(
      <SiguientesAcciones
        leads={[
          { id: 1, nombre: 'Para pasado mañana', next_reminder_at: '2026-09-18' },
          { id: 2, nombre: 'Vencido hace tres', next_reminder_at: '2026-09-13' },
          { id: 3, nombre: 'Para hoy', next_reminder_at: '2026-09-16' },
          { id: 4, nombre: 'Sin recordatorio', next_reminder_at: null },
        ]}
      />,
    );
    const nombres = screen.getAllByText(/^(Para pasado mañana|Vencido hace tres|Para hoy|Sin recordatorio)$/)
      .map((e) => e.textContent);
    expect(nombres).toEqual(['Vencido hace tres', 'Para hoy', 'Para pasado mañana']);
    expect(screen.getByText('vencido hace 3d')).toBeInTheDocument();
  });
});
