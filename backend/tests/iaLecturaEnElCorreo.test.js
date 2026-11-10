import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// La lectura de la semana dentro del «Reporte semanal» de dirección (#30).
//
// Tres cosas que importan mas que el texto en si:
//
//   · APAGADA POR DEFECTO. Hasta que Diego ponga la clave y el tope, el correo
//     sale exactamente como antes: ni una llamada, ni un bloque nuevo.
//   · SI NO HAY LECTURA, EL CORREO SALE IGUAL. Sin clave, con el tope agotado o
//     con la IA caida la lectura es `null` y no se nota nada.
//   · LO QUE ESCRIBE LA IA ENTRA ESCAPADO, y va marcado como escrito por IA.

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_projects up')) return { rows: [{ id: 1, nombre: 'ISEIH', sociedad_id: null }] };
    if (sql.includes('FROM conversion_payments p JOIN conversions c')) return { rows: [{ cobrado: '7795' }] };
    return { rows: [] };
  }),
}));

const overview = vi.fn(async ({ from }) => (from === '2026-10-12'
  ? { leads: { total: 120, convertido: 18 }, conversions: { total: 9 } }
  : { leads: { total: 100, convertido: 20 }, conversions: { total: 8 } }));

const FILA = {
  puesto: 1, de: 1, nombre: 'Diana', leads: 32, ventas: 0, vendido: 0, facturado: 0, pendiente: 0,
  cobrado: 0, cobrado_del_periodo: 0, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
  ventas_anteriores: 0, anteriores_grandes: [], tasa: 0,
};
vi.mock('../src/modules/reports/report.model.js', () => ({
  overview: (...a) => overview(...a),
  miPuesto: vi.fn(async () => ({
    ...FILA, tabla: [FILA], sin_gestora: { ...FILA, anteriores_grandes: [] }, total: { ...FILA, anteriores_grandes: [] },
  })),
  ventasVendedora: vi.fn(async () => []),
  // #270: el correo ahora desglosa por campus y por gestora; aqui no importan los contactos.
  contactosPorCampus: vi.fn(async () => []),
  contactosPorGestora: vi.fn(async () => []),
}));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({
  resumenDeLaCola: vi.fn(async () => ({ esta_semana: 0, atrasados: 0, hoy: 0, manana: 0 })),
}));

const lectura = vi.fn();
vi.mock('../src/modules/ia-analisis/lectura.js', () => ({ lecturaDeLaSemana: (...a) => lectura(...a) }));

const C = await import('../src/jobs/correosDelEquipo.js');
const LUNES = new Date('2026-10-19T09:00:00');
const sinEtiquetas = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const DIEGO = { id: 2, role: 'admin', nombre: 'Diego' };

let previa;
beforeEach(() => { previa = process.env.IA_ANALISIS_SEMANAL; lectura.mockReset(); });
afterEach(() => {
  if (previa === undefined) delete process.env.IA_ANALISIS_SEMANAL;
  else process.env.IA_ANALISIS_SEMANAL = previa;
});

describe('apagada por defecto', () => {
  it('sin IA_ANALISIS_SEMANAL no se llama a la IA y no hay bloque', async () => {
    delete process.env.IA_ANALISIS_SEMANAL;
    const r = await C.correoSemanalDireccion(DIEGO, LUNES);
    expect(lectura).not.toHaveBeenCalled();
    expect(sinEtiquetas(r.html)).not.toContain('Lectura de la semana');
  });

  it('con IA_ANALISIS_SEMANAL=0 tampoco', async () => {
    process.env.IA_ANALISIS_SEMANAL = '0';
    await C.correoSemanalDireccion(DIEGO, LUNES);
    expect(lectura).not.toHaveBeenCalled();
  });
});

describe('encendida', () => {
  beforeEach(() => { process.env.IA_ANALISIS_SEMANAL = '1'; });

  it('le da a la IA las MISMAS cifras que enseña el correo, las dos semanas', async () => {
    lectura.mockResolvedValue(null);
    await C.correoSemanalDireccion(DIEGO, LUNES);

    const arg = lectura.mock.calls[0][0];
    expect(arg.empresa).toBe('ISEIH');
    expect(arg.periodo).toEqual({ from: '2026-10-12', to: '2026-10-18' });
    expect(arg.esta).toEqual({ prospectos: 120, convertidos: 18, ventas: 9, cobrado: 7795 });
    expect(arg.anterior).toMatchObject({ prospectos: 100, convertidos: 20, ventas: 8 });
    expect(arg.userId).toBe(2);
  });

  it('con una lectura, sale en el correo y dice que la escribio una IA', async () => {
    lectura.mockResolvedValue({ texto: 'Los prospectos subieron un 20 %.' });
    const texto = sinEtiquetas((await C.correoSemanalDireccion(DIEGO, LUNES)).html);
    expect(texto).toContain('Lectura de la semana');
    expect(texto).toContain('Los prospectos subieron un 20 %.');
    expect(texto).toContain('Escrita por IA');
  });

  it('lo que escribe la IA entra ESCAPADO', async () => {
    lectura.mockResolvedValue({ texto: '<a href="https://phishing.test">entra</a><script>x()</script>' });
    const { html } = await C.correoSemanalDireccion(DIEGO, LUNES);
    expect(html).not.toContain('<a href="https://phishing');
    expect(html).not.toContain('<script>x()');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sin lectura (null), el correo sale igual que sin IA', async () => {
    delete process.env.IA_ANALISIS_SEMANAL;
    const sin = (await C.correoSemanalDireccion(DIEGO, LUNES)).html;

    process.env.IA_ANALISIS_SEMANAL = '1';
    lectura.mockResolvedValue(null);
    const con = (await C.correoSemanalDireccion(DIEGO, LUNES)).html;

    expect(con).toBe(sin);
  });
});
