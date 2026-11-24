import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import { RECORRIDOS_COBROS, claveRecorrido, pasosPara, tienePermiso, type RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { abrirRecorrido } from '@/shared/lib/lanzadorRecorridos';

/**
 * «VER RECORRIDO» DESDE NOVEDADES (3.0.0; Diego, 24/11: «actualiza Novedades
 * para ver y que los recorridos estén actualizados»).
 *
 * Cada novedad con recorrido lleva un botón «Ver recorrido» que va a su pantalla
 * con `?recorrido=<id>`. Esta pieza, montada UNA vez en `AppLayout`, lo abre al
 * llegar y quita el parámetro de la dirección (al recargar no vuelve a salir).
 *
 * Sigue siendo «solo al pulsar» (#1012): sin ese clic no hay parámetro, y nada
 * se abre solo. Espera un momento para que la pantalla pinte sus anclajes y los
 * permisos estén cargados. Sin permiso, o con un id que no existe, no abre nada.
 */
export const PARAMETRO_RECORRIDO = 'recorrido';

/** La dirección de «Ver recorrido»: la pantalla con el recorrido pedido. */
export function rutaConRecorrido(ruta: string, id: string): string {
  const [base, hash = ''] = ruta.split('#');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${PARAMETRO_RECORRIDO}=${encodeURIComponent(id)}${hash ? `#${hash}` : ''}`;
}

const ESPERA_MS = 900;

export default function RecorridoDeLaDireccion() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth() as { user: { id?: number | string } | null };
  const { can } = usePermission();
  const canRef = useRef(can);
  canRef.current = can;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    const q = new URLSearchParams(search);
    const id = q.get(PARAMETRO_RECORRIDO);
    if (!id) return undefined;
    const t = setTimeout(() => {
      const r = (RECORRIDOS_COBROS as Record<string, RecorridoCobros | undefined>)[id];
      const puede = (p: string) => canRef.current(p);
      if (r && tienePermiso(r.permiso, puede)) {
        const pasos = pasosPara(r, puede);
        if (pasos.length) abrirRecorrido({ titulo: r.titulo, pasos, clave: claveRecorrido(r.id as Parameters<typeof claveRecorrido>[0], userRef.current?.id) });
      }
      q.delete(PARAMETRO_RECORRIDO);
      const resto = q.toString();
      navigate({ pathname, search: resto ? `?${resto}` : '', hash }, { replace: true });
    }, ESPERA_MS);
    return () => clearTimeout(t);
  }, [pathname, search, hash, navigate]);

  return null;
}
