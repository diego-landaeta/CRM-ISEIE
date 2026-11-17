import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #772 (gemela CRM-ISEIE#460) · Automatizaciones 9/9: el informe mensual por
 * equipo y por comercial, el ZIP de facturas del mes de una empresa y el envío
 * a la gestoría.
 *
 * Contra la base LOCAL (tests/setup.js). El correo, simulado: el envío recibe
 * `mandar` y `yaEnviado` y aquí se le pasan funciones de prueba.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/informeMensual772.test.js
 */

// Los PDF que se generen, a una carpeta temporal y no a uploads/.
const CARPETA_PDF = fs.mkdtempSync(path.join(os.tmpdir(), 'informe772-'));
process.env.INVOICES_PDF_DIR = CARPETA_PDF;

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/informe-mensual/index.js');
const service = await import('../src/modules/informe-mensual/informe-mensual.service.js');
const { leerConfig, destinatarios } = await import('../src/modules/informe-mensual/informe-mensual.config.js');
const { firmaValida, firmar } = await import('../src/modules/informe-mensual/informe-mensual.enlace.js');
const { runInformeMensual, toca } = await import('../src/jobs/informeMensualJob.js');
const { default: JSZip } = await import('jszip');
const { default: ExcelJS } = await import('exceljs');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `IM${Date.now().toString(36)}`;
const SERIE = `T${Date.now().toString(36).slice(-7)}`.toUpperCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [] };
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

let EMPRESA; let OTRA; let A; let C;
let SUPER; let LIDER; let ADMIN_OTRA; let G1; let G2; let G3;
let F1; let R1;

const envDePrueba = (extra = {}) => ({
  INFORME_MENSUAL_ACTIVO: 'true',
  INFORME_MENSUAL_EMPRESAS: SERIE,
  [`INFORME_MENSUAL_PARA_${SERIE}`]: 'gestoria@ejemplo.test',
  INFORME_MENSUAL_ADMINISTRACION: 'administracion@ejemplo.test',
  ...extra,
});

