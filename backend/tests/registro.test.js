import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El registro del sistema (#111, segunda parte).
 *
 * «Una pantalla de registro con dos vistas: general —lo que le interesa a quien
 * opera: quién hizo qué, sobre qué ficha, cuándo— y todos —el detalle completo,
 * incluidos los sucesos del sistema: trabajos programados, webhooks,
 * sincronizaciones, errores.»
 *
 * Lo que se fija aqui no es que la consulta devuelva filas, sino las cuatro
 * decisiones que hacen que un registro sirva o no sirva:
 *
 *  · Que las dos vistas sean DISTINTAS. Si «general» trae tambien los webhooks
 *    —miles de filas al dia— lo que hizo una persona no se encuentra, y la
 *    vista deja de valer para lo que se pidio.
 *  · Que una fuente sin tabla no tumbe la pantalla, Y QUE SE DIGA. La 142 no
 *    esta aplicada en los servidores: si el registro se cayera con un 42P01,
 *    o peor, si enseñara cinco fuentes como si fueran seis, nadie sabria que
 *    falta una migracion.
 *  · Que filtrar por usuario DEJE FUERA lo que no tiene usuario. Buscar «lo que
 *    hizo Laura» y que salgan las tareas programadas es un filtro inutil.
 *  · Que una fuente rota se quede sin sus filas y no se lleve el resto.
 */

const filas = {
  lead_audit_log: [],
  document_audit_log: [],
  user_activity_log: [],
  registro_tareas: [],
  make_webhook_deliveries: [],
  status_errors: [],
};

/** Que tablas dice `information_schema` que existen. */
let tablasQueExisten = [
  'lead_audit_log', 'document_audit_log', 'user_activity_log',
  'registro_tareas', 'make_webhook_deliveries', 'status_errors',
];

/** Fuentes que revientan al leerse, para probar que no se llevan la pantalla. */
let rotas = new Set();

/** Las consultas que se hicieron, para mirar el SQL de verdad. */
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (sql.includes('information_schema.tables')) {
      return { rows: tablasQueExisten.map((t) => ({ table_name: t })) };
    }
    for (const [tabla, datos] of Object.entries(filas)) {
      if (new RegExp(`FROM ${tabla}\\b`).test(sql)) {
        if (rotas.has(tabla)) throw new Error(`relation "${tabla}" does not exist`);
        return { rows: datos };
      }
    }
    return { rows: [] };
  }),
}));

vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const modelo = await import('../src/modules/registro/registro.model.js');

const cuando = (m) => new Date(Date.now() - m * 60000).toISOString();

beforeEach(() => {
  consultas.length = 0;
  rotas = new Set();
  tablasQueExisten = [
    'lead_audit_log', 'document_audit_log', 'user_activity_log',
    'registro_tareas', 'make_webhook_deliveries', 'status_errors',
  ];
  modelo.olvidarTablas();
  filas.lead_audit_log = [{
    id: 1, cuando: cuando(5), campo: 'email', antes: 'a@b.com', despues: 'c@d.com',
    lead_id: 7, lead_nombre: 'Maria', project_id: 1, usuario_id: 4, usuario: 'Laura',
  }];
  filas.document_audit_log = [{
    id: 2, cuando: cuando(10), action: 'generated', document_id: 33,
    usuario_id: 1, usuario: 'Manuel', metadata: null,
  }];
  filas.user_activity_log = [{
    id: 3, cuando: cuando(15), action: 'credencial.ver',
    details: { servicio: 'stripe' }, ip_address: '10.0.0.1', usuario_id: 3, usuario: 'Angel',
  }];
  filas.registro_tareas = [{
    id: 4, cuando: cuando(1), nombre: 'metaAdsSync', titulo: 'Meta Ads',
    duracion_ms: 900, ok: false, mensaje: '401 desde Meta', detalle: null,
  }];
  filas.make_webhook_deliveries = [{
    id: 5, cuando: cuando(2), result: 'accepted', lead_id: 9,
    error_message: null, webhook: 'Formulario web', project_id: 1,
  }];
  filas.status_errors = [{
    id: 6, cuando: cuando(3), method: 'POST', path: '/api/leads', status_code: 500,
    message: 'boom', usuario_id: null, usuario: null,
  }];
});

