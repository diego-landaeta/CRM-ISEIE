import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

// Dev-only bypass: si VITE_DEV_BYPASS_AUTH=true en .env.local, deja pasar sin login.
// Solo para validar UI/menus en local sin backend. NUNCA activar en producción.
const BYPASS = String(import.meta.env.VITE_DEV_BYPASS_AUTH || '').toLowerCase() === 'true';

// Lo unico que un tutor puede abrir. Se declara lo permitido y no lo prohibido:
// enumerar lo prohibido deja fuera siempre alguna pantalla nueva, y esa pantalla
// es la que acaba enseñandole las ventas de todos.
//
// Esto es el recorte de la barra de direcciones. El de verdad esta en el
// servidor, que le fuerza su propio identificador; aqui solo se evita que vea
// pantallas que no son suyas.
const RUTAS_DEL_TUTOR = ['/mis-cursos', '/preferences', '/profile', '/set-password'];

function tutorPuede(pathname) {
  return RUTAS_DEL_TUTOR.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();
  if (BYPASS) return children;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground font-medium">Verificando sesión...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Un tutor que entra por cualquier otro sitio —al iniciar sesion cae en la
  // portada, que no es suya— acaba en sus cursos.
  if (user?.role === 'tutor' && !tutorPuede(location.pathname)) {
    return <Navigate to="/mis-cursos" replace />;
  }

  return children;
}
