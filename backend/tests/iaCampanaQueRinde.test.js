import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * «¿Que campaña rinde?» como herramienta del asistente (#30), contra la base.
 *
 * La cadena: campaña de Meta → prospecto (`utm_campaign`) → venta → lo COBRADO
 * de verdad (`conversion_payments`). Los casos y las cifras son los de
 * `metaRetornoPorCampana.test.js` de la rama del #53 (la misma consulta, en otra
 * forma): si las dos dejan de coincidir, una de ellas se ha desviado.
 *
 * Lo que se defiende aqui:
 *   · gasto, prospectos, ventas, cobrado, coste por venta y retorno por campaña;
 *   · el cobrado sale de los apuntes y no de `importe_pagado` (declara de mas);
 *   · una venta sin cobro no es venta, una mensualidad tampoco, y un prospecto
 *     borrado no cuenta;
 *   · otro campus no entra, y el recorte lo pone el servidor, no el modelo;
 *   · las dos lecturas del rango (cohorte y caja);
 *   · las cifras que Claude cite se verifican contra estos datos.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/iaCampanaQueRinde.test.js
 */

// Claude y el tope de gasto se simulan; la base es la de verdad.
const gasto = {
  compruebaAntesDeGastar: vi.fn(async () => ({ permitido: true, motivo: null, estado: {} })),
  registrar: vi.fn(async () => ({ apuntado: true })),
  estado: vi.fn(async () => ({ porcentaje: 1, cerca: false, queda: 19, tope: 20, gastado: 1 })),
};
vi.mock('../src/shared/services/gastoIA.service.js', () => gasto);
vi.mock('../src/modules/credentials/credentials.model.js', () => ({ getDecryptedValue: async () => 'clave-falsa-de-prueba' }));

const { default: pool } = await import('../src/shared/config/db.js');
const consultas = await import('../src/modules/ia-analisis/consultas.js');
const { cifrasSinRespaldo } = await import('../src/modules/ia-analisis/cifras.js');
const { preguntar } = await import('../src/modules/ia-analisis/preguntar.service.js');

