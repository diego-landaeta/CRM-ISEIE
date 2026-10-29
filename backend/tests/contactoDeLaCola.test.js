import { describe, it, expect, vi, beforeEach } from 'vitest';

// El botón «Contactado, al siguiente» de la cola ya no inventa contactos.
//
// Diego, 29/10: a las gestoras «se les ponen interacciones sin ellas ponerlas».
// En producción de ISEIE había 748 «Contacto del seguimiento N»: Fabiola escribía
// su nota en la ficha y luego pulsaba el botón para pasar a la siguiente (una
// «llamada» que nunca hizo), y Catherine o María Gabriela tenían ráfagas de 20 a
// 40 en unos segundos, una cada 0,2–0,4 s.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [{}], rowCount: 1 })),
}));
vi.mock('../src/modules/leads/lead.model.js', () => ({
  findByIdLight: vi.fn(async (id) => ({ id })),
  findById: vi.fn(async (id) => ({ id })),
  createInteraction: vi.fn(async (leadId, tipo, nota, userId) => ({ id: 500, lead_id: leadId, tipo, nota, created_by: userId })),
}));

const { query } = await import('../src/shared/config/db.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const { addInteraction, NOTA_DE_LA_COLA } = await import('../src/modules/leads/lead.service.js');

const comprobacion = (fila) => query.mockResolvedValueOnce({ rows: [fila], rowCount: 1 });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('texto que pone la cola', () => {
  it('reconoce los dos textos por defecto y nada más', () => {
    expect(NOTA_DE_LA_COLA.test('Contacto del seguimiento 3')).toBe(true);
    expect(NOTA_DE_LA_COLA.test('Seguimiento de fin de mes')).toBe(true);
    expect(NOTA_DE_LA_COLA.test('Seguimiento 3. Beca, espero su respuesta')).toBe(false);
    expect(NOTA_DE_LA_COLA.test('Contacto del seguimiento 3, no contesta')).toBe(false);
  });
});

describe('addInteraction desde la cola', () => {
  it('si ya apuntó algo suyo en esa persona, no crea otra «llamada»', async () => {
    comprobacion({ ya_apuntado: 54001, rafaga: false });
    const r = await addInteraction(20418, 'llamada', 'Contacto del seguimiento 3', 2);
    expect(r).toEqual({ id: 54001, lead_id: 20418, ya_apuntado: true });
    expect(leadModel.createInteraction).not.toHaveBeenCalled();
  });

  it('una ráfaga (menos de 2 s con la anterior) se rechaza', async () => {
    comprobacion({ ya_apuntado: null, rafaga: true });
    await expect(addInteraction(19880, 'llamada', 'Contacto del seguimiento 3', 16))
      .rejects.toMatchObject({ statusCode: 429, code: 'DEMASIADO_RAPIDO' });
    expect(leadModel.createInteraction).not.toHaveBeenCalled();
  });

  it('sin nada suyo antes y sin ráfaga, se apunta como siempre', async () => {
    comprobacion({ ya_apuntado: null, rafaga: false });
    const r = await addInteraction(19138, 'llamada', 'Contacto del seguimiento 4', 2);
    expect(r.id).toBe(500);
    expect(leadModel.createInteraction).toHaveBeenCalledOnce();
  });

  it('una nota escrita por la gestora no pasa por el freno', async () => {
    const r = await addInteraction(20418, 'whatsapp', 'Seguimiento 3. Beca, espero su respuesta', 2);
    expect(r.id).toBe(500);
    // (En el 360 el contacto además mueve la etiqueta, con su propia consulta.)
    expect(query.mock.calls.some(([sql]) => /AS rafaga/.test(sql))).toBe(false);
  });
});
