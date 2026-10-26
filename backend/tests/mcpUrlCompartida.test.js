import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar, conPermisos } = await import('./helpers/permisosSinBase.js');

/**
 * La alerta «de madrugada» de Tony del 13/10 (Diego, 13/10).
 *
 * Era Yolanda con la URL personal de Tony en su Claude: sacó sus propios
 * códigos en el panel y los probó con esa URL (CODIGO_INCORRECTO, porque los
 * códigos son por persona). Esa noche, 8 llamadas, todas paradas, 0 datos; y la
 * 2.ª alerta (Yolanda, 03:24) era su clic en «Desbloquear desde aquí». Tres
 * arreglos:
 *
 *   1. un código vigente de OTRA persona: error propio (CODIGO_DE_OTRA_PERSONA),
 *      sin sumar fallo, y alerta de «URL compartida»;
 *   2. la alerta de madrugada no cuenta el clic del panel y dice cuántas
 *      consultas dieron datos y cuántas paró el código;
 *   3. los correos dicen de qué zona son las horas («hora de Madrid»).
 *
 * Con la base EN MEMORIA (un mock de `query`), como mcpInterruptor: lo que se
 * mira es qué hace el código con lo que contesta la base.
 */

const TOKEN = 'crm_mcp_' + 't'.repeat(43);
// #326: Claude manda la llave de SU conexión (autorizada), no la de la URL.
const LLAVE_CONEXION = 'crm_mcc_' + 'c'.repeat(43);
const TONY = { id: 7, nombre: 'Tony', role: 'admin', active: true, email: 'tony@ejemplo.test' };
const YOLANDA = { id: 9, nombre: 'Yolanda', email: 'yolanda@ejemplo.test' };

const query = vi.hoisted(() => vi.fn());
vi.mock('../src/shared/config/db.js', () => ({ query, getClient: vi.fn(), default: {} }));

const modelo = vi.hoisted(() => ({
  findTokenVivo: vi.fn(async () => ({ token_id: 2, user_id: 7 })),
  findUserById: vi.fn(async () => conPermisos(TONY)),
  proyectosDeLaPersona: vi.fn(async () => [{ id: 10, nombre: 'ISEIH', sociedad_id: 1 }]),
  marcarUso: vi.fn(async () => {}),
  registrarAuditoria: vi.fn(async () => {}),
}));
vi.mock('../src/modules/mcp/mcp.model.js', async (original) => ({ ...(await original()), ...modelo }));

// El correo de alertas, espiado; el de verdad se prueba aparte con el freno puesto.
const correos = vi.hoisted(() => ({ sendMcpAlertasEmail: vi.fn(async () => ({ sent: true })) }));
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({ ...(await original()), ...correos }));

// Para leer el correo de verdad: se guarda lo que monta P.correo (la plantilla
// de todos, con la marca), y el freno lo para antes de salir.
const registrados = vi.hoisted(() => []);
vi.mock('../src/shared/services/email-plantilla.service.js', async (original) => {
  const real = await original();
  return {
    ...real,
    correo: (args) => {
      const r = real.correo(args);
      registrados.push({ proyecto: args.proyecto, cuerpoHtml: r.htmlContent });
      return r;
    },
  };
});
vi.mock('../src/shared/services/email-freno.service.js', () => ({
  dejaPasar: () => ({ pasa: false, motivo: 'pruebas', bloqueados: [] }),
  porQueSeParo: () => 'freno de pruebas',
}));
vi.mock('../src/shared/services/email-log.service.js', () => ({
  yaSeEnvio: async () => false,
  registrar: async () => {},
}));

