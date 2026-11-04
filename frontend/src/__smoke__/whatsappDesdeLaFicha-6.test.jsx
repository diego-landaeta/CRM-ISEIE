// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/*
  WhatsApp desde la FICHA abierta del lead (#6, como CRM#25 en el 360).

  Hasta ahora el boton solo estaba en el listado: quien entraba a la ficha para
  mirar el historial tenia que volver atras para escribirle. Y tres reglas:
  - el telefono con el criterio del backend (si no es utilizable, no hay boton);
  - el registro del contacto NO se traga su error: si falla, se dice;
  - el chat se abre igual aunque el registro falle.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
const chat = vi.hoisted(() => ({ abrirChatCrm: vi.fn() }));
vi.mock('@/shared/lib/abrirChatCrm', () => ({ abrirChatCrm: chat.abrirChatCrm }));

import LeadInfoCard from '@/modules/leads/components/lead-detail/LeadInfoCard';

afterEach(cleanup);
beforeEach(() => { avisos.toast.mockReset(); chat.abrirChatCrm.mockReset(); });

const lead = { id: 7, nombre: 'Ana Test', email: 'ana@prueba.local', telefono: '+34 612 345 678', origen: 'meta_ads' };
const pintar = (props = {}, l = lead) => render(
  <MemoryRouter initialEntries={['/leads/7']}>
    <Routes>
      <Route path="/leads/7" element={<LeadInfoCard lead={l} onUpdate={vi.fn()} {...props} />} />
      <Route path="/whatsapp/chat" element={<p>chat abierto</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('WhatsApp desde la ficha del lead (#6)', () => {
  it('con un telefono utilizable sale el boton, abre el chat del CRM y apunta el contacto', async () => {
    chat.abrirChatCrm.mockResolvedValue('/whatsapp/chat');
    const onWhatsapp = vi.fn().mockResolvedValue(undefined);
    pintar({ onWhatsapp });
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    await waitFor(() => expect(screen.getByText('chat abierto')).toBeInTheDocument());
    expect(chat.abrirChatCrm).toHaveBeenCalledWith({ leadId: 7, telefono: '+34 612 345 678' });
    expect(onWhatsapp).toHaveBeenCalledWith('Contacto por WhatsApp (desde la ficha)');
    expect(avisos.toast).not.toHaveBeenCalled();
  });

  it('si el registro falla, lo dice en pantalla y el chat se abre igual', async () => {
    chat.abrirChatCrm.mockResolvedValue('/whatsapp/chat');
    pintar({ onWhatsapp: vi.fn().mockRejectedValue(new Error('500')) });
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    await waitFor(() => expect(screen.getByText('chat abierto')).toBeInTheDocument());
    expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'El contacto no ha quedado registrado', variant: 'destructive' }));
  });

  it('si no se puede abrir el chat, avisa y no apunta nada', async () => {
    chat.abrirChatCrm.mockResolvedValue(null);
    const onWhatsapp = vi.fn();
    pintar({ onWhatsapp });
    fireEvent.click(screen.getByRole('button', { name: /WhatsApp/ }));
    await waitFor(() => expect(avisos.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se ha podido abrir el chat' })));
    expect(onWhatsapp).not.toHaveBeenCalled();
  });

  it('sin telefono utilizable no se ofrece el boton', () => {
    pintar({}, { ...lead, telefono: '' });
    expect(screen.queryByRole('button', { name: /WhatsApp/ })).toBeNull();
  });
});
