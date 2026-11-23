import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import RecorridoGuiado from '@/shared/components/ui/RecorridoGuiado';
import {
  RECORRIDOS_COBROS, claveRecorrido, pasosPara, tienePermiso, type IdRecorridoCobros,
} from '@/shared/lib/recorridosCobros';

/**
 * «Ver recorrido» y el recorrido guiado de una pantalla (Diego, 18/11). Lo mismo
 * que el tablero de Tareas, con el `RecorridoGuiado` de siempre:
 *
 *  · NUNCA SE ABRE SOLO (CRM#1012, Diego 23/11: «QUE SOLO SE ACTIVE AL TOCAR EL
 *    BOTÓN»). Antes salía solo la primera vez que esa persona entraba; ya no.
 *    Se abre con este botón o con «Recorrido» en la cabecera, que ofrece el
 *    mismo recorrido (por su ruta, `rutas`) y el general según el rol.
 *  · Sin el permiso del recorrido, ni botón ni recorrido. Los pasos de botones que
 *    esa persona no tiene se quitan antes de empezar.
 *  · Nunca encima de otra ventana (lo del 27/10 en el tablero: tapaba «Crear tarea»).
 *    Si se abre una con el recorrido puesto, se cierra.
 */

/** Otra ventana encima (una ficha, un diálogo) que no sea el propio recorrido. */
const OTRA_VENTANA = '[role="dialog"]:not([aria-labelledby="recorrido-titulo"]), [role="alertdialog"]';
/** ¿Hay otra ventana encima? `dentroDe`: la que el recorrido explica no cuenta. */
const hayOtraVentana = (dentroDe?: string) => typeof document !== 'undefined'
  && Array.from(document.querySelectorAll(OTRA_VENTANA)).some((el) => !(dentroDe && el.matches(dentroDe)));
/**
 * Quién mira. Fuera de la sesión (una prueba que monta solo una tarjeta) no hay
 * nadie: el botón no sale y la tarjeta sigue funcionando.
 */
function useQuienMira(): { id?: number | string } | null {
  try {
    return (useAuth() as { user: { id?: number | string } | null }).user;
  } catch {
    return null;
  }
}
/** Lo que puede hacer. Fuera de la sesión, nada (#611: «Mi factura» y «Mi campus»
 *  no usaban permisos y sus pruebas las montan sin sesión). */
function usePuede(): (p: string) => boolean {
  try {
    return usePermission().can;
  } catch {
    return () => false;
  }
}

export default function VerRecorrido({ id, compacto = false, dentroDe }: {
  id: IdRecorridoCobros;
  /**
   * El recorrido explica una ventana (el asistente de crear link, el plan de
   * pago) y el botón va dentro de ella: esa ventana no lo cierra.
   */
  dentroDe?: string;
  /**
   * La pantalla ya tiene lo que se va a señalar. Solo decidía cuándo abrirlo
   * solo; desde la #1012 no se usa (se acepta para no tocar cada pantalla).
   */
  listo?: boolean;
  /** Dentro de una tarjeta: el botón, pequeño. */
  compacto?: boolean;
}) {
  const user = useQuienMira();
  const can = usePuede();
  const recorrido = RECORRIDOS_COBROS[id];
  const permitido = !!user && tienePermiso(recorrido.permiso, can);
  const clave = claveRecorrido(id, user?.id);
  // `can` cambia en cada render; los pasos, solo si cambia lo que se puede.
  const firma = recorrido.pasos.map((p) => (tienePermiso(p.permiso, can) ? '1' : '0')).join('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pasos = useMemo(() => pasosPara(recorrido, can), [recorrido, firma]);
  const [abierto, setAbierto] = useState(false);

  // Con el recorrido puesto, si se abre otra ventana encima, se cierra.
  useEffect(() => {
    if (!abierto) return undefined;
    const t = setInterval(() => { if (hayOtraVentana(dentroDe)) setAbierto(false); }, 400);
    return () => clearInterval(t);
  }, [abierto, dentroDe]);

  if (!permitido || pasos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title={`Un recorrido paso a paso: ${recorrido.titulo.toLowerCase()}`}
        aria-label={`Ver recorrido: ${recorrido.titulo}`}
        data-ver-recorrido={id}
        className={compacto
          ? 'inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted'
          : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted'}
      >
        <Compass size={compacto ? 13 : 14} weight="bold" aria-hidden="true" /> Ver recorrido
      </button>
      {/* En el `body`, no aquí (como en el 360, CRM#941): el botón del menú
          (#611) vive en el cajón del móvil, que se mueve con `transform`, y eso
          encierra lo `fixed`: el recuadro y el cartel quedaban dentro del
          cajón, no sobre la pantalla. */}
      {abierto && createPortal(
        <RecorridoGuiado pasos={pasos} clave={clave} alCerrar={() => setAbierto(false)} />,
        document.body,
      )}
    </>
  );
}
