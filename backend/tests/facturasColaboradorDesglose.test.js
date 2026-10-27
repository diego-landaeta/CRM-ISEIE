import { describe, it, expect, beforeAll, vi } from 'vitest';
import supertest from 'supertest';

/**
 * Facturas de colaboradores (#202, segunda parte) · el desglose al subir la
 * factura: fijo, por hora y por proyecto, con IVA e IRPF, y «No cuadra».
 * Desde la corrección de Diego del 13/10, cuadra si el total del PDF es lo
 * escrito (el desglose ya no decide): los PDF se hacen con pdf-lib.
 *
 * La misma prueba que en MultiCRM, con la base simulada (facturasColaborador.base.js)
 * y, si pdf-parse aún no está instalado, el lector simulado de facturasColaborador.pdf.js.
 */

vi.mock('../src/shared/config/db.js', async () => (await import('./facturasColaborador.base.js')).moduloDb);
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({ enUtf8: (s) => s }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key), getFromR2: vi.fn(), deleteFromR2: vi.fn(),
}));
vi.mock('pdf-parse/lib/pdf-parse.js', async (importOriginal) => {
  try { return await importOriginal(); } catch {
    return { default: (await import('./facturasColaborador.pdf.js')).pdfParseSimulado };
  }
});

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const { base } = await import('./facturasColaborador.base.js');
const { API, E, P, montarApp, sembrar, PDF } = await import('./facturasColaborador.app.js');
const { pdfCon } = await import('./facturasColaborador.pdf.js');
const { uploadToR2 } = await import('../src/shared/services/r2.service.js');
const { prepararMes } = await import('../src/modules/facturas-colaborador/facturas.service.js');
const { calcularDesglose } = await import('../src/modules/facturas-colaborador/desglose.js');
const request = supertest(await montarApp());

const PERIODO = '2026-06-01';
const C = {};       // colaboradores por clave
const enlace = {};  // clave → token en claro

const subir = (clave, campos, archivo = PDF) => {
  const r = request.post(`${API}/enlace/${enlace[clave]}`).attach('archivo', archivo, 'factura.pdf');
  for (const [k, v] of Object.entries(campos)) r.field(k, v);
  return r;
};
const fila = (clave) => {
  const f = base.datos.facturas.find((x) => x.colaborador_id === C[clave] && x.periodo === PERIODO);
  const n = (v) => (v === null || v === undefined ? null : Number(v));
  return { id: f.id, base: n(f.base), iva: n(f.iva), irpf: n(f.irpf), total: n(f.total), horas: n(f.horas), cuadra: f.cuadra ?? null, importe_pdf: n(f.importe_pdf), subida_at: f.subida_at };
};
const lineas = (clave) => base.datos.lineas.filter((l) => l.factura_id === fila(clave).id).sort((a, b) => a.orden - b.orden)
  .map((l) => ({ orden: l.orden, concepto: l.concepto, project_id: l.project_id, horas: Number(l.horas), tarifa: Number(l.tarifa), importe: Number(l.importe) }));

beforeAll(async () => {
  sembrar(base);
  const fichas = {
    horas: { modalidad: 'hora', tarifa_hora: 22, iva_pct: 21, irpf_pct: 15 },
    fijo: { modalidad: 'fijo', importe_fijo: 600, iva_pct: 21, irpf_pct: 15 },
    proyecto: { modalidad: 'proyecto', tarifa_hora: 30, iva_pct: 0, irpf_pct: 0 },
    sin: { modalidad: null },
  };
  for (const [clave, cobro] of Object.entries(fichas)) {
    const id = ++base.datos.sec.colaborador;
    base.datos.colaboradores.push({
      id, nombre: clave, email: `${clave}@test.local`, area: 'seo', nif: null, notas: null, user_id: null, activo: true,
      alta_desde: '2026-06-01', baja_desde: '2026-07-01', created_at: new Date(), updated_at: new Date(),
    });
    base.datos.ce.push({
      colaborador_id: id, issuer_id: E.A, importe_acordado: 600, modalidad: cobro.modalidad,
      importe_fijo: cobro.importe_fijo ?? null, tarifa_hora: cobro.tarifa_hora ?? null, iva_pct: cobro.iva_pct ?? null, irpf_pct: cobro.irpf_pct ?? null,
    });
    C[clave] = id;
  }
  for (const p of await prepararMes(PERIODO)) {
    const [clave] = Object.entries(C).find(([, id]) => id === p.colaboradorId);
    enlace[clave] = p.token;
  }
});

