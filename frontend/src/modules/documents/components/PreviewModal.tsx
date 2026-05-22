import { useEffect, useRef, useState } from 'react';
import { X, Plus, Minus, ArrowsClockwise } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

interface PreviewModalProps {
  html: string;
  title: string;
  TitleIcon: Icon;
  onClose: () => void;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.15;

export default function PreviewModal({ html, title, TitleIcon, onClose }: PreviewModalProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(1);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Carga inicial del HTML en el iframe via document.write
  useEffect(() => {
    if (!html || !iframeRef.current) return;
    const iframe = iframeRef.current;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    // Aplicar zoom inicial despues del write
    doc.documentElement.style.setProperty('--zoom', String(zoom));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html]);

  // Sincroniza zoom -> CSS variable del iframe en cada cambio
  useEffect(() => {
    const root = iframeRef.current?.contentDocument?.documentElement;
    if (root) root.style.setProperty('--zoom', String(zoom));
  }, [zoom]);

  const zoomOut = (): void => setZoom(z => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)));
  const zoomIn = (): void => setZoom(z => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)));
  const zoomReset = (): void => setZoom(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-modal-title"
        className="bg-card rounded-xl border border-border shadow-2xl flex flex-col w-full max-w-5xl h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <TitleIcon size={16} className="text-primary" />
            <span id="preview-modal-title" className="font-semibold text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
              title="Zoom out (Ctrl + −)"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={zoomReset}
              aria-label="Ajustar al ancho"
              title="Ajustar al ancho (Ctrl + 0)"
              className="inline-flex items-center gap-1 px-2 h-7 rounded-md hover:bg-muted text-xs font-medium tabular-nums text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 min-w-[3.5rem] justify-center"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
              title="Zoom in (Ctrl + +)"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Plus size={14} />
            </button>
            <span className="w-px h-5 bg-border mx-1.5" aria-hidden="true" />
            <button
              type="button"
              onClick={zoomReset}
              aria-label="Restablecer zoom"
              title="Restablecer (Ctrl + 0)"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <ArrowsClockwise size={14} />
            </button>
            <span className="w-px h-5 bg-border mx-1.5" aria-hidden="true" />
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden bg-muted/30 flex">
          <iframe
            ref={iframeRef}
            className="flex-1 border-0"
            title={title}
          />
        </div>
      </div>
    </div>
  );
}
