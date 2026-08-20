import { createContext, useContext, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { hexToHslTriplet, adaptHslForDarkMode } from '@/shared/lib/color';
import { useTheme } from '@/contexts/ThemeContext';
import { APP_BASE_URL } from '@/shared/api/client';

const ProjectContext = createContext(null);

const DEFAULT_FAVICON = `${APP_BASE_URL}/iseie-icon-192.png`;

// El favicon del proyecto activo.
//
// Tres cosas que hacian que desapareciera y que aqui se evitan:
//
// 1 · Apuntaba a /api/projects/:id/logo. El navegador pide el favicon SIN
//     cabeceras de sesion, asi que esa direccion nunca le va a contestar: pide
//     autenticacion. Hoy da igual: el icono es fijo, el del CRM.
// 2 · Si la imagen no cargaba —404, borrada, sin internet— el navegador se
//     quedaba sin icono. Ahora se prueba ANTES y solo se cambia si carga.
// 3 · El <link> del index declara type="image/svg+xml"; al meterle un PNG, el
//     tipo dejaba de cuadrar. Se quita al cambiarlo.
// El icono que trae el index.html, guardado antes de tocar nada. Es el que se
// repone cuando no hay logo o cuando el del proyecto no carga: viene con su
// ruta ya resuelta por el navegador, asi que funciona en /crm, en /testeo y en
// /staging sin tener que adivinar la base.
const ICONO_ORIGINAL = document.querySelector("link[rel='icon']")?.href || null;

function ponerFavicon(href) {
  for (const sel of ["link[rel='icon']", "link[rel='apple-touch-icon']"]) {
    const link = document.querySelector(sel);
    if (!link) continue;
    link.removeAttribute('type');
    link.removeAttribute('sizes');
    link.href = href;
  }
}

// Solo cambia el icono si la imagen carga de verdad. Si falla, se queda el del
// CRM: es preferible el icono de siempre a una pestaña en blanco.
function setFavicon(href, porDefecto) {
  const respaldo = ICONO_ORIGINAL || porDefecto;
  if (!href) { ponerFavicon(respaldo); return; }
  const img = new Image();
  img.onload = () => ponerFavicon(href);
  img.onerror = () => ponerFavicon(respaldo);
  img.src = href;
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

  // El icono de la pestaña es SIEMPRE el del CRM.
  //
  // Antes cambiaba al logo de la marca activa, y con nueve marcas y varias
  // pestañas abiertas dejaba de saberse cual era el CRM: parecian nueve
  // aplicaciones distintas. El icono identifica la herramienta; la marca en la
  // que trabajas la dice el menu, que es donde se mira.
  useEffect(() => {
    setFavicon(DEFAULT_FAVICON, DEFAULT_FAVICON);
  }, []);

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
