// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { emitirPreguntandoSiPasa, pasaDeLoCobrado } from '@/modules/invoices/lib/masQueLoCobrado';

/*
  «Esta factura pasa de lo cobrado» (06/10): el servidor la para y dice cuánto
  queda; aquí se pregunta y, con un sí, se manda otra vez con permiso. Lo que no
  puede pasar: que se mande con permiso sin preguntar, o que un «no» la emita.
*/

// Así llega un 409 del cliente de la API: lanza, con el cuerpo en `data`.
function rechazo(code: string, error = 'Esta venta lleva cobrados 222.00 €…') {
  return Object.assign(new Error(error), { status: 409, data: { success: false, error, code } });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('pasaDeLoCobrado', () => {
  it('reconoce el suyo y devuelve el motivo del servidor', () => {
    expect(pasaDeLoCobrado(rechazo('MAS_QUE_LO_COBRADO', 'queda 111'))).toBe('queda 111');
  });

  it('cualquier otro error no es este', () => {
    expect(pasaDeLoCobrado(rechazo('NUMBER_TAKEN'))).toBeNull();
    expect(pasaDeLoCobrado(null)).toBeNull();
  });
});

describe('emitirPreguntandoSiPasa', () => {
  it('si sale a la primera, ni pregunta', async () => {
    const preguntar = vi.fn();
    const enviar = vi.fn(async () => ({ success: true, data: { id: 1 } }));
    await expect(emitirPreguntandoSiPasa(enviar, { preguntar })).resolves.toEqual({ success: true, data: { id: 1 } });
    expect(enviar).toHaveBeenCalledTimes(1);
    // El segundo es «emitir aunque parezca duplicada» (#1001): sin aviso, no.
    expect(enviar).toHaveBeenCalledWith(false, false);
    expect(preguntar).not.toHaveBeenCalled();
  });

  it('con un sí, la vuelve a mandar con permiso', async () => {
    const preguntar = vi.fn().mockResolvedValue(true);
    const enviar = vi.fn()
      .mockRejectedValueOnce(rechazo('MAS_QUE_LO_COBRADO', 'queda 111'))
      .mockResolvedValueOnce({ success: true, data: { id: 2 } });
    await expect(emitirPreguntandoSiPasa(enviar, { preguntar })).resolves.toEqual({ success: true, data: { id: 2 } });
    expect(enviar.mock.calls).toEqual([[false, false], [true, false]]);
    expect(preguntar.mock.calls[0][0]).toContain('queda 111');
  });

  it('con un no, no se emite y el error sigue su camino', async () => {
    const preguntar = vi.fn().mockResolvedValue(false);
    const enviar = vi.fn().mockRejectedValueOnce(rechazo('MAS_QUE_LO_COBRADO'));
    await expect(emitirPreguntandoSiPasa(enviar, { preguntar })).rejects.toMatchObject({ data: { code: 'MAS_QUE_LO_COBRADO' } });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('otro error ni pregunta ni reintenta', async () => {
    const preguntar = vi.fn();
    const enviar = vi.fn().mockRejectedValueOnce(rechazo('NUMBER_TAKEN'));
    await expect(emitirPreguntandoSiPasa(enviar, { preguntar })).rejects.toMatchObject({ data: { code: 'NUMBER_TAKEN' } });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(preguntar).not.toHaveBeenCalled();
  });
});

describe('el diálogo real (sin inyectar "preguntar")', () => {
  it('"Emitir" reenvía con permiso', async () => {
    const enviar = vi.fn()
      .mockRejectedValueOnce(rechazo('MAS_QUE_LO_COBRADO', 'queda 111'))
      .mockResolvedValueOnce({ success: true, data: { id: 3 } });
    let respuesta!: Promise<unknown>;
    await act(async () => { respuesta = emitirPreguntandoSiPasa(enviar); });
    expect(document.body.textContent).toContain('queda 111');
    const boton = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Emitir')!;
    await act(async () => { boton.click(); });
    await expect(respuesta).resolves.toEqual({ success: true, data: { id: 3 } });
    expect(enviar.mock.calls).toEqual([[false, false], [true, false]]);
  });
});
