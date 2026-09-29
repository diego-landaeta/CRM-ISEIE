import { createContext, useState, useContext, useCallback, useEffect, useMemo, useRef } from 'react';
import client, { setAccessToken, setOnAuthFailure, API_BASE_URL } from '@/shared/api/client';

const AuthContext = createContext(null);

// Dev-only bypass: fake superadmin user para validar UI/menus sin backend.
const BYPASS = String(import.meta.env.VITE_DEV_BYPASS_AUTH || '').toLowerCase() === 'true';
const FAKE_USER = { id: 1, userId: 1, nombre: 'Dev Bypass', email: 'dev@local', role: 'superadmin' };
const FAKE_PROJECT = { id: 10, nombre: 'ISEIE', slug: 'iseie' };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(BYPASS ? FAKE_USER : null);
  const [projects, setProjects] = useState(BYPASS ? [FAKE_PROJECT] : []);
  const [activeProjectId, setActiveProjectId] = useState(BYPASS ? FAKE_PROJECT.id : null);
  const [loading, setLoading] = useState(!BYPASS); // bypass salta el loader

  // LOS PERMISOS DE CADA UNO, los que calcula el backend en `/auth/me`.
  //
  // Sin esto la pantalla solo sabia el rol: lo que se le da a una persona
  // suelta en el panel de permisos no le llegaba nunca. En MultiCRM, Ana,
  // Dayana y Yosbely tenian «venta sin gestora» y no les salia (28/09).
  const [permissions, setPermissions] = useState(null);
  // Ni el refresh ni el login los traen: se piden aparte y sin esperar. Hasta
  // que llegan, vale la tabla del rol, que es lo que habia.
  const cargarPermisos = useCallback(() => {
    client.get('/auth/me')
      .then((me) => { if (me.success) setPermissions(me.data.permissions || null); })
      .catch(() => {});
  }, []);
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
        setActiveProjectId(data.activeProjectId || userProjects[0]?.id || null);
        cargarPermisos();
      } catch {
        // sin sesión válida — caer al login
      } finally {
        setLoading(false);
      }
    }

    restoreSession();
  }, [cargarPermisos]);

  // Configurar callback de fallo de auth para limpiar estado
  useEffect(() => {
    setOnAuthFailure(() => {
      setUser(null);
      setPermissions(null);
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
    setActiveProjectId(apiProjectId || userProjects?.[0]?.id || null);
    cargarPermisos();

    return userData;
  }, [cargarPermisos]);

  const logout = useCallback(async () => {
    try {
      await client.post('/auth/logout');
    } catch {
      // Ignorar errores de logout — limpiar estado igual
    }
    setAccessToken(null);
    setUser(null);
    setPermissions(null);
    setProjects([]);
    setActiveProjectId(null);
  }, []);

  const isAuthenticated = !!user;
  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0] || null;

  const refreshUser = useCallback(async () => {
    try {
      const res = await client.get('/auth/me');
      if (res.success) {
        setUser(res.data.user);
        setPermissions(res.data.permissions || null);
        setProjects(res.data.projects || []);
      }
    } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({
    user,
    permissions,
    projects,
    activeProject,
    activeProjectId: activeProject?.id || null,
    isAuthenticated,
    loading,
    login,
    logout,
    refreshUser,
  }), [user, permissions, projects, activeProject, isAuthenticated, loading, login, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
