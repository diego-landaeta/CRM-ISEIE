// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * CRM#534, parte 6 · «Último lead de cada gestora»: la columna Canal salía «—»
 * en todas. Con el canal que deduce el CRM (#48) se pinta su etiqueta de canal;
 * sin él, el texto de respaldo que manda el servidor.
 */

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ default: { get } }));

import UltimoLeadAsignado from '@/modules/leads/components/UltimoLeadAsignado';

const fila = (id, gestora, lead_canal_codigo, lead_canal) => ({
  id, gestora, lead_id: id * 10, lead_nombre: `Prospecto ${id}`, lead_entro: '2026-11-18T10:42:00Z',
  lead_producto: null, lead_canal, lead_canal_codigo,
  horas_sin_recibir: 1, hoy: 1, semana: 1, mes: 1, activa: null,
});

beforeEach(() => { get.mockReset(); });

describe('la columna Canal', () => {
  it('enseña el canal deducido con su etiqueta y, sin él, el texto de respaldo', async () => {
    get.mockResolvedValue({ success: true, data: { gestoras: [
      fila(1, 'Gestora A', 'meta_ads', 'Facebook'),
      fila(2, 'Gestora B', 'chatgpt_ia', 'Sin origen'),
      fila(3, 'Gestora C', 'instagram', 'Sin origen'),
      fila(4, 'Gestora D', null, 'Formulario web'),
      fila(5, 'Gestora E', null, null),
    ], sin_responsable: 0, ventana_min: 5 } });
    const { container } = render(<UltimoLeadAsignado projectId={2} />);
    await screen.findByText('Gestora A');

    const canal = (n) => container.querySelectorAll('tbody tr')[n].querySelectorAll('td')[2].textContent;
    expect(canal(0)).toBe('Meta Ads');        // manda el deducido, no «Facebook»
    expect(canal(1)).toBe('ChatGPT IA');
    expect(canal(2)).toBe('Instagram');
    expect(canal(3)).toBe('Formulario web');
    expect(canal(4)).toBe('—');               // solo sin ningún dato
  });
});
