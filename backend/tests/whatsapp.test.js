import { describe, it, expect, vi, beforeEach } from 'vitest';

// Se simula la capa de base de datos: lo que se prueba aqui es el criterio de
// quien tiene sala propia, no que Postgres sepa hacer un JOIN. Asi el fichero
// corre sin contenedor levantado, al reves que el resto de tests del backend.
const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));

const { tieneSalaPropia } = await import('../src/modules/whatsapp/whatsapp.model.js');

describe('tieneSalaPropia', () => {
  beforeEach(() => { query.mockReset(); });

  it('dice que no, sin preguntar a la base, si el id no es un entero', async () => {
    // sala() saca el userId con parseInt: un valor con letras llega como NaN.
    for (const malo of [NaN, undefined, null, '7', 1.5]) {
      expect(await tieneSalaPropia(malo)).toBe(false);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('dice que si cuando la consulta devuelve fila', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    expect(await tieneSalaPropia(6)).toBe(true);
  });

  it('dice que no cuando la consulta no devuelve nada', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await tieneSalaPropia(2)).toBe(false);
  });

  it('pregunta por el id que se le pasa', async () => {
    query.mockResolvedValue({ rows: [] });
    await tieneSalaPropia(11);
    expect(query.mock.calls[0][1]).toEqual([11]);
  });

  it('aplica el mismo criterio de rol que el panel de equipo', async () => {
    query.mockResolvedValue({ rows: [] });
    await tieneSalaPropia(6);
    const sql = query.mock.calls[0][0];
    // Si alguien cambia el criterio en un sitio y no en el otro, vuelven las
    // salas que no salen en ningun panel.
    expect(sql).toContain("u.role = 'gestor'");
    expect(sql).toContain("up.recibe_leads = TRUE");
    expect(sql).toContain('u.active = TRUE');
  });
});
