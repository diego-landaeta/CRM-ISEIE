import { useEffect, useState } from 'react';
import usePermission from '@/shared/hooks/usePermission';
import { facturaAutomaticaApi } from '../api/facturaAutomatica.api';

/*
  ¿Está encendida la factura automática en este servidor? (#764)

  Se pregunta una vez por carga de la página y se comparte: el alta de la
  venta, la ficha de la venta y la cola lo miran a la vez. Sin permiso para
  verlo, o si no contesta, apagada: entonces no se enseña «Enviar factura
  automáticamente», que no haría nada.
*/
let pendiente: Promise<boolean> | null = null;

export function preguntarSiEstaActiva(): Promise<boolean> {
  if (!pendiente) {
    pendiente = facturaAutomaticaApi.interruptor()
      .then((r) => !!r?.data?.activa)
      .catch(() => { pendiente = null; return false; });
  }
  return pendiente;
}

/** null mientras no se sabe; luego true/false. */
export function useFacturaAutomaticaActiva(): boolean | null {
  const { can } = usePermission();
  const puedeVer = can('facturas.view');
  const [activa, setActiva] = useState<boolean | null>(puedeVer ? null : false);
  useEffect(() => {
    if (!puedeVer) { setActiva(false); return undefined; }
    let vivo = true;
    preguntarSiEstaActiva().then((a) => { if (vivo) setActiva(a); });
    return () => { vivo = false; };
  }, [puedeVer]);
  return activa;
}
