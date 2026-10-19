// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

/*
  «Plantillas de email» (crear y editar) con las piezas comunes (#106), como en MultiCRM: fuera
  la copia local de la clase de los campos (`inp`), el Field común en los
  cuatro campos (las etiquetas iban a mano, con el asterisco en el texto) y
  el aviso dice cuáles faltan.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1 } }) }));
vi.mock('@/modules/email-templates/api/templates.api', () => ({
  emailTemplatesApi: {
    list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    variables: vi.fn().mockResolvedValue({ success: true, data: [] }),
    create: vi.fn(), update: vi.fn(),
  },
}));

import EmailTemplatesPage from '@/modules/email-templates/pages/EmailTemplatesPage';

const abrirNueva = async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  await act(async () => { await Promise.resolve(); });
  fireEvent.click(screen.getByRole('button', { name: /Nueva plantilla/ }));
};

describe('Plantillas de email (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('los cuatro campos con el Field común, enlazados y con la clase común', async () => {
    await abrirNueva();
    for (const nombre of [/^Nombre interno/, /^Asunto/, /^Cuerpo HTML/, 'Descripción interna (opcional)']) {
      expect(screen.getByLabelText(nombre).className).toMatch(/bg-muted\/50/);
    }
    expect(screen.getAllByText('(obligatorio)')).toHaveLength(3);
    expect(screen.queryByText('Asunto *')).toBeNull();
  });

  it('el aviso dice cuáles faltan', async () => {
    await abrirNueva();
    fireEvent.change(screen.getByLabelText(/^Nombre interno/), { target: { value: 'Bienvenida' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Faltan datos', description: 'Falta el asunto en «Asunto» y el cuerpo en «Cuerpo HTML».',
    }));
  });
});
