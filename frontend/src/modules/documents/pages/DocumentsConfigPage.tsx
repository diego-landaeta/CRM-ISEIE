import { useEffect, useMemo, useState } from 'react';
import { Receipt, Certificate as CertificateIcon, PencilSimple, ShieldWarning, ChartBar, X, Check, EnvelopeSimple } from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts';
import PageHeader from '@/shared/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { documentsApi, type CrmDocument, type DocumentType } from '../api/documents.api';
import { toast } from '@/shared/hooks/useToast';
import client from '@/shared/api/client';

interface Project {
  id: number;
  nombre: string;
  auto_email_documents?: boolean;
}

interface CounterRow {
  projectId: number;
  projectName: string;
  type: DocumentType;
  next: number | null;
  formatted: string;
  loading: boolean;
}

interface MonthBucket {
  month: string;        // "ene 26"
  invoice: number;
  certificate: number;
}

const TYPES: ReadonlyArray<{ key: DocumentType; label: string; Icon: typeof Receipt }> = [
  { key: 'invoice', label: 'Facturas', Icon: Receipt },
  { key: 'certificate', label: 'Certificados', Icon: CertificateIcon },
];

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function buildLast12Months(): { key: string; label: string; date: Date }[] {
  const now = new Date();
  const out: { key: string; label: string; date: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({
      key,
      label: `${MONTH_LABELS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      date: d,
    });
  }
  return out;
}

export default function DocumentsConfigPage() {
  const { user, projects } = useAuth();
  const role = (user as { role?: string } | null)?.role;
  const isAdmin = role === 'superadmin' || role === 'admin';

  const [counters, setCounters] = useState<CounterRow[]>([]);
  const [docs, setDocs] = useState<CrmDocument[]>([]);
  const [editing, setEditing] = useState<CounterRow | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [autoEmail, setAutoEmail] = useState<Record<number, boolean>>({});
  const [emailSaving, setEmailSaving] = useState<Record<number, boolean>>({});

  const projectList = (projects || []) as Project[];

  // Sincroniza auto_email_documents desde el contexto cada vez que cambian los proyectos
  useEffect(() => {
    const map: Record<number, boolean> = {};
    projectList.forEach((p) => { map[p.id] = p.auto_email_documents === true; });
    setAutoEmail(map);
  }, [projectList]);

  async function toggleAutoEmail(projectId: number, next: boolean): Promise<void> {
    setAutoEmail(prev => ({ ...prev, [projectId]: next }));
    setEmailSaving(prev => ({ ...prev, [projectId]: true }));
    try {
      const res = await client.patch(`/projects/${projectId}`, { auto_email_documents: next });
      if (!res.success) throw new Error(res.error || 'No se pudo actualizar');
      toast({
        title: next ? 'Email automático activado' : 'Email automático desactivado',
        description: next ? 'Las facturas y certificados se enviarán al cliente al generarse.' : 'Los documentos solo se generarán; el envío será manual.',
      });
    } catch (e: unknown) {
      setAutoEmail(prev => ({ ...prev, [projectId]: !next }));
      const msg = e instanceof Error ? e.message : 'Error desconocido';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setEmailSaving(prev => ({ ...prev, [projectId]: false }));
    }
  }

  // Carga peek + lista de docs por (proyecto × tipo)
  useEffect(() => {
    if (!isAdmin || projectList.length === 0) return;
    let cancelled = false;

    (async () => {
      const init: CounterRow[] = projectList.flatMap(p =>
        TYPES.map(t => ({
          projectId: p.id,
          projectName: p.nombre,
          type: t.key,
          next: null,
          formatted: '',
          loading: true,
        })),
      );
      if (!cancelled) setCounters(init);

      // Peek por cada combo
      const peekResults = await Promise.all(
        init.map(async (r) => {
          try {
            const res = await documentsApi.nextNumber(r.projectId, r.type);
            if (res.success && res.data) {
              return { ...r, next: res.data.number, formatted: res.data.formatted, loading: false };
            }
            return { ...r, loading: false };
          } catch {
            return { ...r, loading: false };
          }
        }),
      );
      if (cancelled) return;
      setCounters(peekResults);

      // Listado de docs (para el histograma) — todos los proyectos, sin filtrar tipo
      const listResults = await Promise.all(
        projectList.map(async (p) => {
          try {
            const res = await documentsApi.list(p.id);
            return res.success && res.data ? res.data : [];
          } catch { return []; }
        }),
      );
      if (cancelled) return;
      setDocs(listResults.flat());
    })();

    return () => { cancelled = true; };
  }, [isAdmin, projectList]);

  // Agregación últimos 12 meses
  const histogram: MonthBucket[] = useMemo(() => {
    const months = buildLast12Months();
    const buckets = new Map<string, MonthBucket>();
    months.forEach(m => buckets.set(m.key, { month: m.label, invoice: 0, certificate: 0 }));
    docs.forEach((d) => {
      const created = new Date(d.created_at);
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      const b = buckets.get(key);
      if (!b) return;
      if (d.type === 'invoice') b.invoice++;
      else if (d.type === 'certificate') b.certificate++;
    });
    return months.map(m => buckets.get(m.key)!);
  }, [docs]);

  function openEdit(row: CounterRow): void {
    setEditing(row);
    setEditValue(row.next != null ? String(row.next) : '1');
  }

  async function saveOverride(): Promise<void> {
    if (!editing) return;
    const v = parseInt(editValue, 10);
    if (!Number.isFinite(v) || v < 1) {
      toast({ title: 'Número inválido', description: 'Debe ser un entero ≥ 1', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await documentsApi.setNumber(editing.projectId, editing.type, v);
      if (res.success) {
        setCounters(prev => prev.map(r => (
          r.projectId === editing.projectId && r.type === editing.type
            ? { ...r, next: v, formatted: formatNumber(v, editing.type) }
            : r
        )));
        toast({ title: 'Contador actualizado', description: `Próximo número: ${formatNumber(v, editing.type)}` });
        setEditing(null);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo actualizar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6 pb-8">
        <PageHeader title="Configuración de documentos" subtitle="Numeración de facturas y certificados" />
        <div className="bg-card border border-border rounded-xl p-8 flex items-start gap-4">
          <ShieldWarning size={28} className="text-amber-500 shrink-0" />
          <div>
            <h2 className="font-semibold">Acceso restringido</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Solo Administradores y Superadmin pueden gestionar la configuración de documentos.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Configuración de documentos"
        subtitle="Próximo número de factura/certificado por proyecto y resumen de emisión"
      />

      {/* Counters por proyecto */}
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 mb-3 px-1">
          Numeración por proyecto
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          {projectList.map((p) => {
            const rows = counters.filter(c => c.projectId === p.id);
            return (
              <article key={p.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30">
                  <h4 className="font-semibold text-sm">{p.nombre}</h4>
                </div>
                <div className="divide-y divide-border">
                  {rows.length === 0 && (
                    <div className="px-4 py-3 text-xs text-muted-foreground">Cargando…</div>
                  )}
                  {rows.map((r) => {
                    const meta = TYPES.find(t => t.key === r.type)!;
                    const Icon = meta.Icon;
                    return (
                      <div key={`${r.projectId}-${r.type}`} className="px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <Icon size={16} weight="duotone" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-muted-foreground">{meta.label}</div>
                          <div className="font-semibold text-sm tabular-nums">
                            {r.loading
                              ? <span className="text-muted-foreground">—</span>
                              : (r.formatted || '—')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={r.loading || r.next == null}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-xs font-medium border border-border bg-card hover:bg-muted transition-colors disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          title="Editar próximo número"
                        >
                          <PencilSimple size={12} /> Editar
                        </button>
                      </div>
                    );
                  })}
                  <div className="px-4 py-3 flex items-center gap-3 bg-muted/20">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <EnvelopeSimple size={16} weight="duotone" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">Email automático</div>
                      <div className="text-[11px] text-muted-foreground/80">
                        {autoEmail[p.id]
                          ? 'Envía la factura/certificado al cliente al generarse.'
                          : 'Solo se genera el PDF; el envío será manual.'}
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!autoEmail[p.id]}
                        disabled={!!emailSaving[p.id]}
                        onChange={(e) => toggleAutoEmail(p.id, e.target.checked)}
                        aria-label={`Email automático para ${p.nombre}`}
                      />
                      <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-emerald-500 peer-checked:after:translate-x-5 after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all" />
                    </label>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Histograma 12m */}
      <section className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <ChartBar size={16} className="text-primary" weight="duotone" />
          <h3 className="font-semibold text-sm">Documentos emitidos · últimos 12 meses</h3>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogram} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
              <Bar dataKey="invoice" name="Facturas" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="certificate" name="Certificados" fill="#C9A84C" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Modal de edición */}
      {editing && (
        <EditCounterDialog
          row={editing}
          value={editValue}
          onChange={setEditValue}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={saveOverride}
        />
      )}
    </div>
  );
}

function formatNumber(n: number, type: DocumentType): string {
  const prefix = type === 'invoice' ? 'FAC' : 'CERT';
  return `${prefix}-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`;
}

interface EditCounterDialogProps {
  row: CounterRow;
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function EditCounterDialog({ row, value, onChange, saving, onCancel, onSave }: EditCounterDialogProps) {
  const meta = TYPES.find(t => t.key === row.type)!;
  const v = parseInt(value, 10);
  const preview = Number.isFinite(v) && v >= 1 ? formatNumber(v, row.type) : '—';
  const goingDown = Number.isFinite(v) && row.next != null && v < row.next;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <h2 className="font-semibold text-sm">Editar próximo {meta.label.toLowerCase().slice(0, -1)}</h2>
          <button type="button" onClick={onCancel} aria-label="Cerrar"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="text-xs text-muted-foreground">
            Proyecto: <span className="font-medium text-foreground">{row.projectName}</span>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Próximo número</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                {row.type === 'invoice' ? 'FAC' : 'CERT'}-{new Date().getFullYear()}-
              </span>
              <input
                type="number"
                min="1"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                disabled={saving}
                autoFocus
                aria-label="Próximo número"
                placeholder="194"
                className="w-32 h-9 px-2 rounded-md border border-border bg-muted/50 text-sm tabular-nums font-semibold text-center outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50"
              />
            </div>
          </div>
          <div className="text-xs">
            Resultado: <span className="font-semibold tabular-nums">{preview}</span>
          </div>
          {goingDown && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md p-3 flex items-start gap-2">
              <ShieldWarning size={14} className="shrink-0 mt-0.5" />
              <span>
                Vas a retroceder el contador. Si ya existe un documento con número <strong>{preview}</strong>,
                el siguiente intento de generar fallará por conflicto único.
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Check size={14} />
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
