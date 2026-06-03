import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConfirmProvider } from './shared/components/ui/useConfirm';
import ErrorBoundary from './shared/components/layout/ErrorBoundary';
import App from './App';
import './index.css';

// Auto-reload cuando un chunk lazy falla por bundle desactualizado tras un deploy.
// Pasa cuando el usuario tiene la pestaña abierta con JS viejo que pide chunks
// con hashes ya no servidos en el servidor. Recargar es seguro: AuthContext
// restaura sesión del refresh token.
const CHUNK_RELOAD_KEY = 'chunk-error-reload-ts';
function handleChunkError(reason) {
  const msg = String(reason?.message || reason || '');
  const isChunkErr =
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module') ||
    /ChunkLoadError|Loading chunk \d+ failed/.test(msg);
  if (!isChunkErr) return false;
  // Evita loop infinito: solo recarga si no hubo otro reload en los últimos 10s
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
  const now = Date.now();
  if (now - last < 10000) return false;
  sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  // eslint-disable-next-line no-console
  console.warn('[chunk-reload] bundle desactualizado, recargando…');
  window.location.reload();
  return true;
}
window.addEventListener('error', (e) => { handleChunkError(e.error || e.message); });
window.addEventListener('unhandledrejection', (e) => { handleChunkError(e.reason); });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter
        basename={import.meta.env.BASE_URL?.replace(/\/$/, '') || '/'}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ThemeProvider>
          <AuthProvider>
            <ProjectProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
