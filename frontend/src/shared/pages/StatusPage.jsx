import { useEffect, useState } from 'react';
import { Pulse, CheckCircle, WarningCircle, XCircle, ArrowClockwise } from '@phosphor-icons/react';
import client from '@/shared/api/client';
// Los dos bloques nuevos. Se AÑADEN a lo que esta pantalla ya tenia
// —Componentes e Incidencias—; no lo sustituyen.
import PiezasDelSistema from '@/modules/status/components/PiezasDelSistema';
import CorreosEnviados from '@/modules/status/components/CorreosEnviados';

const STATUS_META = {
  operational: { label: 'Operativo',    tone: 'green',  Icon: CheckCircle },
  degraded:    { label: 'Degradado',    tone: 'amber',  Icon: WarningCircle },
  partial:     { label: 'Parcial',      tone: 'amber',  Icon: WarningCircle },
  major:       { label: 'Caído',        tone: 'rose',   Icon: XCircle },
  maintenance: { label: 'Mantenimiento', tone: 'sky',   Icon: ArrowClockwise },
};

const TONE_CLASS = {
  green: 'text-[hsl(var(--iseie-green))] bg-[hsl(var(--iseie-green))]/10 ring-[hsl(var(--iseie-green))]/20',
  amber: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-amber-200/40 dark:ring-amber-900/50',
  rose:  'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 ring-rose-200/40 dark:ring-rose-900/50',
  sky:   'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30 ring-sky-200/40 dark:ring-sky-900/50',
};

export default function StatusPage() {
  const [components, setComponents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [comps, incs] = await Promise.all([
          client.get('/status/components').then((r) => Array.isArray(r?.data) ? r.data : []).catch(() => []),
          client.get('/status/incidents?status=active').then((r) => Array.isArray(r?.data) ? r.data : []).catch(() => []),
        ]);
        if (!cancelled) {
          setComponents(comps);
          setIncidents(incs);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const allOperational = components.length > 0 && components.every((c) => c.status === 'operational');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Estado del sistema</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitoreo en tiempo real de los servicios del CRM.
        </p>
      </header>

      {/* Banner resumen */}
      <div className={`rounded-2xl border p-5 flex items-center gap-4 ${allOperational ? 'border-[hsl(var(--iseie-green))]/30 bg-[hsl(var(--iseie-green))]/5' : 'border-border bg-card'}`}>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center ring-2 ${allOperational ? TONE_CLASS.green : 'bg-muted text-muted-foreground ring-border'}`}>
          {allOperational ? <CheckCircle size={22} weight="fill" /> : <Pulse size={22} weight="duotone" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold tracking-tight">
            {allOperational ? 'Todos los sistemas operativos' : loading ? 'Cargando estado...' : 'Hay incidencias activas'}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Actualizado {new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>

      {/* Componentes */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Componentes</h2>
        <div className="rounded-2xl border border-border bg-card divide-y divide-border">
          {loading && (
            <div className="p-6 text-sm text-muted-foreground text-center">Cargando componentes...</div>
          )}
          {!loading && components.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground text-center">
              Sin componentes registrados. Configura los componentes en la base de datos para verlos aquí.
            </div>
          )}
          {components.map((c) => {
            const meta = STATUS_META[c.status] || STATUS_META.operational;
            const Icon = meta.Icon;
            return (
              <div key={c.id} className="flex items-center gap-3 p-4">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center ${TONE_CLASS[meta.tone]}`}>
                  <Icon size={16} weight="fill" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{c.name}</div>
                  <div className="text-[11px] text-muted-foreground">/{c.slug}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ring-1 ${TONE_CLASS[meta.tone]}`}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Incidencias activas */}
      {incidents.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Incidencias activas</h2>
          <div className="space-y-2">
            {incidents.map((i) => (
              <div key={i.id} className="rounded-2xl border border-amber-200/40 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/15 p-4">
                <div className="font-semibold text-sm mb-1">{i.title}</div>
                {i.description && <p className="text-xs text-muted-foreground leading-relaxed">{i.description}</p>}
                <div className="text-[10px] text-muted-foreground/80 mt-2 uppercase tracking-wider">
                  Severidad: {i.severity} · Estado: {i.status}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <PiezasDelSistema />

      <CorreosEnviados />
    </div>
  );
}
