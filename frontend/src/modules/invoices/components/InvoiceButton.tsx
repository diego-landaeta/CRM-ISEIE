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
  /** Importe ya pagado de la conversión. Si 0 → no se emite factura fiscal, solo PROFORMA. */
  importePagado?: number;
}

// Botón de factura de una conversión:
// - Emitida completa → muestra el Nº y abre el PDF.
// - Emitida con datos incompletos (auto-emitida al pagar) → "Nº X — completar":
//   abre la alerta para rellenar los datos (desbloquea descargar/enviar).
// - BORRADOR → "BORRADOR — emitir" (alerta Validar y emitir).
// - Sin factura → "Emitir factura": completa→emite directo; incompleta→
//   V2: crea borrador + alerta · clásico: abre el modal de datos fiscales.
export default function InvoiceButton({ projectId, leadId, conversionId, items, size = 'sm', onInvoiced, importePagado }: Props) {
  // Sin ningún pago no puede emitirse una factura fiscal: se emite PROFORMA
  // (con su correlativo). Cuando entre un pago, ese pago genera su factura.
  const sinPago = (Number(importePagado) || 0) <= 0;
  const [existing, setExisting] = useState<Invoice | null>(null);
  const [emitOpen, setEmitOpen] = useState(false);
  const [fiscalOpen, setFiscalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [choiceOpen, setChoiceOpen] = useState(false);

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

  // Al pulsar: si ya hay documento, abrir/emitir; si no, preguntar qué emitir
  // (proforma o factura) — así el usuario confirma la proforma y también puede
  // emitir proforma aunque haya pago inicial.
  function onClick() {
    if (existing) {
      if (isDraft || incompleta) { setEmitOpen(true); return; }
      invoicesApi.openPdf(existing.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
      return;
    }
    setChoiceOpen(true);
  }

  async function doEmit(asProforma: boolean) {
    setChoiceOpen(false);
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

      // PROFORMA (sin pago, o elegida con pago): reserva su correlativo y se
      // convierte en factura al registrar el pago. No exige datos fiscales completos.
      if (asProforma) {
        const res = await invoicesApi.create({
          projectId, leadId, conversionId, tipo: 'proforma',
          clienteNombre: d.nombre,
          clienteNif: d.identificacion_fiscal || undefined,
          clienteDireccion: d.direccion_fiscal || undefined,
          clienteCiudad: d.ciudad_fiscal || undefined,
          clienteCp: d.codigo_postal_fiscal || undefined,
          clientePais: d.pais_fiscal || 'España',
          clienteEmail: d.email, clienteTelefono: d.telefono,
          items, metodoPago: metodoDefault as 'transferencia', piePago: pieDefault,
        });
        if (res.success && res.data) {
          setExisting(res.data);
          toast({ title: '✓ Proforma emitida', description: `Se emitió la proforma ${res.data.codigo || ''}. Al registrar el pago se convertirá en factura.` });
          invoicesApi.openPdf(res.data.id).catch(() => {});
          onInvoiced?.();
        } else {
          toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
        }
        return;
      }

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
          invoicesApi.openPdf(res.data.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
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
          : existing ? `Ver ${existing.tipo === 'proforma' ? 'proforma' : 'factura'} ${existing.codigo || ''}`
          : sinPago ? 'Sin pago aún: se emitirá una PROFORMA (no factura). Al registrar el pago se generará la factura.'
          : 'Emitir factura'}>
        {(isDraft || incompleta) ? <Warning size={size === 'md' ? 14 : 12} weight="bold" /> : <Receipt size={size === 'md' ? 14 : 12} weight="bold" />}
        {existing
          ? (isDraft ? 'BORRADOR — emitir' : incompleta ? `Nº ${existing.codigo} — completar` : `Nº ${existing.codigo}`)
          : sinPago ? 'Emitir proforma' : 'Emitir factura'}
      </button>

      {/* Confirmación: proforma (sin pago) o elegir documento (con pago). */}
      {choiceOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" onClick={() => setChoiceOpen(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="dialog" className="relative bg-card rounded-xl border border-border w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            {sinPago ? (
              <>
                <h3 className="font-semibold text-base mb-1">¿Emitir una proforma?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Esta venta <b>no tiene ningún pago</b>. Se emitirá una <b>PROFORMA</b> (documento sin validez fiscal) que reserva el número y se <b>convertirá en factura</b> automáticamente cuando registres el pago.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setChoiceOpen(false)} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">No</button>
                  <button onClick={() => doEmit(true)} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">Sí, emitir proforma</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-base mb-1">¿Qué documento emitir?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Puedes emitir la <b>factura</b> directamente, o una <b>proforma</b> (p. ej. del pago inicial) que luego se convierte en factura.
                </p>
                <div className="flex justify-end gap-2 flex-wrap">
                  <button onClick={() => setChoiceOpen(false)} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">Cancelar</button>
                  <button onClick={() => doEmit(true)} className="h-9 px-4 rounded-md border border-primary text-primary text-sm font-semibold hover:bg-primary/10">Proforma</button>
                  <button onClick={() => doEmit(false)} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">Factura</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {emitOpen && existing && (
        <Suspense fallback={null}>
          <EmitirBorradorDialog
            invoice={existing}
            onClose={() => setEmitOpen(false)}
            onEmitted={(codigo, id) => {
              setEmitOpen(false);
              toast({ title: '✓ Factura lista', description: codigo });
              invoicesApi.openPdf(id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
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
              invoicesApi.openPdf(id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
              refresh();
              onInvoiced?.();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
