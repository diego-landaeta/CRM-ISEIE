import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La lectura de la semana para el correo de los lunes (#30, cuarta subfase).
 *
 * La regla que lo distingue de las preguntas: aqui una cifra sin comprobar NO se
 * marca, se DESCARTA la lectura entera. Una pregunta tiene a alguien delante que
 * puede matizar; un correo sale a las 8 de la mañana a direccion y nadie esta.
 *
 * Y la otra, que no se negocia: que falle no puede impedir que llegue el reporte.
 */

const gasto = {
  compruebaAntesDeGastar: vi.fn(async () => ({ permitido: true, motivo: null, estado: {} })),
  registrar: vi.fn(async () => ({ apuntado: true })),
};
vi.mock('../src/shared/services/gastoIA.service.js', () => gasto);

const clave = vi.fn(async () => 'clave-falsa-de-prueba');
vi.mock('../src/modules/credentials/credentials.model.js', () => ({ getDecryptedValue: (...a) => clave(...a) }));

const { lecturaDeLaSemana, variacion, datosDeLaSemana } =
  await import('../src/modules/ia-analisis/lectura.js');

const ESTA = { prospectos: 120, convertidos: 18, ventas: 9, cobrado: 12000 };
const ANTES = { prospectos: 100, convertidos: 20, ventas: 8, cobrado: 10000 };
const base = { empresa: 'CEDIA', periodo: { from: '2026-08-03', to: '2026-08-09' }, esta: ESTA, anterior: ANTES, userId: 4 };

const contesta = (texto) => vi.fn(async () => ({
  content: [{ type: 'text', text: texto }], usage: { input_tokens: 200, output_tokens: 60 },
}));

beforeEach(() => {
  gasto.compruebaAntesDeGastar.mockReset();
  gasto.compruebaAntesDeGastar.mockResolvedValue({ permitido: true, motivo: null, estado: {} });
  gasto.registrar.mockClear();
  clave.mockReset();
  clave.mockResolvedValue('clave-falsa-de-prueba');
});

describe('las variaciones van calculadas, no las calcula el modelo', () => {
  it('variacion', () => {
    expect(variacion(120, 100)).toBe(20);
    expect(variacion(18, 20)).toBe(-10);
    expect(variacion(12000, 10000)).toBe(20);
  });

  it('sin base de comparacion no hay variacion, no se inventa', () => {
    expect(variacion(5, 0)).toBeNull();
    expect(variacion(5, undefined)).toBeNull();
    expect(variacion('x', 3)).toBeNull();
  });

  it('los datos del modelo llevan las dos semanas y la variacion de cada cifra', () => {
    const d = datosDeLaSemana({ empresa: 'CEDIA', periodo: {}, esta: ESTA, anterior: ANTES });
    expect(d.variacion_porcentual).toEqual({ prospectos: 20, convertidos: -10, ventas: 12.5, cobrado: 20 });
    expect(d.esta_semana).toEqual(ESTA);
    expect(d.semana_anterior).toEqual(ANTES);
  });

  it('una cifra sin base no entra en las variaciones', () => {
    const d = datosDeLaSemana({ empresa: 'X', periodo: {}, esta: { ventas: 3 }, anterior: { ventas: 0 } });
    expect(d.variacion_porcentual).toEqual({});
  });
});

describe('cuando sale', () => {
  it('con cifras que estan en los datos, devuelve la lectura', async () => {
    const llamar = contesta('Los prospectos subieron un 20 % hasta 120 y las ventas a 9; las conversiones bajaron un 10 %.');
    const r = await lecturaDeLaSemana({ ...base, llamar });
    expect(r).toEqual({ texto: expect.stringContaining('120') });
  });

  it('cita las variaciones calculadas sin que cuente como inventar', async () => {
    const llamar = contesta('El cobrado subió un 20 % y las ventas un 12,5 %.');
    expect(await lecturaDeLaSemana({ ...base, llamar })).not.toBeNull();
  });

  it('apunta el gasto de la llamada', async () => {
    await lecturaDeLaSemana({ ...base, llamar: contesta('Subieron los prospectos un 20 %.') });
    expect(gasto.registrar).toHaveBeenCalledWith(expect.objectContaining({
      origen: 'ia-semanal', userId: 4, entrada: 200, salida: 60,
    }));
  });

  it('le manda al modelo las cifras de las dos semanas y nada mas', async () => {
    const llamar = contesta('Subieron los prospectos un 20 %.');
    await lecturaDeLaSemana({ ...base, llamar });
    const { messages, tools } = llamar.mock.calls[0][0];
    const enviado = JSON.parse(messages[0].content);
    expect(enviado.esta_semana).toEqual(ESTA);
    expect(enviado.variacion_porcentual.cobrado).toBe(20);
    // Sin herramientas: no consulta la base, lee lo que le dan.
    expect(tools).toBeUndefined();
  });
});

describe('cuando NO sale: el correo sigue como siempre', () => {
  it('con una cifra que no esta en los datos, se descarta la lectura entera', async () => {
    const llamar = contesta('Los prospectos subieron un 20 %, y se hicieron 4.321 llamadas.');
    expect(await lecturaDeLaSemana({ ...base, llamar })).toBeNull();
  });

  it('si el modelo calcula por su cuenta, tambien se descarta', async () => {
    // 120 → 100 es -16,7 % visto desde la otra semana, pero ese numero no esta en
    // los datos: lo que esta es la variacion ya calculada.
    const llamar = contesta('La semana anterior fue un 16,7 % menor.');
    expect(await lecturaDeLaSemana({ ...base, llamar })).toBeNull();
  });

  it('sin clave, no llama a nadie', async () => {
    clave.mockResolvedValue(null);
    const previa = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const llamar = contesta('x');
      expect(await lecturaDeLaSemana({ ...base, llamar })).toBeNull();
      expect(llamar).not.toHaveBeenCalled();
    } finally {
      if (previa !== undefined) process.env.ANTHROPIC_API_KEY = previa;
    }
  });

  it('con el tope agotado, no llama a nadie', async () => {
    gasto.compruebaAntesDeGastar.mockResolvedValue({ permitido: false, motivo: 'tope', estado: {} });
    const llamar = contesta('x');
    expect(await lecturaDeLaSemana({ ...base, llamar })).toBeNull();
    expect(llamar).not.toHaveBeenCalled();
  });

  it('si la IA falla, devuelve null, apunta el intento y NO lanza', async () => {
    const llamar = vi.fn().mockRejectedValue(new Error('Anthropic 529'));
    await expect(lecturaDeLaSemana({ ...base, llamar })).resolves.toBeNull();
    expect(gasto.registrar).toHaveBeenCalledWith(expect.objectContaining({
      origen: 'ia-semanal', fallo: expect.stringContaining('529'),
    }));
  });

  it('si falla lo que apunta el gasto, tampoco lanza', async () => {
    gasto.registrar.mockRejectedValueOnce(new Error('base caida'));
    await expect(lecturaDeLaSemana({ ...base, llamar: contesta('Subieron los prospectos un 20 %.') }))
      .resolves.toBeNull();
  });

  it('un texto vacio no es una lectura', async () => {
    expect(await lecturaDeLaSemana({ ...base, llamar: contesta('   ') })).toBeNull();
  });
});
