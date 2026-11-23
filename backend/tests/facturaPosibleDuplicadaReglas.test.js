import { describe, it, expect, vi } from 'vitest';

/**
 * CRM#819 (gemela CRM-ISEIE#500) · La regla de «posible duplicada», sin base.
 *
 * 17/11/2026, ISEIE: una factura emitida dos veces para el mismo cobro y el
 * mismo cliente, con el nombre cambiado solo por un espacio. Aqui se prueba lo
 * que decide si dos nombres o dos NIF son el mismo, y la forma del 409. Lo que
 * pasa contra la base de verdad esta en facturaPosibleDuplicada.test.js.
 */

vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

const D = await import('../src/modules/invoices/posible-duplicada.js');

describe('el mismo cliente aunque lo escriban distinto', () => {
  it('un espacio de mas, al principio, al final o repetido: el mismo nombre', () => {
    const base = D.normalizarNombre('Juana Pérez Gómez');
    expect(D.normalizarNombre('Juana  Pérez Gómez')).toBe(base);
    expect(D.normalizarNombre(' Juana Pérez Gómez ')).toBe(base);
    expect(D.normalizarNombre('Juana\u00a0Pérez\tGómez')).toBe(base);
  });

  it('sin mayusculas ni tildes', () => {
    expect(D.normalizarNombre('JUANA PEREZ GOMEZ')).toBe('juana perez gomez');
    expect(D.normalizarNombre('Íñigo Muñoz Çelik')).toBe('inigo munoz celik');
  });

  it('un nombre distinto sigue siendo distinto', () => {
    expect(D.normalizarNombre('Juana Pérez')).not.toBe(D.normalizarNombre('Juan Pérez'));
  });

  it('el NIF, solo letras y cifras; vacio o «—» no es un NIF', () => {
    expect(D.normalizarNif('12345678-z')).toBe('12345678Z');
    expect(D.normalizarNif(' b 12.345.678 ')).toBe('B12345678');
    expect(D.normalizarNif('—')).toBeNull();
    expect(D.normalizarNif('')).toBeNull();
    expect(D.normalizarNif(null)).toBeNull();
  });

  it('la tabla de tildes de SQL esta alineada (cada letra con la suya)', () => {
    const { CON_TILDE, SIN_TILDE } = D.TABLA_TILDES;
    expect([...CON_TILDE]).toHaveLength([...SIN_TILDE].length);
    // Y dice lo mismo que la version JS, letra a letra.
    [...CON_TILDE].forEach((c, i) => expect(D.normalizarNombre(c), c).toBe(SIN_TILDE[i]));
  });
});

