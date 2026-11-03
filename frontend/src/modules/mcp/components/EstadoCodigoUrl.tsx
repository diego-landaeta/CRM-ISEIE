import { useEffect, useState } from 'react';
import { CheckCircle, Clock, Copy, LockKey, LockKeyOpen, Prohibit, XCircle } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, type McpCodigo, type McpConexionClaude, type McpEstadoCodigo } from '../api/mcp.api';

/**
 * El estado de una URL con el código para Claude, y cada Claude conectado con
 * ella (#192, Diego 05/10; #326, 13/10).
 *
 * #326: cada Claude que se conecta con la URL aparece aquí debajo. Queda
 * PENDIENTE hasta que el dueño lo autoriza: si la URL se ha colado y otra
 * persona la conecta en su Claude, no puede consultar nada aunque la URL esté
 * desbloqueada y aunque tenga un código. Se rechaza desde aquí. El desbloqueo
 * ya no caduca por horas (Carlos, 13/10).
 *
 * «Desbloquear desde aquí» desbloquea los Claude ya autorizados, sin código:
 * claude.ai guarda la lista de herramientas al conectar y a veces no tiene
 * `desbloquear`. Los textos los calcula el servidor; con el código apagado no
 * llega nada y aquí no se pinta nada.
 *
 * #260 (Diego, 07/10): «Sacar código» vive AQUÍ, en la fila de la URL, y el
 * código solo vale para esta URL. Ya no hay una sección suelta «Código para
 * Claude»: si hay fila, hay URL, y sin URL no hay botón. El código se enseña UNA
 * vez, con su cuenta atrás, y se olvida al caducar: el servidor solo guarda su
 * huella.
 */
export default function EstadoCodigoUrl({ codigo, tokenId, onCambio }: {
  codigo: McpEstadoCodigo | null | undefined;
  tokenId: number;
  onCambio: () => void;
}) {
  const [desbloqueando, setDesbloqueando] = useState(false);
  const [elCodigo, setElCodigo] = useState<McpCodigo | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [quedan, setQuedan] = useState(0);

  // Cuenta atrás. Al llegar a cero el código se borra de la pantalla: ya no vale.
  useEffect(() => {
    if (!elCodigo) return undefined;
    const tic = () => {
      const s = Math.max(0, Math.round((new Date(elCodigo.caducaAt).getTime() - Date.now()) / 1000));
      setQuedan(s);
      if (s === 0) setElCodigo(null);
    };
    tic();
    const t = setInterval(tic, 1000);
    return () => clearInterval(t);
  }, [elCodigo]);

  if (!codigo) return null;

  async function sacarCodigo() {
    setPidiendo(true);
    try {
      const r = await mcpApi.crearCodigo(tokenId);
      setElCodigo(r.data as McpCodigo);
    } catch (e) {
      toast({ title: 'No se pudo sacar el código', description: (e as Error).message, variant: 'destructive' });
    } finally { setPidiendo(false); }
  }

  async function desbloquear() {
    setDesbloqueando(true);
    try {
      await mcpApi.desbloquearUrl(tokenId);
      toast({ title: 'Desbloqueado', description: 'Dile a Claude que vuelva a consultar.' });
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo desbloquear', description: (e as Error).message, variant: 'destructive' });
    } finally { setDesbloqueando(false); }
  }

  const conexiones = codigo.conexiones || [];
  const hayAutorizadaCerrada = conexiones.some((c) => c.estado === 'autorizada' && !c.desbloqueada);
  const Icono = codigo.estado === 'desbloqueada' ? LockKeyOpen
    : codigo.estado === 'bloqueada' ? Prohibit
      : codigo.estado === 'pendiente' ? Clock : LockKey;
  const color = codigo.estado === 'desbloqueada'
    ? 'text-success-soft-foreground'
    : codigo.estado === 'bloqueada' ? 'text-destructive' : 'text-warning-soft-foreground';

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`inline-flex items-start gap-1 text-[11px] ${color}`}>
          <Icono size={12} weight="bold" className="mt-0.5 shrink-0" /> {codigo.texto}
        </span>
        {codigo.estado !== 'bloqueada' && hayAutorizadaCerrada && (
          <button
            type="button"
            onClick={desbloquear}
            disabled={desbloqueando}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-50"
          ><LockKeyOpen size={12} weight="bold" /> Desbloquear desde aquí</button>
        )}
        {codigo.estado !== 'bloqueada' && (
          <button
            type="button"
            onClick={sacarCodigo}
            disabled={pidiendo}
            title="El código solo vale para esta URL"
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-50"
          ><LockKey size={12} weight="bold" /> {elCodigo ? 'Sacar otro' : 'Sacar código'}</button>
        )}
      </div>
      {elCodigo && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2">
          <code className="text-lg font-bold tracking-[0.2em]">{elCodigo.codigo}</code>
          <button
            type="button"
            onClick={() => { navigator.clipboard?.writeText(elCodigo.codigo); toast({ title: 'Código copiado' }); }}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
          ><Copy size={12} weight="bold" /> Copiar</button>
          <span className="text-[11px] text-muted-foreground">
            Caduca en {Math.floor(quedan / 60)}:{String(quedan % 60).padStart(2, '0')} y vale una sola vez, solo para esta URL.
            Díselo a Claude: «mi código es {elCodigo.codigo}».
          </span>
        </div>
      )}
      {!elCodigo && codigo.estado !== 'bloqueada' && (
        <p className="text-[11px] text-muted-foreground">
          Claude te pide el código la primera vez que se conecta con esta URL; después no lo vuelve a pedir.
        </p>
      )}
      {conexiones.length > 0 && (
        <ul className="space-y-1">
          {conexiones.map((c) => <FilaConexion key={c.id} conexion={c} onCambio={onCambio} />)}
        </ul>
      )}
    </div>
  );
}

