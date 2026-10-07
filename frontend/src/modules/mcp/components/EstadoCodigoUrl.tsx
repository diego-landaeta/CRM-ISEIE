import { useState } from 'react';
import { LockKey, LockKeyOpen, Prohibit } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, type McpEstadoCodigo } from '../api/mcp.api';

/**
 * Cuándo volverá a pedir el código una URL, y «Desbloquear desde aquí» (#192,
 * Diego 05/10).
 *
 * claude.ai guarda la lista de herramientas del momento en que se conectó: a
 * quien conectó con el código apagado le falta `desbloquear`, y Claude no puede
 * usar el código. Con el botón la persona desbloquea SU URL desde el CRM, con
 * las mismas reglas (2 h sin uso, 9 h como máximo). El texto lo calcula el
 * servidor; con el código apagado no llega nada y aquí no se pinta nada.
 */
export default function EstadoCodigoUrl({ codigo, tokenId, onCambio }: {
  codigo: McpEstadoCodigo | null | undefined;
  tokenId: number;
  onCambio: () => void;
}) {
  const [desbloqueando, setDesbloqueando] = useState(false);
  if (!codigo) return null;

  async function desbloquear() {
    setDesbloqueando(true);
    try {
      await mcpApi.desbloquearUrl(tokenId);
      toast({ title: 'URL desbloqueada', description: 'Dile a Claude que vuelva a consultar.' });
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo desbloquear', description: (e as Error).message, variant: 'destructive' });
    } finally { setDesbloqueando(false); }
  }

  const Icono = codigo.estado === 'desbloqueada' ? LockKeyOpen : codigo.estado === 'bloqueada' ? Prohibit : LockKey;
  const color = codigo.estado === 'desbloqueada'
    ? 'text-success-soft-foreground'
    : codigo.estado === 'bloqueada' ? 'text-destructive' : 'text-warning-soft-foreground';

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={`inline-flex items-start gap-1 text-[11px] ${color}`}>
        <Icono size={12} weight="bold" className="mt-0.5 shrink-0" /> {codigo.texto}
      </span>
      {codigo.estado === 'sin_desbloquear' && (
        <button
          type="button"
          onClick={desbloquear}
          disabled={desbloqueando}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-50"
        ><LockKeyOpen size={12} weight="bold" /> Desbloquear desde aquí</button>
      )}
    </div>
  );
}
