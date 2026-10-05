import { useCallback, useEffect, useState } from 'react';
import { ClockCounterClockwise, CaretLeft, CaretRight, ArrowClockwise } from '@phosphor-icons/react';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, type McpActividad, type McpFiltrosActividad } from '../api/mcp.api';

/**
 * Conexión → MCP → Actividad (#195): quién consultó qué con Claude, cuándo, con
 * qué herramienta y con qué resultado. Sale de `mcp_auditoria`.
 *
 * Solo super admin y admin; un admin ve lo de las personas de sus empresas (lo
 * filtra el servidor, no esta pantalla).
 */

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** «Claude-User» → «Claude Desktop / claude.ai», como en la tabla de URLs. */
function cliente(ua: string | null): string {
  if (!ua) return '';
  if (/^claude-code\//i.test(ua)) return 'Claude Code';
  if (/Claude-User|Anthropic|python-httpx/i.test(ua)) return 'Claude Desktop / claude.ai';
  if (/mcp-remote|node/i.test(ua)) return 'Claude Desktop (archivo)';
  return ua.length > 30 ? `${ua.slice(0, 30)}…` : ua;
}

/** {"texto":"ana","proyecto_id":2} → «texto: ana · proyecto_id: 2». */
function queConsulto(p: Record<string, unknown> | null): string {
  if (!p || !Object.keys(p).length) return '—';
  return Object.entries(p).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ');
}

const campo = 'h-9 px-2.5 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

export default function ActividadMcp() {
  const [filtros, setFiltros] = useState<McpFiltrosActividad>({ pagina: 1 });
  const [datos, setDatos] = useState<McpActividad | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await mcpApi.actividad(filtros);
      setDatos(r.data as McpActividad);
    } catch (e) {
      toast({ title: 'No se pudo cargar la actividad', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  // Cambiar un filtro vuelve a la página 1.
  const poner = (k: keyof McpFiltrosActividad, v: string) => setFiltros((f) => ({ ...f, [k]: v || undefined, pagina: 1 }));
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.limite)) : 1;

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden" id="actividad">
      <div className="p-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <ClockCounterClockwise size={18} weight="bold" className="text-primary" />
          <div className="flex-1">
            <h2 className="font-semibold text-sm">Actividad</h2>
            <p className="text-xs text-muted-foreground">Cada consulta que se ha hecho al CRM desde Claude: quién, qué, cuándo, desde dónde y con qué resultado.</p>
          </div>
          <button onClick={cargar} aria-label="Recargar" className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border hover:bg-muted">
            <ArrowClockwise size={14} weight="bold" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <select className={campo} value={filtros.persona || ''} onChange={(e) => poner('persona', e.target.value)} aria-label="Persona">
            <option value="">Todas las personas</option>
            {datos?.opciones.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select className={campo} value={filtros.conexion || ''} onChange={(e) => poner('conexion', e.target.value)} aria-label="Conexión">
            <option value="">Todas las conexiones</option>
            <option value="personal">URLs personales</option>
            {datos?.opciones.conexiones.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <select className={campo} value={filtros.herramienta || ''} onChange={(e) => poner('herramienta', e.target.value)} aria-label="Herramienta">
            <option value="">Todas las consultas</option>
            {datos?.opciones.herramientas.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <select className={campo} value={filtros.resultado || ''} onChange={(e) => poner('resultado', e.target.value)} aria-label="Resultado">
            <option value="">Cualquier resultado</option>
            <option value="ok">Correctas</option>
            <option value="error">Rechazadas o con error</option>
          </select>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Desde
            <input type="date" className={campo} value={filtros.desde || ''} onChange={(e) => poner('desde', e.target.value)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">Hasta
            <input type="date" className={campo} value={filtros.hasta || ''} onChange={(e) => poner('hasta', e.target.value)} />
          </label>
        </div>
      </div>

      {!datos?.filas.length ? (
        <EmptyState icon={ClockCounterClockwise} title={cargando ? 'Cargando…' : 'Sin actividad'}
          description={cargando ? '' : 'No hay consultas con estos filtros.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] uppercase text-muted-foreground">
                <th className="text-left font-bold px-4 py-2.5">Cuándo</th>
                <th className="text-left font-bold px-4 py-2.5">Quién</th>
                <th className="text-left font-bold px-4 py-2.5">Conexión</th>
                <th className="text-left font-bold px-4 py-2.5">Consulta</th>
                <th className="text-left font-bold px-4 py-2.5">Qué pidió</th>
                <th className="text-left font-bold px-4 py-2.5">Resultado</th>
                <th className="text-left font-bold px-4 py-2.5">Desde</th>
              </tr>
            </thead>
            <tbody>
              {datos.filas.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fechaHora(f.created_at)}</td>
                  <td className="px-4 py-2.5">{f.persona || <span className="text-muted-foreground">usuario borrado</span>}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {f.conexion ? `Conexión: ${f.conexion}` : f.url_nombre ? `${f.url_nombre} (${f.prefijo}…)` : '—'}
                  </td>
                  <td className="px-4 py-2.5"><code className="text-[12px]">{f.herramienta}</code></td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[280px] break-words">{queConsulto(f.parametros)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {f.ok
                      ? <span className="text-emerald-600 font-semibold">Correcta</span>
                      : <span className="text-destructive" title={f.error || ''}>{(f.error || 'Error').slice(0, 70)}</span>}
                    {f.duracion_ms != null && <span className="block text-muted-foreground">{f.duracion_ms} ms</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {cliente(f.cliente)}{f.ip && <span className="block">{f.ip}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && datos.total > 0 && (
        <div className="flex items-center justify-between p-3 border-t border-border text-xs text-muted-foreground">
          <span>{datos.total} consultas</span>
          <div className="flex items-center gap-2">
            <button disabled={datos.pagina <= 1} onClick={() => setFiltros((f) => ({ ...f, pagina: (f.pagina || 1) - 1 }))}
              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-40" aria-label="Página anterior">
              <CaretLeft size={12} weight="bold" /></button>
            <span>Página {datos.pagina} de {paginas}</span>
            <button disabled={datos.pagina >= paginas} onClick={() => setFiltros((f) => ({ ...f, pagina: (f.pagina || 1) + 1 }))}
              className="h-7 w-7 inline-flex items-center justify-center rounded border border-border disabled:opacity-40" aria-label="Página siguiente">
              <CaretRight size={12} weight="bold" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
