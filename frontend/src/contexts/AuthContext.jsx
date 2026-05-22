import { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import client, { setAccessToken, setOnAuthFailure, API_BASE_URL } from '@/shared/api/client';

const AuthContext = createContext(null);

// Sentinel para el modo "Todos los proyectos" (vista agregada).
export const ALL_PROJECTS_ID = -1;
const ALL_PROJECTS_PSEUDO = { id: ALL_PROJECTS_ID, nombre: 'Todos los proyectos', isAll: true, type: 'multi' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(true); // true hasta que verifiquemos sesión
  const initialized = useRef(false);

  // Al montar, intentar restaurar sesión con refresh token (cookie httpOnly)
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    async function restoreSession() {
      try {
        // /auth/refresh devuelve accessToken + user + projects → un único
        // round-trip al arrancar (antes eran dos: refresh + /me).
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!res.ok) return;

        const { success, data } = await res.json();
        if (!success || !data?.accessToken) return;

        setAccessToken(data.accessToken);
        setUser(data.user);
        const userProjects = data.projects || [];
        setProjects(userProjects);

        const saved = Number(localStorage.getItem('crm_active_project_id'));
        const restored = saved === ALL_PROJECTS_ID
          ? ALL_PROJECTS_ID
          : userProjects.find((p) => p.id === saved)?.id;
        setActiveProjectId(restored || data.activeProjectId || userProjects[0]?.id || null);
      } catch {
        // sin sesión válida — caer al login
      } finally {
        setLoading(false);
      }
    }

    restoreSession();
  }, []);

  // Configurar callback de fallo de auth para limpiar estado
  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      setProjects([]);
      setActiveProjectId(null);
      setAccessToken(null);
    });
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await client.post('/auth/login', { email, password });

    if (!res.success) {
      throw new Error(res.error || 'Error al iniciar sesión');
    }

    const { accessToken: token, user: userData, projects: userProjects, activeProjectId: apiProjectId } = res.data;

    setAccessToken(token);
    setUser(userData);
    setProjects(userProjects || []);

    // Usar proyecto activo del login o el primero disponible
    const savedProjectId = localStorage.getItem('crm_active_project_id');
    const projectId = userProjects?.find((p) => p.id === Number(savedProjectId))?.id
      || apiProjectId
      || userProjects?.[0]?.id
      || null;
    setActiveProjectId(projectId);
    if (projectId) localStorage.setItem('crm_active_project_id', String(projectId));

    return userData;
  }, []);

  const logout = useCallback(async () => {
    try {
      await client.post('/auth/logout');
    } catch {
      // Ignorar errores de logout — limpiar estado igual
    }
    setAccessToken(null);
    setUser(null);
    setProjects([]);
    setActiveProjectId(null);
    localStorage.removeItem('crm_active_project_id');
  }, []);

  const switchProject = useCallback((projectId) => {
    if (projectId === ALL_PROJECTS_ID) {
      setActiveProjectId(ALL_PROJECTS_ID);
      localStorage.setItem('crm_active_project_id', String(ALL_PROJECTS_ID));
      return;
    }
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setActiveProjectId(projectId);
      localStorage.setItem('crm_active_project_id', String(projectId));
    }
  }, [projects]);

  const isAuthenticated = !!user;
  const activeProject =
    activeProjectId === ALL_PROJECTS_ID
      ? ALL_PROJECTS_PSEUDO
      : projects.find((p) => p.id === activeProjectId) || projects[0] || null;
  const isAllProjects = activeProjectId === ALL_PROJECTS_ID;

  const refreshUser = useCallback(async () => {
    try {
      const res = await client.get('/auth/me');
      if (res.success) {
        setUser(res.data.user);
        setProjects(res.data.projects || []);
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      projects,
      activeProject,
      activeProjectId: activeProject?.id || null,
      isAllProjects,
      isAuthenticated,
      loading,
      login,
      logout,
      switchProject,
      refreshUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
