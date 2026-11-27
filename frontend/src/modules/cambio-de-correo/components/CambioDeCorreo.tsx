import { useEffect, useState } from 'react';
import { At } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { formatDateTime } from '@/shared/lib/format';
import { anularCambioDeCorreo, getCambiosDeCorreo, type CambioDeCorreo as Cambio, type CambiosDeCorreo } from '../api/cambiosDeCorreo.api';

/**
 * «Cambio de correo», en la ficha de una persona (#833, gemela de CRM#1199).
 *
 * Si alguien dice «no me llega el código», aquí se ve si lo pidió, a qué
 * dirección, hasta cuándo vale y cuántos intentos lleva; y debajo, los cambios
 * anteriores (confirmados, anulados o caducados). «Anular» deja la petición
 * pendiente sin efecto: su código ya no abre nada.
 *
 * Solo con `users.cambios_correo` (de serie, superadmin y soporte): quien
 * monta la ficha lo decide, y el servidor lo vuelve a mirar. Nunca llega el
 * código. Y no se dice si la dirección nueva era ya de otra persona: el
 * servidor no lo distingue aquí, a propósito.
 */

const ETIQUETA: Record<Cambio['estado'], { texto: string; clase: string }> = {
  pendiente: { texto: 'Pendiente', clase: 'bg-warning-soft text-warning-soft-foreground' },
  confirmado: { texto: 'Confirmado', clase: 'bg-success-soft text-success-soft-foreground' },
  anulado: { texto: 'Anulado', clase: 'bg-muted text-muted-foreground' },
  caducado: { texto: 'Caducado', clase: 'bg-muted text-muted-foreground' },
};

function Estado({ estado }: { estado: Cambio['estado'] }) {
  const e = ETIQUETA[estado];
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${e.clase}`}>{e.texto}</span>;
}

export default function CambioDeCorreo({ userId }: { userId: number }) {
  const [datos, setDatos] = useState<CambiosDeCorreo | null>(null);
  const [preguntando, setPreguntando] = useState(false);
  const [anulando, setAnulando] = useState(false);

  useEffect(() => {
    let vivo = true;
    getCambiosDeCorreo(userId)
      .then((d) => { if (vivo) setDatos(d); })
      // Sin acceso o sin la tabla: la sección no sale.
      .catch(() => { if (vivo) setDatos(null); });
    return () => { vivo = false; };
  }, [userId]);

  if (!datos) return null;
  const { pendiente, historial, intentos_max: maximo } = datos;

  async function anular() {
    setAnulando(true);
    try {
      setDatos(await anularCambioDeCorreo(userId));
      setPreguntando(false);
      toast({ title: 'Cambio de correo anulado', description: 'Su código ya no vale. Si quiere cambiarlo, tendrá que pedir otro.' });
    } catch (err) {
      toast({ title: 'No se pudo anular', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setAnulando(false);
    }
  }

  const titulo = `cambio-correo-${userId}`;
  return (
    <section className="rounded-lg border border-border p-3" aria-labelledby={titulo} data-testid="cambio-de-correo">
      <h3 id={titulo} className="flex items-center gap-1.5 text-sm font-medium">
        <At size={14} weight="bold" /> Cambio de correo
      </h3>

      {pendiente ? (
        <div className="mt-2 rounded-md border border-warning/30 bg-warning-soft/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Estado estado="pendiente" />
            <span className="min-w-0 break-words text-sm font-medium">{pendiente.a}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-x-4 gap-y-1 text-secundario">
            <div><dt className="text-muted-foreground">Lo pidió</dt><dd>{formatDateTime(pendiente.pedido_at)}</dd></div>
            <div><dt className="text-muted-foreground">Vale hasta</dt><dd>{formatDateTime(pendiente.expira_at)}</dd></div>
            <div><dt className="text-muted-foreground">Intentos</dt><dd>{pendiente.intentos} de {maximo}</dd></div>
          </dl>
          <p className="mt-2 text-secundario text-muted-foreground">
            Hasta que meta el código, sigue entrando con su correo de ahora. Si no le llega, que lo vuelva a pedir
            desde «Mi cuenta»: cada petición anula la anterior.
          </p>
          {preguntando ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center" role="group" aria-label="Confirmar la anulación">
              <span className="text-secundario">¿Anular? Su código dejará de valer.</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={anular}
                  disabled={anulando}
                  className="h-9 rounded-md bg-destructive px-3 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
                >
                  {anulando ? 'Anulando…' : 'Sí, anular'}
                </button>
                <button
                  type="button"
                  onClick={() => setPreguntando(false)}
                  disabled={anulando}
                  className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPreguntando(true)}
                className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              >
                Anular
              </button>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-1 text-secundario text-muted-foreground">No tiene ningún cambio de correo pendiente.</p>
      )}

      {historial.length > 0 && (
        <div className="mt-3">
          <h4 className="text-secundario font-medium text-muted-foreground">Anteriores</h4>
          <ul className="mt-1 divide-y divide-border">
            {historial.map((h) => (
              // Apilado a cualquier ancho: la ficha es estrecha también en escritorio,
              // y dos correos en fila se partían por la mitad.
              <li key={h.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <Estado estado={h.estado} />
                  <span className="text-secundario text-muted-foreground">{formatDateTime(h.cuando)}</span>
                </div>
                <p className="mt-1 min-w-0 break-words text-secundario">
                  {h.de ? <>{h.de} <span aria-hidden="true">→</span><span className="sr-only"> a </span> </> : null}{h.a}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
