import { useEffect, useState } from 'react';
import { ArrowsClockwise, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import client from '@/shared/api/client';
import { formatDateTime } from '@/shared/lib/format';

/**
 * Cómo va el cron de Stripe de este proyecto.
 *
 * Sin webhook, este cron es la ÚNICA vía por la que entra el dinero: cada cinco
 * minutos el CRM le pregunta a Stripe por los cobros nuevos. Si se para, no hay
 * segunda vía que lo cubra.
 *
 * Y se puede parar sin ruido. El caso concreto que viene: estos access tokens
 * caducan —el de Tarot IA, el 11 de enero—, y el día que venza Stripe empieza a
 * contestar 401. Hasta ahora eso solo salía en el log del servidor; ahora queda
 * apuntado en `stripe_sync_state.last_error` y se lee aquí, en la misma
 * pantalla donde se puso la clave.
 *
 * Se enseña la fecha de la última vuelta BUENA, no la del último intento: la
 * pregunta que importa es «¿hasta cuándo sé que tengo los cobros?».
 */

interface Sync {
  last_sync_at: string | null;
  total_imported: number;
  last_error: string | null;
}

/** Cuánto hace, en palabras, sin pedir una librería para esto. */
function hace(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 2) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export default function EstadoDeLaSincronizacion({ projectId }: { projectId: number }) {
  const [sync, setSync] = useState<Sync | null>(null);
  const [mirado, setMirado] = useState(false);

  useEffect(() => {
    let vivo = true;
    setMirado(false);
    client.get<{ sync: Sync | null }>(`/stripe-payments/stats?projectId=${projectId}`)
      .then((r) => { if (vivo) setSync(r?.data?.sync || null); })
      .catch(() => { if (vivo) setSync(null); })
      .finally(() => { if (vivo) setMirado(true); });
    return () => { vivo = false; };
  }, [projectId]);

  // Nunca ha sincronizado: no hay nada que contar todavía, y una caja diciendo
  // «sin datos» en un proyecto recién conectado solo alarma.
  if (!mirado || !sync || (!sync.last_sync_at && !sync.last_error)) return null;

  const fallando = !!sync.last_error;
  const desde = hace(sync.last_sync_at);

  return (
    <div className={`rounded-md border p-3 text-xs ${fallando
      ? 'border-destructive/30 bg-destructive-soft'
      : 'border-border bg-muted/30'}`}
    >
      <p className="font-semibold flex items-center gap-1.5">
        {fallando
          ? <WarningCircle size={13} weight="bold" className="text-destructive" />
          : <CheckCircle size={13} weight="bold" className="text-success" />}
        Sincronización
      </p>

      {fallando ? (
        <>
          <p className="mt-1 text-destructive-soft-foreground">
            <strong>El último intento falló.</strong> Sin webhook, este cron es la única vía por la
            que entran los cobros: mientras falle, no entra ninguno.
          </p>
          <p className="mt-1 font-mono text-[11px] text-destructive break-all">
            {sync.last_error}
          </p>
          <p className="mt-1 text-muted-foreground">
            Última vez que salió bien: {sync.last_sync_at
              ? <>{formatDateTime(sync.last_sync_at)} ({desde})</>
              : <strong>nunca</strong>}.
            {' '}Si el mensaje habla de la clave, lo normal es que haya caducado: saca otra y pégala arriba.
          </p>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Última vuelta correcta {desde} ({formatDateTime(sync.last_sync_at)}).
          {' '}{sync.total_imported} cobros traídos en total.
          {' '}<Link to="/accounting/pagos-stripe" className="text-primary hover:underline">Ver los cobros</Link>
        </p>
      )}
    </div>
  );
}
