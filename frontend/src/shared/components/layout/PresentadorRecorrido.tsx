import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import RecorridoGuiado from '@/shared/components/ui/RecorridoGuiado';
import { cerrarRecorrido, useRecorridoActivo } from '@/shared/lib/lanzadorRecorridos';

/**
 * Pinta el recorrido que se ha pedido con el botón «Recorrido» de la cabecera
 * (CRM#1012). Va montado una vez en `AppLayout`.
 *
 *  · En el `body`: dentro de la cabecera, su `backdrop-blur` encierra lo `fixed`
 *    y el recuadro salía corrido (lo de Ventas a 1280 px, #941).
 *  · Nunca encima de otra ventana (lo del 27/10): si se abre una con el
 *    recorrido puesto, se cierra. Salvo la ventana que el recorrido explica
 *    (`dentroDe`: el asistente de crear link, el plan de pago).
 *  · Al cambiar de pantalla, se cierra: era el recorrido de la otra.
 */
const OTRA_VENTANA = '[role="dialog"]:not([aria-labelledby="recorrido-titulo"]), [role="alertdialog"]';

export default function PresentadorRecorrido() {
  const { recorrido, vez } = useRecorridoActivo();
  const { pathname } = useLocation();

  useEffect(() => { cerrarRecorrido(); }, [pathname]);

  useEffect(() => {
    if (!recorrido) return undefined;
    const t = setInterval(() => {
      const otras = Array.from(document.querySelectorAll(OTRA_VENTANA));
      const ajena = otras.some((el) => !(recorrido.dentroDe && el.matches(recorrido.dentroDe)));
      if (ajena) cerrarRecorrido();
    }, 400);
    return () => clearInterval(t);
  }, [recorrido]);

  if (!recorrido || typeof document === 'undefined') return null;
  return createPortal(
    <RecorridoGuiado key={vez} pasos={recorrido.pasos} clave={recorrido.clave} alCerrar={cerrarRecorrido} />,
    document.body,
  );
}
