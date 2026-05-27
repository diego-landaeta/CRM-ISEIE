// Stub minimo: el dialog completo con 10 tabs (Categories, Columns, ExternalPanels, etc.)
// vive en CRM hermano (ISEIH). Aqui mostramos un placeholder hasta que se porte.

import { X } from '@phosphor-icons/react';

interface Props {
  project: any;
  initialTab?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export default function ProjectSettingsDialog({ project, initialTab, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card border border-border rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-bold">Configuracion del proyecto</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary">
            <X size={16} />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mb-2">
          Proximamente: tab <strong>{initialTab || '—'}</strong> para <strong>{project?.nombre || project?.slug || 'proyecto'}</strong>.
        </p>
        <p className="text-xs text-muted-foreground">
          Este modulo se va a portar desde el CRM hermano en una proxima iteracion (10 tabs:
          Apis, Categorias, Columnas, Campos custom, Modulos, Paneles externos, Sidebar labels,
          Stripe, Webhook, General).
        </p>
        <div className="mt-4 text-right">
          <button onClick={onClose} className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