const MARCA = `IAC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const C1 = `${MARCA}-C1`;
const C2 = `${MARCA}-C2`;
const CB = `${MARCA}-CB`;
let P; let OTRO; let PRODUCTO;
const ids = { leads: [], conversions: [] };

async function lead(nombre, { campana = null, creado, proyecto = P, borrado = false }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, created_at, deleted_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, creado, borrado ? '2026-10-20' : null]
  );
  ids.leads.push(l.id);
  if (campana) await q(`INSERT INTO lead_utms (lead_id, utm_campaign) VALUES ($1, $2)`, [l.id, campana]);
  return l.id;
}

/** Una venta con sus apuntes de cobro: [[importe, fecha], ...]. `declarado`: lo que dice importe_pagado. */
async function venta(leadId, total, cobros, { declarado = 0, mensualidad = false, producto = null, proyecto = P } = {}) {
  const [c] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion, es_mensualidad)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-09-15', $7) RETURNING id`,
    [leadId, proyecto, `${MARCA} Master`, producto, total, declarado, mensualidad]
  );
  ids.conversions.push(c.id);
  for (const [importe, fecha] of cobros) {
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, $3)`, [c.id, importe, fecha]);
  }
  return c.id;
}

beforeAll(async () => {
  const proy = async (clave) => (await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]
  ))[0].id;
  P = await proy('a');
  OTRO = await proy('b');
  PRODUCTO = (await q(`INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, `${MARCA} Master`]))[0].id;

  for (const [id, nombre, proyecto] of [[C1, 'Campaña uno', P], [C2, 'Campaña dos', P], [CB, 'Campaña del otro campus', OTRO]]) {
    await q(`INSERT INTO meta_campaigns (campaign_id, project_id, ad_account_id, nombre) VALUES ($1, $2, 'act_1', $3)`, [id, proyecto, `${MARCA} ${nombre}`]);
  }
  await q(
    `INSERT INTO meta_campaigns_daily (campaign_id, project_id, date, spend, leads) VALUES
       ($1, $4, '2026-09-10', 100, 5), ($1, $4, '2026-10-10', 50, 3), ($2, $4, '2026-10-05', 80, 4),
       ($3, $5, '2026-10-10', 10, 1)`,
    [C1, C2, CB, P, OTRO]
  );

  // L1: captado en septiembre; cobra 400 en septiembre y 300 en octubre. Su
  // importe_pagado declara 9.999: no puede contar.
  const l1 = await lead('L1', { campana: C1, creado: '2026-09-12' });
  await venta(l1, 1000, [[400, '2026-09-20'], [300, '2026-10-12']], { declarado: 9999, producto: PRODUCTO });
  // L2: captado en octubre, venta pagada entera en octubre.
  const l2 = await lead('L2', { campana: C1, creado: '2026-10-11' });
  await venta(l2, 500, [[500, '2026-10-15']]);
  // L3: captado en octubre, sin venta.
  await lead('L3', { campana: C1, creado: '2026-10-12' });
  // L4: de la campaña dos, con una venta SIN ningun cobro: no es una venta todavia.
  const l4 = await lead('L4', { campana: C2, creado: '2026-10-06' });
  await venta(l4, 800, []);
  // L5: sin campaña. Su venta es del CRM pero no de Meta.
  const l5 = await lead('L5', { creado: '2026-10-07' });
  await venta(l5, 700, [[700, '2026-10-08']]);
  // L6: borrado, con campaña y con cobro: no cuenta.
  const l6 = await lead('L6', { campana: C1, creado: '2026-10-13', borrado: true });
  await venta(l6, 123, [[123, '2026-10-14']]);
  // L7: su venta es una mensualidad: no es una venta nueva.
  const l7 = await lead('L7', { campana: C1, creado: '2026-10-14' });
  await venta(l7, 77, [[77, '2026-10-16']], { mensualidad: true });
  // L8: del OTRO campus pero con el id de la campaña uno (un UTM copiado a mano):
  // la campaña es de P, no de su campus, asi que no cuenta en ninguna.
  const l8 = await lead('L8', { campana: C1, creado: '2026-10-15', proyecto: OTRO });
  await venta(l8, 999, [[999, '2026-10-15']], { proyecto: OTRO });
  // LB: el prospecto bueno del otro campus, con su propia campaña.
  const lb = await lead('LB', { campana: CB, creado: '2026-10-11', proyecto: OTRO });
  await venta(lb, 100, [[100, '2026-10-12']], { proyecto: OTRO });
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM lead_utms WHERE lead_id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM meta_campaigns_daily WHERE project_id = ANY($1::int[])`, [[P, OTRO]]);
  await q(`DELETE FROM meta_campaigns WHERE project_id = ANY($1::int[])`, [[P, OTRO]]);
  await q(`DELETE FROM products WHERE project_id = $1`, [P]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [[P, OTRO]]);
  await pool.end();
}, 60000);

const fila = (datos, id) => datos.campanas.find((c) => c.campana_id === id);
/** Lo que haria el asistente: la consulta con el ambito que pone el servidor. */
const corre = (parametros, alcance) => consultas.ejecutar('campana_que_rinde', parametros, { alcance });

describe('la campaña que rinde, de lo gastado a lo cobrado', () => {
  it('toda la vida de la campaña: gasto, prospectos, ventas, cobrado, coste por venta y retorno', async () => {
    const { datos } = await corre({}, { projectId: P });
    expect(fila(datos, C1)).toMatchObject({
      campus: `${MARCA} a`,
      gasto: 150,
      // L1, L2, L3 y L7 llegaron por ella; no el borrado (L6) ni el del otro campus (L8).
      prospectos_crm: 4,
      // Dos ventas con cobro (L1 y L2). La mensualidad (L7) no es una venta nueva.
      ventas: 2,
      vendido: 1500,
      // 700 + 500, de los apuntes: el importe_pagado de L1 declara 9.999 y no cuenta.
      cobrado: 1200,
      coste_por_prospecto: 37.5,
      coste_por_venta: 75,
      retorno: 1050,
      retorno_pct: 700,
      cobrado_en_periodo: 1200,
    });
  });

  it('una venta sin cobro no es una venta; y el dinero de un prospecto sin campaña no es de Meta', async () => {
    const { datos } = await corre({}, { projectId: P });
    expect(fila(datos, C2)).toMatchObject({
      gasto: 80, prospectos_crm: 1, ventas: 0, vendido: 0, cobrado: 0,
      coste_por_venta: null, retorno: -80, retorno_pct: -100,
    });
    // Los 700 de L5 no entran en ninguna campaña.
    expect(datos.totales).toMatchObject({
      gasto: 230, prospectos_crm: 5, ventas: 2, cobrado: 1200,
      coste_por_venta: 115, retorno: 970, retorno_pct: 421.74,
    });
  });

  it('el cobrado atribuido es lo cobrado por los prospectos de esas campañas, ni un euro de mas', async () => {
    const { datos } = await corre({}, { projectId: P });
    const [{ total }] = await q(
      `SELECT COALESCE(SUM(cp.importe), 0)::float AS total
         FROM conversion_payments cp
         JOIN conversions c ON c.id = cp.conversion_id
         JOIN lead_utms lu ON lu.lead_id = c.lead_id
         JOIN leads l ON l.id = c.lead_id
        WHERE c.project_id = $1 AND NOT c.es_mensualidad AND l.deleted_at IS NULL AND lu.utm_campaign = ANY($2)`,
      [P, [C1, C2]]
    );
    expect(datos.totales.cobrado).toBe(total);
  });

  it('octubre: gasto de octubre frente a lo captado en octubre (cohorte) y a lo que entro en octubre (caja)', async () => {
    const { datos, parametros } = await corre({ from: '2026-10-01', to: '2026-10-31' }, { projectId: P });
    expect(parametros).toEqual({ from: '2026-10-01', to: '2026-10-31', projectId: P });
    expect(fila(datos, C1)).toMatchObject({
      gasto: 50,
      prospectos_crm: 3, // L2, L3 y L7: L1 es de septiembre
      ventas: 1,
      vendido: 500,
      cobrado: 500,
      coste_por_venta: 50,
      retorno: 450,
      retorno_pct: 900,
      // En octubre ha entrado dinero de L1 (300, captado en septiembre) y de L2 (500).
      cobrado_en_periodo: 800,
      retorno_en_periodo: 750,
      retorno_en_periodo_pct: 1500,
    });
  });

  it('EL DESFASE: lo captado en septiembre se mide con todo lo que ha cobrado hasta hoy', async () => {
    const { datos } = await corre({ from: '2026-09-01', to: '2026-09-30' }, { projectId: P });
    expect(fila(datos, C1)).toMatchObject({
      gasto: 100, prospectos_crm: 1, ventas: 1, vendido: 1000,
      cobrado: 700, retorno_pct: 600,
      // Mirando solo la caja de septiembre parecería mucho peor.
      cobrado_en_periodo: 400, retorno_en_periodo_pct: 300,
    });
    // Sin gasto, prospectos ni cobros en el rango, la campaña dos no sale.
    expect(fila(datos, C2)).toBeUndefined();
  });

  it('una consulta sin nada que contar devuelve las listas vacias y los totales a cero, no un error', async () => {
    const { datos } = await corre({ from: '2020-01-01', to: '2020-01-31' }, { projectId: P });
    expect(datos.campanas).toEqual([]);
    expect(datos.totales).toMatchObject({ gasto: 0, ventas: 0, cobrado: 0, coste_por_venta: null, retorno_pct: null });
  });
});

describe('el campus lo pone el servidor', () => {
  it('otro campus no entra en el ambito de la persona', async () => {
    const { datos } = await corre({}, { projectId: P });
    expect(datos.campanas.map((c) => c.campana_id).sort()).toEqual([C1, C2].sort());
    expect(datos.campanas.every((c) => c.campus === `${MARCA} a`)).toBe(true);
  });

  it('diga lo que diga el modelo: pedir el id del otro campus se tira', async () => {
    const { datos, parametros } = await corre({ projectId: OTRO }, { projectId: P });
    expect(parametros.projectId).toBe(P);
    expect(fila(datos, CB)).toBeUndefined();
  });

  it('una sociedad con varios campus los trae todos, cada campaña en el suyo', async () => {
    const { datos } = await corre({}, { projectIds: [P, OTRO] });
    expect(fila(datos, CB)).toMatchObject({ campus: `${MARCA} b`, gasto: 10, prospectos_crm: 1, ventas: 1, cobrado: 100, coste_por_venta: 10 });
    // El UTM copiado a mano (L8) no suma a la campaña uno ni siquiera con los dos campus a la vista.
    expect(fila(datos, C1)).toMatchObject({ prospectos_crm: 4, cobrado: 1200 });
    expect(datos.totales).toMatchObject({ gasto: 240, cobrado: 1300, ventas: 3 });
  });

  it('un ambito de otro campus no ve las campañas de este', async () => {
    const { datos } = await corre({}, { projectId: OTRO });
    expect(datos.campanas.map((c) => c.campana_id)).toEqual([CB]);
  });
});

describe('los parametros del modelo', () => {
  it('Zod descarta lo que no es valido y no lo corrige', () => {
    expect(consultas.limpiarParametros('campana_que_rinde', { projectId: '3; DROP TABLE leads' })).toEqual({});
    expect(consultas.limpiarParametros('campana_que_rinde', { from: '2026-13-45' })).toEqual({});
    expect(consultas.limpiarParametros('campana_que_rinde', { from: 'julio', to: '2026-07-31', tabla: 'users' }))
      .toEqual({ to: '2026-07-31' });
    expect(consultas.limpiarParametros('campana_que_rinde', { projectId: '7', from: '2026-07-01' }))
      .toEqual({ projectId: 7, from: '2026-07-01' });
  });

  it('esta en el catalogo y en las herramientas de Claude, sin projectId ni asesoraId', () => {
    expect(consultas.NOMBRES).toContain('campana_que_rinde');
    const h = consultas.herramientasParaClaude().find((x) => x.name === 'campana_que_rinde');
    expect(Object.keys(h.input_schema.properties).sort()).toEqual(['from', 'to']);
    expect(consultas.catalogoEnTexto()).toMatch(/campana_que_rinde/);
  });
});

describe('las cifras que Claude cite se verifican contra estos datos', () => {
  it('las que salen de la consulta pasan; la inventada y la suma propia, no', async () => {
    const { datos } = await corre({}, { projectId: P });
    const buena = 'La campaña uno gastó 150 € y cobró 1.200 €: 75 € por venta y un retorno de 1.050 € (700 %).';
    expect(cifrasSinRespaldo(buena, [datos])).toEqual([]);

    // Los totales vienen calculados: citar el coste por venta global no es una cifra suelta.
    expect(cifrasSinRespaldo('En conjunto, 230 € de gasto y 115 € por venta.', [datos])).toEqual([]);

    // 9.999 es el importe_pagado declarado de L1: no esta en lo cobrado.
    expect(cifrasSinRespaldo('Cobró 9.999 € y su retorno fue de 1.050 €.', [datos])).toEqual(['9.999']);
    // Una suma que el modelo hizo por su cuenta tampoco sale de los datos.
    expect(cifrasSinRespaldo('Entre las dos cobraron 1.350 €.', [datos])).toEqual(['1.350']);
  });

  it('de punta a punta: Claude pide la campaña de OTRO campus, el servidor la recorta y la respuesta se verifica', async () => {
    const llamar = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'tool_use', id: 'tu_1', name: 'campana_que_rinde', input: { projectId: OTRO, from: '2026-10-01', to: '2026-10-31' } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 },
        content: [{ type: 'text', text: 'En octubre la campaña uno gastó 50 € y cobró 500 € por 1 venta: 450 € de retorno. Costó 77 € por lead.' }],
      });

    const r = await preguntar({
      pregunta: '¿Qué campaña rinde en octubre?', alcance: { projectId: P }, llamar,
      hoy: new Date('2026-10-20T10:00:00Z'),
    });

    expect(r.ok).toBe(true);
    expect(r.desglose).toHaveLength(1);
    expect(r.desglose[0].parametros).toMatchObject({ projectId: P, from: '2026-10-01', to: '2026-10-31' });
    expect(r.desglose[0].datos.campanas.map((c) => c.campana_id).sort()).toEqual([C1, C2].sort());
    // «77 €» no sale de los datos; lo demas, si.
    expect(r.cifrasSinComprobar).toEqual(['77']);
    expect(r.verificada).toBe(false);
  });
});
