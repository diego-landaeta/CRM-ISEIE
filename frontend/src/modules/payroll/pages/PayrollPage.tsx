import { useEffect, useState, useCallback } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Select from '@/shared/components/ui/Select';
import { Coins, Plus, X, FloppyDisk, Calendar, Clock } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import type { Project, User } from '@/shared/types';

type TabId = 'plans' | 'periods' | 'hours';

interface PayrollPlan {
  id?: number;
  user_id: number;
  user_nombre?: string;
  user_email?: string;
  modo_fijo: number | null | '';
  modo_horas: number | null | '';
  modo_comisiones: boolean;
  active?: boolean;
  notas?: string;
}

type PeriodEstado = 'abierto' | 'cerrado' | 'pagado';

interface PayrollPeriod {
  id: number;
  user_id?: number;
  user_nombre: string;
  fijo: number | string;
  monto_horas: number | string;
  monto_comisiones: number | string;
  ajustes: number | string;
  total: number | string;
  estado: PeriodEstado;
}

interface PayrollHour {
  id: number;
  user_id?: number;
  user_nombre?: string;
  fecha: string;
  horas: number | string;
  notas?: string;
}

interface HoursForm {
  user_id: string;
  fecha: string;
  horas: string;
  notas: string;
}

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'plans', label: 'Planes' },
  { id: 'periods', label: 'Periodos' },
  { id: 'hours', label: 'Horas' },
];

export default function PayrollPage() {
  const { activeProject } = useProjectContext();
  const [tab, setTab] = useState<TabId>('plans');

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Nominas" subtitle={`Plantilla y pagos en ${activeProject?.nombre || 'este proyecto'}`} />
      <div className="flex border-b border-border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`px-4 py-2 text-sm font-bold border-b-2 whitespace-nowrap ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'plans' && <PlansTab project={activeProject} />}
      {tab === 'periods' && <PeriodsTab project={activeProject} />}
      {tab === 'hours' && <HoursTab project={activeProject} />}
    </div>
  );
}

interface TabProps {
  project: Project | null | undefined;
}

