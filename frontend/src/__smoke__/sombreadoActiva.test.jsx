// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * CRM#524 · Carlos, 28/10: «para saber quién está activa, que me haga un sombreado».
 * En Prospectos, el recuadro «Último lead de cada gestora» sombrea a la que ha hecho
 * algo en el CRM dentro de la ventana de la asignación por actividad. En ISEIE el
 * recuadro llega con el sombreado (ISEIE #293); antes solo estaba en el 360.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: { get } }));

import UltimoLeadAsignado, { textoActiva } from '@/modules/leads/components/UltimoLeadAsignado';

const fila = (id, gestora, activa = null) => ({
  id, gestora, lead_id: null, lead_nombre: null, lead_entro: null, lead_producto: null, lead_canal: null,
  horas_sin_recibir: 2, hoy: 1, semana: 3, mes: 9, activa,
});

beforeEach(() => { get.mockReset(); });
afterEach(cleanup);

describe('el porqué de «activa»', () => {
  it('dice hace cuánto y qué hizo', () => {
    expect(textoActiva({ hace_min: 3, que: 'contacto' })).toBe('activa hace 3 min (contacto)');
    expect(textoActiva({ hace_min: 0, que: 'estado' })).toBe('activa ahora mismo (cambio de estado)');
  });
});

describe('el recuadro', () => {
  it('sombrea a la activa y cuenta cuántas hay', async () => {
    get.mockResolvedValue({ success: true, data: { gestoras: [fila(6, 'Ana Comercial', { hace_min: 3, que: 'contacto' }), fila(7, 'Dayana Comercial')], sin_responsable: 0, ventana_min: 5 } });
    const { container } = render(<UltimoLeadAsignado projectId={2} />);
    expect(await screen.findByText('1 activa ahora')).toBeTruthy();
    const marcadas = container.querySelectorAll('tr[data-activa="si"]');
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0].textContent).toMatch(/Ana Comercial/);
    expect(screen.getByText('activa hace 3 min (contacto)')).toBeTruthy();
  });

  it('sin nadie activa, lo dice y no sombrea a nadie', async () => {
    get.mockResolvedValue({ success: true, data: { gestoras: [fila(6, 'Ana Comercial'), fila(7, 'Dayana Comercial')], sin_responsable: 0, ventana_min: 5 } });
    const { container } = render(<UltimoLeadAsignado projectId={2} />);
    expect(await screen.findByText('Ninguna activa ahora')).toBeTruthy();
    expect(container.querySelectorAll('tr[data-activa="si"]')).toHaveLength(0);
  });
});
