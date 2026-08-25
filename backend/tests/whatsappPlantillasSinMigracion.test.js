import { describe, it, expect, vi, beforeEach } from 'vitest';

// Que pasa mientras la migracion 122 no este aplicada.
//
// Importa porque no depende de nosotros: la aprueba Diego (tarea #21) y puede
// tardar. Lo que NO puede pasar es que el CRM se llene de errores por eso.

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));

const { listTemplates } = await import('../src/modules/whatsapp/whatsapp.model.js');

/** Lo que contesta Postgres cuando la tabla no existe. */
const sinTabla = () => Object.assign(new Error('relation "whatsapp_templates" does not exist'), { code: '42P01' });

describe('plantillas sin la migracion 122', () => {
  beforeEach(() => { query.mockReset(); });

  it('devuelve la lista vacia en vez de reventar', async () => {
    // Esto se pide en CADA carga del listado de prospectos. Si subiera el error,
    // cada carga contestaria 500 — y el manejador escribe todos los 5xx en la
    // tabla de errores, o sea que una migracion pendiente llenaria el panel de
    // soporte de ruido.
    query.mockRejectedValue(sinTabla());
    await expect(listTemplates({ projectId: 1, userId: 3 })).resolves.toEqual([]);
  });

  it('los DEMAS errores si suben', async () => {
    // Tragarselos todos esconderia una base caida o una consulta mal escrita.
    query.mockRejectedValue(Object.assign(new Error('connection terminated'), { code: '57P01' }));
    await expect(listTemplates({ projectId: 1, userId: 3 })).rejects.toThrow('connection terminated');
  });

  it('con la tabla puesta devuelve lo que hay', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, label: 'Saludo inicial' }] });
    const r = await listTemplates({ projectId: 1, userId: 3 });
    expect(r).toHaveLength(1);
  });

  it('nunca enseña las personales de otra persona', async () => {
    query.mockResolvedValue({ rows: [] });
    await listTemplates({ projectId: 1, userId: 3 });
    const sql = query.mock.calls[0][0];
    // Ni siquiera siendo admin: una plantilla personal es de quien la escribio.
    expect(sql).toContain("t.ambito = 'compartida' OR t.owner_id = $2");
    expect(query.mock.calls[0][1]).toEqual([1, 3]);
  });
});
