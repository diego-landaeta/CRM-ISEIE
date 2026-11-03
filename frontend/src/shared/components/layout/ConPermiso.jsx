import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';

// Una pantalla que pide un permiso del catálogo (#423). El menú ya la esconde a
// quien no lo tiene, pero la dirección se puede escribir a mano: sin esto,
// /informes/preguntar se abría igual y el error llegaba al pulsar (#580).
//
// El corte de verdad es del servidor (`puede(...)` en la ruta de la API); esto
// solo evita enseñar una pantalla que no va a funcionar.
//
// Mientras no ha llegado el mapa de permisos no se decide: redirigir en ese
// instante echaría a quien sí lo tiene.
export default function ConPermiso({ permiso, a = '/', children }) {
  const { permissions, user } = useAuth();
  const { can } = usePermission();
  if (can(permiso)) return children;
  if (user && !permissions) return null;
  return <Navigate to={a} replace />;
}
