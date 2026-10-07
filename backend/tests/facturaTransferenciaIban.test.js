// Carlos, 30/09/2026: «en las facturas que salgan seleccionando transferencia
// bancaria, debe de aparecer el IBAN y abajo el código BIC/SWIFT».
//
// Contra la base de verdad: se crea una sociedad con su banco y dos facturas —una
// por transferencia y otra con tarjeta—, se saca el PDF y se lee su texto.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inflateSync } from 'zlib';

const { default: pool } = await import('../src/shared/config/db.js');
const { generatePDF } = await import('../src/modules/invoices/invoices.service.js');

const IBAN = 'ES79 0049 6982 1624 1006 9196';
const BIC = 'BSCHESMMXXX';
let issuerId;
let projectId;
const facturas = {};

/** El texto de un PDF de pdf-lib: las cadenas en hexadecimal de sus `Tj`, descomprimiendo lo que haga falta. */
function textoDelPdf(bytes) {
  const buf = Buffer.from(bytes);
  const trozos = [buf.toString('latin1')];
  const re = /stream\r?\n/g;
  let m;
  const bin = buf.toString('latin1');
  while ((m = re.exec(bin))) {
    const ini = m.index + m[0].length;
    const fin = bin.indexOf('endstream', ini);
    if (fin < 0) break;
    try { trozos.push(inflateSync(buf.subarray(ini, fin)).toString('latin1')); } catch { /* no estaba comprimido */ }
  }
  const hex = trozos.join('\n').match(/<([0-9A-Fa-f]+)>\s*Tj/g) || [];
  return hex.map((h) => Buffer.from(h.replace(/[<>\sTj]/g, ''), 'hex').toString('latin1')).join('\n');
}

async function factura(metodo) {
  const { rows } = await pool.query(
    `INSERT INTO invoices (project_id, ano, issuer_id, issuer_razon_social, issuer_nif, tipo, estado, metodo_pago,
                           cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                           items, base_imponible, iva_pct, iva_importe, total, fecha_emision)
     VALUES ($3, 2026, $1, 'Sociedad de prueba IBAN S.L.', 'B00000000', 'normal', 'borrador', $2,
             'Cliente de prueba', '00000000T', 'Calle 1', 'Madrid', '28001', 'España',
             '[{"descripcion":"Curso de prueba","cantidad":1,"precio_unitario":100,"subtotal":100}]'::jsonb,
             100, 21, 21, 121, CURRENT_DATE)
     RETURNING id`,
    [issuerId, metodo, projectId],
  );
  return rows[0].id;
}

let proyectoCreado = false;
beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: si no hay proyecto, se crea uno.
  const p = await pool.query('SELECT id FROM projects ORDER BY id LIMIT 1');
  if (p.rows[0]) projectId = p.rows[0].id;
  else {
    const n = await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Prueba IBAN', 'prueba-iban', 'clave-prueba-iban') RETURNING id`);
    projectId = n.rows[0].id;
    proyectoCreado = true;
  }
  const { rows } = await pool.query(
    `INSERT INTO invoice_issuers (project_id, razon_social, nif, iban, bic)
     VALUES ($3, 'Sociedad de prueba IBAN S.L.', 'B00000000', $1, $2) RETURNING id`, [IBAN, BIC, projectId]);
  issuerId = rows[0].id;
  facturas.transferencia = await factura('transferencia');
  facturas.tarjeta = await factura('tarjeta');
});

afterAll(async () => {
  await pool.query('DELETE FROM invoices WHERE issuer_id = $1', [issuerId]);
  await pool.query('DELETE FROM invoice_issuers WHERE id = $1', [issuerId]);
  if (proyectoCreado) await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
  await pool.end();
});

describe('factura por transferencia', () => {
  it('lleva el IBAN y, debajo, el BIC/SWIFT de la sociedad', async () => {
    const texto = textoDelPdf((await generatePDF(facturas.transferencia, { preliminar: true })).bytes);
    expect(texto).toContain('Forma de pago: Transferencia bancaria');
    expect(texto).toContain(`IBAN: ${IBAN}`);
    expect(texto).toContain(`BIC/SWIFT: ${BIC}`);
    // Debajo: el BIC sale después del IBAN.
    expect(texto.indexOf(`BIC/SWIFT: ${BIC}`)).toBeGreaterThan(texto.indexOf(`IBAN: ${IBAN}`));
  });

  it('con tarjeta no sale el banco', async () => {
    const texto = textoDelPdf((await generatePDF(facturas.tarjeta, { preliminar: true })).bytes);
    expect(texto).toContain('Forma de pago: Tarjeta');
    expect(texto).not.toContain('BIC/SWIFT');
  });
});