beforeAll(async () => {
  const empresa = async (n, serie = null) => {
    const e = await one('INSERT INTO invoice_issuers (razon_social, nif, serie) VALUES ($1, $2, $3) RETURNING id, razon_social, serie',
      [`${MARCA}${n} Sociedad SL`, `B${Date.now().toString().slice(-8)}`, serie]);
    ids.issuers.push(e.id); return e;
  };
  const campus = async (n, issuer) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id)
                         VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, issuer]);
    ids.projects.push(p.id); return p.id;
  };
  EMPRESA = await empresa('', SERIE);
  OTRA = await empresa('otra');
  A = await campus('a', EMPRESA.id);
  C = await campus('c', OTRA.id);

  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  SUPER = await persona('super', 'superadmin', []);
  LIDER = await persona('lider', 'admin', [A]);
  ADMIN_OTRA = await persona('adminotra', 'admin', [C]);
  G1 = await persona('g1', 'gestor', [A]);
  G2 = await persona('g2', 'gestor', [A]);
  G3 = await persona('g3', 'gestor', [A]);   // sin equipo
  await q('INSERT INTO equipo_comercial (lider_id, gestora_id) VALUES ($1, $2), ($1, $3)', [LIDER.id, G1.id, G2.id]);

  const venta = async (gestora, total, fecha, pagos) => {
    const l = await one('INSERT INTO leads (project_id, nombre, responsable_id) VALUES ($1, $2, $3) RETURNING id',
      [A, `${MARCA} cliente`, gestora.id]);
    // importe_pagado a propósito MAL: lo cobrado tiene que salir de los pagos (#692).
    const v = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, vendedora_id, metodo_pago)
                         VALUES ($1, $2, 'Curso', $3, 9999, $4, $5, 'tarjeta') RETURNING id`, [l.id, A, total, fecha, gestora.id]);
    for (const [importe, f] of pagos) {
      await q('INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, $2, $3, \'tarjeta\')', [v.id, importe, f]);
    }
    return v.id;
  };
  const V1 = await venta(G1, 1000, '2026-10-03', [[300, '2026-10-05'], [200, '2026-11-02']]);
  await venta(G2, 500, '2026-10-18', [[500, '2026-10-20']]);
  await venta(G3, 400, '2026-10-30', [[100, '2026-10-31']]);
  await venta(G1, 600, '2026-09-12', [[50, '2026-10-10']]);   // venta de septiembre cobrada en octubre

  let n = 0;
  const factura = async ({ tipo = 'normal', estado = 'emitida', fecha, total, conversion = null, numero = true, rectifica = null }) => {
    n += 1;
    const num = numero ? n : null;
    return one(
      `INSERT INTO invoices (project_id, issuer_id, serie, ano, numero, codigo, tipo, estado, fecha_emision, cliente_nombre, cliente_nif,
                             cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, iva_pct, iva_importe, total,
                             conversion_id, metodo_pago, rectifica_codigo)
       VALUES ($1, $2, $3, 2026, $4, $5, $6, $7, $8, 'Cliente Prueba', 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España',
               '[]'::jsonb, $9, 0, 0, $9, $10, 'tarjeta', $11) RETURNING id, codigo`,
      [A, EMPRESA.id, SERIE, num, num ? `2026/${SERIE}-${num}` : null, tipo, estado, fecha, total, conversion, rectifica]);
  };
  F1 = await factura({ fecha: '2026-10-05', total: 300, conversion: V1 });
  R1 = await factura({ tipo: 'rectificativa', fecha: '2026-10-25', total: -50, conversion: V1, rectifica: F1.codigo });
  await factura({ estado: 'cancelada', fecha: '2026-10-15', total: 80 });
  await factura({ estado: 'borrador', fecha: '2026-10-16', total: 70, numero: false });
  await factura({ tipo: 'proforma', fecha: '2026-10-17', total: 60 });
  await factura({ fecha: '2026-11-03', total: 999 });                     // de noviembre: no entra
});

afterAll(async () => {
  if (ids.projects.length) {
    const ventas = 'SELECT id FROM conversions WHERE project_id = ANY($1::int[])';
    await q('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, [ids.projects]);
    await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]);
    await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [ids.projects]);
  }
  if (ids.users.length) {
    await q('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[])', [ids.users]);
    await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
    await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  }
  if (ids.projects.length) await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  if (ids.issuers.length) await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  fs.rmSync(CARPETA_PDF, { recursive: true, force: true });
  await pool.end();
});

const fila = (lista, nombre) => lista.find((x) => x.nombre === `${MARCA} ${nombre}`);

describe('#772 · el informe del mes, por comercial y por equipo', () => {
  it('lo cobrado es la suma de los pagos con fecha en el mes natural, no importe_pagado', async () => {
    const inf = await service.informeDelMes({ periodo: '2026-10', projectIds: [A] });
    // G1: 300 de su venta de octubre + 50 de la de septiembre; los 200 de noviembre, fuera.
    expect(fila(inf.comerciales, 'g1').cobrado).toBe(350);
    expect(fila(inf.comerciales, 'g2').cobrado).toBe(500);
    expect(fila(inf.comerciales, 'g3').cobrado).toBe(100);
    expect(inf.total.cobrado).toBe(950);
    // Facturado: por la fecha de emisión, con el abono restando y sin anulada, borrador ni proforma.
    expect(fila(inf.comerciales, 'g1').facturado).toBe(250);
    // Ventas del mes: solo las de octubre con algún cobro.
    expect(fila(inf.comerciales, 'g1').ventas).toBe(1);
  });

  it('agrupa por equipo (líder con sus gestoras) y deja aparte a quien no tiene', async () => {
    const inf = await service.informeDelMes({ periodo: '2026-10', projectIds: [A] });
    const equipo = inf.equipos.find((e) => e.equipo === `Equipo de ${MARCA} lider`);
    expect(equipo).toMatchObject({ comerciales: 2, cobrado: 850, facturado: 250 });
    expect(inf.equipos.find((e) => e.equipo === 'Sin equipo')).toMatchObject({ comerciales: 1, cobrado: 100 });
    expect(fila(inf.comerciales, 'g1').equipo).toBe(`Equipo de ${MARCA} lider`);
    expect(fila(inf.comerciales, 'g3').equipo).toBe('Sin equipo');
  });

  it('en pantalla y en Excel, con permiso y dentro de sus campus', async () => {
    const r = await request.get(`/api/informe-mensual?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(SUPER));
    expect(r.status).toBe(200);
    expect(r.body.data.total.cobrado).toBe(950);
    expect(r.body.data.envio).toMatchObject({ dia: 1, hora: '09:00' });

    // Una gestora no tiene el permiso; un admin de otra empresa no ve esta.
    expect((await request.get(`/api/informe-mensual?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(G1))).status).toBe(403);
    const ajena = await request.get(`/api/informe-mensual?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(ADMIN_OTRA));
    expect(ajena.status).toBe(403);
    expect((await request.get('/api/informe-mensual?periodo=2026-13').set(como(SUPER))).status).toBe(400);

    // Quien lleva un equipo ve el de su equipo: G3 no sale.
    const lider = await request.get(`/api/informe-mensual?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(LIDER));
    expect(lider.status).toBe(200);
    expect(fila(lider.body.data.comerciales, 'g3')).toBeUndefined();
    expect(lider.body.data.total.cobrado).toBe(850);

    const x = await request.get(`/api/informe-mensual/excel?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(SUPER))
      .buffer(true).parse((res, cb) => { const t = []; res.on('data', (c) => t.push(c)); res.on('end', () => cb(null, Buffer.concat(t))); });
    expect(x.status).toBe(200);
    expect(x.headers['content-type']).toContain('spreadsheetml');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(x.body);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Por equipo', 'Por comercial', 'Cómo se cuenta']);
  });
});

