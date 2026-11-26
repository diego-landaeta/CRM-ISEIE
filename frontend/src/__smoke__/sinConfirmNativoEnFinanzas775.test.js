import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CRM-ISEIE#775, primer lote (Finanzas, Facturas, Ventas): nada de `confirm()`
 * ni `alert()` nativos del navegador — el diálogo es `useConfirm()`/`ConfirmDialog`
 * y los avisos son `toast`. Gemela en CRM#1120.
 */

const ARCHIVOS = [
  'src/modules/accounting/pages/CobrosExternosPage.tsx',
  'src/modules/accounting/pages/IntegrationsPage.tsx',
  'src/modules/invoices/components/EmitirFacturaCobro.tsx',
  'src/modules/invoices/components/FacturacionAlDiaCard.tsx',
  'src/modules/invoices/lib/masQueLoCobrado.tsx',
  'src/modules/invoices/pages/InvoicesPage.tsx',
  'src/modules/invoices/pages/InvoiceTemplateEditorPage.tsx',
  'src/modules/invoices/pages/InvoicingConfigPage.tsx',
  'src/modules/conversions/components/ConversionsTab.tsx',
  'src/modules/conversions/components/InstallmentsDialog.tsx',
  'src/modules/conversions/components/PaymentDialog.tsx',
  'src/modules/sales/pages/VentasSinFormacionPage.tsx',
];

const CONFIRM_NATIVO = /(?<!await )\bconfirm\(/;
const ALERT_NATIVO = /\balert\(/;

describe('CRM-ISEIE#775 — sin confirm()/alert() nativos en Finanzas, Facturas y Ventas', () => {
  it.each(ARCHIVOS)('%s', (ruta) => {
    const contenido = readFileSync(resolve(process.cwd(), ruta), 'utf8');
    expect(contenido).not.toMatch(CONFIRM_NATIVO);
    expect(contenido).not.toMatch(ALERT_NATIVO);
  });
});