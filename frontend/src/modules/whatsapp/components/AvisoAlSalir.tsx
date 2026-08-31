import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowSquareOut, WarningCircle } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';

/**
 * «Vas a salir del chat» — y ofrece abrirlo en otra pestaña.
 *
 * Salir de la pantalla del chat no es gratis: al volver hay que traerse otra vez
 * las conversaciones, los mensajes del hilo abierto y las firmas de los
 * adjuntos. Es un viaje completo cada vez, y una gestora entra y sale a menudo.
 * La tarea #64 pide avisar antes, con las dos salidas: seguir aqui, o abrirlo
 * aparte sin perder el chat.
 *
 * Se hace escuchando los clics en fase de CAPTURA porque el CRM monta un
 * `BrowserRouter`, no un router de datos: `useBlocker` no existe ahi. Se mira el
 * enlace mas cercano al sitio pulsado y se decide antes de que React Router
 * llegue a navegar.
 *
 * Lo que NO se intercepta, a proposito:
 *   · moverse DENTRO del chat —cambiar de conversacion, abrir plantillas—, que
 *     es la mayoria de los clics y avisar ahi seria un incordio;
 *   · lo que ya abre pestaña nueva, que no se lleva la que estas mirando;
 *   · descargas, anclas y enlaces externos.
 *
 * Queda fuera la navegacion por codigo (`navigate(...)`), que no pasa por un
 * enlace. Hoy el chat no hace ninguna que se salga de la pantalla.
 */

/** ¿Esta direccion sigue estando dentro del chat de WhatsApp? */
function sigueEnElChat(ruta: string): boolean {
  // Las pantallas hermanas de WhatsApp —conexion, plantillas, ayuda— TAMBIEN
  // sacan del chat y lo recargan al volver, asi que tampoco se dejan pasar sin
  // avisar. Solo se libra la propia pantalla del chat, con los parametros que
  // sean: `?conv=12` es cambiar de conversacion, no salir.
  try {
    const u = new URL(ruta, window.location.origin);
    return u.pathname.replace(/\/+$/, '').endsWith('/whatsapp/chat');
  } catch {
    return false;
  }
}

export default function AvisoAlSalir({ activo }: { activo: boolean }) {
  const navigate = useNavigate();
  const [destino, setDestino] = useState<string | null>(null);

  useEffect(() => {
    if (!activo) return undefined;

    const alPulsar = (e: MouseEvent) => {
      // Los clics con modificador ya los entiende el navegador: ctrl/cmd abre en
      // pestaña nueva y shift en ventana. Interceptarlos seria quitarle a la
      // gestora justo lo que le estamos ofreciendo.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const enlace = (e.target as HTMLElement | null)?.closest?.('a');
      if (!enlace) return;

      const href = enlace.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (enlace.target === '_blank') return;            // ya abre aparte
      if (enlace.hasAttribute('download')) return;        // descarga, no navegacion

      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;  // fuera del CRM
      if (sigueEnElChat(url.pathname)) return;            // no se sale de aqui

      e.preventDefault();
      setDestino(url.pathname + url.search);
    };

    document.addEventListener('click', alPulsar, true);
    return () => document.removeEventListener('click', alPulsar, true);
  }, [activo]);

  useEffect(() => {
    if (!destino) return undefined;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') setDestino(null); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [destino]);

  if (!destino) return null;

  const enOtraPestana = () => {
    window.open(`${window.location.origin}${destino}`, '_blank', 'noopener');
    setDestino(null);
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[65] flex items-center justify-center p-4 bg-black/50"
        onClick={() => setDestino(null)}
        role="presentation"
      >
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="wa-salir-titulo"
          aria-describedby="wa-salir-texto"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-sm rounded-lg border border-border bg-background shadow-xl p-5"
        >
          <div className="flex items-start gap-3">
            <span className="shrink-0 rounded-full p-2 bg-amber-100 dark:bg-amber-950/40
                             text-amber-700 dark:text-amber-400" aria-hidden="true">
              <WarningCircle size={18} weight="fill" />
            </span>
            <div className="min-w-0">
              <h2 id="wa-salir-titulo" className="font-semibold text-foreground">
                Vas a salir del chat
              </h2>
              <p id="wa-salir-texto" className="text-sm text-muted-foreground mt-1 leading-relaxed">
                Al volver hay que cargar otra vez las conversaciones y los mensajes.
                Puedes abrirlo aparte y no perder esto de vista.
              </p>
            </div>
          </div>

          {/* En COLUMNA, y no en fila con `sm:`.
              Tres botones con estas etiquetas no caben en 384 px, y `sm:` mira
              el ancho de la VENTANA, no el del dialogo: en una pantalla ancha
              se ponian en fila igual y partian el texto en dos lineas cada uno.
              Apilados caben siempre y se leen de un vistazo.

              El orden va de lo recomendado a lo caro: abrir aparte es lo que
              resuelve el problema, y salir del chat queda al final y sin peso,
              porque es lo que cuesta los segundos de recarga. */}
          <div className="flex flex-col gap-2 mt-4">
            <button
              type="button"
              autoFocus
              onClick={enOtraPestana}
              className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium
                         hover:bg-primary/90 inline-flex items-center justify-center gap-2 whitespace-nowrap
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
              Abrir en otra pestaña
            </button>
            <button
              type="button"
              onClick={() => setDestino(null)}
              className="h-9 px-4 rounded-md border border-border text-sm font-medium text-foreground
                         hover:bg-muted whitespace-nowrap
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Seguir aquí
            </button>
            <button
              type="button"
              onClick={() => { const d = destino; setDestino(null); navigate(d); }}
              className="h-8 px-4 rounded-md text-sm text-muted-foreground hover:text-foreground
                         whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Salir del chat de todas formas
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