function PlansTab({ project }: TabProps) {
  const [plans, setPlans] = useState<PayrollPlan[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PayrollPlan | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PayrollPlan | null>(null);

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [pl, us] = await Promise.all([
        client.get(`/payroll/plans?projectId=${project.id}`),
        client.get(`/users`),
      ]);
      if (pl.success) setPlans(Array.isArray(pl.data) ? (pl.data as PayrollPlan[]) : []);
      if (us.success) setUsers(Array.isArray(us.data) ? (us.data as User[]) : []);
    } finally { setLoading(false); }
  }, [project?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(p: PayrollPlan): Promise<void> {
    if (!project?.id) return;
    try {
      await client.put('/payroll/plans', { ...p, project_id: project.id });
      toast({ title: 'Plan guardado' });
      setEditing(null); load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  function handleDelete(p: PayrollPlan): void { setPendingDelete(p); }
  async function doDelete(): Promise<void> {
    if (!pendingDelete) return;
    try { await client.delete(`/payroll/plans/${pendingDelete.id}`); load(); }
    catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setPendingDelete(null); }
  }

  const usersWithoutPlan = users.filter(u => !plans.find(p => p.user_id === u.id));

  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        {usersWithoutPlan.length > 0 && (
          <Select<string>
            value=""
            onChange={(v) => { if (v) setEditing({ user_id: parseInt(v), modo_fijo: '', modo_horas: '', modo_comisiones: false, active: true }); }}
            options={[
              { value: '', label: 'Añadir plan a usuario...' },
              ...usersWithoutPlan.map(u => ({ value: String(u.id), label: u.nombre })),
            ]}
            ariaLabel="Añadir plan a usuario"
            className="w-56"
          />
        )}
      </div>

      {loading ? <SkeletonTable rows={4} columns={5} /> : plans.length === 0 ? (
        <EmptyState icon={Coins} title="Sin planes" description="Configura cuanto cobra cada usuario" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground"><tr>
                <th className="text-left px-4 py-2.5 font-bold">Usuario</th>
                <th className="text-right px-4 py-2.5 font-bold">Fijo €/mes</th>
                <th className="text-right px-4 py-2.5 font-bold">€/hora</th>
                <th className="text-center px-4 py-2.5 font-bold">Comisiones</th>
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3"><div className="font-semibold">{p.user_nombre}</div><div className="text-xs text-muted-foreground">{p.user_email}</div></td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.modo_fijo != null && p.modo_fijo !== '' ? Number(p.modo_fijo).toFixed(2) : '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.modo_horas != null && p.modo_horas !== '' ? Number(p.modo_horas).toFixed(2) : '—'}</td>
                    <td className="px-4 py-3 text-center">{p.modo_comisiones ? '✓' : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setEditing(p)} className="px-2 py-1 rounded bg-muted text-xs font-bold mr-1">Editar</button>
                      <button onClick={() => handleDelete(p)} className="px-2 py-1 rounded text-red-500 hover:bg-red-50 text-xs font-bold">Eliminar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {plans.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{p.user_nombre}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.user_email}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px]">
                    <span><span className="text-muted-foreground">Fijo:</span> <span className="tabular-nums font-semibold">{p.modo_fijo != null && p.modo_fijo !== '' ? Number(p.modo_fijo).toFixed(2) + ' €' : '—'}</span></span>
                    <span><span className="text-muted-foreground">€/h:</span> <span className="tabular-nums font-semibold">{p.modo_horas != null && p.modo_horas !== '' ? Number(p.modo_horas).toFixed(2) : '—'}</span></span>
                    <span><span className="text-muted-foreground">Comis:</span> <span className="font-semibold">{p.modo_comisiones ? '✓' : '—'}</span></span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <button onClick={() => setEditing(p)} className="px-2 py-1 rounded bg-muted text-[11px] font-bold w-full">Editar</button>
                  <button onClick={() => handleDelete(p)} className="px-2 py-1 rounded text-red-500 hover:bg-red-50 text-[11px] font-bold w-full">Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {editing && <PlanEditor plan={editing} users={users} onSave={handleSave} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={pendingDelete !== null} title="¿Eliminar plan?" message="Se eliminará el plan de nómina de este usuario." onConfirm={doDelete} onCancel={() => setPendingDelete(null)} />
    </div>
  );
}

interface PlanEditorProps {
  plan: PayrollPlan;
  users: User[];
  onSave: (p: PayrollPlan) => void | Promise<void>;
  onClose: () => void;
}

function PlanEditor({ plan, users, onSave, onClose }: PlanEditorProps) {
  const [p, setP] = useState<PayrollPlan>(plan);
  const usr = users.find(u => u.id === p.user_id);
  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="plan-editor-title" className="bg-card rounded-2xl border border-border max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 id="plan-editor-title" className="font-extrabold">Plan: {usr?.nombre}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded hover:bg-muted"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">Fijo €/mes (opcional)</span>
            <input type="number" step="0.01" value={p.modo_fijo ?? ''} onChange={e => setP({ ...p, modo_fijo: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">€/hora (opcional)</span>
            <input type="number" step="0.01" value={p.modo_horas ?? ''} onChange={e => setP({ ...p, modo_horas: e.target.value === '' ? null : Number(e.target.value) })} className="mt-1 w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!p.modo_comisiones} onChange={e => setP({ ...p, modo_comisiones: e.target.checked })} />
            Cobra comisiones (calculadas en modulo de comisiones)
          </label>
          {p.modo_fijo != null && p.modo_fijo !== '' && p.modo_horas != null && p.modo_horas !== '' && (
            <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">Combinacion fijo+horas es poco comun, asegurate de que es lo que quieres</p>
          )}
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">Notas</span>
            <textarea value={p.notas || ''} onChange={e => setP({ ...p, notas: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm" />
          </label>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold">Cancelar</button>
            <button onClick={() => onSave(p)} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold"><FloppyDisk size={14} weight="bold" /> Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PeriodsTab({ project }: TabProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [users, setUsers] = useState<PayrollPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [p, u] = await Promise.all([
        client.get(`/payroll/periods?projectId=${project.id}&year=${year}&month=${month}`),
        client.get(`/payroll/plans?projectId=${project.id}`),
      ]);
      if (p.success) setPeriods(Array.isArray(p.data) ? (p.data as PayrollPeriod[]) : []);
      if (u.success) setUsers(Array.isArray(u.data) ? (u.data as PayrollPlan[]) : []);
    } finally { setLoading(false); }
  }, [project?.id, year, month]);

  useEffect(() => { load(); }, [load]);

  async function generateAll(): Promise<void> {
    if (!project?.id) return;
    for (const u of users) {
      try { await client.post('/payroll/periods/generate', { project_id: project.id, user_id: u.user_id, year, month }); }
      catch { /* skip usuario si ya tiene periodo generado */ }
    }
    toast({ title: 'Periodos generados' });
    load();
  }
  async function close(p: PayrollPeriod): Promise<void> { await client.post(`/payroll/periods/${p.id}/close`); load(); }
  async function pay(p: PayrollPeriod): Promise<void> { await client.post(`/payroll/periods/${p.id}/pay`, { fecha_pago: new Date().toISOString().slice(0, 10) }); load(); }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 items-center">
        <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="h-9 w-24 px-2 rounded border border-border bg-card text-sm" />
        <Select<number>
          value={month}
          onChange={setMonth}
          options={Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
          ariaLabel="Mes"
          className="w-20"
        />
        <button onClick={generateAll} className="ml-auto px-3 py-1.5 rounded bg-primary text-white text-xs font-bold">Generar/recalcular periodos</button>
      </div>
      {loading ? <SkeletonTable rows={4} columns={8} /> : periods.length === 0 ? (
        <EmptyState icon={Calendar} title="Sin periodos" description="Genera los periodos del mes" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block bg-card border border-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground"><tr>
                <th className="text-left px-4 py-2.5 font-bold">Usuario</th>
                <th className="text-right px-4 py-2.5 font-bold">Fijo</th>
                <th className="text-right px-4 py-2.5 font-bold">Horas</th>
                <th className="text-right px-4 py-2.5 font-bold">Comisiones</th>
                <th className="text-right px-4 py-2.5 font-bold">Ajustes</th>
                <th className="text-right px-4 py-2.5 font-bold">Total</th>
                <th className="text-center px-4 py-2.5 font-bold">Estado</th>
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {periods.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-semibold">{p.user_nombre}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.fijo).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.monto_horas).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.monto_comisiones).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(p.ajustes).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold">{Number(p.total).toFixed(2)} €</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.estado === 'pagado' ? 'bg-emerald-100 text-emerald-700' : p.estado === 'cerrado' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{p.estado}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.estado === 'abierto' && <button onClick={() => close(p)} className="px-2 py-1 rounded bg-blue-600 text-white text-xs font-bold mr-1">Cerrar</button>}
                      {p.estado === 'cerrado' && <button onClick={() => pay(p)} className="px-2 py-1 rounded bg-emerald-600 text-white text-xs font-bold">Pagar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-2">
            {periods.map(p => (
              <div key={p.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${p.estado === 'pagado' ? 'bg-emerald-100 text-emerald-700' : p.estado === 'cerrado' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{p.estado}</span>
                    <span className="text-sm font-semibold truncate">{p.user_nombre}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] mt-1">
                    <span><span className="text-muted-foreground">Fijo:</span> <span className="tabular-nums font-semibold">{Number(p.fijo).toFixed(2)}</span></span>
                    <span><span className="text-muted-foreground">Horas:</span> <span className="tabular-nums font-semibold">{Number(p.monto_horas).toFixed(2)}</span></span>
                    <span><span className="text-muted-foreground">Comis:</span> <span className="tabular-nums font-semibold">{Number(p.monto_comisiones).toFixed(2)}</span></span>
                    <span><span className="text-muted-foreground">Ajustes:</span> <span className="tabular-nums font-semibold">{Number(p.ajustes).toFixed(2)}</span></span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-sm font-bold tabular-nums">{Number(p.total).toFixed(2)} €</span>
                  {p.estado === 'abierto' && <button onClick={() => close(p)} className="px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-bold w-full">Cerrar</button>}
                  {p.estado === 'cerrado' && <button onClick={() => pay(p)} className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold w-full">Pagar</button>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HoursTab({ project }: TabProps) {
  const [hours, setHours] = useState<PayrollHour[]>([]);
  const [users, setUsers] = useState<PayrollPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<HoursForm>({ user_id: '', fecha: new Date().toISOString().slice(0, 10), horas: '', notas: '' });

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const [h, p] = await Promise.all([
        client.get(`/payroll/hours?projectId=${project.id}`),
        client.get(`/payroll/plans?projectId=${project.id}`),
      ]);
      if (h.success) setHours(Array.isArray(h.data) ? (h.data as PayrollHour[]) : []);
      if (p.success) setUsers(Array.isArray(p.data) ? (p.data as PayrollPlan[]).filter(x => x.modo_horas != null && x.modo_horas !== '') : []);
    } finally { setLoading(false); }
  }, [project?.id]);

  useEffect(() => { load(); }, [load]);

  async function add(): Promise<void> {
    if (!project?.id) return;
    if (!form.user_id || !form.horas) { toast({ title: 'Usuario y horas requeridos', variant: 'destructive' }); return; }
    try {
      await client.post('/payroll/hours', { project_id: project.id, user_id: parseInt(form.user_id), fecha: form.fecha, horas: parseFloat(form.horas), notas: form.notas });
      toast({ title: 'Registrado' });
      setForm({ user_id: '', fecha: new Date().toISOString().slice(0, 10), horas: '', notas: '' });
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  async function del(h: PayrollHour): Promise<void> { await client.delete(`/payroll/hours/${h.id}`); load(); }

  return (
    <div className="space-y-3">
      <div className="bg-card border border-border rounded-2xl p-4 grid grid-cols-1 md:grid-cols-5 gap-2">
        <Select<string>
          value={form.user_id}
          onChange={(v) => setForm({ ...form, user_id: v })}
          options={[
            { value: '', label: 'Usuario' },
            ...users.map(u => ({ value: String(u.user_id), label: u.user_nombre })),
          ]}
          ariaLabel="Usuario"
        />
        <input type="date" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} className="h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
        <input type="number" step="0.25" placeholder="Horas" value={form.horas} onChange={e => setForm({ ...form, horas: e.target.value })} className="h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
        <input placeholder="Notas" value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} className="h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm md:col-span-1" />
        <button onClick={add} className="h-10 px-4 rounded-lg bg-primary text-white text-sm font-bold flex items-center justify-center gap-1"><Plus size={14} weight="bold" /> Registrar</button>
      </div>

      {loading ? <SkeletonTable rows={4} columns={5} /> : hours.length === 0 ? (
        <EmptyState icon={Clock} title="Sin horas registradas" description="Registra horas trabajadas para los usuarios con plan por hora" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-card border border-border rounded-2xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground"><tr>
                <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
                <th className="text-left px-4 py-2.5 font-bold">Usuario</th>
                <th className="text-right px-4 py-2.5 font-bold">Horas</th>
                <th className="text-left px-4 py-2.5 font-bold">Notas</th>
                <th className="px-4 py-2.5"></th>
              </tr></thead>
              <tbody>
                {hours.map(h => (
                  <tr key={h.id} className="border-b last:border-0">
                    <td className="px-4 py-3">{h.fecha}</td>
                    <td className="px-4 py-3 font-semibold">{h.user_nombre}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(h.horas).toFixed(2)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{h.notas || ''}</td>
                    <td className="px-4 py-3 text-right"><button onClick={() => del(h)} className="px-2 py-1 rounded text-red-500 hover:bg-red-50 text-xs font-bold">Eliminar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {hours.map(h => (
              <div key={h.id} className="bg-card border border-border rounded-lg p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[11px] text-muted-foreground">{h.fecha}</span>
                    <span className="text-sm font-semibold truncate">{h.user_nombre}</span>
                  </div>
                  {h.notas && <p className="text-[11px] text-muted-foreground truncate">{h.notas}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-sm font-bold tabular-nums">{Number(h.horas).toFixed(2)} h</span>
                  <button onClick={() => del(h)} className="px-2 py-1 rounded text-red-500 hover:bg-red-50 text-[11px] font-bold">Eliminar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
