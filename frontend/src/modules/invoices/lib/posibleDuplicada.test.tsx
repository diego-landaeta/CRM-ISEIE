// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import { posibleDuplicada, textoDuplicada, fechaLegible, preguntarSiEmitirDuplicada, type OtraFactura } from './posibleDuplicada';
import { emitirPreguntandoSiPasa } from './masQueLoCobrado';

/*
  CRM#819 (gemela CRM-ISEIE#500) · Antes de emitir una posible duplicada, el
  diálogo «Ya existe la factura X de este cliente por el mismo importe el día
  Y. ¿Emitir otra igualmente?», con «Cancelar» y «Emitir igualmente». Con un sí
  se reenvía con `confirmar_duplicada: true`.
*/

const otra: OtraFactura = { id: 7, numero: '2026/0123', fecha: '2026-11-17', importe: 125.5, cliente: 'Cliente de prueba' };

// El 409 tal cual lo lanza el cliente HTTP: el cuerpo de la respuesta en `data`.
const error409 = () => Object.assign(new Error('Ya existe la factura'), {
  status: 409,
  data: { success: false, error: 'Ya existe la factura…', code: 'POSIBLE_DUPLICADA', data: { otra } },
});

describe('reconocer el aviso', () => {
  it('del error del cliente HTTP y de una respuesta { success: false }', () => {
    expect(posibleDuplicada(error409())).toEqual(otra);
    expect(posibleDuplicada({ success: false, code: 'POSIBLE_DUPLICADA', data: { otra } })).toEqual(otra);
  });

  it('otro error no es este aviso', () => {
    expect(posibleDuplicada({ data: { code: 'MAS_QUE_LO_COBRADO' } })).toBeNull();
    expect(posibleDuplicada(new Error('x'))).toBeNull();
    expect(posibleDuplicada(null)).toBeNull();
  });

  it('el texto del diálogo', () => {
    expect(fechaLegible('2026-11-17')).toBe('17/11/2026');
    expect(textoDuplicada(otra)).toBe(
      'Ya existe la factura 2026/0123 de este cliente por el mismo importe el día 17/11/2026. ¿Emitir otra igualmente?');
  });
});

describe('el diálogo', () => {
  const boton = (texto: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === texto)!;
  // El diálogo se desmonta justo después del clic: se espera y se comprueba que se fue.
  const seCierra = async () => {
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  };

  it('sale con el texto y los dos botones; «Emitir igualmente» → sí', async () => {
    let respuesta!: Promise<boolean>;
    await act(async () => { respuesta = preguntarSiEmitirDuplicada(otra); });
    expect(document.body.textContent).toContain(textoDuplicada(otra));
    expect(boton('Cancelar')).toBeTruthy();
    await act(async () => { boton('Emitir igualmente').click(); });
    await expect(respuesta).resolves.toBe(true);
    await seCierra();
  });

  it('«Cancelar» → no', async () => {
    let respuesta!: Promise<boolean>;
    await act(async () => { respuesta = preguntarSiEmitirDuplicada(otra); });
    await act(async () => { boton('Cancelar').click(); });
    await expect(respuesta).resolves.toBe(false);
    await seCierra();
  });
});

describe('emitir preguntando', () => {
  it('con «Emitir igualmente», reenvía confirmada', async () => {
    const enviar = vi.fn(async (_permitir: boolean, duplicada: boolean) => {
      if (!duplicada) throw error409();
      return { success: true, data: { codigo: '2026/0124' } };
    });
    const preguntarDuplicada = vi.fn(async () => true);
    await expect(emitirPreguntandoSiPasa(enviar, { preguntarDuplicada })).resolves.toEqual({ success: true, data: { codigo: '2026/0124' } });
    expect(preguntarDuplicada).toHaveBeenCalledWith(otra);
    expect(enviar.mock.calls).toEqual([[false, false], [false, true]]);
  });

  it('con «Cancelar», no reenvía y el error sigue su camino', async () => {
    const enviar = vi.fn(async () => { throw error409(); });
    await expect(emitirPreguntandoSiPasa(enviar, { preguntarDuplicada: async () => false }))
      .rejects.toMatchObject({ status: 409 });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('los dos avisos seguidos: cada uno se pregunta una vez y el reenvío lleva los dos', async () => {
    const enviar = vi.fn(async (permitir: boolean, duplicada: boolean) => {
      if (!permitir) throw Object.assign(new Error('pasa'), { data: { code: 'MAS_QUE_LO_COBRADO', error: 'Pasa de lo cobrado' } });
      if (!duplicada) throw error409();
      return 'emitida';
    });
    const preguntar = vi.fn(() => true);
    const preguntarDuplicada = vi.fn(async () => true);
    await expect(emitirPreguntandoSiPasa(enviar, { preguntar, preguntarDuplicada })).resolves.toBe('emitida');
    expect(preguntar).toHaveBeenCalledTimes(1);
    expect(preguntarDuplicada).toHaveBeenCalledTimes(1);
    expect(enviar.mock.calls.at(-1)).toEqual([true, true]);
  });

  it('sin aviso, una sola llamada', async () => {
    const enviar = vi.fn(async () => 'ok');
    const preguntarDuplicada = vi.fn();
    await expect(emitirPreguntandoSiPasa(enviar, { preguntarDuplicada })).resolves.toBe('ok');
    expect(preguntarDuplicada).not.toHaveBeenCalled();
    expect(enviar).toHaveBeenCalledTimes(1);
  });
});
