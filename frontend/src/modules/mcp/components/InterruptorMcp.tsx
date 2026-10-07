import { useState } from 'react';
import { Power, WarningOctagon } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, type McpInterruptor } from '../api/mcp.api';

/**
 * Interruptor de emergencia del MCP (#196).
 *
 * Para todos: si está apagado, un aviso arriba (que nadie piense que Claude
 * está roto). Para el super admin, además, el botón que lo apaga o lo enciende
 * al momento. Con MCP_DISABLED=1 en el .env el botón no puede encenderlo.
 */
const cuando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function InterruptorMcp({ estado, puedeApagar, onCambio }: {
  estado: McpInterruptor; puedeApagar: boolean; onCambio: () => void;
}) {
  const [cambiando, setCambiando] = useState(false);

  async function cambiar(apagar: boolean) {
    let motivo: string | undefined;
    if (apagar) {
      const m = window.prompt('Se va a APAGAR el MCP para todo el CRM: ninguna URL responderá hasta que lo vuelvas a encender.\n\n¿Por qué? (queda en la Actividad)');
      if (m === null) return;
      motivo = m.trim() || undefined;
    } else if (!window.confirm('¿Volver a encender el MCP? Claude podrá consultar de nuevo.')) {
      return;
    }
    setCambiando(true);
    try {
      await mcpApi.cambiarInterruptor(apagar, motivo);
      toast({ title: apagar ? 'MCP apagado' : 'MCP encendido' });
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo cambiar', description: (e as Error).message, variant: 'destructive' });
    } finally { setCambiando(false); }
  }

  if (!estado.apagado && !puedeApagar) return null;

  return (
    <div className={`rounded-lg p-4 flex flex-wrap items-center gap-3 border ${estado.apagado
      ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30'
      : 'border-border bg-card'}`}>
      {estado.apagado
        ? <WarningOctagon size={22} weight="fill" className="text-red-600 flex-shrink-0" />
        : <Power size={20} weight="bold" className="text-emerald-600 flex-shrink-0" />}
      <div className="flex-1 min-w-[240px]">
        <p className="font-semibold text-sm">
          {estado.apagado ? 'El MCP está APAGADO: Claude no puede consultar el CRM' : 'Interruptor de emergencia · el MCP está encendido'}
        </p>
        <p className="text-xs text-muted-foreground">
          {estado.porEnv
            ? 'Apagado desde el servidor (MCP_DISABLED=1). Para encenderlo hay que quitarlo del .env y reiniciar.'
            : estado.apagado
              ? `Lo apagó ${estado.cambiadoPor || 'un super admin'} el ${cuando(estado.cambiadoAt)}${estado.motivo ? ` · «${estado.motivo}»` : ''}.`
              : 'Si algo va mal (una URL filtrada, consultas raras), apágalo: todas las URLs dejan de responder al momento.'}
        </p>
      </div>
      {puedeApagar && !estado.porEnv && (
        <button
          onClick={() => cambiar(!estado.apagado)}
          disabled={cambiando}
          className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-semibold disabled:opacity-50 ${estado.apagado
            ? 'bg-emerald-600 text-white hover:bg-emerald-700'
            : 'bg-red-600 text-white hover:bg-red-700'}`}
        ><Power size={14} weight="bold" /> {estado.apagado ? 'Encender el MCP' : 'Apagar el MCP'}</button>
      )}
    </div>
  );
}
