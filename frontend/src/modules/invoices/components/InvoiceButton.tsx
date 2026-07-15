import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { Receipt, Warning } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice, InvoiceItem } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const EmitirBorradorDialog = lazy(() => import('./EmitirBorradorDialog'));

interface Props {
  projectId: number;
  leadId: number;
  conversionId: number;
  items: InvoiceItem[];
  size?: 'sm' | 'md';
  onInvoiced?: () => void;
}

// Botón de factura de una conversión:
// - Sin factura → "Emitir factura": si el cliente tiene los datos fiscales completos
//   emite directo (con número); si faltan, crea un BORRADOR y abre la alerta
//   "debes rellenar estos datos" (Validar y emitir).
// - Con BORRADOR → muestra "BORRADOR" y al clicar abre la alerta para completar y emitir.
// - Emitida → muestra el Nº de factura y abre el PDF.
export default function InvoiceButton({ projectId, leadId, conversionId, items, size = 'sm', onInvoiced }: Props) {
  const [existing, setExisting] = useState<Invoice | null>(null);
  const [emitOpen, setEmitOpen] = useState(false);
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

  async function onClick() {
    if (existing) {
      if (existing.estado === 'borrador') { setEmitOpen(true); return; }
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

      const res = await invoicesApi.create({
        projectId, leadId, conversionId,
        // Datos completos → factura emitida directa. Incompletos → BORRADOR
        // (sin número fiscal) que se completa con "Validar y emitir".
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
  const isDraft = existing?.estado === 'borrador';
  const skin = isDraft
    ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300'
    : 'border-border bg-card hover:bg-muted';

  return (
    <>
      <button onClick={onClick} disabled={loading || working} className={`${cls} ${skin} disabled:opacity-50`}
        title={isDraft ? 'Factura en borrador (sin número): rellena los datos y emítela' : existing ? `Ver factura ${existing.codigo || ''}` : 'Emitir factura'}>
        {isDraft ? <Warning size={size === 'md' ? 14 : 12} weight="bold" /> : <Receipt size={size === 'md' ? 14 : 12} weight="bold" />}
        {existing
          ? (isDraft ? 'BORRADOR — emitir' : `Nº ${existing.codigo}`)
          : 'Emitir factura'}
      </button>
      {emitOpen && existing && existing.estado === 'borrador' && (
        <Suspense fallback={null}>
          <EmitirBorradorDialog
            invoice={existing}
            onClose={() => setEmitOpen(false)}
            onEmitted={(codigo, id) => {
              setEmitOpen(false);
              toast({ title: '✓ Factura emitida', description: codigo });
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
