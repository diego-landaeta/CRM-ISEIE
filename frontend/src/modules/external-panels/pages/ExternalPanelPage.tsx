// CRM-155: página que embebe un panel externo configurado en el proyecto.
// La URL se resuelve a partir del id del panel y del proyecto activo.
// Si el sitio destino bloquea ser embebido, ofrecemos abrirlo en pestaña nueva.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowSquareOut, ArrowsClockwise, Globe, Warning } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import EmptyState from '@/shared/components/ui/EmptyState';

interface ExternalPanel {
  id: string;
  label: string;
  url: string;
  open_in?: 'iframe' | 'tab';
}

export default function ExternalPanelPage() {
  const { panelId } = useParams<{ panelId: string }>();
  const { activeProject } = useProjectContext();
  const [reloadKey, setReloadKey] = useState(0);

  const panel = useMemo<ExternalPanel | null>(() => {
    const list = (activeProject as { external_panels?: ExternalPanel[] | null } | null)?.external_panels;
    if (!Array.isArray(list)) return null;
    return list.find((p) => p.id === panelId) || null;
  }, [activeProject, panelId]);

  if (!panel) {
    return (
      <div className="p-8">
        <EmptyState
          icon={Warning}
          title="Panel no encontrado"
          description="Este panel ya no existe en el proyecto activo, o no tiene permiso. Verifica la configuración en Ajustes → Paneles externos."
          action={
            <Link to="/" className="text-sm font-semibold text-primary hover:underline">Volver al inicio</Link>
          }
        />
      </div>
    );
  }

  // Modo tab: realmente nunca se debería navegar aquí porque el sidebar abre directo
  // en otra pestaña. Pero por si alguien entra por URL, ofrecemos el botón.
  if (panel.open_in === 'tab') {
    return (
      <div className="p-8 max-w-md mx-auto text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <Globe size={26} weight="regular" />
        </div>
        <h1 className="text-lg font-semibold">{panel.label}</h1>
        <p className="text-sm text-muted-foreground">
          Este panel está configurado para abrirse en una pestaña nueva.
        </p>
        <a
          href={panel.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
        >
          <ArrowSquareOut size={14} weight="bold" /> Abrir {panel.label}
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-2 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={16} className="text-muted-foreground flex-shrink-0" weight="regular" />
          <h1 className="text-sm font-semibold truncate">{panel.label}</h1>
          <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">{panel.url}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            aria-label="Recargar"
            title="Recargar"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border bg-card hover:bg-muted text-muted-foreground"
          >
            <ArrowsClockwise size={13} weight="bold" />
          </button>
          <a
            href={panel.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir en pestaña nueva"
            title="Abrir en pestaña nueva"
            className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border bg-card hover:bg-muted text-muted-foreground"
          >
            <ArrowSquareOut size={13} weight="bold" />
          </a>
        </div>
      </header>

      <iframe
        key={reloadKey}
        src={panel.url}
        title={panel.label}
        // Permitimos lo común para webs corporativas; si el destino corta por X-Frame-Options
        // o CSP, mostramos un fallback en onLoad cuando lo detectemos. (sandbox vacío bloquea
        // demasiado para casos como Stripe). Dejamos sin sandbox para máxima compatibilidad.
        referrerPolicy="no-referrer-when-downgrade"
        loading="lazy"
        className="flex-1 w-full bg-white"
      />
    </div>
  );
}
