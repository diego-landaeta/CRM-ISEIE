import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ConfirmProvider } from './shared/components/ui/useConfirm';
import ErrorBoundary from './shared/components/layout/ErrorBoundary';
import App from './App';
import { recargarUnaVez } from './shared/lib/piezaNueva';
import './index.css';

// Auto-reload cuando una pieza del frontal falla por estar desactualizada tras un
// deploy (la pestaña abierta con el JS viejo pide piezas que ya no están). La regla
// —una sola vez, con la marca en sessionStorage— vive en shared/lib/piezaNueva:
// la usan también las páginas perezosas de App.jsx y el ErrorBoundary. Recargar es
// seguro: AuthContext restaura la sesión del refresh token.
const handleChunkError = (reason) => recargarUnaVez(reason);
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