describe('la condicion de SQL', () => {
  const sql = D.condicionParecida({ nombre: '$1', nif: '$2', total: '$3', fecha: '$4' });

  it('solo facturas normales y ni anuladas ni borradores', () => {
    expect(sql).toMatch(/i\.tipo = 'normal'/);
    expect(sql).toMatch(/i\.estado NOT IN \('cancelada', 'borrador'\)/);
  });

  it('el mismo total con ±0,01 y 7 dias o menos', () => {
    expect(sql).toMatch(/ABS\(i\.total - \(\$3\)::numeric\) <= 0\.01/);
    expect(sql).toMatch(/ABS\(i\.fecha_emision::date - COALESCE\(\(\$4\)::date, CURRENT_DATE\)\) <= 7/);
  });

  it('el mismo cliente: nombre normalizado, NIF o la misma venta', () => {
    expect(sql).toMatch(/translate\(lower\(/);
    expect(sql).toMatch(/regexp_replace\(upper\(COALESCE\(i\.cliente_nif/);
    expect(sql).toMatch(/i\.conversion_id = NULL::int/);
  });
});

describe('el aviso', () => {
  const otra = { id: 7, numero: '2026/0123', fecha: '2026-11-17', importe: 125.5, cliente: 'Juana Pérez' };

  it('409 POSIBLE_DUPLICADA con numero, fecha e importe de la otra', () => {
    const e = D.errorPosibleDuplicada(otra);
    expect(e.statusCode).toBe(409);
    expect(e.code).toBe('POSIBLE_DUPLICADA');
    expect(e.data).toEqual({ otra });
    expect(e.message).toContain('2026/0123');
    expect(e.message).toContain('17/11/2026');
    expect(e.message).toContain('125,50');
  });

  it('para la emision si hay otra y no viene confirmada', async () => {
    const exec = vi.fn(async () => ({
      rows: [{ id: 7, codigo: '2026/0123', fecha: '2026-11-17', total: 125.5, cliente_nombre: 'Juana Pérez' }],
    }));
    await expect(D.frenarSiPosibleDuplicada({ nombre: 'Juana  Pérez', total: 125.5 }, { exec }))
      .rejects.toMatchObject({ code: 'POSIBLE_DUPLICADA', data: { otra } });
    const [, params] = exec.mock.calls[0];
    expect(params).toEqual(['Juana  Pérez', null, 125.5, null, null, null]);
  });

  it('con «Emitir igualmente» ni siquiera pregunta a la base', async () => {
    const exec = vi.fn();
    await expect(D.frenarSiPosibleDuplicada({ nombre: 'x', total: 1 }, { confirmada: true, exec })).resolves.toBeNull();
    expect(exec).not.toHaveBeenCalled();
  });

  it('sin otra parecida, sigue', async () => {
    const exec = vi.fn(async () => ({ rows: [] }));
    await expect(D.frenarSiPosibleDuplicada({ nombre: 'x', total: 1 }, { exec })).resolves.toBeNull();
  });

  it('se confirma con `confirmar_duplicada` (y los nombres de antes)', () => {
    expect(D.vieneConfirmada({ confirmar_duplicada: true })).toBe(true);
    expect(D.vieneConfirmada({ confirmarDuplicada: true })).toBe(true);
    expect(D.vieneConfirmada({ permitirParecida: true })).toBe(true);
    expect(D.vieneConfirmada({})).toBe(false);
    expect(D.vieneConfirmada({ confirmar_duplicada: 'true' })).toBe(false);
  });

  it('la cola: una sola consulta y vacia si no hay cobros', async () => {
    const exec = vi.fn(async () => ({ rows: [{ payment_id: 5, id: 7, codigo: 'X', fecha: '2026-11-17', total: 10 }] }));
    expect((await D.duplicadasDeLaCola([], exec)).size).toBe(0);
    const m = await D.duplicadasDeLaCola([5, 6], exec);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(m.get(5)).toMatchObject({ numero: 'X', importe: 10 });
    expect(m.has(6)).toBe(false);
  });
});

/*
  Ana (CEDIA), 20/11/2026: «me salía que el número 296 ya estaba asignado».
  No era el número: era el aviso de duplicada contra la factura de OTRA
  clienta del mismo diplomado. El aviso dice ahora de quién es la otra y en
  qué se parecen.
*/
describe('el aviso dice de quién es la otra y por qué se parece', () => {
  const base = { id: 555, numero: '2026/0296', fecha: '2026-11-16', importe: 784, cliente: 'Alba Santos Ruescas' };

  it('nombra a la otra clienta y empieza por «Posible duplicada»', () => {
    const t = D.textoPosibleDuplicada({ ...base, coincide: 'nombre' });
    expect(t).toMatch(/^Posible duplicada de la factura 2026\/0296 de Alba Santos Ruescas \(784,00 €, 16\/11\/2026\)/);
    expect(t).toContain('mismo nombre de cliente');
    expect(t).toContain('otra cuota');
    expect(t).not.toMatch(/ya existe/i);
  });

  it('con el NIF, enseña cuál', () => {
    expect(D.textoPosibleDuplicada({ ...base, coincide: 'nif', nif: '0000' })).toContain('mismo NIF (0000)');
  });

  it('con la venta, lo dice', () => {
    expect(D.porQueSeParece({ coincide: 'venta' })).toBe('es de la misma venta');
  });

  it('la consulta devuelve en qué coincide y el NIF de la otra', async () => {
    const exec = vi.fn(async () => ({
      rows: [{ id: 555, codigo: '2026/0296', fecha: '2026-11-16', total: 784, cliente_nombre: 'Alba Santos Ruescas', cliente_nif: '0000', coincide: 'nif' }],
    }));
    const otra = await D.buscarPosibleDuplicada({ nombre: 'Sara', nif: '0000', total: 784 }, exec);
    expect(otra).toMatchObject({ numero: '2026/0296', cliente: 'Alba Santos Ruescas', nif: '0000', coincide: 'nif' });
    const [sql] = exec.mock.calls[0];
    expect(sql).toMatch(/THEN 'venta'/);
    expect(sql).toMatch(/THEN 'nif'/);
    expect(sql).toMatch(/AS coincide/);
  });
});
