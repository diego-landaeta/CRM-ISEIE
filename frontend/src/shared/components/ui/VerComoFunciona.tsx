import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import RecorridoGuiado from '@/shared/components/ui/RecorridoGuiado';
import { tienePermiso } from '@/shared/lib/recorridosCobros';
import {
  RECORRIDOS_DE_PRUEBA, claveRecorridoDePrueba, pasosApagada, pasosDePruebaPara, type IdRecorridoDePrueba,
} from '@/shared/lib/recorridosDePrueba';

/**
 * «Ver cómo funciona»: el recorrido guiado para probar una función nueva de staging
 * (CRM#856 · CRM-ISEIE#522). El mismo `RecorridoGuiado` del tablero.
 *
 *  · NUNCA se abre solo: solo al pulsar el botón (lo del 27/10).
 *  · Sin el permiso del recorrido, no hay botón. Los pasos de botones que esa persona
 *    no tiene se quitan antes de empezar.
 *  · `apagada`: la función está apagada en este servidor; el botón sigue y dice
 *    «Esta función está apagada: la enciende Diego».
 *  · El recorrido se pinta en el `body`: el botón suele ir en la cabecera y, dentro
 *    de la barra de arriba, su `backdrop-blur` encierra lo `fixed` (CRM#941).
 *  · Si se abre otra ventana encima con el recorrido puesto, se cierra.
 */

const OTRA_VENTANA = '[role="dialog"]:not([aria-labelledby="recorrido-titulo"]), [role="alertdialog"]';

/** Quién mira. Fuera de la sesión (una prueba que monta solo un trozo) no hay nadie. */
function useQuienMira(): { id?: number | string } | null {
  try {
    return (useAuth() as { user: { id?: number | string } | null }).user;
  } catch {
    return null;
  }
}

export default function VerComoFunciona({ id, apagada = false, alAbrir, compacto = false }: {
  id: IdRecorridoDePrueba;
  /** La función está apagada en este servidor (su interruptor). */
  apagada?: boolean;
  /** Antes de abrir: dejar la pantalla donde empieza el recorrido (una pestaña). */
  alAbrir?: () => void;
  /** Dentro de una tarjeta: el botón, pequeño. */
  compacto?: boolean;
}) {
  const user = useQuienMira();
  const { can } = usePermission();
  const recorrido = RECORRIDOS_DE_PRUEBA[id];
  const permitido = !!user && tienePermiso(recorrido.permiso, can);
  // `can` cambia en cada render; los pasos, solo si cambia lo que se puede.
  const firma = recorrido.pasos.map((p) => (tienePermiso(p.permiso, can) ? '1' : '0')).join('');
  const pasos = useMemo(
    () => (apagada ? pasosApagada(recorrido) : pasosDePruebaPara(recorrido, can)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recorrido, apagada, firma],
  );
  const [abierto, setAbierto] = useState(false);

  // Cambia el recorrido (otra pestaña): el que estaba puesto se cierra.
  useEffect(() => { setAbierto(false); }, [id, apagada]);

  // Con el recorrido puesto, si se abre otra ventana encima, se cierra.
  useEffect(() => {
    if (!abierto) return undefined;
    const t = setInterval(() => { if (document.querySelector(OTRA_VENTANA)) setAbierto(false); }, 400);
    return () => clearInterval(t);
  }, [abierto]);

  if (!permitido || pasos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => { alAbrir?.(); setAbierto(true); }}
        title={apagada ? `${recorrido.titulo}: apagada en este servidor` : `Un recorrido paso a paso para probar: ${recorrido.titulo.toLowerCase()}`}
        aria-label={`Ver cómo funciona: ${recorrido.titulo}`}
        data-ver-como-funciona={id}
        className={compacto
          ? 'inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted'
          : 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted'}
      >
        <Compass size={compacto ? 13 : 14} weight="bold" aria-hidden="true" /> Ver cómo funciona
      </button>
      {abierto && createPortal(
        <RecorridoGuiado
          key={`${id}-${apagada ? 'apagada' : 'encendida'}`}
          pasos={pasos}
          clave={claveRecorridoDePrueba(id, user?.id)}
          alCerrar={() => setAbierto(false)}
        />,
        document.body,
      )}
    </>
  );
}
