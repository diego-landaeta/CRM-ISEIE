import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { fuenteSegura } from '../src/modules/invoices/invoices.service.js';

// 02/11/2026: la factura ICTESS 2026/0111 de Yosbely no se podía descargar, generar ni
// enviar. La dirección del cliente decía «Camín de La Pedrera n⁰ 86» (cero volado, U+2070)
// y la fuente estándar del PDF (WinAnsi) reventaba con «WinAnsi cannot encode "⁰"».
const DIRECCION = 'DIRECCIÓN: Camín de La Pedrera n⁰ 86';

describe('el PDF de la factura con caracteres que WinAnsi no tiene', () => {
  it('sin limpiar, revienta (el fallo de la 0111)', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    expect(() => doc.addPage().drawText(DIRECCION, { x: 10, y: 10, size: 10, font })).toThrow(/WinAnsi/);
  });

  it('con la fuente segura se dibuja, y el cero volado sale como «º»', async () => {
    const doc = await PDFDocument.create();
    const font = fuenteSegura(await doc.embedFont(StandardFonts.Helvetica));
    const page = doc.addPage();
    expect(() => page.drawText(DIRECCION, { x: 10, y: 10, size: 10, font })).not.toThrow();
    expect(font.widthOfTextAtSize('n⁰', 10)).toBe(font.widthOfTextAtSize('nº', 10));
    // Lo que no tiene equivalente se quita en vez de romper el PDF; los acentos y el euro se quedan.
    expect(() => page.drawText('Ω 漢 ✓ ñ € 1.234,56', { x: 10, y: 30, size: 10, font })).not.toThrow();
    expect(font.widthOfTextAtSize('ñ €', 10)).toBeGreaterThan(font.widthOfTextAtSize('Ω', 10));
    expect((await doc.save()).length).toBeGreaterThan(0);
  });
});
