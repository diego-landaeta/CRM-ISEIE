import { describe, it, expect, vi, beforeEach } from 'vitest';
// Paso en MultiCRM (ICTESS, 05-06/10); va igual en ISEIE por paridad.

// Borrar la ultima venta devuelve la ficha a donde estaba, y un «convertido»
// sin venta sigue saliendo en Prospectos (06/10).
//
// El caso: Orlando Villalobos (ICTESS, de Yolanda). Venta registrada a las
// 17:03, borrada a las 19:24 como «Error al cargar». La ficha se quedo en
// «convertido» sin venta y no salia ni en Prospectos ni en Clientes; al dia
// siguiente Yolanda no lo encontraba e intento darlo de alta otra vez.

const consultas = [];
let ficha;            // lo que devuelve la consulta del estado de la ficha

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/lead_status_history h/.test(sql) && /quedan_ventas/.test(sql)) return { rows: ficha ? [ficha] : [] };
    if (/COUNT\(\*\)/i.test(sql)) return { rows: [{ total: 0 }] };
    return { rows: [] };
  }),
  getClient: vi.fn(),
}));
vi.mock('../src/modules/conversions/conversion.model.js', () => ({
  findById: vi.fn(async (id) => ({ id, lead_id: 3916, producto_contratado: 'Diplomado en Mecánico Naval', importe_total: 1780 })),
  deleteConversion: vi.fn(async () => {}),
}));
vi.mock('../src/modules/leads/lead.model.js', async () => {
  const real = await vi.importActual('../src/modules/leads/lead.model.js');
  return { ...real, updateStatus: vi.fn(async () => {}) };
});

const { remove } = await import('../src/modules/conversions/conversion.service.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const YOLANDA = 11;

beforeEach(() => {
  consultas.length = 0;
  ficha = { status: 'convertido', quedan_ventas: false, antes: 'en_seguimiento' };
  vi.clearAllMocks();
});

describe('al borrar la ultima venta', () => {
  it('Orlando vuelve a «en seguimiento», su estado antes de «convertido»', async () => {
    await remove(633, { reason: 'error_carga', userId: YOLANDA });
    expect(leadModel.updateStatus).toHaveBeenCalledWith(3916, 'en_seguimiento', 'convertido', YOLANDA);
  });

  it('sin historial, a «contactado»: si se le llego a vender, se hablo con el', async () => {
    ficha.antes = null;
    await remove(633, { reason: 'error_carga', userId: YOLANDA });
    expect(leadModel.updateStatus).toHaveBeenCalledWith(3916, 'contactado', 'convertido', YOLANDA);
  });

  it('si le queda otra venta, sigue siendo cliente: no se toca', async () => {
    ficha.quedan_ventas = true;
    await remove(633, { reason: 'duplicada', userId: YOLANDA });
    expect(leadModel.updateStatus).not.toHaveBeenCalled();
  });

  it('si alguien ya lo cambio a mano, eso manda', async () => {
    ficha.status = 'no_interesado';
    await remove(633, { reason: 'anulacion_cliente', userId: YOLANDA });
    expect(leadModel.updateStatus).not.toHaveBeenCalled();
  });

  it('si devolverlo falla, la venta queda borrada igual y no revienta', async () => {
    leadModel.updateStatus.mockRejectedValueOnce(new Error('se cayo la base'));
    await expect(remove(633, { reason: 'error_carga', userId: YOLANDA })).resolves.toMatchObject({ message: 'Conversion eliminada' });
  });
});

const real = await vi.importActual('../src/modules/leads/lead.model.js');

describe('Prospectos: un «convertido» sin venta sigue saliendo', () => {
  const NO_ES_CLIENTE = /\(l\.status <> 'convertido'\s+OR NOT EXISTS \(SELECT 1 FROM conversions cx WHERE cx\.lead_id = l\.id\)\)/;

  it('la lista de Prospectos esconde solo los convertidos CON venta', async () => {
    await real.findAll({ projectId: 4, page: 1, limit: 20 }).catch(() => {});
    expect(consultas.some((q) => NO_ES_CLIENTE.test(q.sql))).toBe(true);
    // Y ya no queda el filtro viejo, que los escondia a todos.
    expect(consultas.some((q) => /AND l\.status <> 'convertido'\s+AND/.test(q.sql))).toBe(false);
  });

  it('Clientes sigue siendo «al menos una venta», sin esta regla', async () => {
    await real.findAll({ projectId: 4, page: 1, limit: 20, conConversion: true }).catch(() => {});
    expect(consultas.some((q) => NO_ES_CLIENTE.test(q.sql))).toBe(false);
  });
});