const binario = (res, cb) => { const t = []; res.on('data', (c) => t.push(c)); res.on('end', () => cb(null, Buffer.concat(t))); };

describe('#772 · el ZIP de facturas del mes de una empresa', () => {
  it('lleva los PDF de las emitidas (rectificativas aparte), el listado y el informe', async () => {
    const z = await service.zipDelMes({ periodo: '2026-10', empresa: EMPRESA });
    const zip = await JSZip.loadAsync(z.buffer);
    const nombres = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
    const archivo = (codigo) => `${codigo.replace(/\//g, '-')}.pdf`;
    expect(nombres).toEqual([
      `facturas/${archivo(F1.codigo)}`,
      'informe-ventas.xlsx',
      'listado-facturas.xlsx',
      `rectificativas/${archivo(R1.codigo)}`,
    ].sort());
    const pdf = await zip.file(`facturas/${archivo(F1.codigo)}`).async('nodebuffer');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(z.resumen).toMatchObject({ facturas: 1, rectificativas: 1, anuladas: 1, total: 250, sinPdf: 0 });

    // El listado: las dos y la anulada (sin PDF), y nada de borradores, proformas ni noviembre.
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(await zip.file('listado-facturas.xlsx').async('nodebuffer'));
    const h = libro.getWorksheet('Facturas');
    const filas = [];
    h.eachRow((r, i) => { if (i > 1) filas.push(r.values.slice(1)); });
    expect(filas.map((f) => f[0])).toEqual([F1.codigo, R1.codigo, `2026/${SERIE}-3`, 'Total (sin anuladas)']);
    expect(filas[2][2]).toBe('Anulada');
    expect(filas[3][10]).toBe(250);
  });

  it('se baja desde el CRM; quien lleva un equipo o es de otra empresa, no', async () => {
    const r = await request.get(`/api/informe-mensual/zip?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(SUPER)).buffer(true).parse(binario);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.headers['content-disposition']).toContain(`facturas-e-informe_2026-10_`);
    expect((await request.get(`/api/informe-mensual/zip?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(LIDER))).status).toBe(403);
    expect((await request.get(`/api/informe-mensual/zip?periodo=2026-10&issuerId=${EMPRESA.id}`).set(como(ADMIN_OTRA))).status).toBe(403);
    expect((await request.get('/api/informe-mensual/zip?periodo=2026-10').set(como(SUPER))).status).toBe(400);
  });
});