describe('las dos vistas son distintas, que es el motivo de que haya dos', () => {
  it('general trae SOLO lo que hizo una persona', async () => {
    const r = await modelo.listar({ vista: 'general' });
    expect(r.fuentes.sort()).toEqual(['documento', 'ficha', 'usuario']);
    expect(r.filas.map((f) => f.fuente).sort()).toEqual(['documento', 'ficha', 'usuario']);
  });

  it('todos trae ademas los sucesos del sistema', async () => {
    const r = await modelo.listar({ vista: 'todos' });
    expect(r.filas.map((f) => f.fuente).sort())
      .toEqual(['documento', 'error', 'ficha', 'tarea', 'usuario', 'webhook']);
  });

  it('los webhooks y las tareas NO se cuelan en general', async () => {
    // Son miles de filas al dia. Coladas ahi, lo que hizo una persona no se
    // encuentra y la vista deja de servir para lo que se pidio.
    const r = await modelo.listar({ vista: 'general' });
    expect(r.filas.some((f) => f.fuente === 'webhook')).toBe(false);
    expect(r.filas.some((f) => f.fuente === 'tarea')).toBe(false);
  });
});

describe('lo mas nuevo primero, mezclando fuentes', () => {
  it('se ordena por fecha, no por fuente', async () => {
    const r = await modelo.listar({ vista: 'todos' });
    expect(r.filas.map((f) => f.fuente)).toEqual([
      'tarea', 'webhook', 'error', 'ficha', 'documento', 'usuario',
    ]);
  });

  it('el limite se aplica DESPUES de mezclar', async () => {
    // Si se aplicara antes, «las 2 mas nuevas» serian las 2 mas nuevas de una
    // fuente cualquiera, no las 2 mas nuevas de verdad.
    const r = await modelo.listar({ vista: 'todos', limite: 2 });
    expect(r.filas.map((f) => f.fuente)).toEqual(['tarea', 'webhook']);
  });
});

describe('una fuente sin tabla no tumba nada, y SE DICE', () => {
  it('sin la 142 aplicada, el resto se sigue viendo', async () => {
    tablasQueExisten = tablasQueExisten.filter((t) => t !== 'registro_tareas');
    modelo.olvidarTablas();
    const r = await modelo.listar({ vista: 'todos' });
    expect(r.filas.some((f) => f.fuente === 'tarea')).toBe(false);
    expect(r.filas.length).toBe(5);
  });

  it('y se dice CUAL falta, que es la diferencia entre un dia tranquilo y una migracion sin aplicar', async () => {
    tablasQueExisten = tablasQueExisten.filter((t) => t !== 'registro_tareas');
    modelo.olvidarTablas();
    const r = await modelo.listar({ vista: 'todos' });
    expect(r.sinTabla).toEqual(['tarea']);
    expect(r.fuentes).not.toContain('tarea');
  });

  it('no se pregunta por las tablas en cada consulta', async () => {
    await modelo.listar({ vista: 'todos' });
    await modelo.listar({ vista: 'todos' });
    const preguntas = consultas.filter((c) => c.sql.includes('information_schema'));
    expect(preguntas).toHaveLength(1);
  });

  it('pero se puede olvidar, para no tener que reiniciar tras aplicar una migracion', async () => {
    tablasQueExisten = tablasQueExisten.filter((t) => t !== 'registro_tareas');
    modelo.olvidarTablas();
    expect((await modelo.listar({ vista: 'todos' })).sinTabla).toEqual(['tarea']);

    tablasQueExisten.push('registro_tareas');
    modelo.olvidarTablas();
    expect((await modelo.listar({ vista: 'todos' })).sinTabla).toEqual([]);
  });
});

describe('una fuente rota se queda sin sus filas y ya', () => {
  it('el resto de la pantalla sigue', async () => {
    rotas.add('make_webhook_deliveries');
    const r = await modelo.listar({ vista: 'todos' });
    expect(r.filas.some((f) => f.fuente === 'webhook')).toBe(false);
    expect(r.filas.length).toBe(5);
  });
});

describe('filtrar por usuario deja fuera lo que no tiene usuario', () => {
  it('las tareas y los webhooks no se cuelan', async () => {
    // Buscar «lo que hizo Laura» y que salgan las tareas programadas es un
    // filtro que no filtra.
    const r = await modelo.listar({ vista: 'todos', usuarioId: 4 });
    expect(r.filas.some((f) => f.fuente === 'tarea')).toBe(false);
    expect(r.filas.some((f) => f.fuente === 'webhook')).toBe(false);
  });

  it('y a esas fuentes ni se les pregunta', async () => {
    await modelo.listar({ vista: 'todos', usuarioId: 4 });
    expect(consultas.some((c) => /FROM registro_tareas/.test(c.sql))).toBe(false);
  });

  it('sin filtro de usuario si se les pregunta', async () => {
    await modelo.listar({ vista: 'todos' });
    expect(consultas.some((c) => /FROM registro_tareas/.test(c.sql))).toBe(true);
  });
});

