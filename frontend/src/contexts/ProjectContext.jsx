import { createContext, useContext, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { hexToHslTriplet, adaptHslForDarkMode } from '@/shared/lib/color';
import { useTheme } from '@/contexts/ThemeContext';
import { APP_BASE_URL } from '@/shared/api/client';

const ProjectContext = createContext(null);

const DEFAULT_FAVICON = `${APP_BASE_URL}/iseie-icon-192.png`;

function setFavicon(href) {
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
  // Apple touch icon tambien
  let apple = document.querySelector("link[rel='apple-touch-icon']");
  if (apple) apple.href = href;
}

// CRM-191: aplica el color primario del proyecto a las CSS vars que usan
// shadcn/Tailwind. Si theme_color es null o inválido, restaura el default
// quitando el override inline (el index.css recupera el control).
function applyThemeColor(hex, isDark) {
  const root = document.documentElement;
  let triplet = hexToHslTriplet(hex);
  if (triplet && isDark) {
    // En dark mode los colores corporativos navy quedan ilegibles sobre
    // fondo oscuro. Se ajusta a una variante mas clara automaticamente.
    triplet = adaptHslForDarkMode(triplet);
  }
  if (triplet) {
    root.style.setProperty('--primary', triplet);
    root.style.setProperty('--ring', triplet);
  } else {
    root.style.removeProperty('--primary');
    root.style.removeProperty('--ring');
  }
}

export function ProjectProvider({ children }) {
  const { activeProject, projects } = useAuth();
  const { theme } = useTheme();

  // Favicon dinamico: si el proyecto activo tiene logo, usarlo. Si no, default.
  useEffect(() => {
    // El title lo construye App.jsx (ruta + proyecto + CRM ISEIE) — aquí solo favicon.
    if (activeProject?.logo_url) {
      setFavicon(`${APP_BASE_URL}/api/projects/${activeProject.id}/logo`);
    } else {
      setFavicon(DEFAULT_FAVICON);
    }
  }, [activeProject?.id, activeProject?.logo_url]);

  // Branding por proyecto (CRM-191): inyecta --primary/--ring del activeProject.
  // En dark mode aclara automaticamente colores oscuros para mantener legibilidad.
  useEffect(() => {
    applyThemeColor(activeProject?.theme_color, theme === 'dark');
    return () => applyThemeColor(null, false);
  }, [activeProject?.id, activeProject?.theme_color, theme]);

  return (
    <ProjectContext.Provider value={{
      activeProject: activeProject || { id: null, nombre: 'Sin proyecto' },
      projects: projects || [],
    }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}