describe('#772 · el envío a la gestoría', () => {
  const ok = () => vi.fn(async () => ({ sent: true }));
  const nunca = async () => false;

  it('con el interruptor apagado (lo de serie) no se manda nada', async () => {
    expect(leerConfig({}).activo).toBe(false);
    const mandar = ok();
    const r = await runInformeMensual({ ahora: new Date('2026-11-01T10:00:00Z'), cfg: leerConfig(envDePrueba({ INFORME_MENSUAL_ACTIVO: 'false' })), mandar, yaEnviado: nunca });
    expect(r).toEqual({ omitido: 'apagado' });
    const r2 = await service.enviarMes({ periodo: '2026-10', cfg: leerConfig({}), mandar, yaEnviado: nunca });
    expect(r2.omitido).toBe('apagado');
    expect(mandar).not.toHaveBeenCalled();
  });

  it('solo el día elegido desde la hora de Madrid, y los tres siguientes de margen', () => {
    const cfg = leerConfig(envDePrueba({ INFORME_MENSUAL_DIA: '2', INFORME_MENSUAL_HORA: '09:30' }));
    expect(toca({ dia: 2, minuto: 9 * 60 + 29 }, cfg)).toBe(false);
    expect(toca({ dia: 2, minuto: 9 * 60 + 30 }, cfg)).toBe(true);
    expect(toca({ dia: 1, minuto: 12 * 60 }, cfg)).toBe(false);
    expect(toca({ dia: 5, minuto: 0 }, cfg)).toBe(true);
    expect(toca({ dia: 6, minuto: 12 * 60 }, cfg)).toBe(false);
  });

  it('la gestoría de la empresa (o la general) y administración, sin repetir', () => {
    const cfg = leerConfig(envDePrueba({ INFORME_MENSUAL_PARA: 'general@ejemplo.test' }));
    expect(destinatarios(cfg, EMPRESA)).toEqual(['gestoria@ejemplo.test', 'administracion@ejemplo.test']);
    expect(destinatarios(cfg, OTRA)).toEqual(['general@ejemplo.test', 'administracion@ejemplo.test']);
    expect(destinatarios(leerConfig({}), OTRA)).toEqual([]);
  });

  it('encendido, el día 1 a las 09:00 sale un correo por empresa con el ZIP adjunto', async () => {
    const mandar = ok();
    const cfg = leerConfig(envDePrueba());
    // 08:00 UTC en noviembre son las 09:00 de Madrid.
    expect(await runInformeMensual({ ahora: new Date('2026-11-01T07:59:00Z'), cfg, mandar, yaEnviado: nunca })).toEqual({ omitido: 'no toca hoy' });
    const r = await runInformeMensual({ ahora: new Date('2026-11-01T08:00:00Z'), cfg, mandar, yaEnviado: nunca });
    expect(r.mandados).toBe(1);
    expect(mandar).toHaveBeenCalledTimes(1);
    const correo = mandar.mock.calls[0][0];
    expect(correo.to).toEqual([{ email: 'gestoria@ejemplo.test' }, { email: 'administracion@ejemplo.test' }]);
    expect(correo.clave).toBe(`informe-mensual-${EMPRESA.id}-2026-10`);
    expect(correo.subject).toContain('2026-10');
    expect(correo.attachment).toHaveLength(1);
    expect(correo.attachment[0].name).toMatch(/^facturas-e-informe_2026-10_.+\.zip$/);
    const zip = await JSZip.loadAsync(Buffer.from(correo.attachment[0].content, 'base64'));
    expect(zip.file('informe-ventas.xlsx')).toBeTruthy();
    // La plantilla común, con el informe por equipo dentro.
    expect(correo.htmlContent).toContain(`Equipo de ${MARCA} lider`);
    expect(correo.htmlContent).toContain('Te lo manda el');
    expect(correo.textContent).toBeTruthy();
  });

  it('lo ya enviado no se vuelve a armar ni a mandar', async () => {
    const mandar = ok();
    const r = await service.enviarMes({ periodo: '2026-10', cfg: leerConfig(envDePrueba()), mandar, yaEnviado: async () => true });
    expect(mandar).not.toHaveBeenCalled();
    expect(r.empresas).toEqual([{ empresa: expect.any(String), estado: 'ya enviado' }]);
  });

  it('sin a quién mandarlo, no sale', async () => {
    const mandar = ok();
    const env = envDePrueba();
    delete env[`INFORME_MENSUAL_PARA_${SERIE}`];
    delete env.INFORME_MENSUAL_ADMINISTRACION;
    const r = await service.enviarMes({ periodo: '2026-10', cfg: leerConfig(env), mandar, yaEnviado: nunca });
    expect(mandar).not.toHaveBeenCalled();
    expect(r.empresas[0].estado).toBe('sin destinatarios');
  });

  it('si el ZIP no cabe, va un enlace firmado que caduca y que sirve el ZIP', async () => {
    const mandar = ok();
    const cfg = { ...leerConfig(envDePrueba({ CRM_BASE_URL: 'https://crm.ejemplo.test/crm' })), maxAdjuntoBytes: 10 };
    await service.enviarMes({ periodo: '2026-10', cfg, mandar, yaEnviado: nunca });
    const correo = mandar.mock.calls[0][0];
    expect(correo.attachment).toBeUndefined();
    const url = /https:\/\/crm\.ejemplo\.test\/crm\/api\/informe-mensual\/descarga\/(\d+)\/(2026-10)\?exp=(\d+)&amp;sig=([\w-]+)/.exec(correo.htmlContent);
    expect(url).toBeTruthy();
    const [, id, periodo, exp, sig] = url;
    expect(Number(id)).toBe(EMPRESA.id);
    expect(firmaValida(id, periodo, exp, sig)).toBe(true);
    expect(firmaValida(OTRA.id, periodo, exp, sig)).toBe(false);
    expect(firmaValida(id, '2026-09', exp, sig)).toBe(false);

    const ruta = `/api/informe-mensual/descarga/${id}/${periodo}?exp=${exp}&sig=${sig}`;
    process.env.INFORME_MENSUAL_ACTIVO = 'false';
    expect((await request.get(ruta)).status).toBe(404);
    process.env.INFORME_MENSUAL_ACTIVO = 'true';
    try {
      const r = await request.get(ruta).buffer(true).parse(binario);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('application/zip');
      expect((await request.get(`/api/informe-mensual/descarga/${id}/${periodo}?exp=${exp}&sig=${'x'.repeat(43)}`)).status).toBe(403);
      const caducado = firmar(id, periodo, { horas: 1, ahora: Date.now() - 2 * 3600 * 1000 });
      expect((await request.get(`/api/informe-mensual/descarga/${id}/${periodo}?exp=${caducado.exp}&sig=${caducado.sig}`)).status).toBe(403);
    } finally {
      delete process.env.INFORME_MENSUAL_ACTIVO;
    }
  });
});
