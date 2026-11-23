import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  #773 · Las transferencias que entran por el EXTRACTO DEL BANCO (#766) avisan al
  webhook de transferencias de su campus, como las apuntadas a mano.

  Antes, `enlazarMovimiento` registraba el cobro con `addPayment` del modelo
  (forma de pago «transferencia») y no llamaba a `dispararCobro`: la venta quedaba
  cobrada y Make no se enteraba. Los caminos a mano ya avisaban
  (webhookTransferenciasDisparo.test.js).

  Sin base y sin red: el modelo, el enlace y el envío son de mentira.
*/

const disparados = [];
vi.mock('../src/modules/webhooks-salientes/webhooks-salientes.service.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    dispararCobro: vi.fn((paymentId, opciones) => { disparados.push({ paymentId, ...opciones }); }),
  };
});

const webhooksModel = {
  datosDelCobro: vi.fn(),
  webhooksParaCobro: vi.fn(),
  crearEnvio: vi.fn(),
  reclamarEnvio: vi.fn(async () => null),
};
vi.mock('../src/modules/webhooks-salientes/webhooks-salientes.model.js', () => webhooksModel);

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => (/FROM conversions/.test(sql) ? { rows: [{ project_id: 4 }] } : { rows: [] })),
}));

const reservado = {
  id: 55, huella: 'h-55', importe: '250.00', fecha_operacion: '2026-11-10', cuenta: '****1234',
  concepto: 'TRANSFERENCIA DE CLIENTE PRUEBA', referencia: 'REF-1', estado_antes: 'a_revisar',
};
vi.mock('../src/modules/cobros-externos/extracto.model.js', () => ({
  reservar: vi.fn(async () => ({ ...reservado })),
  marcarEnlazado: vi.fn(async () => {}),
  soltar: vi.fn(async () => {}),
  getMovimiento: vi.fn(async () => ({ id: 55, project_id: 4, conversion_payment_id: null })),
}));

let respuestaEnlace = { paymentId: 901, metodo: 'nuevo', conversionId: 70 };
vi.mock('../src/modules/cobros-externos/enlace.js', () => ({
  registrarCobroExterno: vi.fn(async () => respuestaEnlace),
  normalizarTexto: (t) => String(t || '').toLowerCase(),
}));

const extractos = await import('../src/modules/cobros-externos/extracto.service.js');
const { registrarCobroExterno } = await import('../src/modules/cobros-externos/enlace.js');
const { avisarCobro } = await vi.importActual('../src/modules/webhooks-salientes/webhooks-salientes.service.js');

beforeEach(() => {
  disparados.length = 0;
  respuestaEnlace = { paymentId: 901, metodo: 'nuevo', conversionId: 70 };
  vi.clearAllMocks();
});

describe('#773 · el abono del extracto que se enlaza a una venta avisa al webhook', () => {
  it('enlace automático: el cobro nuevo, como transferencia, se avisa', async () => {
    const r = await extractos.enlazarMovimiento(55, 70, { linkMethod: 'auto' });
    expect(r).toEqual({ paymentId: 901, metodo: 'nuevo' });
    expect(registrarCobroExterno).toHaveBeenCalledWith(expect.objectContaining({ metodo: 'transferencia', origen: 'santander' }));
    expect(disparados).toEqual([{ paymentId: 901, userId: null, metodo: 'transferencia' }]);
  });

  it('una persona confirma el abono dudoso: se avisa con quien lo confirma', async () => {
    const r = await extractos.confirmar(55, 70, 3);
    expect(r.metodo).toBe('nuevo');
    expect(disparados).toEqual([{ paymentId: 901, userId: 3, metodo: 'transferencia' }]);
  });

  it('si ya estaba apuntado a mano (dedup), no se avisa otra vez: avisó al apuntarlo', async () => {
    respuestaEnlace = { paymentId: 800, metodo: 'dedup', conversionId: 70 };
    await extractos.enlazarMovimiento(55, 70, { linkMethod: 'auto' });
    expect(disparados).toEqual([]);
  });

  it('si ese abono ya había entrado con su huella, tampoco', async () => {
    respuestaEnlace = { paymentId: 800, metodo: 'ya_estaba', conversionId: 70 };
    await extractos.enlazarMovimiento(55, 70, { linkMethod: 'manual', userId: 3 });
    expect(disparados).toEqual([]);
  });

  it('venta que no existe: ni cobro ni aviso', async () => {
    respuestaEnlace = null;
    expect(await extractos.enlazarMovimiento(55, 70)).toEqual({ error: 'NOT_FOUND' });
    expect(disparados).toEqual([]);
  });
});

describe('#773 · un campus sin webhook configurado no rompe el cobro', () => {
  const cobro = { id: 901, metodo: 'transferencia', campus_id: 4, empresa_id: 9, importe: '250.00', fecha: '2026-11-10' };

  it('se buscan los webhooks del campus y la empresa DE LA VENTA; sin ninguno, no se manda nada', async () => {
    webhooksModel.datosDelCobro.mockResolvedValueOnce(cobro);
    webhooksModel.webhooksParaCobro.mockResolvedValueOnce([]);
    await expect(avisarCobro(901, { metodo: 'transferencia' })).resolves.toEqual([]);
    expect(webhooksModel.webhooksParaCobro).toHaveBeenCalledWith({ metodo: 'transferencia', projectId: 4, issuerId: 9 });
    expect(webhooksModel.crearEnvio).not.toHaveBeenCalled();
  });

  it('si la consulta de webhooks falla (p. ej. sin la migración 206), no lanza', async () => {
    webhooksModel.datosDelCobro.mockResolvedValueOnce(cobro);
    webhooksModel.webhooksParaCobro.mockRejectedValueOnce(new Error('relation "webhooks_salientes" does not exist'));
    await expect(avisarCobro(901, { metodo: 'transferencia' })).resolves.toEqual([]);
  });
});
