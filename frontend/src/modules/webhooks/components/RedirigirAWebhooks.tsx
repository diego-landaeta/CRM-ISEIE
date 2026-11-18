import { Navigate, useLocation, useParams } from 'react-router-dom';

/**
 * Las direcciones de antes (#690) llevan al apartado Conexión › Webhooks, con
 * el `:id` de la ficha y lo que lleve detrás (`?new=1`, del atajo «n»), para
 * no romper avisos ya enviados, marcadores ni el buscador (Ctrl K).
 */
export default function RedirigirAWebhooks({ a }: { a: string }) {
  const { id } = useParams();
  const { search, hash } = useLocation();
  return <Navigate to={`${a}${id ? `/${id}` : ''}${search}${hash}`} replace />;
}
