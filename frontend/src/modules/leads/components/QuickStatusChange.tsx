import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, CheckCircle } from '@phosphor-icons/react';
import StatusBadge, { STATUS_LABELS, STATUS_STYLES, STATUS_KEYS } from '@/shared/components/ui/StatusBadge';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import type { User } from '@/shared/types';

const LeadLossDialog = lazy(() => import('./lead-detail/LeadLossDialog'));

// Colores sólidos para el dot del menú — tienen que ser opacos sobre fondo
// blanco/negro para que el menú nunca se vea transparente como pasaba con
// los badges semitransparentes anteriores.
const STATUS_DOT_COLORS: Record<string, string> = {
  nuevo: 'bg-blue-500',
  por_contactar: 'bg-orange-500',
  contactado: 'bg-emerald-500',
  en_seguimiento: 'bg-amber-500',
  convertido: 'bg-violet-500',
  no_interesado: 'bg-red-500',
};

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
  const { user } = useAuth() as { user: User | null };
  const [open, setOpen] = useState(false);
  // El menu se pinta en un portal con posicion fija: dentro de la tabla quedaba
  // recortado por el contenedor con overflow y no se veia al desplegarlo.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  function abrir() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const alto = 260; // alto aproximado del menu
      const abajo = window.innerHeight - r.bottom;
      setMenuPos({ top: abajo < alto ? Math.max(8, r.top - alto) : r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  }
  const [saving, setSaving] = useState(false);
  const [lossOpen, setLossOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // El menu va en un portal, fuera de `ref`. Sin esta referencia, el clic
  // en una opcion se toma por 'fuera' y cierra el menu antes de aplicarla.
  const menuRef = useRef<HTMLDivElement>(null);

  // Las gestoras tienen el mismo permiso entre ellas: cualquiera puede mover el
  // estado de cualquier lead. Antes solo podia la responsable, y en la practica
  // se quedaban leads parados cuando quien atendia no era la asignada.
  const canEdit = Boolean(user);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
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
          ref={btnRef}
          onClick={abrir}
          disabled={saving}
          title="Cambiar estado"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer transition-all hover:ring-2 hover:ring-primary/40 ${STATUS_STYLES[currentStatus] || 'bg-muted text-muted-foreground'} ${saving ? 'opacity-50' : ''}`}
        >
          {STATUS_LABELS[currentStatus] || currentStatus}
          <CaretDown size={10} weight="bold" className="opacity-70" />
        </button>

        {open && menuPos && createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            className="z-[100] min-w-[200px] rounded-md shadow-2xl py-1 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
          >
            {STATUS_KEYS.map((s) => {
              const isCurrent = s === currentStatus;
              const dotClass = STATUS_DOT_COLORS[s] || 'bg-zinc-400';
              return (
                <button
                  key={s}
                  type="button"
                  role="menuitem"
                  onClick={() => handleSelect(s)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors ${isCurrent ? 'opacity-50 cursor-default' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'} text-zinc-900 dark:text-zinc-100`}
                  disabled={isCurrent}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${dotClass} flex-shrink-0`} />
                    <span className="font-medium">{STATUS_LABELS[s]}</span>
                  </span>
                  {isCurrent && <CheckCircle size={12} weight="bold" className="text-emerald-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
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
