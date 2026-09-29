import { describe, it, expect, vi, beforeEach } from 'vitest';

// El resumen del dia y el plan de mañana, de la tarea #28.
//
// Se prueba el CRITERIO —a quien se avisa, que se le cuenta y que no se repita—
// no la consulta contra Postgres, que se comprueba corriendo el trabajo contra
// la base de verdad.

const consultas = [];
const enviados = [];

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    // `destinatarios` devuelve gente; el resto, contadores.
    if (sql.includes('avisos_apagados') && sql.includes('FROM users')) {
      return { rows: [{ id: 1, nombre: 'Ana', email: 'ana@empresa.com' }] };
    }
    return { rows: [{ entraron: 2, contactos: 5, convertidos: 1, sin_tocar: 3,
                      en_seguimiento: 4, recordatorios: 2 }] };
  }),
}));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (a) => { enviados.push(a); return { sent: true }; }),
}));

const { _internos } = await import('../src/jobs/resumenDiarioScheduler.js');

/** Un solo proyecto, que es el caso normal de una gestora. */
const unProyecto = (c) => ({
  variosProyectos: false,
  bloques: [{ proyecto: { id: 9, nombre: 'Proyecto de prueba' }, ...c }],
});

beforeEach(() => { consultas.length = 0; enviados.length = 0; });

describe('a quien llega', () => {
  it('respeta a quien lo apago', async () => {
    await _internos.destinatarios('resumen_del_dia', ['gestor']);
    expect(consultas[0].sql).toMatch(/NOT EXISTS[\s\S]*avisos_apagados/);
    expect(consultas[0].params).toContain('resumen_del_dia');
  });

  it('solo a gente activa y con correo', async () => {
    await _internos.destinatarios('resumen_del_dia', ['gestor']);
    expect(consultas[0].sql).toMatch(/u\.active/);
    expect(consultas[0].sql).toMatch(/u\.email IS NOT NULL/);
  });

  it('deja fuera a quien lleva colaboraciones', async () => {
    // Tiene rol de gestor pero no atiende prospectos: un resumen de su dia con
    // prospectos seria un correo de ceros todos los dias.
    await _internos.destinatarios('resumen_del_dia', ['gestor']);
    expect(consultas[0].sql).toMatch(/gestor_colaboraciones/);
  });
});

describe('una vez al dia, y cada dia', () => {
  it('la clave lleva la fecha, al reves que el aviso de prospecto sin tocar', async () => {
    // Alli la clave es el id del lead —el aviso es ESE prospecto y repetirlo
    // seria acosar—. Aqui es «lo de hoy», y tiene que llegar cada dia.
    await _internos.mandar('resumen_del_dia', ['gestor'], 'Resumen', async () => ({}), () => 'cuerpo');
    expect(enviados).toHaveLength(1);
    expect(enviados[0].clave).toMatch(/^resumen_del_dia-1-\d{4}-\d{2}-\d{2}$/);
  });

  it('cada persona lleva su propia clave', async () => {
    // Sin el id dentro, el primero en recibirlo dejaria sin aviso a los demas.
    await _internos.mandar('resumen_del_dia', ['gestor'], 'Resumen', async () => ({}), () => 'cuerpo');
    expect(enviados[0].clave).toContain('-1-');
  });

  it('que falle el de una persona no deja sin aviso a las demas', async () => {
    // Se comprueba que `mandar` no relanza: si lo hiciera, un correo con una
    // direccion mal escrita cortaria la lista entera.
    const rompe = async () => { throw new Error('esta persona no tiene datos'); };
    await expect(_internos.mandar('resumen_del_dia', ['gestor'], 'Resumen', rompe))
      .resolves.toBeTruthy();
  });
});

/**
 * Los correos nuevos (28/09): con datos y con la marca. Diego: «mejora los
 * correos de notificación, muestra los datos, con el logo… y móntalo en
 * staging». Las cifras salen de las funciones de las pantallas y se comprueban
 * contra la base; aquí se prueba lo que no depende de ella: el diseño, los
 * enlaces y las comparaciones.
 */
const C = await import('../src/jobs/correosDelEquipo.js');

describe('el diseño de los correos', () => {
  it('con cabecera de marca, la lleva como imagen; y dice cómo apagarlo', () => {
    const h = C.envoltorio({ cabeceraUrl: 'https://crm/api/f/cabecera/3?v=1', preTitulo: 'X', titulo: 'Y', contenido: 'Z' });
    expect(h).toContain('<img src="https://crm/api/f/cabecera/3?v=1"');
    expect(h).toContain('Mis preferencias');
  });

  it('sin cabecera, sale el nombre del CRM en su color', () => {
    const h = C.envoltorio({ preTitulo: 'X', titulo: 'Y', contenido: 'Z' });
    expect(h).not.toContain('<img');
    expect(h).toMatch(/MultiCRM|CRM ISEIE/);
  });

  it('las tarjetas van de dos en dos: en el móvil no caben cuatro', () => {
    const h = C.tarjetas([1, 2, 3].map((i) => ({ etiqueta: `e${i}`, valor: i })));
    expect((h.match(/<tr>/g) || []).length).toBe(2);
  });

  it('una línea con enlace abre el CRM con su filtro, y la URL no está cableada', () => {
    const antes = process.env.FEEDBACK_BASE_URL;
    process.env.FEEDBACK_BASE_URL = 'https://ejemplo.test/crm/';
    try {
      const h = C.lineaConEnlace(7, 'para mañana', `${C.base()}/prospectos?projectId=9&qf=tomorrow`);
      expect(h).toContain('https://ejemplo.test/crm/prospectos?projectId=9&amp;qf=tomorrow');
      expect(h).toContain('>7<');
    } finally { process.env.FEEDBACK_BASE_URL = antes; }
  });

  it('las comparaciones no inventan porcentajes', () => {
    expect(C.comparar(10, 8)).toMatchObject({ texto: '+25 %', signo: 'sube' });
    expect(C.comparar(5, 0).texto).toBe('nuevo');
    expect(C.comparar(0, 0).texto).toBe('igual');
  });

  it('el repaso mensual sale con el mismo diseño', () => {
    const t = _internos.textoValidacion('Ana', { bloques: [], variosProyectos: false });
    expect(t).toContain('Toca repasar tu base');
    expect(t).toContain('Mis preferencias');
  });
});
