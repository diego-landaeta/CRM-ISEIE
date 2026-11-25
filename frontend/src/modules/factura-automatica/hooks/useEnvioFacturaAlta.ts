import { useEffect, useRef, useState } from 'react';
import usePermission from '@/shared/hooks/usePermission';
import { useFacturaAutomaticaActiva } from './useFacturaAutomatica';
import { aEnvioFactura, envioInicial, faltaConfirmar, type EnvioEnEdicion } from '../components/EnvioFacturaCampos';
import type { EnvioFactura } from '../api/facturaAutomatica.api';

/*
  «Enviar factura automáticamente» al registrar una venta o crear un link (#764,
  24/11). Con la factura automática apagada no se enseña ni se manda nada.

  `emailFicha` puede llegar tarde (la ficha se lee después de abrir) o cambiar
  (otro cliente elegido): mientras no se haya confirmado, el correo de la ficha
  manda; uno ya confirmado no se toca.
*/
export function useEnvioFacturaAlta(emailFicha: string | null | undefined, { sinCorreoVale = false } = {}) {
  // Solo administración elige el envío (Diego, 25/11): sin `facturas.envio_auto`
  // no se enseña ni se manda, y la venta sigue el modo del CRM.
  const { can } = usePermission();
  const encendida = useFacturaAutomaticaActiva();
  const activa = encendida === true && !can('facturas.envio_auto') ? false : encendida;
  const [envio, setEnvio] = useState<EnvioEnEdicion>(() => envioInicial(emailFicha));
  const ultimo = useRef(emailFicha);

  useEffect(() => {
    if (ultimo.current === emailFicha) return;
    ultimo.current = emailFicha;
    setEnvio((v) => (v.confirmado ? v : envioInicial(emailFicha, { auto: v.auto })));
  }, [emailFicha]);

  return {
    /** Si se enseña el bloque. */
    visible: activa === true,
    envio,
    setEnvio,
    /** El aviso si falta confirmar el correo, o null. */
    falta(): { title: string; description: string } | null {
      if (activa !== true || !faltaConfirmar(envio, emailFicha, sinCorreoVale)) return null;
      return {
        title: 'Falta confirmar el correo de la factura',
        description: 'En «Enviar a este correo», pulsa «Confirmar» (o «Editar» para cambiarlo).',
      };
    },
    /** Lo que va al servidor; undefined con la factura automática apagada. */
    cuerpo(): EnvioFactura | undefined {
      return activa === true ? aEnvioFactura(envio, emailFicha) : undefined;
    },
  };
}
