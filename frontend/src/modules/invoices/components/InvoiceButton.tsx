import { lazy, Suspense, useState, useCallback, useEffect } from 'react';
import { Receipt } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { InvoiceItem } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

const FiscalDataDialog = lazy(() => import('./FiscalDataDialog'));

interface Props {
  projectId: number;
  leadId: number;
  conversionId: number;
  items: InvoiceItem[];
  size?: 'sm' | 'md';
}

// Boton "Ver factura" que aparece en la conversion.
// - Si ya existe factura: abre PDF en otra pestaña
// - Si NO existe: chequea datos fiscales del lead.
//   - Si todos los obligatorios estan completos: emite directo y abre PDF
//   - Si faltan: abre modal de datos fiscales
export default function InvoiceButton({ projectId, leadId, conversionId, items, size = 'sm' }: Props) {
  const [existingId, setExistingId] = useState<number | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoicesApi.byConversion(conversionId);
      setExistingId(res.success && res.data ? res.data.id : null);
    } finally { setLoading(false); }
  }, [conversionId]);
  useEffect(() => { refresh(); }, [refresh]);

  async function onClick() {
    if (existingId) {
      window.open(invoicesApi.pdfUrl(existingId), '_blank');
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
      const complete = d.nombre && d.identificacion_fiscal && d.direccion_fiscal && d.ciudad_fiscal && d.codigo_postal_fiscal && d.pais_fiscal;
      if (complete) {
        // Cargar config del proyecto para defaults
        const cfg = await invoicesApi.getConfig(projectId);
        const metodoDefault = (cfg.success && cfg.data?.factura_metodo_default) || 'transferencia';
        const pieDefault = cfg.success ? (cfg.data?.factura_pie_default || undefined) : undefined;
        // Emitir directo
        const res = await invoicesApi.create({
          projectId, leadId, conversionId,
          clienteNombre: d.nombre,
          clienteNif: d.identificacion_fiscal!,
          clienteDireccion: d.direccion_fiscal!,
          clienteCiudad: d.ciudad_fiscal!,
          clienteCp: d.codigo_postal_fiscal!,
          clientePais: d.pais_fiscal!,
          clienteEmail: d.email,
          clienteTelefono: d.telefono,
          items,
          metodoPago: metodoDefault as 'transferencia',
          piePago: pieDefault,
        });
        if (res.success && res.data) {
          toast({ title: '✓ Factura emitida', description: res.data.codigo });
          setExistingId(res.data.id);
          window.open(invoicesApi.pdfUrl(res.data.id), '_blank');
        } else {
          toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
        }
      } else {
        setShowDialog(true);
      }
    } finally { setWorking(false); }
  }

  const cls = size === 'md'
    ? 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted'
    : 'inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] font-semibold border border-border bg-card hover:bg-muted';

  return (
    <>
      <button onClick={onClick} disabled={loading || working} className={`${cls} disabled:opacity-50`}>
        <Receipt size={size === 'md' ? 14 : 12} weight="bold" />
        {existingId ? 'Ver factura' : 'Emitir factura'}
      </button>
      {showDialog && (
        <Suspense fallback={null}>
          <FiscalDataDialog
            projectId={projectId}
            leadId={leadId}
            conversionId={conversionId}
            defaultItems={items}
            onClose={() => setShowDialog(false)}
            onCreated={(id) => {
              setShowDialog(false);
              setExistingId(id);
              window.open(invoicesApi.pdfUrl(id), '_blank');
            }}
          />
        </Suspense>
      )}
    </>
  );
}
