import { Link } from 'react-router-dom';
import { Eye, ArrowSquareOut } from '@phosphor-icons/react';

/**
 * Las dos formas de abrir a una persona, desde la lista (repaso del 15/09).
 *
 * Diego: «Faltan atajos rápidos para ver las acciones: abrir la ficha rápida
 * del lead o la completa».
 *
 * Estaban las dos, pero en fila: pulsabas la fila y salía la ficha rápida, y
 * desde dentro de ella había un «Ver ficha completa». Para lo que más se hace
 * —mirar a alguien sin perder el sitio en la lista— eso es un clic de más y,
 * sobre todo, no se ve: quien no abre el cajón no sabe que la ficha entera
 * existe.
 *
 * LA COMPLETA ES UN ENLACE DE VERDAD, no un botón que navega. Así el botón
 * central del ratón y «abrir en otra pestaña» funcionan, que es como se
 * trabaja cuando hay que atender a cinco: se abren cinco pestañas y se va
 * cerrando. Con un `onClick` que llama a `navigate` eso no se puede.
 *
 * Los dos paran la propagación: la fila entera abre la ficha rápida, y sin
 * frenarlo aquí un clic en «abrir ficha» haría las dos cosas a la vez.
 */

const BOTON = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export default function AtajosDeFicha({
  leadId,
  nombre,
  onFichaRapida,
}: {
  leadId: number;
  /** Para que el nombre del atajo diga de quién es, no «abrir ficha» a secas. */
  nombre?: string | null;
  onFichaRapida: () => void;
}) {
  const dueno = nombre ? ` de ${nombre}` : '';
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        className={BOTON}
        title="Ficha rápida"
        aria-label={`Ficha rápida${dueno}`}
        onClick={(e) => { e.stopPropagation(); onFichaRapida(); }}
      >
        <Eye size={15} weight="regular" />
      </button>
      <Link
        // En ISEIE la ficha completa vive en /leads/:id (en MultiCRM, /prospectos/:id).
        to={`/leads/${leadId}`}
        className={BOTON}
        title="Abrir la ficha completa"
        aria-label={`Abrir la ficha completa${dueno}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ArrowSquareOut size={15} weight="regular" />
      </Link>
    </span>
  );
}
