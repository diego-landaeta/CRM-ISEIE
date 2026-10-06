import { useEffect, useState } from 'react';
import { Copy, LockKey } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, type McpCodigo, type McpEstado } from '../api/mcp.api';
import EstadoCodigoUrl from './EstadoCodigoUrl';

/**
 * «Código para Claude» (#192): el segundo factor del MCP.
 *
 * Con el interruptor MCP_CODIGO_OBLIGATORIO encendido, Claude no saca datos
 * hasta que la persona le da este código. El desbloqueo es de la conexión y se
 * pierde tras un rato sin uso: entonces Claude lo vuelve a pedir y se saca otro
 * aquí.
 *
 * El código vive solo en este estado y se olvida al caducar: el servidor no lo
 * guarda, solo su huella.
 */
const horas = (min: number) => (min % 60 === 0 ? `${min / 60} h` : `${min} min`);

export default function CodigoParaClaude({ config, onCambio }: {
  config: NonNullable<McpEstado['codigo']>;
  onCambio: () => void;
}) {
  const [codigo, setCodigo] = useState<McpCodigo | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [quedan, setQuedan] = useState(0);

  // Cuenta atrás. Al llegar a cero el código se borra de la pantalla: ya no vale.
  useEffect(() => {
    if (!codigo) return undefined;
    const tic = () => {
      const s = Math.max(0, Math.round((new Date(codigo.caducaAt).getTime() - Date.now()) / 1000));
      setQuedan(s);
      if (s === 0) setCodigo(null);
    };
    tic();
    const t = setInterval(tic, 1000);
    return () => clearInterval(t);
  }, [codigo]);

  async function pedir() {
    setPidiendo(true);
    try {
      const r = await mcpApi.crearCodigo();
      setCodigo(r.data as McpCodigo);
    } catch (e) {
      toast({ title: 'No se pudo sacar el código', description: (e as Error).message, variant: 'destructive' });
    } finally { setPidiendo(false); }
  }

  const mmss = `${Math.floor(quedan / 60)}:${String(quedan % 60).padStart(2, '0')}`;

  return (
    <div className="bg-card border border-primary/30 rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <LockKey size={18} weight="bold" className="text-primary" />
        <div className="flex-1 min-w-[200px]">
          <h2 className="font-semibold text-sm">Código para Claude</h2>
          <p className="text-xs text-muted-foreground">
            Claude necesita este código para darte datos. Te lo pedirá al conectarte y otra vez tras {horas(config.inactividadMin)} sin
            usarlo (como mucho cada {horas(config.maximoMin)}). Vale {config.minutosCodigo} minutos y una sola vez.
          </p>
        </div>
        <button
          onClick={pedir}
          disabled={pidiendo}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        ><LockKey size={14} weight="bold" /> {codigo ? 'Sacar otro' : 'Sacar código para Claude'}</button>
      </div>

      {/* El estado actual en una línea (#192, Diego 05/10): el de su URL o, si tiene varias,
          un resumen de todas. El detalle y el botón de cada una, en su tabla. */}
      {config.resumen && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {config.resumen.una ? (<>
            <span>Tu URL ({config.resumen.una.nombre}):</span>
            <EstadoCodigoUrl codigo={config.resumen.una} tokenId={config.resumen.una.id} onCambio={onCambio} />
          </>) : (
            <span className="inline-flex items-start gap-1"><LockKey size={12} weight="bold" className="mt-0.5 shrink-0" /> {config.resumen.texto}</span>
          )}
        </div>
      )}

      {codigo && (
        <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted p-4">
          <code className="text-2xl font-bold tracking-[0.2em]">{codigo.codigo}</code>
          <button
            onClick={() => { navigator.clipboard?.writeText(codigo.codigo); toast({ title: 'Código copiado' }); }}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          ><Copy size={12} weight="bold" /> Copiar</button>
          <span className="text-xs text-muted-foreground">Caduca en {mmss}. Díselo a Claude: «mi código es {codigo.codigo}».</span>
        </div>
      )}
    </div>
  );
}
