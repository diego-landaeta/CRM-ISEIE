// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Secuencias de email» con las piezas comunes (#106), como en MultiCRM: la plantilla de cada
  paso con su Field (era un desplegable pequeño, con un icono y sin
  etiqueta), el nombre que falta se dice antes y dónde, y los errores ya no se
  callan ni salen con la descripción vacía. Lo que se puede guardar no cambia:
  el servidor solo exige el nombre.
*/

const h = vi.hoisted(() => ({ toast: vi.fn(), get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: h.toast }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISEIE' } }) }));
vi.mock('@/shared/api/client', () => ({ default: { get: h.get, post: h.post, patch: vi.fn(), delete: h.del } }));
vi.mock('@/modules/email-templates/api/templates.api', () => ({
  emailTemplatesApi: { list: vi.fn().mockResolvedValue({ success: true, data: [{ id: 4, name: 'Bienvenida' }] }) },
}));

import EmailSequencesPage from '@/modules/email-sequences/pages/EmailSequencesPage';

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });

describe('Secuencias de email (#106)', () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    h.get.mockResolvedValue({ success: true, data: [
      { id: 9, nombre: 'Seguimiento', trigger_event: 'lead_created', steps: [], active: true },
    ] });
  });

  const nueva = async () => {
    render(<EmailSequencesPage />);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: 'Nueva secuencia' }));
    await esperar();
  };

  it('la plantilla del paso lleva su Field, al tamaño de los demás y enlazada', async () => {
    await nueva();
    const plantilla = screen.getByRole('combobox', { name: 'Plantilla del paso 1' });
    expect(plantilla.closest('div.min-w-0').textContent).toMatch(/^Plantilla/);
    // El tamaño de siempre (h-9), no el pequeño (h-7) de antes.
    expect(plantilla.className).toMatch(/\bh-9\b/);
    expect(plantilla.className).not.toMatch(/\bh-7\b/);
    expect(document.querySelector('label[for="paso-0-plantilla"]')).toBeTruthy();
  });

  it('sin nombre no guarda, y dice dónde ponerlo', async () => {
    await nueva();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Falta el nombre de la secuencia',
      description: 'Escríbelo en «Nombre de la secuencia».',
    }));
    expect(h.post).not.toHaveBeenCalled();
  });

  it('con nombre se guarda aunque un paso no tenga asunto ni cuerpo (como antes)', async () => {
    h.post.mockResolvedValue({ success: true });
    await nueva();
    fireEvent.change(screen.getByLabelText(/^Nombre de la secuencia/), { target: { value: 'Bienvenida' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Guardar/ })); });
    expect(h.post).toHaveBeenCalledWith('/secuencias-email', expect.objectContaining({ nombre: 'Bienvenida' }));
  });

  it('solo el nombre se marca obligatorio: es lo único que exige el servidor', async () => {
    await nueva();
    expect(screen.getAllByText('(obligatorio)')).toHaveLength(1);
  });

  it('si no se puede borrar, lo dice (antes se callaba)', async () => {
    h.del.mockRejectedValue({ data: { error: 'Tiene envíos en curso' } });
    render(<EmailSequencesPage />);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar secuencia' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se pudo eliminar la secuencia', description: 'Tiene envíos en curso',
    })));
  });
});
