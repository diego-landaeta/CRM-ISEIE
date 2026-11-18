import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '@/shared/api/client';
import { CheckCircle, WarningCircle, Eye, ArrowsClockwise } from '@phosphor-icons/react';

interface WebhookEvent {
  id: number;
  source: string;
  payload: Record<string, unknown>;
  status: 'success' | 'error' | 'duplicate' | 'sample_captured' | string;
  result_type: string | null;
  result_id: number | null;
  error_message: string | null;
  ip_address: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  success:          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  error:            'bg-red-500/15 text-red-700 dark:text-red-400',
  duplicate:        'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  sample_captured:  'bg-blue-500/15 text-blue-700 dark:text-blue-400',
};

export default function EventsHistory({ webhookId }: { webhookId: number }) {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  async function load() {
    // Sin id no se pide nada: saldría `/forms//events`, que el servidor no conoce.
    if (!webhookId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await client.get(`/forms/${webhookId}/events?limit=50`);
      if (res.success) setEvents((res.data as WebhookEvent[]) || []);
    } catch { /* */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [webhookId]);

  return (
    <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase text-muted-foreground">Historial de eventos recibidos</h3>
        <button onClick={load} className="flex items-center gap-1 px-2 py-1 text-xs hover:bg-muted rounded">
          <ArrowsClockwise size={12} /> Refrescar
        </button>
      </div>

      {loading && <div className="text-xs text-muted-foreground">Cargando…</div>}

      {!loading && events.length === 0 && (
        <div className="text-xs text-muted-foreground italic py-4 text-center">
          Aún no se ha recibido ningún payload en este webhook.
        </div>
      )}

      {!loading && events.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Fecha</th>
                <th className="text-left px-3 py-2 font-medium">Fuente</th>
                <th className="text-left px-3 py-2 font-medium">Estado</th>
                <th className="text-left px-3 py-2 font-medium">Resultado</th>
                <th className="text-left px-3 py-2 font-medium">IP</th>
                <th className="text-right px-3 py-2 font-medium">Ver</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <>
                  <tr key={e.id} className="border-b last:border-b-0 hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[10px] uppercase">{e.source}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_STYLES[e.status] || 'bg-muted text-muted-foreground'}`}>
                        {e.status === 'success' && <CheckCircle size={10} className="inline mr-1" />}
                        {e.status === 'error' && <WarningCircle size={10} className="inline mr-1" />}
                        {e.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {e.result_id ? (
                        // La ficha del prospecto vive en `/leads/:id`. La matricula no
                        // tiene ficha propia y se lleva a la lista: `/matriculas/:id`
                        // daba «Pagina no encontrada».
                        <Link to={e.result_type === 'lead' ? `/leads/${e.result_id}` : '/matriculas'}
                           className="text-primary hover:underline">
                          {e.result_type} #{e.result_id}
                        </Link>
                      ) : e.error_message ? (
                        <span className="text-red-500 text-[11px] truncate max-w-xs inline-block" title={e.error_message}>
                          {e.error_message.slice(0, 50)}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                      {e.ip_address || '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                        className="p-1 hover:bg-muted rounded"
                        title="Ver payload"
                      >
                        <Eye size={12} />
                      </button>
                    </td>
                  </tr>
                  {expanded === e.id && (
                    <tr key={`${e.id}-expanded`}>
                      <td colSpan={6} className="px-3 py-2 bg-muted/10">
                        <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap max-h-60">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
