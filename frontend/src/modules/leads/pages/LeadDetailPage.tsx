import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, EnvelopeSimple, Phone, WhatsappLogo,
  Trash, UserCircle, Hash, CheckCircle, WarningOctagon,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

const SpamReportDialog = lazy(() => import('../components/SpamReportDialog'));

const STATUS_MAP: Record<string, string> = {
  nuevo:          'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  por_contactar:  'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  contactado:     'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  en_seguimiento: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  convertido:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  no_interesado:  'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
};

const STATUS_OPTIONS = [
  { value: 'nuevo',          label: 'Nuevo' },
  { value: 'por_contactar',  label: 'Por contactar' },
  { value: 'contactado',     label: 'Contactado' },
  { value: 'en_seguimiento', label: 'En seguimiento' },
  { value: 'convertido',     label: 'Convertido' },
  { value: 'no_interesado',  label: 'No interesado' },
];

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${STATUS_MAP[status] || 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-2 border-b border-border last:border-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function cleanPhone(p: string | null | undefined): string {
  return (p || '').replace(/[^\d]/g, '');
}

export default function LeadDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [lead, setLead] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [spamOpen, setSpamOpen] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res: any = await client.get(`/leads/${id}`);
      setLead(res?.data || null);
    } catch (err: any) {
      toast({ title: 'No se pudo cargar el prospecto', description: err?.message || 'Error', variant: 'destructive' });
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(status: string, motivo?: string) {
    if (!lead || status === lead.status) return;
    setChanging(true);
    try {
      await client.patch(`/leads/${lead.id}/status`, {
        status,
        motivo: motivo || `Cambio manual desde ficha (${lead.status} → ${status})`,
      });
      toast({ title: 'Estado actualizado', description: STATUS_OPTIONS.find((s) => s.value === status)?.label });
      await load();
    } catch (err: any) {
      toast({ title: 'No se pudo cambiar el estado', description: err?.data?.error || err?.message || 'Error', variant: 'destructive' });
    } finally { setChanging(false); }
  }

  async function markContacted() {
    if (!lead) return;
    if (lead.status === 'contactado' || lead.status === 'en_seguimiento' || lead.status === 'convertido') {
      toast({ title: 'Ya estaba marcado como contactado' });
      return;
    }
    await changeStatus('contactado', 'Marcado como contactado desde ficha');
  }

  async function handleDelete() {
    if (!lead || !isAdmin) return;
    if (!(await confirm({ title: 'Eliminar prospecto', message: `¿Eliminar a "${lead.nombre}"? Se moverá a la papelera y podrá restaurarse por un superadmin.`, tone: 'destructive', confirmLabel: 'Eliminar' }))) return;
    try {
      await client.delete(`/leads/${lead.id}`);
      toast({ title: 'Prospecto eliminado', description: 'Movido a la papelera.' });
      navigate('/leads');
    } catch (err: any) {
      toast({ title: 'No se pudo eliminar', description: err?.message || 'Error', variant: 'destructive' });
    }
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <Link to="/leads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={12} weight="bold" /> Volver a prospectos
        </Link>
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">Cargando…</div>
      </div>
    );
  }
  if (!lead) {
    return (
      <div className="space-y-5">
        <Link to="/leads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft size={12} weight="bold" /> Volver a prospectos
        </Link>
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <h2 className="font-semibold text-lg mb-1">Prospecto no encontrado</h2>
          <p className="text-sm text-muted-foreground">El ID #{id} no existe, está eliminado o no tienes acceso.</p>
        </div>
      </div>
    );
  }

  const wa = lead.telefono ? cleanPhone(lead.telefono) : '';
  const waMsg = encodeURIComponent(`Hola ${lead.nombre || ''}, te contacto desde ISEIE…`);

  return (
    <div className="space-y-5">
      <Link to="/leads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={12} weight="bold" />
        Volver a prospectos
      </Link>

      <header className="rounded-2xl border border-border bg-card p-5 lg:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0 flex-1">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-lg font-bold flex-shrink-0">
              {(lead.nombre?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-xl font-bold tracking-tight">{lead.nombre || '—'}</h1>
                <StatusPill status={lead.status} />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Hash size={11} />{lead.id}</span>
                {lead.email && <span className="inline-flex items-center gap-1"><EnvelopeSimple size={11} />{lead.email}</span>}
                {lead.telefono && <span className="inline-flex items-center gap-1"><Phone size={11} />{lead.telefono}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
            {lead.telefono && (
              <a
                href={`tel:${cleanPhone(lead.telefono)}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium hover:bg-muted transition-colors"
              >
                <Phone size={13} weight="duotone" /> Llamar
              </a>
            )}
            {wa && (
              <a
                href={`https://wa.me/${wa}?text=${waMsg}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium hover:bg-muted transition-colors"
              >
                <WhatsappLogo size={13} weight="duotone" /> WhatsApp
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium hover:bg-muted transition-colors"
              >
                <EnvelopeSimple size={13} weight="duotone" /> Email
              </a>
            )}
            <button
              type="button"
              onClick={markContacted}
              disabled={changing}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <CheckCircle size={13} weight="bold" /> Marcar contactado
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <div className="space-y-5 min-w-0">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold tracking-tight mb-3">Datos del prospecto</h3>
            <InfoRow label="Nombre completo">{lead.nombre || '—'}</InfoRow>
            <InfoRow label="Email">{lead.email || <span className="text-muted-foreground">—</span>}</InfoRow>
            <InfoRow label="Teléfono">{lead.telefono || <span className="text-muted-foreground">—</span>}</InfoRow>
            <InfoRow label="Producto interés">{lead.producto_interes_nombre || lead.producto_interes || <span className="text-muted-foreground">—</span>}</InfoRow>
            <InfoRow label="Canal">{lead.canal_detectado || lead.canal || <span className="text-muted-foreground">Sin detectar</span>}</InfoRow>
            <InfoRow label="Responsable">{lead.responsable_nombre || <span className="text-muted-foreground">Sin asignar</span>}</InfoRow>
            <InfoRow label="Landing URL">
              {lead.landing_url
                ? <a href={lead.landing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate inline-block max-w-full">{lead.landing_url}</a>
                : <span className="text-muted-foreground">—</span>}
            </InfoRow>
            <InfoRow label="Notas">{lead.notas || <span className="text-muted-foreground italic">Sin notas</span>}</InfoRow>
            <InfoRow label="Creado">{lead.fecha_solicitud ? new Date(lead.fecha_solicitud).toLocaleString('es-ES') : '—'}</InfoRow>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-3">Asignación</h4>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {lead.responsable_nombre
                  ? lead.responsable_nombre.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
                  : <UserCircle size={18} weight="bold" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{lead.responsable_nombre || 'Sin responsable'}</div>
                <div className="text-xs text-muted-foreground truncate">{lead.responsable_email || 'Pendiente asignar'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-3">Cambiar estado</h4>
            <select
              value={lead.status}
              disabled={changing}
              onChange={(e) => changeStatus(e.target.value)}
              className="w-full h-9 px-3 rounded-md bg-card border border-border text-sm focus:outline-none focus:ring-4 focus:ring-primary/10 disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h4 className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground mb-2">Acciones</h4>
            <button
              type="button"
              onClick={() => setSpamOpen(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors"
            >
              <WarningOctagon size={12} weight="bold" />
              Reportar como spam
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={handleDelete}
                className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
              >
                <Trash size={12} weight="bold" />
                Eliminar prospecto
              </button>
            )}
          </div>
        </aside>
      </div>

      <Suspense fallback={null}>
        <SpamReportDialog
          open={spamOpen}
          onClose={() => setSpamOpen(false)}
          leadId={lead.id}
          leadNombre={lead.nombre}
          onReported={load}
        />
      </Suspense>
    </div>
  );
}
