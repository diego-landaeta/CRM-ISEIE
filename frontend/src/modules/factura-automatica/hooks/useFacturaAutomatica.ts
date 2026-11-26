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
let pendiente: Promise<{ activa: boolean; revision: boolean }> | null = null;

function preguntarInterruptor(): Promise<{ activa: boolean; revision: boolean }> {
  if (!pendiente) {
    pendiente = facturaAutomaticaApi.interruptor()
      .then((r) => ({ activa: !!r?.data?.activa, revision: !!r?.data?.revision }))
      .catch(() => { pendiente = null; return { activa: false, revision: false }; });
  }
  return pendiente;
}

export function preguntarSiEstaActiva(): Promise<boolean> {
  return preguntarInterruptor().then((r) => r.activa);
}

/**
 * «Por enviar» (FACTURA_ENVIO_REVISION_ADMIN, ISEIE 25/11): la factura no sale
 * sola al alumno; administración la verifica y la envía. null mientras no se sabe.
 */
export function useModoPorEnviar(): boolean | null {
  const { can } = usePermission();
  const puedeVer = can('facturas.view');
  const [modo, setModo] = useState<boolean | null>(puedeVer ? null : false);
  useEffect(() => {
    if (!puedeVer) { setModo(false); return undefined; }
    let vivo = true;
    preguntarInterruptor().then((r) => { if (vivo) setModo(r.activa && r.revision); });
    return () => { vivo = false; };
  }, [puedeVer]);
  return modo;
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
