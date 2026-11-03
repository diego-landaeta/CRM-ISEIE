import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Voz frente a texto en WhatsApp (#128, punto 4).
 *
 * Diego: «hay que diferenciar cuánto es escrito y cuánto por voz». Y el
 * documento comercial afirma que el saludo del día 1 «funciona mejor en nota
 * de voz». Eso se repite de oídas desde hace meses: o se cuenta, o seguirá
 * siendo una creencia — y las creencias sobre qué funciona son las que hacen
 * que una gestora mande cien audios y otra ninguno sin que nadie sepa cuál
 * acierta.
 */

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a), getClient: vi.fn(), default: {} }));

// El ámbito lo resuelve `proyectosDelAmbito` (recorta por los campus de la
// persona). Aquí se simula su respuesta: lo que se prueba es que ESTE módulo
// use lo que devuelve y no lo que venga en la URL.
const ambito = vi.fn();
vi.mock('../src/shared/utils/ambito.js', () => ({ proyectosDelAmbito: (...a) => ambito(...a) }));

const { vozOTexto, vozOTextoDeLaPeticion } = await import('../src/modules/whatsapp/vozOTexto.js');

beforeEach(() => { query.mockReset(); ambito.mockReset(); });

describe('voz o texto', () => {
  it('cuenta solo lo que SALE', async () => {
    // Lo que entra lo decide el cliente: mezclarlo daría un porcentaje que
    // sube cuando el prospecto manda audios, justo lo contrario de lo que se
    // quiere medir.
    query.mockResolvedValue({ rows: [] });
    await vozOTexto({});
    expect(query.mock.calls[0][0]).toMatch(/direccion = 'saliente'/);
  });

  it('saca el porcentaje por gestora y el del equipo', async () => {
    query.mockResolvedValue({ rows: [
      { user_id: 1, gestora: 'Ana', voz: 30, escrito: 70, total: 100 },
      { user_id: 2, gestora: 'Lucía', voz: 0, escrito: 50, total: 50 },
    ] });

    const r = await vozOTexto({});
    expect(r.porGestora[0].pctVoz).toBe(30);
    expect(r.porGestora[1].pctVoz).toBe(0);
    // El del equipo sale de la suma, no de la media de los porcentajes: con
    // dos gestoras de volumen distinto, la media de medias miente.
    expect(r.total).toMatchObject({ voz: 30, escrito: 120, total: 150, pctVoz: 20 });
  });

  it('sin mensajes no divide por cero', async () => {
    query.mockResolvedValue({ rows: [] });
    const r = await vozOTexto({});
    expect(r.total).toMatchObject({ voz: 0, total: 0, pctVoz: 0 });
  });

  it('el último día del rango entra entero', async () => {
    // Con `<=` sobre una fecha, lo mandado ese día después de medianoche se
    // queda fuera y el último día sale siempre a cero.
    query.mockResolvedValue({ rows: [] });
    await vozOTexto({ desde: '2026-09-01', hasta: '2026-09-18' });
    expect(query.mock.calls[0][0]).toMatch(/m\.ts < \(\$\d::date \+ 1\)/);
  });

  it('una gestora sin nombre no se pierde', async () => {
    // Los mensajes viejos pueden no tener `enviado_por`. Contarlos en «Sin
    // asignar» es peor que esconderlos, pero esconderlos es mucho peor: el
    // total dejaría de cuadrar con el banco de mensajes.
    query.mockResolvedValue({ rows: [{ user_id: null, gestora: 'Sin asignar', voz: 2, escrito: 3, total: 5 }] });
    const r = await vozOTexto({});
    expect(r.porGestora[0].gestora).toBe('Sin asignar');
    expect(r.total.total).toBe(5);
  });
});

describe('quién ve qué (#245)', () => {
  const req = (user, q = {}) => ({ user, query: q });

  it('el ámbito sale de proyectosDelAmbito, no de lo que diga la URL', async () => {
    // Alguien de CEDIA pide los proyectos 90 y 91, que son de otra empresa.
    // proyectosDelAmbito lo recorta a sus campus y es eso lo que se consulta.
    ambito.mockResolvedValue({ projectId: null, projectIds: [1, 2] });
    query.mockResolvedValue({ rows: [] });

    await vozOTextoDeLaPeticion(req({ role: 'admin', userId: 5 }, { projectIds: '90,91' }));

    expect(ambito).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1][0]).toEqual([1, 2]);
  });

  it('un proyecto suelto también pasa por ahí', async () => {
    ambito.mockResolvedValue({ projectId: 7, projectIds: null });
    query.mockResolvedValue({ rows: [] });

    await vozOTextoDeLaPeticion(req({ role: 'admin', userId: 5 }, { projectId: '7' }));

    expect(query.mock.calls[0][1][0]).toEqual([7]);
  });

  it('una gestora solo ve su propia fila', async () => {
    ambito.mockResolvedValue({ projectId: null, projectIds: [1] });
    query.mockResolvedValue({ rows: [] });

    await vozOTextoDeLaPeticion(req({ role: 'gestor', userId: 42 }));

    const [sql, par] = query.mock.calls[0];
    expect(sql).toMatch(/AND m\.enviado_por = \$\d::int/);
    expect(par).toContain(42);
  });

  it('admin, superadmin y soporte ven a todas las de su ámbito', async () => {
    for (const role of ['admin', 'superadmin', 'soporte']) {
      query.mockReset();
      ambito.mockResolvedValue({ projectId: null, projectIds: [1] });
      query.mockResolvedValue({ rows: [] });

      await vozOTextoDeLaPeticion(req({ role, userId: 9 }));

      expect(query.mock.calls[0][0], role).not.toMatch(/AND m\.enviado_por/);
    }
  });

  it('si el ámbito da un 403, no se consulta nada', async () => {
    ambito.mockRejectedValue(Object.assign(new Error('Ese proyecto no es tuyo'), { statusCode: 403 }));

    await expect(vozOTextoDeLaPeticion(req({ role: 'admin', userId: 5 }, { projectId: '99' })))
      .rejects.toThrow('Ese proyecto no es tuyo');
    expect(query).not.toHaveBeenCalled();
  });

  it('una fecha bien escrita sí llega a la consulta', async () => {
    ambito.mockResolvedValue({ projectId: null, projectIds: null });
    query.mockResolvedValue({ rows: [] });

    await vozOTextoDeLaPeticion(req({ role: 'superadmin', userId: 1 },
      { desde: '2026-09-01', hasta: '2026-09-18' }));

    expect(query.mock.calls[0][1]).toEqual(['2026-09-01', '2026-09-18']);
  });

  it('las fechas mal escritas se ignoran en vez de llegar al SQL', async () => {
    ambito.mockResolvedValue({ projectId: null, projectIds: null });
    query.mockResolvedValue({ rows: [] });

    await vozOTextoDeLaPeticion(req({ role: 'superadmin', userId: 1 },
      { desde: "2026-09-01'; DROP TABLE x;--", hasta: 'ayer' }));

    const [sql, par] = query.mock.calls[0];
    expect(sql).not.toMatch(/m.ts >=/);
    expect(par).toEqual([]);
  });
});
