import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * MCP de Claude: solo consulta y solo lo de cada uno.
 *
 * Diego, 28/09: «Si yo estoy en X empresa solo ver los datos de ahi. Si solo
 * soy de un campus solo de ese campus. No puedo ver ni consultar datos de
 * otros campus». Y: «Solo hara consulta el MCP».
 *
 * Un fallo aqui NO SE VE: no rompe nada, solo hace que Claude cuente datos de
 * un campus ajeno. Por eso se prueba sin base, grabando CADA consulta que se
 * lanza: todas tienen que ser de lectura y todas tienen que llevar la lista de
 * campus de la persona como primer parametro.
 */

const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    return { rows: [{ total: 0, count: 0 }], rowCount: 0 };
  }),
  getClient: vi.fn(),
  default: {},
}));

const {
  acotarProyectos, construirAmbito, puedeUsarMcp, soloLoSuyo, responsableImpuesto,
  generarToken, huella, pareceToken,
} = await import('../src/modules/mcp/mcp.acceso.js');
const { HERRAMIENTAS, INFORMES } = await import('../src/modules/mcp/mcp.tools.js');

// Dos empresas: CEDIA (1) con los campus 10 y 11, Ictess (2) con el 20.
const PROYECTOS = [
  { id: 10, nombre: 'ISEIH', sociedad_id: 1, sociedad_nombre: 'CEDIA' },
  { id: 11, nombre: 'Psiko', sociedad_id: 1, sociedad_nombre: 'CEDIA' },
  { id: 20, nombre: 'Ictess', sociedad_id: 2, sociedad_nombre: 'Ictess' },
];
const persona = (role, extra = {}) => ({ id: 7, nombre: 'Ana', role, active: true, usa_mcp: false, ...extra });
const ambitoDe = (role, proyectos = PROYECTOS) => construirAmbito(persona(role), proyectos);

beforeEach(() => { consultas.length = 0; });

describe('quien entra', () => {
  it('super admin y admin entran por su rol', () => {
    expect(puedeUsarMcp(persona('superadmin'))).toBe(true);
    expect(puedeUsarMcp(persona('admin'))).toBe(true);
  });

  it('el resto solo si se le ha puesto la casilla', () => {
    expect(puedeUsarMcp(persona('gestor'))).toBe(false);
    expect(puedeUsarMcp(persona('gestor', { usa_mcp: true }))).toBe(true);
    expect(puedeUsarMcp(persona('soporte'))).toBe(false);
  });

  it('un tutor no entra ni con la casilla puesta', () => {
    expect(puedeUsarMcp(persona('tutor', { usa_mcp: true }))).toBe(false);
  });

  it('un usuario desactivado no entra, sea quien sea', () => {
    expect(puedeUsarMcp(persona('superadmin', { active: false }))).toBe(false);
    expect(puedeUsarMcp(null)).toBe(false);
  });
});

describe('que campus ve', () => {
  it('sin pedir nada: todos los suyos', () => {
    expect(acotarProyectos(ambitoDe('admin'))).toEqual([10, 11, 20]);
  });

  it('una empresa: solo sus campus', () => {
    expect(acotarProyectos(ambitoDe('admin'), { sociedad_id: 1 })).toEqual([10, 11]);
  });

  it('un campus suyo: ese', () => {
    expect(acotarProyectos(ambitoDe('admin'), { proyecto_id: 11 })).toEqual([11]);
  });

  it('un campus AJENO se rechaza, no se devuelve vacio', () => {
    // Vacio haria que Claude contestara «no hay ventas» cuando lo que pasa es
    // que no puede verlas.
    const soloIseih = ambitoDe('gestor', [PROYECTOS[0]]);
    expect(() => acotarProyectos(soloIseih, { proyecto_id: 11 })).toThrow(/No tienes acceso al campus 11/);
    expect(() => acotarProyectos(soloIseih, { proyecto_id: 11 })).toThrow(expect.objectContaining({ statusCode: 403 }));
  });

  it('una empresa ajena tambien', () => {
    const soloCedia = ambitoDe('admin', PROYECTOS.slice(0, 2));
    expect(() => acotarProyectos(soloCedia, { sociedad_id: 2 })).toThrow(/empresa 2/);
  });

  it('un campus de OTRA empresa no se cuela pidiendo empresa y campus a la vez', () => {
    expect(() => acotarProyectos(ambitoDe('admin'), { sociedad_id: 1, proyecto_id: 20 })).toThrow(/campus 20/);
  });

  it('sin ningun campus asignado no ve nada', () => {
    expect(() => acotarProyectos(ambitoDe('admin', []))).toThrow(/ningun campus/);
  });
});