describe('las fechas', () => {
  it('«hasta» incluye el dia entero', async () => {
    // Con `<= '2026-09-04'` no entraria nada de ese dia salvo la medianoche
    // justa: se pide un dia y sale vacio.
    await modelo.listar({ vista: 'general', hasta: '2026-09-04' });
    const c = consultas.find((c) => /FROM lead_audit_log/.test(c.sql));
    expect(c.sql).toMatch(/::date \+ 1/);
    expect(c.params).toContain('2026-09-04');
  });

  it('van como parametros, no pegadas al SQL', async () => {
    await modelo.listar({ vista: 'general', desde: '2026-09-01' });
    const c = consultas.find((c) => /FROM lead_audit_log/.test(c.sql));
    expect(c.sql).not.toContain('2026-09-01');
    expect(c.params).toContain('2026-09-01');
  });
});

describe('lo que se lee en cada fila', () => {
  it('un cambio de campo dice de que a que', async () => {
    // «Se cambió el email» sin los dos valores no dice nada.
    const r = await modelo.listar({ vista: 'general' });
    const f = r.filas.find((x) => x.fuente === 'ficha');
    expect(f.resumen).toBe('Cambió email de «a@b.com» a «c@d.com»');
    expect(f.enlace).toBe('/crm/leads/7');
  });

  it('una tarea que fallo lo dice, y va marcada como no correcta', async () => {
    const r = await modelo.listar({ vista: 'todos' });
    const f = r.filas.find((x) => x.fuente === 'tarea');
    expect(f.ok).toBe(false);
    expect(f.resumen).toContain('401 desde Meta');
  });

  it('un `action` sin traducir aparece tal cual, no se esconde', async () => {
    // Esconderlo hasta que alguien lo traduzca es como se pierden sucesos.
    filas.user_activity_log = [{
      id: 9, cuando: cuando(1), action: 'algo.que.nadie.tradujo',
      details: null, usuario_id: 1, usuario: 'Manuel',
    }];
    const r = await modelo.listar({ vista: 'general' });
    expect(r.filas.find((f) => f.fuente === 'usuario').resumen).toBe('algo.que.nadie.tradujo');
  });
});

describe('lo que NO viaja en la lista', () => {
  it('el cuerpo del webhook se queda fuera', async () => {
    // Lleva nombre, email y telefono de quien rellenó el formulario. Esto es
    // una lista, no una ficha.
    const r = await modelo.listar({ vista: 'todos' });
    const f = r.filas.find((x) => x.fuente === 'webhook');
    expect(JSON.stringify(f)).not.toContain('payload');
  });

  it('la IP de un compañero tampoco', async () => {
    const r = await modelo.listar({ vista: 'general' });
    const f = r.filas.find((x) => x.fuente === 'usuario');
    expect(JSON.stringify(f)).not.toContain('10.0.0.1');
  });

  it('ni la traza de un error', async () => {
    const r = await modelo.listar({ vista: 'todos' });
    const f = r.filas.find((x) => x.fuente === 'error');
    expect(f.detalle).toEqual({ metodo: 'POST', ruta: '/api/leads', codigo: 500 });
  });
});

describe('buscar', () => {
  it('afina sobre lo traido', async () => {
    const r = await modelo.listar({ vista: 'todos', busca: 'meta' });
    expect(r.filas.map((f) => f.fuente)).toEqual(['tarea']);
  });

  it('sin acentos ni mayusculas de por medio', async () => {
    expect((await modelo.listar({ vista: 'general', busca: 'LAURA' })).filas).toHaveLength(1);
  });

  it('lo que no esta no aparece', async () => {
    expect((await modelo.listar({ vista: 'todos', busca: 'inmobiliaria' })).filas).toEqual([]);
  });
});

describe('el tope', () => {
  it('no se puede pedir mas de 500 aunque se pida', async () => {
    await modelo.listar({ vista: 'general', limite: 99999 });
    const c = consultas.find((c) => /FROM lead_audit_log/.test(c.sql));
    expect(c.params.at(-1)).toBe(modelo.TOPE);
  });
});
