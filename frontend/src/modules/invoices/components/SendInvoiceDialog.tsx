import { useState } from 'react';
import { PaperPlaneTilt, X } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { Invoice } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

interface Props {
  invoice: Invoice;
  onClose: () => void;
  onSent: () => void;
}

// Modal de confirmacion para enviar factura por email.
// Se muestra al registrar el primer pago si la factura existe y no fue enviada.
export default function SendInvoiceDialog({ invoice, onClose, onSent }: Props) {
  const [email, setEmail] = useState(invoice.cliente_email || '');
  const [sending, setSending] = useState(false);

  async function send() {
    if (!email.trim()) {
      toast({ title: 'Sin email', description: 'El cliente no tiene email guardado. Añade uno arriba.', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const res = await invoicesApi.send(invoice.id, email.trim());
      if (res.success) {
        toast({ title: '✓ Factura enviada', description: `${invoice.codigo} → ${email.trim()}` });
        onSent();
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error || 'No se pudo enviar', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-base">¿Enviar factura por email?</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{invoice.codigo} · {invoice.cliente_nombre}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        <div className="p-4 space-y-3 text-sm">
          <div className="text-xs">
            <label className="text-muted-foreground">Enviar a este email:</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full h-9 px-2 mt-1 rounded border border-border bg-background" />
            {!invoice.cliente_email && (
              <p className="text-amber-600 text-[11px] mt-1">⚠ La factura no tenía email guardado. Verifica antes de enviar.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La factura se adjunta como PDF. El estado pasará a <strong>enviada</strong>.
          </p>
        </div>

        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted">
            No por ahora
          </button>
          <button onClick={send} disabled={sending}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <PaperPlaneTilt size={14} weight="bold" /> {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
