// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/*
  «Avisar al tutor» (CRM#165 / CRM-ISEIE#188): el diálogo de la vista previa y el
  envío. Lo que defiende: que se ve el correo antes de mandarlo, que si ya se le
  mandó el de ese mes se dice quién y cuándo, y que repetirlo pide marcarlo.
  La API va doblada: aquí no sale ningún correo.
*/

const h = vi.hoisted(() => ({ previo: null, avisar: null }));
vi.mock('@/modules/tutores/api/tutores.api', () => ({
  tutoresApi: {
    previoDelAviso: (...a) => h.previo(...a),
    avisarTutor: (...a) => h.avisar(...a),
  },
}));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: AvisarTutorDialog, textoYaMandado, cuandoFue, escalaDelCorreo, ANCHO_DEL_CORREO } = await import('@/modules/tutores/components/AvisarTutorDialog');
const { toast } = await import('@/shared/hooks/useToast');

const AVISO = {
  tutorId: 3, nombre: 'Lola Hernández', email: 'lola@prueba.local', tieneIban: false,
  periodo: '2026-10', mes: 'octubre de 2026', pendiente: 17.82, formaciones: ['Máster'],
  grupos: [{ empresa: { id: 1, nombre: 'CEDIA', razon_social: 'CEDIA SL', nif: 'B1' }, campus: ['Psiko'], formaciones: ['Máster'],
    cuenta: { base: 17.82, iva: 3.74, retencion: 2.67, total: 18.89 } }],
  cuenta: { base: 17.82, iva: 3.74, retencion: 2.67, total: 18.89 },
  marca: { id: 5, nombre: 'Psiko Aprende' },
  avisos: [],
  asunto: 'Tus comisiones de octubre de 2026 · Psiko Aprende',
  html: '<!DOCTYPE html><html><body><p>Hola Lola</p></body></html>',
};
const YA = [{ id: 4, enviadoAt: '2026-11-12T09:20:00.000Z', enviadoPor: 'Vanessa', email: 'lola@prueba.local', total: 18.89 }];

const pintar = (props = {}) => render(
  <AvisarTutorDialog tutorId={3} periodo="2026-10" ambito={{ projectId: 5, issuerId: null }}
    onClose={vi.fn()} onEnviado={vi.fn()} {...props} />,
);

beforeEach(() => {
  h.previo = vi.fn(async () => ({ success: true, data: AVISO }));
  h.avisar = vi.fn(async () => ({ success: true, data: { enviado: true } }));
});

describe('la frase de «ya se le mandó»', () => {
  it('dice cuándo, en hora de Madrid, y quién', () => {
    expect(cuandoFue('2026-11-12T09:20:00.000Z')).toBe('12/11/2026 a las 10:20');
    expect(textoYaMandado('octubre de 2026', YA))
      .toBe('Ya se le mandó el aviso de octubre de 2026 el 12/11/2026 a las 10:20 por Vanessa.');
    expect(textoYaMandado('octubre de 2026', [])).toBeNull();
  });

  it('con varios, cuántos van', () => {
    expect(textoYaMandado('octubre de 2026', [...YA, { ...YA[0], id: 3 }])).toMatch(/Ya van 2 avisos de ese mes\./);
  });
});

describe('el diálogo', () => {
  it('pide la vista previa con el recorte de la pantalla y la enseña tal cual', async () => {
    pintar();
    const iframe = await screen.findByTitle('Vista previa del correo al tutor');
    expect(h.previo).toHaveBeenCalledWith(3, '2026-10', { projectId: 5, issuerId: null });
    expect(iframe.getAttribute('srcdoc')).toContain('Hola Lola');
    expect(iframe.getAttribute('sandbox')).toBe('');
    expect(screen.getByText(/17,82/)).toBeTruthy();       // se le debe
    expect(screen.getByText(/18,89/)).toBeTruthy();       // a facturar
    expect(screen.getByText(/No tenemos su IBAN/)).toBeTruthy();
  });

  it('sin avisos previos, «Enviar» lo manda con la nota y sin `repetir`', async () => {
    const onEnviado = vi.fn();
    pintar({ onEnviado });
    await screen.findByTitle('Vista previa del correo al tutor');
    fireEvent.change(screen.getByPlaceholderText(/Una devolución/), { target: { value: 'Hubo una devolución.' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar a lola@prueba.local/ }));
    await waitFor(() => expect(onEnviado).toHaveBeenCalled());
    expect(h.avisar).toHaveBeenCalledWith({
      tutorId: 3, periodo: '2026-10', projectId: 5, issuerId: null,
      asunto: null, nota: 'Hubo una devolución.', repetir: false,
    });
  });

  it('si ya se le mandó, lo dice y no deja repetir sin marcarlo', async () => {
    h.previo = vi.fn(async () => ({ success: true, data: { ...AVISO, avisos: YA } }));
    pintar();
    expect(await screen.findByText(/Ya se le mandó el aviso de octubre de 2026 el 12\/11\/2026 a las 10:20 por Vanessa/)).toBeTruthy();
    const boton = screen.getByRole('button', { name: /Mandar otra vez/ });
    expect(boton.disabled).toBe(true);
    fireEvent.click(boton);
    expect(h.avisar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/Mandárselo otra vez/));
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    await waitFor(() => expect(h.avisar).toHaveBeenCalledWith(expect.objectContaining({ repetir: true })));
  });

  it('si el servidor contesta que ya se mandó (409), se enseña y pide confirmarlo', async () => {
    const err = Object.assign(new Error('Ya se le mandó el aviso de octubre de 2026 el 25/11/2026 a las 10:00 (Ana).'), {
      status: 409, data: { code: 'YA_AVISADO' },
    });
    h.avisar = vi.fn(async () => { throw err; });
    pintar();
    await screen.findByTitle('Vista previa del correo al tutor');
    fireEvent.click(screen.getByRole('button', { name: /Enviar a/ }));
    expect(await screen.findByText(/el 25\/11\/2026 a las 10:00 \(Ana\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mandar otra vez/ }).disabled).toBe(true);
  });

  // QA del 26/11: el aviso emergente «No se ha enviado» tapaba el botón de
  // enviar a 1280. El motivo va dentro del diálogo, encima de los botones.
  it('si no sale, el motivo se dice dentro del diálogo y no en un aviso emergente', async () => {
    toast.mockClear();
    h.avisar = vi.fn(async () => { throw Object.assign(new Error('No hay clave de Brevo configurada en este entorno.'), { status: 502 }); });
    pintar();
    await screen.findByTitle('Vista previa del correo al tutor');
    fireEvent.click(screen.getByRole('button', { name: /Enviar a/ }));
    const alerta = await screen.findByText(/No hay clave de Brevo/);
    expect(alerta.closest('[role="alert"]').textContent).toMatch(/^No se ha enviado. No hay clave de Brevo/);
    expect(toast).not.toHaveBeenCalled();
    // Y el botón sigue ahí para reintentarlo.
    expect(screen.getByRole('button', { name: /Enviar a/ }).disabled).toBe(false);
  });
});

// QA del 26/11: a 375 px el correo (624 px) no cabía en el iframe (339 px).
describe('la vista previa en un móvil', () => {
  it('se reduce entera para caber, y en escritorio va a tamaño real', () => {
    expect(ANCHO_DEL_CORREO).toBe(624);
    expect(escalaDelCorreo(339)).toBeCloseTo(339 / 624, 5);
    expect(escalaDelCorreo(624)).toBe(1);
    expect(escalaDelCorreo(736)).toBe(1);   // nunca lo agranda
    expect(escalaDelCorreo(0)).toBe(1);     // sin medir todavía
  });
});
