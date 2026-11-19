import { useEffect, useMemo, useState } from 'react';
import { Compass } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import RecorridoGuiado, { recorridoPendiente } from '@/shared/components/ui/RecorridoGuiado';
import {
  RECORRIDOS_COBROS, claveRecorrido, pasosPara, tienePermiso, type IdRecorridoCobros,
} from '@/shared/lib/recorridosCobros';

/**
 * «Ver recorrido» y el recorrido guiado de una pantalla de Stripe y cobros (Diego,
 * 18/11). Lo mismo que el tablero de Tareas, con el `RecorridoGuiado` de siempre:
 *
 *  · La PRIMERA vez que esa persona entra (`listo`: la pantalla ya cargó), se abre
 *    solo. Se marca como visto al abrirse, por persona: no vuelve a salir solo.
 *  · El botón «Ver recorrido» lo repite cuando se quiera.
 *  · Sin el permiso del recorrido, ni botón ni recorrido. Los pasos de botones que
 *    esa persona no tiene se quitan antes de empezar.
 *  · Nunca encima de otra ventana (lo del 27/10 en el tablero: tapaba «Crear tarea»).
 *    Si hay una abierta, espera; si se abre una con el recorrido puesto, se cierra.
 *    Y si ya hay otro recorrido en pantalla, espera a que acabe.
 */

/** Otra ventana encima (una ficha, un diálogo) que no sea el propio recorrido. */
const OTRA_VENTANA = '[role="dialog"]:not([aria-labelledby="recorrido-titulo"]), [role="alertdialog"]';
const UN_RECORRIDO = '[aria-labelledby="recorrido-titulo"]';
const hayOtraVentana = () => typeof document !== 'undefined' && !!document.querySelector(OTRA_VENTANA);
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
const hayUnRecorrido = () => typeof document !== 'undefined' && !!document.querySelector(UN_RECORRIDO);
/** El recorrido que tiene la pantalla ahora (dos a la vez, nunca). */
let enPantalla: IdRecorridoCobros | null = null;

export default function VerRecorrido({ id, listo = true, compacto = false }: {
  id: IdRecorridoCobros;
  /** La pantalla ya tiene lo que se va a señalar (ha terminado de cargar). */
  listo?: boolean;
  /** Dentro de una tarjeta: el botón, pequeño. */
  compacto?: boolean;
}) {
  const user = useQuienMira();
  const { can } = usePermission();
  const recorrido = RECORRIDOS_COBROS[id];
  const permitido = !!user && tienePermiso(recorrido.permiso, can);
  const clave = claveRecorrido(id, user?.id);
  // `can` cambia en cada render; los pasos, solo si cambia lo que se puede.
  const firma = recorrido.pasos.map((p) => (tienePermiso(p.permiso, can) ? '1' : '0')).join('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pasos = useMemo(() => pasosPara(recorrido, can), [recorrido, firma]);
  const [abierto, setAbierto] = useState(false);

  // La primera vez, solo, cuando la pantalla está lista y no hay nada encima.
  useEffect(() => {
    if (!permitido || !listo || abierto || !recorridoPendiente(clave)) return undefined;
    const t = setInterval(() => {
      if (hayOtraVentana() || hayUnRecorrido() || (enPantalla && enPantalla !== id) || !recorridoPendiente(clave)) return;
      clearInterval(t);
      enPantalla = id;
      setAbierto(true);
    }, 800);
    return () => clearInterval(t);
  }, [permitido, listo, abierto, clave, id]);

  // Al cerrarse (o al salir de la pantalla), deja sitio al siguiente.
  useEffect(() => {
    if (!abierto) return undefined;
    enPantalla = id;
    return () => { if (enPantalla === id) enPantalla = null; };
  }, [abierto, id]);

  // Con el recorrido puesto, si se abre otra ventana encima, se cierra.
  useEffect(() => {
    if (!abierto) return undefined;
    const t = setInterval(() => { if (hayOtraVentana()) setAbierto(false); }, 400);
    return () => clearInterval(t);
  }, [abierto]);

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
      {abierto && (
        <RecorridoGuiado pasos={pasos} clave={clave} alCerrar={() => setAbierto(false)} />
      )}
    </>
  );
}