describe('el cálculo del desglose', () => {
  const desglose = (cobro, entrada, campusIds = []) =>
    calcularDesglose({ cobro, area: 'seo', periodo: PERIODO, entrada, campus: campusIds });

  it('fijo: una línea, ya rellena; 600 + 21 % − 15 % = 636,00 (el ejemplo del aviso de pago)', () => {
    const d = desglose({ modalidad: 'fijo', importe_fijo: 600, iva_pct: 21, irpf_pct: 15 }, {});
    expect(d.lineas).toEqual([expect.objectContaining({ concepto: 'Servicios de SEO · junio 2026', importe: 600, horas: null })]);
    expect(d).toMatchObject({ base: 600, iva: 126, irpf: 90, total: 636, horas: null });
  });

  it('por hora: 18 h × 22 €/h = 396 € de base (el ejemplo de la definición)', () => {
    const d = desglose({ modalidad: 'hora', tarifa_hora: 22, iva_pct: 21, irpf_pct: 15 }, { horas: '18' });
    expect(d).toMatchObject({ base: 396, iva: 83.16, irpf: 59.4, total: 419.76, horas: 18 });
    expect(d.lineas[0]).toMatchObject({ horas: 18, tarifa: 22, importe: 396 });
  });

  it('por proyecto: la suma de las líneas da la base; las horas «7,5» valen', () => {
    const d = desglose({ modalidad: 'proyecto', tarifa_hora: 30, iva_pct: 0, irpf_pct: 0 }, {
      lineas: JSON.stringify([
        { concepto: 'Landing de la feria', project_id: 7, horas: '7,5' },
        { concepto: 'SEO del blog', horas: 4 },
      ]),
    }, [7]);
    expect(d.lineas.map((l) => [l.concepto, l.project_id, l.horas, l.importe])).toEqual([
      ['Landing de la feria', 7, 7.5, 225], ['SEO del blog', null, 4, 120],
    ]);
    expect(d).toMatchObject({ base: 345, total: 345, horas: 11.5 });
  });

  it('lo que no vale se rechaza con un mensaje claro', () => {
    const p = { modalidad: 'proyecto', tarifa_hora: 30, iva_pct: 0, irpf_pct: 0 };
    const casos = [
      [{ modalidad: 'hora', tarifa_hora: 22, iva_pct: 0, irpf_pct: 0 }, {}, 'Escribe las horas'],
      [{ modalidad: 'hora', tarifa_hora: 22, iva_pct: 0, irpf_pct: 0 }, { horas: '-3' }, 'Horas inválidas'],
      [p, { lineas: '[]' }, 'al menos un encargo'],
      [p, { lineas: 'no es json' }, 'no se pudo leer'],
      [p, { lineas: JSON.stringify([{ concepto: '', horas: 2 }]) }, 'Escribe qué hiciste en el encargo 1'],
      [p, { lineas: JSON.stringify([{ concepto: 'x', horas: 2, project_id: 999 }]) }, 'Ese campus no es de esta empresa en el encargo 1'],
    ];
    for (const [cobro, entrada, texto] of casos) {
      expect(() => desglose(cobro, entrada, [7]), texto).toThrow(texto);
    }
  });

  it('sin modalidad no hay desglose (como en la primera parte)', () => {
    expect(desglose({ modalidad: null }, {})).toBeNull();
  });

  it('el medio céntimo, hacia arriba: el total sugerido es el de una factura bien hecha', () => {
    // 5 h × 21,70 = 108,50; IRPF 15 % = 16,275 → 16,28.
    const h = desglose({ modalidad: 'hora', tarifa_hora: 21.7, iva_pct: 21, irpf_pct: 15 }, { horas: '5' });
    expect(h).toMatchObject({ base: 108.5, iva: 22.79, irpf: 16.28, total: 115.01 });
    expect(desglose({ modalidad: 'fijo', importe_fijo: 158.5, iva_pct: 21, irpf_pct: 0 }, {}).iva).toBe(33.29);
    expect(desglose({ modalidad: 'proyecto', tarifa_hora: 22.33, iva_pct: 0, irpf_pct: 0 },
      { lineas: JSON.stringify([{ concepto: 'x', horas: '1,5' }]) }).lineas[0].importe).toBe(33.5);
  });

  it('las horas, con dos decimales como mucho y sin punto de miles: «0.500» no son 500 horas', () => {
    const h = { modalidad: 'hora', tarifa_hora: 22, iva_pct: 0, irpf_pct: 0 };
    expect(desglose(h, { horas: '7.25' })).toMatchObject({ horas: 7.25, base: 159.5 });
    for (const horas of ['7,333', '0.500', '1.000', '7,5,1', '1e2']) {
      expect(() => desglose(h, { horas }), horas).toThrow('Horas inválidas');
    }
  });

  it('un desglose que no cabe en la base se rechaza antes de guardar', () => {
    expect(() => desglose({ modalidad: 'hora', tarifa_hora: 99999999.99, iva_pct: 21, irpf_pct: 0 }, { horas: '744' }))
      .toThrow('demasiado grande');
  });

  it('el total, al céntimo: base + IVA − IRPF', () => {
    const d = desglose({ modalidad: 'hora', tarifa_hora: 22, iva_pct: 21, irpf_pct: 15 }, { horas: '18' });
    expect(d.total).toBe(419.76);
    expect(d.total).toBe(Math.round((d.base + d.iva - d.irpf) * 100) / 100);
  });
});