describe('solo lo suyo', () => {
  it('super admin y admin ven todo su campus; el resto solo lo suyo', () => {
    expect(soloLoSuyo(persona('superadmin'))).toBe(false);
    expect(soloLoSuyo(persona('admin'))).toBe(false);
    expect(soloLoSuyo(persona('gestor'))).toBe(true);
    expect(soloLoSuyo(persona('soporte'))).toBe(true);
  });

  it('a quien ve solo lo suyo se le impone su propio id', () => {
    expect(responsableImpuesto(ambitoDe('gestor'))).toBe(7);
    expect(responsableImpuesto(ambitoDe('admin'))).toBe(null);
  });
});

describe('tokens', () => {
  it('se guarda la huella, no el token', () => {
    const { token, hash, prefijo } = generarToken();
    expect(hash).toBe(huella(token));
    expect(hash).not.toContain(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.startsWith(prefijo)).toBe(true);
    expect(prefijo.length).toBeLessThan(16);
  });

  it('dos tokens nunca son iguales', () => {
    expect(generarToken().token).not.toBe(generarToken().token);
  });

  it('solo se busca en la base lo que tiene pinta de token nuestro', () => {
    expect(pareceToken(generarToken().token)).toBe(true);
    expect(pareceToken('eyJhbGciOiJIUzI1NiJ9.jwt.del.crm')).toBe(false);
    expect(pareceToken('crm_mcp_corto')).toBe(false);
    expect(pareceToken(undefined)).toBe(false);
  });
});

// ─── Las herramientas contra la base (grabada) ────────────────────────────

/** Argumentos razonables para cada herramienta, con todos los filtros puestos. */
const ARGS = {
  mis_proyectos: {},
  buscar_prospectos: { estado: 'nuevo', canal: 'meta', texto: 'ana', desde: '2026-01-01', hasta: '2026-09-01', pagina: 1, limite: 25 },
  ver_prospecto: { id: 5 },
  resumen_prospectos: { desde: '2026-01-01' },
  listar_ventas: { texto: 'master', pendiente: true, desde: '2026-01-01', pagina: 1, limite: 25 },
  resumen_ventas: { hasta: '2026-09-01' },
  listar_facturas: { estado: 'pagada', tipo: 'normal', texto: 'F-1', pagina: 1, limite: 25 },
  resumen_facturas: {},
  cobros_pendientes: { limite: 50 },
  informe: { tipo: 'resumen_mensual', desde: '2026-01-01', hasta: '2026-09-01' },
  listar_tutores: { texto: 'ana', incluir_retirados: true },
  comisiones_tutores: { desde: '2026-08', hasta: '2026-09', tutor_id: 3 },
  formaciones_sin_tutor: { incluir_anteriores_al_corte: true },
};

const ejecutarTodas = async (ambito, extra = {}, omitir = []) => {
  for (const h of HERRAMIENTAS.filter((x) => !omitir.includes(x.nombre))) {
    // ver_prospecto devuelve «no existe» con la base vacia; lo que se mira
    // aqui es la consulta que lanzo, no el resultado.
    // Y las de tutores, a una gestora, se niegan: es lo que tienen que hacer.
    await h.ejecutar(ambito, { ...ARGS[h.nombre], ...extra }).catch((e) => {
      if (e.code !== 'MCP_NO_ENCONTRADO' && e.code !== 'MCP_SOLO_ADMIN') throw e;
    });
  }
};

