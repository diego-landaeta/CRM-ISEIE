import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { Bell, CheckCircle, Checks } from '@phosphor-icons/react';

interface Notif {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link_path: string | null;
  is_read: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Listado completo de notificaciones del usuario (lo que abre "Ver todas").
export default function NotificationsList() {
  const [items, setItems] = useState<Notif[] | null>(null);
  const [marking, setMarking] = useState(false);
  const navigate = useNavigate();

  async function load() {
    const res = await client.get<Notif[]>('/notifications', { params: { limit: 100 } }).catch(() => ({ success: false, data: [] as Notif[] }));
    if (res.success) setItems(res.data || []);
    else setItems([]);
  }
  useEffect(() => { load(); }, []);

  async function open(n: Notif) {
    if (!n.is_read) { try { await client.patch(`/notifications/${n.id}/read`); } catch { /* noop */ } }
    if (n.link_path) navigate(n.link_path);
    else load();
  }

  async function markAll() {
    setMarking(true);
    try { await client.patch('/notifications/mark-all-read'); await load(); } catch { /* noop */ } finally { setMarking(false); }
  }

  const unread = (items || []).filter(n => !n.is_read).length;

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 h-12 border-b border-border">
        <div className="flex items-center gap-2">
          <Bell size={16} weight="duotone" className="text-primary" />
          <h3 className="text-sm font-bold">Todas las notificaciones</h3>
          {unread > 0 && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{unread} sin leer</span>}
        </div>
        {unread > 0 && (
          <button onClick={markAll} disabled={marking}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted disabled:opacity-50">
            <Checks size={13} weight="bold" /> {marking ? 'Marcando…' : 'Marcar todas como leídas'}
          </button>
        )}
      </div>

      {items === null ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No tienes notificaciones.</div>
      ) : (
        <ul className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {items.map(n => (
            <li key={n.id}>
              <button onClick={() => open(n)}
                className={`w-full text-left px-4 py-3 flex gap-3 hover:bg-muted/40 transition-colors ${n.is_read ? '' : 'bg-primary/[0.03]'}`}>
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${n.is_read ? 'bg-transparent border border-border' : 'bg-primary'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${n.is_read ? 'font-medium text-foreground' : 'font-bold text-foreground'}`}>{n.title}</span>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                </div>
                {n.is_read && <CheckCircle size={13} weight="fill" className="text-emerald-500 mt-1 flex-shrink-0" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