describe('facturas de colaboradores (#202) · el desglose al subir', () => {
  it('el enlace le dice cómo cobra; si es por proyecto, con los campus para elegir', async () => {
    const h = (await request.get(`${API}/enlace/${enlace.horas}`)).body.data;
    expect(h.cobro).toMatchObject({ modalidad: 'hora', tarifa_hora: 22, iva_pct: 21, irpf_pct: 15, concepto: 'Servicios de SEO · junio 2026' });
    expect(h.campus).toBeUndefined();
    const p = (await request.get(`${API}/enlace/${enlace.proyecto}`)).body.data;
    expect(p.cobro.modalidad).toBe('proyecto');
    expect(p.campus).toEqual(expect.arrayContaining([{ id: P.A, nombre: 'Campus Alfa' }]));
    expect((await request.get(`${API}/enlace/${enlace.sin}`)).body.data.cobro).toBeNull();
  });

  it('solo los campus de la empresa de la factura (Diego, 10/10: «son por EMPRESA, no por campus»)', async () => {
    const p = (await request.get(`${API}/enlace/${enlace.proyecto}`)).body.data;
    // Los activos de su empresa, sin el de pruebas; el de la otra empresa, no.
    expect(p.campus).toEqual([{ id: P.A, nombre: 'Campus Alfa' }, { id: P.A2, nombre: 'Campus Alfa Online' }]);
    uploadToR2.mockClear();
    const res = await subir('proyecto', {
      importe: '60', numero_factura: 'F-P-06', lineas: JSON.stringify([{ concepto: 'x', horas: 2, project_id: P.B }]),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Ese campus no es de esta empresa');
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it('por hora y cuadra con el PDF: se guardan la base, el IVA, el IRPF, el total, su línea y lo que dice el PDF', async () => {
    const res = await subir('horas', { importe: '419,76', numero_factura: 'F-H-06', horas: '18' },
      await pdfCon(['Factura F-H-06', 'Base imponible 396,00 €', 'Total IVA 83,16 €', 'Total factura: 419,76 €']));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.recibida).toMatchObject({ total: 419.76, importe_pdf: 419.76, cuadra: true });
    expect(fila('horas')).toMatchObject({ base: 396, iva: 83.16, irpf: 59.4, total: 419.76, horas: 18, importe_pdf: 419.76, cuadra: true });
    expect(lineas('horas')).toEqual([{ orden: 1, concepto: 'Servicios de SEO · junio 2026', project_id: null, horas: 18, tarifa: 22, importe: 396 }]);
  });

  it('si el PDF dice otra cifra, se deja enviar y queda marcada «No cuadra» (y en el registro)', async () => {
    // Fijo 600 con 21 % y 15 %: escribe 636, el total del desglose, pero su PDF dice 650.
    const res = await subir('fijo', { importe: '636', numero_factura: 'F-F-06' }, await pdfCon(['Total a pagar 650,00 €']));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.recibida).toMatchObject({ total: 636, importe_pdf: 650, cuadra: false });
    expect(fila('fijo')).toMatchObject({ base: 600, total: 636, importe_pdf: 650, cuadra: false });
    const reg = base.registroDe(fila('fijo').id).find((r) => r.evento === 'recibida');
    expect(reg.detalle).toMatchObject({ modalidad: 'fijo', base: 600, total: 636, importe_pdf: 650, cuadra: false, importe: 636 });
  });

  it('un desglose demasiado largo da un mensaje claro (no «no se pudo leer el archivo») y no sube nada', async () => {
    uploadToR2.mockClear();
    // 30 encargos de 200 eñes: unos 12 000 bytes (la eñe ocupa dos), más que el tope de la subida.
    const larga = { concepto: 'ñ'.repeat(200), horas: '1' };
    const res = await subir('proyecto', { importe: '60', numero_factura: 'F-P-06', lineas: JSON.stringify(Array(30).fill(larga)) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('El desglose es demasiado largo');
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it('un desglose mal escrito da 400 y no sube nada a R2', async () => {
    uploadToR2.mockClear();
    const res = await subir('proyecto', {
      importe: '60', numero_factura: 'F-P-06', lineas: JSON.stringify([{ concepto: 'x', horas: 2, project_id: 2147483 }]),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Ese campus no es de esta empresa');
    expect(uploadToR2).not.toHaveBeenCalled();
    expect(fila('proyecto').subida_at).toBeNull();
  });

  it('por proyecto: cada línea con su encargo, su campus y sus horas', async () => {
    const res = await subir('proyecto', {
      importe: '345', numero_factura: 'F-P-06',
      lineas: JSON.stringify([
        { concepto: 'Landing de la feria', project_id: P.A, horas: '7,5' },
        { concepto: 'SEO del blog', project_id: null, horas: '4' },
      ]),
    }, await pdfCon(['Subtotal 345,00 EUR', 'TOTAL 345,00 EUR']));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(fila('proyecto')).toMatchObject({ base: 345, total: 345, horas: 11.5, importe_pdf: 345, cuadra: true });
    expect(lineas('proyecto').map(({ tarifa, ...l }) => l)).toEqual([
      { orden: 1, concepto: 'Landing de la feria', project_id: P.A, horas: 7.5, importe: 225 },
      { orden: 2, concepto: 'SEO del blog', project_id: null, horas: 4, importe: 120 },
    ]);
  });

  it('sin modalidad se sube como en la primera parte, sin desglose; y el PDF se lee igual', async () => {
    const res = await subir('sin', { importe: '600', numero_factura: 'F-S-06' }, await pdfCon(['Importe total 600.00 EUR']));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.recibida).toMatchObject({ total: null, importe_pdf: 600, cuadra: true });
    expect(fila('sin')).toMatchObject({ base: null, total: null, importe_pdf: 600, cuadra: true });
  });
});
