import { useId, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import StatusDot from '@/shared/components/ui/StatusDot';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import type { CampusMoodle } from '../api/moodle.api';
import ConectarMoodle from './ConectarMoodle';

/**
 * «Conexión» de un campus que ya está conectado, en un diálogo pequeño: el estado, un solo
 * campo para cambiar el token y, abajo, desconectar. No se mete en la página (empujaba los
 * cursos hacia abajo) ni repite los pasos de la primera conexión, que van plegados.
 */
export default function AjustesConexion({ campus, funciones, onCerrar, onCambiado, onDesconectar }: {
  campus: CampusMoodle;
  funciones: string[];
  onCerrar: () => void;
  /** Se cambió el token: hay que volver a leer el campus. */
  onCambiado: () => void;
  onDesconectar: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  useModalAccesible(ref, { open: true, onClose: onCerrar });

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onCerrar} />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId} data-testid="ajustes-conexion" className="relative flex max-h-full w-full max-w-lg flex-col overflow-y-auto border border-border bg-card sm:rounded-lg">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-base font-semibold">Conexión con Moodle</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{campus.nombre}</span>
                <StatusDot tono="success">Conectado</StatusDot>
                {campus.cursos && <span>{campus.cursos.total} cursos</span>}
              </p>
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="px-5 py-5">
            <ConectarMoodle campus={campus} funciones={funciones} modo="cambiar" onConectado={onCambiado} />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3">
            <button type="button" onClick={onDesconectar} className="text-sm font-medium text-destructive hover:underline">Desconectar este Moodle</button>
            <button type="button" onClick={onCerrar} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Cerrar</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
