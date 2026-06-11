import { useState, useEffect, useMemo } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { CurrencyEur, TrendUp, Receipt, CheckCircle } from '@phosphor-icons/react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '@/shared/lib/format';

type TipoPago = 'pago_completo' | 'abono_parcial' | string;

interface Conversion {
  id: number;
  lead_nombre?: string | null;
  lead?: string | null;
  producto_contratado?: string | null;
  importe_total: number | string;
  tipo_pago?: TipoPago | null;
  fecha_conversion: string;
}

interface MonthlyPoint {
  mes: string;
  ingresos: number;
}

const TIPO_STYLES: Record<string, string> = {
  pago_completo: 'bg-emerald-50 text-emerald-600',
  abono_parcial: 'bg-amber-50 text-amber-600',
};

function fmt(n: number | string | null | undefined): string {
  return formatNumber(n);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 text-white text-xs font-semibold px-3 py-2 rounded-lg">
      {label}: <span className="text-emerald-300">{fmt(payload[0].value)} €</span>
    </div>
  );
}

export default function RevenuePage() {
  const { activeProject } = useProjectContext();
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeProject?.id) return;
    setLoading(true);
    client.get(`/conversions?projectId=${activeProject.id}&limit=100`)
      .then(res => { if (res.success) setConversions((res.data as Conversion[]) || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeProject?.id]);

  const stats = useMemo(() => {
    const now = new Date();
    const mesActual = now.getMonth();
    const anioActual = now.getFullYear();
    const estesMes = conversions.filter(c => {
      const d = new Date(c.fecha_conversion);
      return d.getMonth() === mesActual && d.getFullYear() === anioActual;
    });
    const ingresosMes = estesMes.reduce((s, c) => s + Number(c.importe_total || 0), 0);
    const convertidoMes = estesMes.length;
    const ticketMedio = convertidoMes > 0 ? ingresosMes / convertidoMes : 0;
    return { ingresosMes, convertidoMes, ticketMedio };
  }, [conversions]);

  const monthly = useMemo<MonthlyPoint[]>(() => {
    const map: Record<string, MonthlyPoint> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
      map[key] = { mes: key, ingresos: 0 };
    }
    conversions.forEach(c => {
      const d = new Date(c.fecha_conversion);
      const key = d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
      if (map[key]) map[key].ingresos += Number(c.importe_total || 0);
    });
    return Object.values(map);
  }, [conversions]);

  const recent = conversions.slice(0, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ingresos"
        subtitle={`Conversiones, pagos y evolución${activeProject?.nombre ? ' — ' + activeProject.nombre : ''}`}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card p-6 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-md bg-emerald-50 flex items-center justify-center text-emerald-600"><CurrencyEur size={20} weight="regular" /></div>
            <span className="text-[10px] font-bold bg-emerald-50 text-emerald-600 px-2 py-1 rounded-full flex items-center gap-1"><TrendUp size={12} weight="bold" />Este mes</span>
          </div>
          <p className="text-xs text-muted-foreground">Ingresos del mes</p>
          <h3 className="text-3xl font-semibold mt-1">{fmt(stats.ingresosMes)} &euro;</h3>
        </div>
        <div className="bg-card p-6 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-md bg-violet-50 flex items-center justify-center text-violet-600"><CheckCircle size={20} weight="regular" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Conversiones del mes</p>
          <h3 className="text-3xl font-semibold mt-1">{stats.convertidoMes}</h3>
        </div>
        <div className="bg-card p-6 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="w-10 h-10 rounded-md bg-blue-50 flex items-center justify-center text-blue-600"><Receipt size={20} weight="regular" /></div>
          </div>
          <p className="text-xs text-muted-foreground">Ticket medio</p>
          <h3 className="text-3xl font-semibold mt-1">{fmt(stats.ticketMedio)} &euro;</h3>
        </div>
      </div>

      <div className="bg-card p-6 rounded-lg border border-border">
        <div className="mb-6">
          <h3 className="font-semibold">Evolucion de Ingresos</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Ultimos 6 meses</p>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={monthly}>
            <defs>
              <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#059669" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#059669" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
            <XAxis dataKey="mes" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#a1a1aa', fontWeight: 600 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#a1a1aa' }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="ingresos" stroke="#059669" strokeWidth={2.5} fill="url(#colorIngresos)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <div className="p-5">
          <h3 className="font-semibold">Conversiones Recientes</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">Ultimos pagos registrados</p>
        </div>
        {loading ? (
          <SkeletonTable rows={4} columns={5} className="border-0 rounded-none" />
        ) : recent.length === 0 ? (
          <div className="px-5 py-12 text-center text-muted-foreground">No hay conversiones para este proyecto aun.</div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 border-y">
                  <tr>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Lead</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Producto</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Monto</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Tipo</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="px-5 py-3 font-semibold">{c.lead_nombre || c.lead || '—'}</td>
                      <td className="px-5 py-3 text-muted-foreground">{c.producto_contratado || '—'}</td>
                      <td className="px-5 py-3 font-bold">{fmt(c.importe_total)} &euro;</td>
                      <td className="px-5 py-3">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${TIPO_STYLES[c.tipo_pago] || 'bg-muted text-muted-foreground'}`}>
                          {c.tipo_pago === 'pago_completo' ? 'Completo' : c.tipo_pago === 'abono_parcial' ? 'Parcial' : c.tipo_pago || '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{fmtDate(c.fecha_conversion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y">
              {recent.map((c) => (
                <div key={c.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">{c.lead_nombre || '—'}</span>
                    <span className="text-[13px] font-bold">{fmt(c.importe_total)} &euro;</span>
                  </div>
                  <p className="text-[13px] text-muted-foreground">{c.producto_contratado || '—'}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${TIPO_STYLES[c.tipo_pago] || 'bg-muted text-muted-foreground'}`}>
                      {c.tipo_pago === 'pago_completo' ? 'Completo' : 'Parcial'}
                    </span>
                    <span className="text-[12px] text-muted-foreground ml-auto">{fmtDate(c.fecha_conversion)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
