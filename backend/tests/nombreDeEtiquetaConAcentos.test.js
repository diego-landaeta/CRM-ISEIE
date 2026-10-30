import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool, { query } from '../src/shared/config/db.js';
import { guardarEtiqueta } from '../src/modules/whatsapp/chat.model.js';

/**
 * El nombre bueno de una etiqueta no se pisa con el pelado (#148).
 *
 * Evolution guarda los nombres sin acentos —pela todo lo que no sea ASCII— así
 * que por la carga inicial llegan «Facturacin», «Semana prxima», «No ledos».
 * Solo el aviso de edición trae el nombre entero.
 *
 * Con un `SET nombre = EXCLUDED.nombre` a secas mandaba el orden de llegada:
 * llegaba el bueno por el aviso y la siguiente carga lo volvía a dejar pelado.
 * Las 18 etiquetas de la cuenta de Ana estaban así, todas creadas en el mismo
 * segundo por una carga.
 *
 * CONTRA LA BASE: la regla vive en un CASE dentro del ON CONFLICT, así que un
 * doble probaría el doble.
 */

const INSTANCIA = '[test] acentos';

async function nombreDe(waId) {
  const { rows } = await query(
    'SELECT nombre FROM wa_etiquetas WHERE instancia = $1 AND wa_id = $2',
    [INSTANCIA, waId]);
  return rows[0]?.nombre ?? null;
}

beforeAll(async () => {
  await query('DELETE FROM wa_etiquetas WHERE instancia = $1', [INSTANCIA]);
});

afterAll(async () => {
  await query('DELETE FROM wa_etiquetas WHERE instancia = $1', [INSTANCIA]);
  await pool.end();
});

describe('el nombre de una etiqueta', () => {
  it('la carga inicial lo deja pelado, y el aviso lo corrige', async () => {
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '1', nombre: 'Facturacin' });
    expect(await nombreDe('1')).toBe('Facturacin');

    await guardarEtiqueta({ instancia: INSTANCIA, waId: '1', nombre: 'Facturación' });
    expect(await nombreDe('1')).toBe('Facturación');
  });

  it('y la siguiente carga YA NO lo vuelve a pelar', async () => {
    // Esto es el fallo: pasaba cada vez que se recargaban las etiquetas.
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '2', nombre: 'Semana próxima' });
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '2', nombre: 'Semana prxima' });
    expect(await nombreDe('2')).toBe('Semana próxima');
  });

  it('pero un cambio de nombre de verdad sí entra', async () => {
    // La regla no puede congelar el nombre: si en el móvil la renombran, el
    // CRM tiene que seguirla. Entre dos nombres sin acentos manda el último.
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '3', nombre: 'Pendiente' });
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '3', nombre: 'Cerrado' });
    expect(await nombreDe('3')).toBe('Cerrado');
  });

  it('y renombrar de uno con acentos a otro con acentos también', async () => {
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '4', nombre: 'Facturación' });
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '4', nombre: 'Edición' });
    expect(await nombreDe('4')).toBe('Edición');
  });

  it('los emojis cuentan igual que los acentos', async () => {
    // Son lo mismo para Evolution: todo lo que no es ASCII se cae. Una
    // etiqueta «🔥 Caliente» no debe volver a quedarse en «Caliente».
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '5', nombre: '🔥 Caliente' });
    await guardarEtiqueta({ instancia: INSTANCIA, waId: '5', nombre: 'Caliente' });
    expect(await nombreDe('5')).toBe('🔥 Caliente');
  });
});
