import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { Receipt, Warning } from '@phosphor-icons/react';
import { invoicesApi, invoiceFaltantes } from '../api/invoices.api';
import type { Invoice, InvoiceItem } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const EmitirBorradorDialog = lazy(() => import('./EmitirBorradorDialog'));
const FiscalDataDialog = lazy(() => import('./FiscalDataDialog'));

// Flujo nuevo de facturación (auto-emisión al pagar + borradores) SOLO donde el
// entorno lo activa (staging). En producción se mantiene el flujo clásico hasta
// validar QA: VITE_FACTURACION_V2=true en .env.staging.
const FACT_V2 = String(import.meta.env.VITE_FACTURACION_V2 || '') === 'true';

interface Props {
  projectId: number;
  leadId: number;
  conversionId: number;
  items: InvoiceItem[];
  size?: 'sm' | 'md';
  onInvoiced?: () => void;
}

// Botón de factura de una conversión:
// - Emitida completa → muestra el Nº y abre el PDF.
// - Emitida con datos incompletos (auto-emitida al pagar) → "Nº X — completar":
//   abre la alerta para rellenar los datos (desbloquea descargar/enviar).
// - BORRADOR → "BORRADOR — emitir" (alerta Validar y emitir).
// - Sin factura → "Emitir factura": completa→emite directo; incompleta→
//   V2: crea borrador + alerta · clásico: abre el modal de datos fiscales.
export default function InvoiceButton({ projectId, leadId, conversionId, items, size = 'sm', onInvoiced }: Props) {
  const [existing, setExisting] = useState<Invoice | null>(null);
  const [emitOpen, setEmitOpen] = useState(false);
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoicesApi.byConversion(conversionId);
      setExisting(res.success && res.data ? res.data : null);
    } finally { setLoading(false); }
  }, [conversionId]);
  useEffect(() => { refresh(); }, [refresh]);

  const isDraft = existing?.estado === 'borrador';
  const incompleta = !!existing && !isDraft && existing.tipo !== 'proforma' && invoiceFaltantes(existing).length > 0;

  async function onClick() {
    if (existing) {
      if (isDraft || incompleta) { setEmitOpen(true); return; }
      window.open(invoicesApi.pdfUrl(existing.id), '_blank');
      return;
    }
    setWorking(true);
    try {
      const lead = await invoicesApi.leadFiscalData(leadId);
      if (!lead.success || !lead.data) {
        toast({ title: 'Error', description: 'No se pudieron cargar datos del cliente', variant: 'destructive' });
        return;
      }
      const d = lead.data;
      const cfg = await invoicesApi.getConfig(projectId);
      const metodoDefault = (cfg.success && cfg.data?.factura_metodo_default) || 'transferencia';
      const pieDefault = cfg.success ? (cfg.data?.factura_pie_default || undefined) : undefined;
      const complete = d.nombre && d.identificacion_fiscal && d.direccion_fiscal && d.ciudad_fiscal && d.codigo_postal_fiscal && d.pais_fiscal;

      if (!complete && !FACT_V2) {
        // Flujo clásico (producción): modal de datos fiscales para completar y emitir.
        setFiscalOpen(true);
        return;
      }

      const res = await invoicesApi.create({
        projectId, leadId, conversionId,
        borrador: complete ? undefined : true,
        clienteNombre: d.nombre,
        clienteNif: d.identificacion_fiscal || undefined,
        clienteDireccion: d.direccion_fiscal || undefined,
        clienteCiudad: d.ciudad_fiscal || undefined,
        clienteCp: d.codigo_postal_fiscal || undefined,
        clientePais: d.pais_fiscal || 'España',
        clienteEmail: d.email,
        clienteTelefono: d.telefono,
        items,
        metodoPago: metodoDefault as 'transferencia',
        piePago: pieDefault,
      });
      if (res.success && res.data) {
        setExisting(res.data);
        if (res.data.estado === 'borrador') {
          toast({ title: 'Factura en borrador', description: 'Faltan datos fiscales: complétalos para emitirla con número.' });
          setEmitOpen(true);
        } else {
          toast({ title: '✓ Factura emitida', description: res.data.codigo || undefined });
          window.open(invoicesApi.pdfUrl(res.data.id), '_blank');
          onInvoiced?.();
        }
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } finally { setWorking(false); }
  }

  const cls = size === 'md'
    ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-semibold'
    : 'inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] font-semibold border';
  const skin = (isDraft || incompleta)
    ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
    : 'border-border bg-card hover:bg-muted';

  return (
    <>
      <button onClick={onClick} disabled={loading || working} className={`${cls} ${skin} disabled:opacity-50`}
        title={isDraft ? 'Factura en borrador (sin número): rellena los datos y emítela'
          : incompleta ? `Factura ${existing?.codigo || ''} emitida: rellena los datos para descargar/enviar`
          : existing ? `Ver factura ${existing.codigo || ''}` : 'Emitir factura'}>
        {(isDraft || incompleta) ? <Warning size={size === 'md' ? 14 : 12} weight="bold" /> : <Receipt size={size === 'md' ? 14 : 12} weight="bold" />}
        {existing
          ? (isDraft ? 'BORRADOR — emitir' : incompleta ? `Nº ${existing.codigo} — completar` : `Nº ${existing.codigo}`)
          : 'Emitir factura'}
      </button>
      {emitOpen && existing && (
        <Suspense fallback={null}>
          <EmitirBorradorDialog
            invoice={existing}
            onClose={() => setEmitOpen(false)}
            onEmitted={(codigo, id) => {
              setEmitOpen(false);
              toast({ title: '✓ Factura lista', description: codigo });
              window.open(invoicesApi.pdfUrl(id), '_blank');
              refresh();
              onInvoiced?.();
            }}
          />
        </Suspense>
      )}
      {fiscalOpen && (
        <Suspense fallback={null}>
          <FiscalDataDialog
            projectId={projectId}
            leadId={leadId}
            conversionId={conversionId}
            defaultItems={items}
            onClose={() => setFiscalOpen(false)}
            onCreated={(id) => {
              setFiscalOpen(false);
              window.open(invoicesApi.pdfUrl(id), '_blank');
              refresh();
              onInvoiced?.();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