const fecha = (iso: string) => new Date(iso).toLocaleString('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

const nombreCliente = (c: McpConexionClaude) => (c.cliente === 'claude_code' ? 'Claude Code' : 'Claude');

/**
 * Un Claude conectado: autorizarlo (solo el dueño) o rechazarlo (el dueño o el
 * super admin). `deOtraPersona`: en la lista del super admin, sin «Autorizar».
 */
export function FilaConexion({ conexion: c, onCambio, deOtraPersona = false }: {
  conexion: McpConexionClaude;
  onCambio: () => void;
  deOtraPersona?: boolean;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function decidir(decision: 'autorizar' | 'rechazar') {
    if (decision === 'rechazar' && !window.confirm(
      `¿Rechazar este ${nombreCliente(c)}? No podrá consultar el CRM con esta URL. Si eres tú, tendrás que volver a conectar Claude.`,
    )) return;
    setOcupado(true);
    try {
      await mcpApi.decidirConexion(c.id, decision);
      toast(decision === 'autorizar'
        ? { title: 'Conexión autorizada', description: 'Si aún no lo has hecho, dale el código a Claude.' }
        : { title: 'Conexión rechazada', description: 'Ese Claude ya no puede consultar el CRM con esta URL.' });
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  const pendiente = c.estado === 'pendiente';
  return (
    <li className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2 py-1 text-[11px] ${
      pendiente ? 'border-warning bg-warning-soft' : 'border-border bg-card'}`}
    >
      <span className="inline-flex items-center gap-1 font-semibold">
        {pendiente
          ? <Clock size={12} weight="bold" className="text-warning-soft-foreground" />
          : <CheckCircle size={12} weight="bold" className="text-success-soft-foreground" />}
        {deOtraPersona ? `${c.persona} · ${c.url} · ` : ''}{nombreCliente(c)}
      </span>
      <span className="text-muted-foreground">
        conectado el {fecha(c.created_at)}
        {pendiente ? ' · pendiente de autorizar' : c.desbloqueada ? ' · autorizado y desbloqueado' : ' · autorizado, pedirá el código'}
        {c.last_used_at ? ` · último uso ${fecha(c.last_used_at)}` : ''}
      </span>
      <span className="ml-auto inline-flex gap-1">
        {pendiente && !deOtraPersona && (
          <button
            type="button"
            onClick={() => decidir('autorizar')}
            disabled={ocupado}
            className="inline-flex h-6 items-center gap-1 rounded-md bg-primary px-2 font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          ><CheckCircle size={12} weight="bold" /> Autorizar</button>
        )}
        <button
          type="button"
          onClick={() => decidir('rechazar')}
          disabled={ocupado}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 font-bold text-destructive hover:bg-muted disabled:opacity-50"
        ><XCircle size={12} weight="bold" /> {pendiente ? 'Rechazar' : 'Quitar'}</button>
      </span>
    </li>
  );
}
