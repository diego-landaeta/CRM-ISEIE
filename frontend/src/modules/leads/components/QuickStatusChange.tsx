import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { CaretDown, CheckCircle } from '@phosphor-icons/react';
import StatusBadge, { STATUS_LABELS, STATUS_STYLES, STATUS_KEYS } from '@/shared/components/ui/StatusBadge';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';

const LeadLossDialog = lazy(() => import('./lead-detail/LeadLossDialog'));

// Cambio rápido de estado de un lead desde la lista o pipeline, sin abrir la ficha.
// - Click en el badge → popover con los estados disponibles
// - Seleccionar uno → PATCH /leads/:id/status. Toast + onChanged() para refrescar
// - 'no_interesado' → abre LeadLossDialog (motivo obligatorio, se guarda como interacción)
// - 'convertido' → no se cambia desde aquí (requiere registrar la conversión en la ficha)
// - Click bloqueado para gestor que no es responsable (excepto admin/superadmin)

interface Props {
  leadId: number;
  currentStatus: string;
  responsableId?: number | null;
  onChanged?: (newStatus: string) => void;
}

export default function QuickStatusChange({ leadId, currentStatus, responsableId, onChanged }: Props) {
  const { user } = useAuth() as { user: { userId: number; role: string } | null };
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const isOwner = responsableId === user?.userId;
  const canEdit = isAdmin || isOwner;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function applyStatus(newStatus: string, motivo?: string) {
    if (newStatus === currentStatus) { setOpen(false); return; }
    setSaving(true);
    try {
      await client.patch(`/leads/${leadId}/status`, { status: newStatus, motivo: motivo || undefined });
      toast({ title: 'Estado actualizado', description: STATUS_LABELS[newStatus] || newStatus });
      onChanged?.(newStatus);
    } catch (err: any) {
      toast({ title: 'No se pudo cambiar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
      setOpen(false);
      setLossOpen(false);
    }
  }

  function handleSelect(s: string) {
    if (s === currentStatus) { setOpen(false); return; }
    if (s === 'no_interesado') { setOpen(false); setLossOpen(true); return; }
    if (s === 'convertido') {
      toast({
        title: 'Registra la compra desde la ficha',
        description: 'Para marcar como convertido entra al lead y registra la conversión con importe.',
      });
      setOpen(false);
      return;
    }
    applyStatus(s);
  }

  // Si no puede editar, solo mostrar badge sin interacción.
  if (!canEdit) {
    return <StatusBadge status={currentStatus} />;
  }

  return (
    <>
      <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={saving}
          title="Cambiar estado"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-all hover:ring-2 hover:ring-primary/40 ${STATUS_STYLES[currentStatus] || 'bg-muted text-muted-foreground'} ${saving ? 'opacity-50' : ''}`}
        >
          {STATUS_LABELS[currentStatus] || currentStatus}
          <CaretDown size={10} weight="bold" className="opacity-70" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute z-[60] left-0 top-full mt-1 min-w-[180px] bg-popover border border-border rounded-md shadow-xl py-1"
          >
            {STATUS_KEYS.map((s) => {
              const isCurrent = s === currentStatus;
              return (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(s)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 hover:bg-muted ${isCurrent ? 'opacity-50 cursor-default' : ''}`}
                  disabled={isCurrent}
                >
                  <span className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded ${STATUS_STYLES[s]}`}>
                    {STATUS_LABELS[s]}
                  </span>
                  {isCurrent && <CheckCircle size={12} weight="bold" className="text-emerald-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <LeadLossDialog
          open={lossOpen}
          onClose={() => setLossOpen(false)}
          onConfirm={(motivo) => applyStatus('no_interesado', motivo)}
          loading={saving}
        />
      </Suspense>
    </>
  );
}
