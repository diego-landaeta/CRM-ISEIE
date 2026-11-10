import { describe, it, expect, vi, beforeEach } from 'vitest';

// #212 (gemela de diego-landaeta/CRM#259) · «Contactar» en la cola del día cierra el paso que la cola enseñaba.
//
// Diego, 07/10: «si en la cola del día hice el seguimiento 3 y le doy a
// contactar, se guarda pero aún se mantiene, y la checklist no lo guarda. Si lo
// hago luego en la checklist, sí sale».
//
// En producción de ISEIE, leads 18000 (08/10) y 19182 (05/10): «Contactar»
// en la cola con otro contacto ese mismo día; la regla de los contactos cierra
// un paso por día, así que el paso quedó abierto. Y 617 de los 632 «Contactar»
// de la cola dejaban el paso «por hacer» en la checklist.
//
// ANTES del arreglo `addInteraction` no recibía el paso y nunca llamaba a
// `ajustarPaso`: las pruebas de «marca el paso» fallan.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
}));
vi.mock('../src/modules/leads/lead.model.js', () => ({
  findByIdLight: vi.fn(async (id) => ({ id })),
  findById: vi.fn(async (id) => ({ id })),
  createInteraction: vi.fn(async (leadId, tipo, nota, userId) => ({ id: 500, lead_id: leadId, tipo, nota, created_by: userId })),
}));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({
  planificarPasosDeLead: vi.fn(),
  ajustarPaso: vi.fn(async (id) => ({ id, lead_id: 3948, orden: 3, estado: 'hecho' })),
}));

const { query } = await import('../src/shared/config/db.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const { ajustarPaso } = await import('../src/modules/proceso/proceso.model.js');
const { addInteraction } = await import('../src/modules/leads/lead.service.js');
const { createInteractionSchema } = await import('../src/modules/leads/lead.validation.js');

/** Responde a las consultas por su texto, no por su orden. */
function base({ yaApuntado = null, rafaga = false, pasoPendiente = true } = {}) {
  query.mockImplementation(async (sql) => {
    if (/AS rafaga/.test(sql)) return { rows: [{ ya_apuntado: yaApuntado, rafaga }], rowCount: 1 };
    if (/FROM lead_steps WHERE id = \$1 AND lead_id = \$2/.test(sql)) {
      return pasoPendiente ? { rows: [{ id: 9101 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('«Contactar» en la cola marca el paso, como la checklist', () => {
  it('el seguimiento 3, con otro contacto esa mañana: queda hecho', async () => {
    base();
    const r = await addInteraction(3948, 'llamada', 'Contacto del seguimiento 3', 12, undefined, { pasoId: 9101 });
    expect(leadModel.createInteraction).toHaveBeenCalledOnce();
    // El mismo camino que PATCH /proceso/paso-lead/:id desde la checklist.
    expect(ajustarPaso).toHaveBeenCalledWith(9101, { estado: 'hecho' }, 12);
    expect(r.paso_hecho).toBe(9101);
  });

  it('si ya lo tenía apuntado: no crea otro contacto, pero el paso sí se cierra', async () => {
    base({ yaApuntado: 54001 });
    const r = await addInteraction(3948, 'llamada', 'Contacto del seguimiento 3', 12, undefined, { pasoId: 9101 });
    expect(leadModel.createInteraction).not.toHaveBeenCalled();
    expect(ajustarPaso).toHaveBeenCalledWith(9101, { estado: 'hecho' }, 12);
    expect(r).toEqual({ id: 54001, lead_id: 3948, ya_apuntado: true, paso_hecho: 9101 });
  });

  it('con su propia nota escrita en la cola, también', async () => {
    base();
    await addInteraction(3970, 'whatsapp', 'Le mando el temario, contesta mañana', 12, undefined, { pasoId: 9101 });
    expect(ajustarPaso).toHaveBeenCalledWith(9101, { estado: 'hecho' }, 12);
  });
});

describe('lo que NO marca ningún paso', () => {
  it('un paso de otra persona o ya hecho: no se toca', async () => {
    base({ pasoPendiente: false });
    const r = await addInteraction(3948, 'llamada', 'Contacto del seguimiento 3', 12, undefined, { pasoId: 777 });
    expect(query.mock.calls.some(([sql, par]) => /lead_id = \$2 AND estado = 'pendiente'/.test(sql)
      && par[0] === 777 && par[1] === 3948)).toBe(true);
    expect(ajustarPaso).not.toHaveBeenCalled();
    expect(r.paso_hecho).toBeNull();
  });

  it('una nota interna no es haber hablado con nadie', async () => {
    base();
    await addInteraction(3948, 'nota', 'Copiado el mensaje «Seguimiento 3»', 12, undefined, { pasoId: 9101 });
    expect(ajustarPaso).not.toHaveBeenCalled();
  });

  it('una ráfaga se rechaza sin marcar nada', async () => {
    base({ rafaga: true });
    await expect(addInteraction(3948, 'llamada', 'Contacto del seguimiento 3', 12, undefined, { pasoId: 9101 }))
      .rejects.toMatchObject({ statusCode: 429 });
    expect(ajustarPaso).not.toHaveBeenCalled();
  });

  it('desde la ficha (sin paso), el contacto se apunta como siempre', async () => {
    base();
    const r = await addInteraction(3948, 'llamada', 'Le llamo y no contesta', 12);
    expect(ajustarPaso).not.toHaveBeenCalled();
    expect(r).toEqual(expect.objectContaining({ id: 500 }));
    expect(r).not.toHaveProperty('paso_hecho');
  });
});

describe('lo que manda la pantalla', () => {
  it('cada fila de la cola trae el id de su paso', async () => {
    const real = await vi.importActual('../src/modules/proceso/proceso.model.js');
    query.mockImplementation(async () => ({ rows: [], rowCount: 0 }));
    await real.colaDelDia({ projectIds: [5], asesoraId: null });
    expect(query.mock.calls.some(([sql]) => /q\.id AS paso_id/.test(sql))).toBe(true);
  });

  it('el esquema acepta el paso y rechaza uno que no es un id', () => {
    expect(createInteractionSchema.safeParse({ tipo: 'llamada', paso_id: 9101 }).success).toBe(true);
    expect(createInteractionSchema.safeParse({ tipo: 'llamada', paso_id: 'x' }).success).toBe(false);
    expect(createInteractionSchema.safeParse({ tipo: 'llamada', paso_id: -1 }).success).toBe(false);
  });
});
