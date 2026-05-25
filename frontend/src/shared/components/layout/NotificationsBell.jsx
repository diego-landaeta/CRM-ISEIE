import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, BellRinging, ArrowRight } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import client from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';

function fmtRelative(date) {
  if (!date) return '';
  const d = new Date(date);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export default function NotificationsBell({ collapsed = false, className = '' }) {
  const navigate = useNavigate();
  const { user, activeProject } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const popoverRef = useRef(null);

  const canSee = user?.role === 'admin' || user?.role === 'superadmin';

  // Items derivados de /leads/today + leads nuevos. Cuando exista /api/notifications real, este efecto lo consume.
  useEffect(() => {
    if (!canSee || !activeProject?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [todayRes, leadsRes] = await Promise.all([
          client.get(`/leads/today`, { params: { projectId: activeProject.id } }).catch(() => ({ success: false, data: null })),
          client.get(`/leads`, { params: { projectId: activeProject.id, status: 'nuevo', limit: 3 } }).catch(() => ({ success: false, data: [] })),
        ]);
        if (cancelled) return;
        const list = [];
        const today = todayRes.success ? todayRes.data : null;

        if (today?.reminders_pendientes) {
          for (const r of today.reminders_pendientes.filter((x) => x.vencido).slice(0, 3)) {
            list.push({
              id: `rem-${r.id}`,
              kind: 'overdue',
              title: 'Recordatorio vencido',
              body: `${r.lead_nombre}: ${r.nota || 'sin nota'}`,
              href: `/leads/${r.lead_id}`,
              when: r.fecha_recordatorio,
            });
          }
        }
        if (today?.cobros_vencidos > 0) {
          list.push({
            id: 'cobros',
            kind: 'urgent',
            title: 'Cobros vencidos',
            body: `${today.cobros_vencidos} pagos atrasados pendientes`,
            href: '/accounting/receivable',
            when: new Date().toISOString(),
          });
        }
        const leadsList = Array.isArray(leadsRes?.data) ? leadsRes.data : [];
        for (const l of leadsList.slice(0, 2)) {
          list.push({
            id: `lead-${l.id}`,
            kind: 'info',
            title: 'Nuevo prospecto',
            body: `${l.nombre} — ${l.email || 'sin email'}`,
            href: `/leads/${l.id}`,
            when: l.created_at,
          });
        }
        setItems(list);
      } catch {
        // Silent fail
      }
    })();
    return () => { cancelled = true; };
  }, [canSee, activeProject?.id]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    function compute() {
      const rect = buttonRef.current.getBoundingClientRect();
      const margin = 8;
      const desiredWidth = 340;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(desiredWidth, vw - margin * 2);
      let top = rect.bottom + 6;
      let left = rect.right - width;
      if (left < margin) left = margin;
      if (left + width + margin > vw) left = vw - width - margin;
      const maxHeight = 360;
      if (top + maxHeight + margin > vh && rect.top > maxHeight) {
        top = rect.top - 6 - maxHeight;
      }
      setPos({ top, left, width });
    }
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (buttonRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canSee) return null;

  const unread = items.length;
  const Icon = unread > 0 ? BellRinging : Bell;

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notificaciones${unread > 0 ? ` (${unread} sin leer)` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Notificaciones"
        className={cn(
          'relative p-2 rounded-md transition-colors flex-shrink-0',
          open ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
          collapsed && 'w-full flex justify-center',
          className,
        )}
      >
        <Icon size={16} weight={unread > 0 ? 'fill' : 'regular'} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && pos && (
        <Portal>
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Notificaciones"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="bg-card border border-border rounded-xl shadow-2xl z-[60] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="font-semibold text-sm">Notificaciones</h3>
                <p className="text-[11px] text-muted-foreground">
                  {unread === 0 ? 'Todo al día' : `${unread} sin atender`}
                </p>
              </div>
              <button
                onClick={() => { setOpen(false); navigate('/notificaciones'); }}
                className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1"
              >
                Ver todas <ArrowRight size={10} weight="bold" />
              </button>
            </header>

            <div className="max-h-[360px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <Bell size={28} className="mx-auto text-muted-foreground/40 mb-2" weight="thin" />
                  <p className="text-xs text-muted-foreground">No tienes notificaciones nuevas</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((it) => (
                    <li key={it.id}>
                      <button
                        onClick={() => { setOpen(false); navigate(it.href); }}
                        className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-start gap-3"
                      >
                        <span className={cn(
                          'w-2 h-2 rounded-full mt-1.5 flex-shrink-0',
                          it.kind === 'overdue' ? 'bg-red-500' : it.kind === 'urgent' ? 'bg-amber-500' : 'bg-blue-500',
                        )} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-tight">{it.title}</p>
                          <p className="text-xs text-muted-foreground truncate">{it.body}</p>
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">{fmtRelative(it.when)}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
