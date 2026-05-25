import { Component } from 'react';
import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react';

/**
 * ErrorBoundary global. Captura errores no manejados en cualquier descendiente
 * y muestra una pantalla útil en vez de la pantalla blanca.
 *
 * Uso:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
    try {
      fetch('/api/client-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || String(error),
          stack: error?.stack || null,
          componentStack: info?.componentStack || null,
          url: window.location.href,
          userAgent: navigator.userAgent,
        }),
        credentials: 'include',
      }).catch(() => {});
    } catch {}
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-xl shadow-lg max-w-md w-full p-6 text-center">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/30 flex items-center justify-center mx-auto mb-4">
            <WarningCircle size={24} weight="regular" className="text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-lg font-semibold mb-1.5">Algo se ha roto</h1>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
            La aplicación encontró un error inesperado. Esto se ha registrado y revisaremos qué pasó.
          </p>
          {import.meta.env.DEV && this.state.error?.message && (
            <pre className="text-[11px] text-left bg-muted/50 border border-border rounded-md p-3 mb-4 overflow-auto max-h-32 font-mono">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={this.handleReset}
              className="h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
            >
              Volver a intentar
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
            >
              <ArrowClockwise size={14} weight="bold" /> Recargar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