describe('solo consulta', () => {
  it('hay una prueba de argumentos para cada herramienta', () => {
    expect(Object.keys(ARGS).sort()).toEqual(HERRAMIENTAS.map((h) => h.nombre).sort());
  });

  it('ninguna herramienta escribe en la base', async () => {
    await ejecutarTodas(ambitoDe('admin'));
    await ejecutarTodas(ambitoDe('gestor'));
    for (const n of Object.keys(INFORMES)) {
      await HERRAMIENTAS.find((h) => h.nombre === 'informe').ejecutar(ambitoDe('admin'), { tipo: n });
    }
    expect(consultas.length).toBeGreaterThan(20);
    for (const { sql } of consultas) {
      expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT)\b/i);
    }
  });

  it('ningun nombre de herramienta suena a escribir', () => {
    for (const h of HERRAMIENTAS) {
      expect(h.nombre).not.toMatch(/crear|editar|cambiar|borrar|eliminar|actualizar|enviar|marcar/);
    }
  });
});

describe('cada consulta va acotada a los campus de la persona', () => {
  it('con un campus pedido, TODAS las consultas llevan solo ese', async () => {
    // ver_prospecto no filtra por campus pedido: busca el id en TODOS los suyos
    // (se prueba aparte, abajo).
    await ejecutarTodas(ambitoDe('admin'), { proyecto_id: 11 }, ['ver_prospecto']);
    const deDatos = consultas.filter((c) => /\b(leads|conversions|invoices)\b/.test(c.sql));
    expect(deDatos.length).toBeGreaterThan(10);
    for (const { sql, params } of deDatos) {
      const lista = (params || []).find((p) => Array.isArray(p));
      const unSolo = (params || []).includes(11);
      // O va la lista [11] con `= ANY`, o el id suelto (Cuentas por cobrar va
      // de proyecto en proyecto). Lo que no puede haber es una consulta sin
      // campus, ni con otro.
      expect(lista ? lista : unSolo ? [11] : sql).toEqual([11]);
    }
  });

  it('ver un prospecto se busca dentro de sus campus, no por id a secas', async () => {
    const soloIseih = ambitoDe('admin', [PROYECTOS[0]]);
    await HERRAMIENTAS.find((h) => h.nombre === 'ver_prospecto').ejecutar(soloIseih, { id: 5 })
      .catch(() => {});
    expect(consultas[0].sql).toMatch(/l\.project_id = ANY\(\$1::int\[\]\)/);
    expect(consultas[0].params[0]).toEqual([10]);
  });

  it('a un gestor se le impone su id en todas las consultas de datos', async () => {
    await ejecutarTodas(ambitoDe('gestor'));
    const deDatos = consultas.filter((c) =>
      /\b(leads l|conversions c|invoices i)\b/.test(c.sql) && !/lead_interactions|WHERE c\.lead_id/.test(c.sql));
    expect(deDatos.length).toBeGreaterThan(10);
    for (const { params } of deDatos) {
      expect(params).toContain(7);
    }
  });

  it('cada informe, a un gestor, o le recorta a lo suyo o se le niega', async () => {
    // `overview` (resumen_general) acepta asesoraId pero no lo aplica. Si un
    // informe nuevo hace lo mismo, esta prueba lo caza antes de que Claude le
    // cuente a una gestora los totales de todo el campus.
    const informe = HERRAMIENTAS.find((h) => h.nombre === 'informe');
    for (const tipo of Object.keys(INFORMES)) {
      consultas.length = 0;
      const r = await informe.ejecutar(ambitoDe('gestor'), { tipo }).catch((e) => e);
      if (r instanceof Error) {
        expect(r.code).toBe('MCP_INFORME_SOLO_ADMIN');
        expect(consultas).toEqual([]);
      } else {
        expect(consultas.length).toBeGreaterThan(0);
        for (const { params } of consultas) expect(params).toContain(7);
      }
    }
  });

  it('a un admin NO se le impone nadie', async () => {
    await ejecutarTodas(ambitoDe('admin'));
    const conSiete = consultas.filter((c) => (c.params || []).includes(7));
    expect(conSiete).toEqual([]);
  });

  it('un campus ajeno no llega a la base', async () => {
    const soloIseih = ambitoDe('gestor', [PROYECTOS[0]]);
    for (const h of HERRAMIENTAS.filter((x) => 'proyecto_id' in x.entrada)) {
      await expect((async () => h.ejecutar(soloIseih, { ...ARGS[h.nombre], proyecto_id: 20 }))())
        .rejects.toThrow(/campus 20/);
    }
    expect(consultas).toEqual([]);
  });
});

