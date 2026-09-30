import { Copy, Robot, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { urlParaClaude } from '@/modules/connectors/api/connectors.api';

/**
 * La URL de una conexión de Claude, la única vez que se ve entera: para pegarla
 * en Claude («Agregar conector personalizado»). No se guarda en ninguna parte.
 * Vivía en Conectores; desde el 29/09 las conexiones de Claude están aquí.
 */
export default function UrlParaClaude({ token, nombre, onCerrar }: { token: string; nombre: string; onCerrar: () => void }) {
  const url = urlParaClaude(token);
  const copiar = () => navigator.clipboard?.writeText(url).then(
    () => toast({ title: 'URL copiada' }),
    () => toast({ title: 'No se pudo copiar: selecciónala y cópiala a mano', variant: 'destructive' }),
  );
  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={onCerrar}>
        <div role="dialog" aria-modal="true" aria-label="Tu URL para Claude" onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg rounded-md border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="flex items-center gap-2 font-semibold"><Robot size={16} /> Tu URL para Claude · {nombre}</h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="p-1 rounded-md text-muted-foreground hover:bg-muted"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-3 text-sm">
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
              <code className="min-w-0 flex-1 break-all text-xs">{url}</code>
              <button type="button" onClick={copiar}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
                <Copy size={14} /> Copiar
              </button>
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
              <li>En Claude (escritorio o claude.ai): <strong className="text-foreground">Configuración → Conectores → Agregar conector personalizado</strong>.</li>
              <li>Ponle un nombre y pega esta URL. No pide nada más.</li>
              <li>Pregúntale como a una persona: «¿cuántas ventas llevamos este mes por campus?».</li>
            </ol>
            <p className="rounded-md bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              Solo se enseña ahora. Es tuya: quien la tenga consulta como tú. Si la pierdes o se filtra, pide una nueva
              en la conexión y esta deja de funcionar.
            </p>
          </div>
        </div>
      </div>
    </Portal>
  );
}
