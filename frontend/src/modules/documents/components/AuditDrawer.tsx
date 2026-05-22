import { useEffect, useState } from 'react';
import {
  X, FileArrowDown, FilePlus, ArrowsClockwise, Trash, Hash, EnvelopeSimple,
  type Icon,
} from '@phosphor-icons/react';
import { documentsApi, type AuditEntry, type CrmDocument } from '../api/documents.api';

interface AuditDrawerProps {
  doc: CrmDocument;
  projectId: number;
  onClose: () => void;
}

const ACTION_META: Record<AuditEntry['action'], { label: string; Icon: Icon; color: string }> = {
  generated:         { label: 'Generado',         Icon: FilePlus,         color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
  downloaded:        { label: 'Descargado',       Icon: FileArrowDown,    color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30' },
  regenerated:       { label: 'Regenerado',       Icon: ArrowsClockwise,  color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
  deleted:           { label: 'Eliminado',        Icon: Trash,            color: 'text-red-600 bg-red-50 dark:bg-red-950/30' },
  number_overridden: { label: 'Número editado',   Icon: Hash,             color: 'text-violet-600 bg-violet-50 dark:bg-violet-950/30' },
  emailed:           { label: 'Email enviado',    Icon: EnvelopeSimple,   color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/30' },
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function shortUA(ua: string | null): string {
  if (!ua) return '—';
  // Extrae el navegador principal del user agent
  const m = ua.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/);
  return m ? m[0] : ua.slice(0, 40) + '…';
}

export default function AuditDrawer({ doc, projectId, onClose }: AuditDrawerProps) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await documentsApi.audit(doc.id, projectId);
        if (cancelled) return;
        if (res.success && res.data) setEntries(res.data);
        else setError('No se pudo cargar el historial');
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error de red');
      }
    })();
    return () => { cancelled = true; };
  }, [doc.id, projectId]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-title"
        className="w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="min-w-0">
            <h2 id="audit-title" className="font-semibold text-sm">Historial de auditoría</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">{doc.number}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-md p-3">
              {error}
            </div>
          )}
          {!entries && !error && (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-muted/30 rounded-md animate-pulse" />
              ))}
            </div>
          )}
          {entries && entries.length === 0 && (
            <p className="text-sm text-muted-foreground italic text-center py-8">
              Sin eventos registrados todavía.
            </p>
          )}
          {entries && entries.length > 0 && (
            <ol className="relative border-l-2 border-border ml-2 space-y-4">
              {entries.map((e) => {
                const meta = ACTION_META[e.action] || { label: e.action, Icon: FilePlus, color: 'text-muted-foreground bg-muted' };
                const Icon = meta.Icon;
                return (
                  <li key={e.id} className="ml-5 relative">
                    <span className={`absolute -left-[33px] top-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.color} ring-4 ring-card`}>
                      <Icon size={13} weight="duotone" />
                    </span>
                    <div className="bg-muted/30 border border-border rounded-md p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-foreground">{meta.label}</span>
                        <time className="text-muted-foreground tabular-nums">{formatDateTime(e.created_at)}</time>
                      </div>
                      <div className="text-muted-foreground space-y-0.5">
                        <div>
                          <span className="opacity-60">Usuario: </span>
                          <span className="text-foreground">{e.user_nombre || `#${e.user_id ?? '—'}`}</span>
                        </div>
                        {e.ip && (
                          <div>
                            <span className="opacity-60">IP: </span>
                            <span className="font-mono">{e.ip}</span>
                          </div>
                        )}
                        {e.user_agent && (
                          <div>
                            <span className="opacity-60">Navegador: </span>
                            <span>{shortUA(e.user_agent)}</span>
                          </div>
                        )}
                        {e.metadata && Object.keys(e.metadata).length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] opacity-70 hover:opacity-100">Metadata</summary>
                            <pre className="text-[10px] mt-1 bg-background border border-border rounded p-2 overflow-x-auto">{JSON.stringify(e.metadata, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </div>
  );
}