describe('lo que nunca sale', () => {
  it('ninguna consulta pide columnas sensibles ni `*`', async () => {
    await ejecutarTodas(ambitoDe('admin'));
    const PROHIBIDO = /password|token|iban|dni|identificacion_fiscal|direccion_fiscal|nif|_key\b|webhook_api_key|encrypted|custom_fields|\b[a-z]+\.\*/i;
    for (const { sql } of consultas) {
      // Los informes de Reportes no son nuestros; se mira lo que escribe el MCP.
      if (/FROM invoices i|FROM leads l|FROM conversions c|lead_interactions/.test(sql)) {
        expect(sql).not.toMatch(PROHIBIDO);
      }
    }
  });
});

describe('tutores (Carlos, 01/10: «la conexión no exporta los datos de tutores»)', () => {
  const TUTORES = ['listar_tutores', 'comisiones_tutores', 'formaciones_sin_tutor'];

  it('existen y van acotadas a los campus pedidos', async () => {
    for (const n of TUTORES) {
      consultas.length = 0;
      await HERRAMIENTAS.find((h) => h.nombre === n).ejecutar(ambitoDe('admin'), { ...ARGS[n], proyecto_id: 11 });
      expect(consultas.length, n).toBeGreaterThan(0);
      for (const { sql, params } of consultas) {
        // «formaciones_sin_tutor» usa la consulta de la pantalla, que lleva la
        // lista en $2; lo que importa es que la lleve y que sea solo [11].
        expect(sql).toMatch(/project_id = ANY\(\$\d::int\[\]\)/);
        expect(params.find((p) => Array.isArray(p))).toEqual([11]);
      }
    }
  });

  it('a una gestora se le niegan sin llegar a la base', async () => {
    for (const n of TUTORES) {
      consultas.length = 0;
      const r = await HERRAMIENTAS.find((h) => h.nombre === n).ejecutar(ambitoDe('gestor'), ARGS[n]).catch((e) => e);
      expect(r?.code, n).toBe('MCP_SOLO_ADMIN');
      expect(consultas).toEqual([]);
    }
  });

  it('no piden DNI, IBAN, banco ni teléfono', async () => {
    consultas.length = 0;
    for (const n of TUTORES) await HERRAMIENTAS.find((h) => h.nombre === n).ejecutar(ambitoDe('admin'), ARGS[n]);
    for (const { sql } of consultas) {
      expect(sql).not.toMatch(/iban|dni|nif|banco|telefono|tutor_profiles|password|\btoken\b/i);
      // El `s.*` de «Cursos sin tutor» lee de su propia subconsulta, que no
      // tiene nada personal; en las demás, ni un `*`.
      if (!/WITH sin_tutor AS/.test(sql)) expect(sql).not.toMatch(/\b[a-z]+\.\*/i);
    }
  });
});
