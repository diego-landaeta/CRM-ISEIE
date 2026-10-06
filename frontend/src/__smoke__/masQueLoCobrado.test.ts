// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
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
    const confirmar = vi.spyOn(window, 'confirm');
    const enviar = vi.fn(async () => ({ success: true, data: { id: 1 } }));
    await expect(emitirPreguntandoSiPasa(enviar)).resolves.toEqual({ success: true, data: { id: 1 } });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(enviar).toHaveBeenCalledWith(false);
    expect(confirmar).not.toHaveBeenCalled();
  });

  it('con un sí, la vuelve a mandar con permiso', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const enviar = vi.fn()
      .mockRejectedValueOnce(rechazo('MAS_QUE_LO_COBRADO', 'queda 111'))
      .mockResolvedValueOnce({ success: true, data: { id: 2 } });
    await expect(emitirPreguntandoSiPasa(enviar)).resolves.toEqual({ success: true, data: { id: 2 } });
    expect(enviar.mock.calls).toEqual([[false], [true]]);
    expect(confirmar.mock.calls[0][0]).toContain('queda 111');
  });

  it('con un no, no se emite y el error sigue su camino', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const enviar = vi.fn().mockRejectedValueOnce(rechazo('MAS_QUE_LO_COBRADO'));
    await expect(emitirPreguntandoSiPasa(enviar)).rejects.toMatchObject({ data: { code: 'MAS_QUE_LO_COBRADO' } });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('otro error ni pregunta ni reintenta', async () => {
    const confirmar = vi.spyOn(window, 'confirm');
    const enviar = vi.fn().mockRejectedValueOnce(rechazo('NUMBER_TAKEN'));
    await expect(emitirPreguntandoSiPasa(enviar)).rejects.toMatchObject({ data: { code: 'NUMBER_TAKEN' } });
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(confirmar).not.toHaveBeenCalled();
  });
});
