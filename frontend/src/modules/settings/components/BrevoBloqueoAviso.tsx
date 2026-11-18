import { useState } from 'react';
import { EnvelopeSimple } from '@phosphor-icons/react';
import { textoDelBloqueo, type BrevoBloqueo } from '@/shared/lib/brevoBloqueo';

interface Props {
  bloqueo: BrevoBloqueo;
  /** Solo con el permiso «Desbloquear correos en Brevo»; sin él, no hay botón. */
  onDesbloquear?: () => Promise<void>;
}

/**
 * La marca de la ficha: Brevo no le entrega NINGÚN correo del CRM. Caso real
 * (17/11/2026): una gestora tres semanas sin avisos y nadie lo sabía.
 */
export default function BrevoBloqueoAviso({ bloqueo, onDesbloquear }: Props) {
  const [enviando, setEnviando] = useState(false);
  async function desbloquear() {
    if (!onDesbloquear) return;
    setEnviando(true);
    try { await onDesbloquear(); } finally { setEnviando(false); }
  }
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft p-3 text-xs">
      <div className="flex items-start gap-2">
        <EnvelopeSimple size={16} weight="duotone" className="text-destructive-soft-foreground flex-shrink-0 mt-px" />
        <div className="min-w-0 space-y-1.5 text-destructive-soft-foreground">
          <p className="font-semibold">{textoDelBloqueo(bloqueo)}.</p>
          <p>No le llega ningún correo del CRM: ni los prospectos asignados ni los resúmenes.</p>
          {onDesbloquear && (
            <>
              <p className="text-destructive-soft-foreground/80">
                Antes de desbloquear, comprueba que el buzón existe y recibe correo: si sigue sin existir,
                Brevo lo volverá a bloquear con el siguiente envío.
              </p>
              <button
                type="button"
                onClick={desbloquear}
                disabled={enviando}
                className="inline-flex items-center h-8 px-3 rounded-md border border-destructive/30 font-semibold hover:bg-destructive/10 transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-destructive/40"
              >
                {enviando ? 'Desbloqueando…' : 'Desbloquear en Brevo'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
