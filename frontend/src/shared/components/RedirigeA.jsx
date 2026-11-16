import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Redirección de una dirección antigua a la de ahora, conservando el `:id` y
 * lo que va detrás del `?` (un `<Navigate>` a secas pierde las dos cosas).
 *
 * Para direcciones que ya no se escriben en el código pero pueden seguir
 * guardadas en algún sitio: atajos de proyecto en la base, avisos ya creados,
 * correos enviados, marcadores (CRM#633, ISEIE#360). `a` admite `:id`.
 *
 * La prueba `enlacesSinRutasRotas` sigue estas redirecciones igual que las de
 * `<Navigate>`.
 */
export default function RedirigeA({ a }) {
  const params = useParams();
  const { search, hash } = useLocation();
  const destino = a.replace(/:(\w+)/g, (_, k) => params[k] ?? '');
  return <Navigate to={`${destino}${search}${hash}`} replace />;
}
