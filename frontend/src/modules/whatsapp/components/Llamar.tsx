import { useEffect, useState } from 'react';
import { Phone, Copy, Check, X, DeviceMobile } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';

/**
 * Llamar a un numero, sin que el boton se quede en nada.
 *
 * Antes esto era una linea:
 *
 *   window.location.href = `tel:+34...`;
 *
 * Y en el ordenador **no hace absolutamente nada**. Si el sistema no tiene una
 * aplicacion asociada al protocolo `tel:` —y un Windows normal no la tiene— el
 * navegador lo ignora en silencio: ni abre nada, ni avisa, ni falla. Diego
 * pulsaba y no pasaba nada (tarea #67). En un movil si funciona, y por eso se
 * escapo: se probo donde funcionaba.
 *
 * Aqui no se adivina el dispositivo —eso se hace mal siempre— sino que se
 * enseña el numero y se dan las dos salidas: marcar, que en un movil abre el
 * telefono, y copiar, que sirve en cualquier sitio. Peor que las dos es que no
 * pase nada.
 *
 * NO se manda a WhatsApp Web aunque ahi si haya boton de llamar. Sacar a la
 * gestora del CRM es lo contrario de para lo que existe este modulo: alli no
 * queda registro de la llamada, ni hay plantillas, ni historial del prospecto.
 * Se monto y se quito por eso.
 */
export default function Llamar({
  telefono,
  nombre,
  apuntada,
  onCerrar,
}: {
  telefono: string;
  nombre?: string | null;
  /** Si el intento quedo registrado. Se dice: es la mitad del sentido de esto. */
  apuntada: boolean;
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  // El aviso de copiado se quita solo; no hace falta que nadie lo cierre.
  useEffect(() => {
    if (!copiado) return undefined;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  const limpio = `+${String(telefono).replace(/[^0-9]/g, '')}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(limpio);
      setCopiado(true);
    } catch {
      // Sin permiso de portapapeles no se puede hacer mucho, pero el numero
      // esta a la vista y se puede seleccionar a mano.
      setCopiado(false);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/50"
        onClick={onCerrar}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wa-llamar-titulo"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-lg border border-border bg-background shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
            <h2 id="wa-llamar-titulo" className="font-semibold text-foreground">
              Llamar {nombre ? `a ${nombre}` : ''}
            </h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar"
              className="shrink-0 text-muted-foreground hover:text-foreground rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X size={18} />
            </button>
          </div>

          <div className="p-4 space-y-3">
            <p className="text-center text-xl font-semibold text-foreground tabular-nums select-all">
              {limpio}
            </p>

            <p className="text-sm text-muted-foreground text-center leading-relaxed">
              La llamada se hace <strong className="text-foreground">desde tu móvil</strong>.
              WhatsApp no deja hablar desde el ordenador.
            </p>

            <div className="flex flex-col gap-2 pt-1">
              {/* Un enlace de verdad, no un `window.location`: asi el navegador
                  decide, y en un movil abre el telefono. En el ordenador puede
                  no hacer nada — para eso esta el boton de copiar debajo. */}
              <a
                href={`tel:${limpio}`}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium
                           hover:bg-primary/90 inline-flex items-center justify-center gap-2 whitespace-nowrap
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <DeviceMobile size={15} weight="bold" aria-hidden="true" />
                Marcar en el móvil
              </a>
              <button
                type="button"
                onClick={copiar}
                className="h-9 px-4 rounded-md border border-border text-sm font-medium text-foreground
                           hover:bg-muted inline-flex items-center justify-center gap-2 whitespace-nowrap
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copiado
                  ? <><Check size={15} weight="bold" aria-hidden="true" /> Copiado</>
                  : <><Copy size={15} aria-hidden="true" /> Copiar el número</>}
              </button>
            </div>

            {/* Si el intento no quedo apuntado hay que DECIRLO: registrar la
                llamada es la mitad del sentido de este boton, y callarlo deja
                un hueco en el historial del prospecto sin que nadie lo sepa. */}
            <p className={`text-xs text-center flex items-center justify-center gap-1.5 ${
              apuntada ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'
            }`}>
              <Phone size={12} weight="fill" aria-hidden="true" />
              {apuntada
                ? 'El intento queda apuntado en el historial.'
                : 'No se pudo apuntar en el historial — llama igual.'}
            </p>
          </div>
        </div>
      </div>
    </Portal>
  );
}