const desbloqueo = await import('../src/modules/mcp/mcp.desbloqueo.js');
const alertas = await import('../src/modules/mcp/mcp.alertas.js');
const { default: mcp } = await import('../src/modules/mcp/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const brevoDeVerdad = await vi.importActual('../src/shared/services/brevo.service.js');

const app = express();
app.use(express.json());
app.use(mcp.prefix, mcp.router);
app.use(errorHandler);

const { huella } = await import('../src/modules/mcp/mcp.acceso.js');
const usarHerramienta = (name, args = {}) => request(app).post(`/api/mcp/u/${TOKEN}`)
  .set('Accept', 'application/json, text/event-stream')
  .set('Authorization', `Bearer ${LLAVE_CONEXION}`)
  .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

/**
 * La base, en memoria. `base.ajeno`: lo que contesta la búsqueda del código
 * entre los de las demás personas; `base.alertaRepetida`: si ya hubo una alerta
 * de URL compartida en la última hora.
 */
const base = {};
const sqls = [];
const hecho = (re) => sqls.some(([sql]) => re.test(sql));
const FALLO = /SET fallos_codigo = CASE/;

beforeEach(() => {
  vi.clearAllMocks();
  sqls.length = 0;
  registrados.length = 0;
  Object.assign(base, {
    ajeno: { codigo_de: YOLANDA.id, codigo_de_nombre: YOLANDA.nombre, url_de_nombre: TONY.nombre },
    alertaRepetida: false,
    estado: { bloqueado: false, desbloqueado: false, bloqueado_hasta: null },
    madrugada: [],
  });
  for (const k of ['MCP_ALERTAS', 'MCP_ALERTA_MADRUGADA', 'APP_TIMEZONE']) delete process.env[k];
  process.env.MCP_CODIGO_OBLIGATORIO = 'true';
  process.env.MCP_AVISO_EMAIL = 'diego@vigila.test';
  query.mockImplementation(async (sql, params) => {
    sqls.push([sql, params]);
    if (/FROM mcp_interruptor/.test(sql)) return { rows: [{ apagado: false }] };
    // #326: el bloqueo es de la URL; el desbloqueo, de la conexión de Claude.
    if (/AS bloqueado\s+FROM mcp_tokens t WHERE t\.id = \$1/.test(sql)) return { rows: [base.estado] };
    if (/FROM mcp_conexiones x\s+JOIN mcp_tokens t/.test(sql)) {
      return { rows: [{ id: 5, token_id: 2, user_id: 7, estado: 'autorizada', desbloqueada_at: null, connector_id: null, token_hash: huella(TOKEN) }] };
    }
    if (/UPDATE mcp_codigos SET usado_at/.test(sql)) return { rows: [] };
    if (/FROM mcp_codigos c/.test(sql)) return { rows: base.ajeno ? [base.ajeno] : [] };
    if (FALLO.test(sql)) return { rows: [{ fallos_codigo: 1, bloqueado_hasta: null, bloqueado: false }] };
    if (/FROM mcp_tokens t JOIN users u/.test(sql)) {
      return { rows: [{ conexion: 'Claude de Tony', prefijo: 'crm_mcp_ab', nombre: TONY.nombre, email: TONY.email }] };
    }
    if (/SELECT nombre, email FROM users WHERE id = \$1/.test(sql)) return { rows: [YOLANDA] };
    if (/INSERT INTO mcp_alertas \(tipo, user_id, detalle\)\s+SELECT 'url_compartida'/.test(sql)) {
      return { rows: base.alertaRepetida ? [] : [{ id: 1 }] };
    }
    // La vuelta de alertas (revisar).
    if (/SELECT ultimo_auditoria_id FROM mcp_vigilancia/.test(sql)) return { rows: [{ ultimo_auditoria_id: 0 }] };
    if (/COALESCE\(MAX\(id\), 0\) AS max FROM mcp_auditoria/.test(sql)) return { rows: [{ max: 10 }] };
    if (/AS noche/.test(sql)) return { rows: base.madrugada };
    if (/SELECT id, nombre, email FROM users/.test(sql)) return { rows: [TONY] };
    return { rows: [], rowCount: 0 };
  });
});

// ─── 1. El código de otra persona ─────────────────────────────────────────

describe('un código vigente de OTRA persona en esta URL', () => {
  it('da «de_otra_persona» con de quién es la URL, y NO suma a fallos_codigo', async () => {
    const r = await desbloqueo.intentarDesbloqueo({ userId: TONY.id, tokenId: 2, codigo: 'K7QM-2XPA' });
    expect(r).toEqual({
      resultado: 'de_otra_persona',
      urlDe: { id: TONY.id, nombre: 'Tony' },
      codigoDe: { id: YOLANDA.id, nombre: 'Yolanda' },
    });
    expect(hecho(FALLO)).toBe(false);
    // Se busca entre los vigentes de los DEMÁS, por la huella: nunca el código en claro.
    const [sql, params] = sqls.find(([s]) => /FROM mcp_codigos c/.test(s));
    expect(sql).toMatch(/c\.user_id <> \$1/);
    expect(sql).toMatch(/usado_at IS NULL AND c\.anulado_at IS NULL AND c\.caduca_at > NOW\(\)/);
    expect(params).toEqual([TONY.id, desbloqueo.huellaCodigo('K7QM-2XPA')]);
  });

  it('un código que no es de nadie sigue siendo un fallo y suma, como siempre', async () => {
    base.ajeno = null;
    const r = await desbloqueo.intentarDesbloqueo({ userId: TONY.id, tokenId: 2, codigo: 'ZZZZ-ZZZZ' });
    expect(r.resultado).toBe('incorrecto');
    expect(hecho(FALLO)).toBe(true);
  });

  it('por el MCP: Claude lee de quién es la URL y que use la suya; queda en la auditoría', async () => {
    const r = await usarHerramienta('desbloquear', { codigo: 'K7QM-2XPA' });
    expect(r.status).toBe(200);
    expect(r.body.result.isError).toBe(true);
    const texto = r.body.result.content[0].text;
    expect(texto).toMatch(/^Ese código es de otra persona: esta URL del MCP es de Tony; usa tu propia URL\./);
    expect(texto).toMatch(/no cuenta como fallo/);
    expect(texto).not.toMatch(/Quedan \d+ intentos/);
    expect(modelo.registrarAuditoria).toHaveBeenCalledWith(expect.objectContaining({
      userId: TONY.id, tokenId: 2, herramienta: 'desbloquear', ok: false, error: 'CODIGO_DE_OTRA_PERSONA', parametros: null,
    }));
    expect(hecho(FALLO)).toBe(false);
  });

  it('y lanza la alerta de «URL compartida» por el canal de alertas: mcp_alertas + correo a quien vigila', async () => {
    await usarHerramienta('desbloquear', { codigo: 'K7QM-2XPA' });
    await vi.waitFor(() => expect(correos.sendMcpAlertasEmail).toHaveBeenCalledTimes(1));
    const { para, alertas: lista } = correos.sendMcpAlertasEmail.mock.calls[0][0];
    expect(para).toEqual([{ email: 'diego@vigila.test' }]);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({
      tipo: 'url_compartida', userId: TONY.id,
      persona: { nombre: 'Tony', email: TONY.email },
      detalle: { token_id: 2, conexion: 'Claude de Tony', prefijo: 'crm_mcp_ab', usada_por_id: YOLANDA.id, usada_por: 'Yolanda', usada_por_email: YOLANDA.email },
    });
    const [, params] = sqls.find(([s]) => /INSERT INTO mcp_alertas/.test(s));
    expect(params[0]).toBe(TONY.id);
    expect(JSON.parse(params[1]).usada_por_id).toBe(YOLANDA.id);
  });

  it('no se repite: con una igual en la última hora, ni correo', async () => {
    base.alertaRepetida = true;
    const r = await alertas.alertarUrlCompartida({ tokenId: 2, urlDe: { id: TONY.id, nombre: 'Tony' }, usadaPor: { id: YOLANDA.id, nombre: 'Yolanda' } });
    expect(r).toMatchObject({ alerta: false, repetida: true });
    expect(correos.sendMcpAlertasEmail).not.toHaveBeenCalled();
  });

  it('con MCP_ALERTAS=false, ni se guarda ni sale', async () => {
    process.env.MCP_ALERTAS = 'false';
    await alertas.alertarUrlCompartida({ tokenId: 2, urlDe: { id: TONY.id }, usadaPor: { id: YOLANDA.id } });
    expect(hecho(/INSERT INTO mcp_alertas/)).toBe(false);
    expect(correos.sendMcpAlertasEmail).not.toHaveBeenCalled();
  });

  it('si la base falla al avisar, la llamada no se rompe', async () => {
    const antes = query.getMockImplementation();
    query.mockImplementation(async (sql, params) => {
      if (/INSERT INTO mcp_alertas/.test(sql)) throw new Error('base caída');
      return antes(sql, params);
    });
    const r = await alertas.alertarUrlCompartida({ tokenId: 2, urlDe: { id: TONY.id }, usadaPor: { id: YOLANDA.id } });
    expect(r).toMatchObject({ alerta: false, error: 'base caída' });
  });

  it('y no cuenta en la alerta de «fallos de desbloqueo»: tiene la suya', async () => {
    process.env.MCP_ALERTA_MADRUGADA = '';
    await alertas.revisar();
    const [sql, params] = sqls.find(([s]) => /a\.herramienta = 'desbloquear' AND NOT a\.ok/.test(s));
    expect(sql).toMatch(/a\.error IS DISTINCT FROM \$3/);
    expect(params[2]).toBe('CODIGO_DE_OTRA_PERSONA');
  });
});

// ─── 2. La alerta de madrugada ────────────────────────────────────────────

describe('la alerta de madrugada', () => {
  const noche = (fila) => ({
    user_id: TONY.id, primera: '2026-10-13T00:20:00Z', ultima: '2026-10-13T01:10:00Z', noche: '2026-10-13', ...fila,
  });

  it('no cuenta «Desbloquear desde aquí» (desbloquear_panel): es un clic, no una consulta', async () => {
    process.env.MCP_ALERTA_MADRUGADA = '0-6';
    await alertas.revisar();
    const [sql] = sqls.find(([s]) => /AS noche/.test(s));
    // #326: tampoco autorizar o rechazar un Claude, que también son clics en el panel.
    expect(sql).toMatch(/a\.herramienta NOT IN \('desbloquear_panel', 'conexion_autorizada', 'conexion_rechazada'\)/);
  });

  it('cuenta aparte las que dieron datos y las que paró el código', async () => {
    process.env.MCP_ALERTA_MADRUGADA = '0-6';
    base.madrugada = [noche({ consultas: 8, con_datos: 0, bloqueadas: 8, desbloqueos: 0 })];
    await alertas.revisar();
    const [sql, params] = sqls.find(([s]) => /AS noche/.test(s));
    expect(sql).toMatch(/FILTER \(WHERE a\.ok AND a\.herramienta <> 'desbloquear'\)::int AS con_datos/);
    expect(sql).toMatch(/a\.error LIKE ANY\(\$5::text\[\]\)/);
    expect(params[4]).toEqual(alertas.BARRERA_DEL_CODIGO.map((m) => `${m}%`));
    const a = correos.sendMcpAlertasEmail.mock.calls[0][0].alertas.find((x) => x.tipo === 'madrugada');
    expect(a.detalle).toMatchObject({ consultas: 8, con_datos: 0, bloqueadas: 8, desbloqueos: 0, franja: '0-6 h' });
  });

  it('lo que la auditoría guarda cuando la barrera para una consulta empieza como se busca', async () => {
    // Sin desbloquear:
    expect(desbloqueo.MENSAJE_SIN_DESBLOQUEAR.startsWith(alertas.BARRERA_DEL_CODIGO[0])).toBe(true);
    await usarHerramienta('mis_proyectos');
    expect(modelo.registrarAuditoria.mock.calls.at(-1)[0].error.startsWith(alertas.BARRERA_DEL_CODIGO[0])).toBe(true);
    // Bloqueada por fallos:
    base.estado = { bloqueado: true, desbloqueado: false, bloqueado_hasta: new Date(Date.now() + 900000) };
    await usarHerramienta('mis_proyectos');
    expect(modelo.registrarAuditoria.mock.calls.at(-1)[0].error.startsWith(alertas.BARRERA_DEL_CODIGO[1])).toBe(true);
  });
});

// ─── 3. Los correos, con la zona de las horas ─────────────────────────────

describe('los correos de alertas (el de verdad, parado por el freno)', () => {
  const html = () => registrados.at(-1).cuerpoHtml;
  const madrugada = (d) => ({
    tipo: 'madrugada', userId: TONY.id, persona: { nombre: 'Tony', email: TONY.email },
    detalle: { primera: '2026-10-13T00:20:00Z', ultima: '2026-10-13T01:10:00Z', noche: '2026-10-13', franja: '0-6 h', ...d },
  });
  const enviar = (lista) => brevoDeVerdad.sendMcpAlertasEmail({ para: [{ email: 'diego@vigila.test' }], alertas: lista });

  it('madrugada: «8 consultas, 0 con datos (todas bloqueadas por el código)», con la hora de Madrid', async () => {
    await enviar([madrugada({ consultas: 8, con_datos: 0, bloqueadas: 8, desbloqueos: 0 })]);
    expect(html()).toContain('8 consultas, 0 con datos (todas bloqueadas por el código)');
    // 00:20 UTC son las 02:20 en Madrid (horario de verano).
    expect(html()).toMatch(/entre las 13 oct, 02:20 y las 13 oct, 03:10 \(hora de Madrid; franja 0-6 h\)/);
    expect(registrados.at(-1).proyecto.nombre).toMatch(/^(MultiCRM|ISEIE)$/);   // P.correo, con la marca
  });

  it('madrugada con datos y sin ellos mezclados', async () => {
    await enviar([madrugada({ consultas: 5, con_datos: 2, bloqueadas: 3, desbloqueos: 0 })]);
    expect(html()).toContain('5 consultas, 2 con datos (las otras 3, bloqueadas por el código)');
    await enviar([madrugada({ consultas: 4, con_datos: 0, bloqueadas: 2, desbloqueos: 1 })]);
    expect(html()).toContain('4 consultas, 0 con datos (2 bloqueadas por el código, 1 para desbloquear, 1 con otro error)');
    await enviar([madrugada({ consultas: 3, con_datos: 3, bloqueadas: 0, desbloqueos: 0 })]);
    expect(html()).toContain('3 consultas, todas con datos');
  });

  it('con otra APP_TIMEZONE, su zona', async () => {
    process.env.APP_TIMEZONE = 'America/Bogota';
    await enviar([madrugada({ consultas: 1, con_datos: 0, bloqueadas: 1, desbloqueos: 0 })]);
    expect(html()).toContain('1 consulta, 0 con datos (bloqueada por el código)');
    expect(html()).toMatch(/entre las 12 oct, 19:20 y las 12 oct, 20:10 \(hora de Bogota; franja 0-6 h\)/);
  });

  it('URL compartida: de quién es la URL, quién la usa y a qué hora (de Madrid)', async () => {
    await enviar([{
      tipo: 'url_compartida', userId: TONY.id, persona: { nombre: 'Tony', email: TONY.email },
      detalle: { conexion: 'Claude de Tony', prefijo: 'crm_mcp_ab', usada_por: 'Yolanda', usada_por_email: YOLANDA.email, cuando: '2026-10-13T00:20:00Z' },
    }]);
    expect(html()).toContain('URL compartida');
    expect(html()).toMatch(/La URL <strong>Claude de Tony<\/strong> \(crm_mcp_ab…\) de <strong>Tony<\/strong>/);
    expect(html()).toMatch(/la está usando <strong>Yolanda<\/strong> \(yolanda@ejemplo\.test\): a las 13 oct, 02:20 \(hora de Madrid\)/);
  });

  it('ráfaga y bloqueo, también con la zona', async () => {
    await enviar([{ tipo: 'rafaga', userId: TONY.id, persona: { nombre: 'Tony' }, detalle: { consultas: 120, minutos: 10, hasta: '2026-10-13T10:00:00Z' } }]);
    expect(html()).toMatch(/hasta las 13 oct, 12:00, hora de Madrid/);
    await brevoDeVerdad.sendMcpBloqueoEmail({
      para: [{ email: 'diego@vigila.test' }], maxFallos: 5, hasta: '2026-10-13T00:35:00Z',
      persona: { nombre: 'Tony', conexion: 'Claude de Tony', prefijo: 'crm_mcp_ab' },
    });
    // El enlace entre fecha y hora depende de la versión de ICU de Node («, » en local, «a las» en
    // la CI): lo que se comprueba es la hora de Madrid (00:35 UTC → 02:35) y la zona escrita.
    expect(html()).toMatch(/13 de octubre[^<]{0,12}02:35<\/strong> \(hora de Madrid\)/);
  });
});
