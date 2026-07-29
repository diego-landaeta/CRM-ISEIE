// Hasta que dia esta la facturacion al dia.
//
// Los cobros de Stripe se asocian solos, pero su factura no sale hasta que
// quien lleva la facturacion mueve esta fecha. Si no, la numeracion se
// adelantaria a las facturas que se estan metiendo a mano y ya no habria forma
// de recolocarla sin tocar numeros ya presentados.
import { useEffect, useState, useCallback } from 'react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import { CalendarCheck, Clock, FloppyDisk } from '@phosphor-icons/react';

type Proforma = {
  id: number; total: number | string; created_at: string;
  conversion_id: number | null; cliente_nombre: string | null; creada_por: string | null;
};

type ColaItem = {
  payment_id: number; conversion_id: number; fecha: string; importe: number;
  cliente: string | null; producto: string | null; dentro_del_corte: boolean;
};
type PorDia = { dia: string; cobros: number; importe: number };

type Estado = {
  al_dia_hasta: string | null;
  updated_at: string | null;
  updated_by_nombre?: string | null;
  pagos_sin_factura: number;
  importe_sin_factura: number;
  listos_para_emitir: number;
  cola?: ColaItem[];
  por_dia?: PorDia[];
  proformas_pendientes?: Proforma[];
  stripe_ok_hasta?: string | null;
};

function fmt(n: unknown) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
}
function fecha(d: unknown) {
  return d ? new Date(String(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export default function FacturacionAlDiaCard({ projectId }: { projectId?: number | null }) {
  const { user } = useAuth() as { user?: { role?: string; factura_manager?: boolean } };
  const puedeMover = !!user?.factura_manager || user?.role === 'superadmin';
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await client.get<Estado>(`/invoices/facturacion-al-dia?projectId=${projectId}`);
      if (r.success) {
        setEstado(r.data);
        setValor(r.data.al_dia_hasta ? String(r.data.al_dia_hasta).slice(0, 10) : '');
      }
    } catch { /* si falla, la tarjeta simplemente no se muestra */ }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar() {
    if (!projectId || !valor) return;
    setGuardando(true);
    try {
      const r = await client.put<{ emitidas: number; fallidas: unknown[] }>(
        '/invoices/facturacion-al-dia', { projectId, alDiaHasta: valor },
      );
      if (r.success) {
        const n = r.data?.emitidas || 0;
        toast({
          title: 'Facturación al día actualizada',
          description: n > 0
            ? `Se han emitido ${n} factura${n === 1 ? '' : 's'} que estaban esperando.`
            : 'No había ninguna factura esperando dentro de esa fecha.',
        });
        cargar();
      }
    } catch (err) {
      toast({
        title: 'No se pudo actualizar',
        description: (err as { data?: { error?: string } })?.data?.error || 'Error desconocido',
        variant: 'destructive',
      });
    } finally { setGuardando(false); }
  }

  const [aprobando, setAprobando] = useState<number | null>(null);

  async function aprobar(id: number) {
    setAprobando(id);
    try {
      // Al emitirla se le asigna su numero: hasta ahora no gastaba correlativo.
      const r = await client.post(`/invoices/${id}/emitir`, {});
      if (r.success) {
        toast({ title: 'Proforma aprobada', description: 'Ya tiene su número y aparece en el listado.' });
        cargar();
      }
    } catch (err) {
      toast({
        title: 'No se pudo aprobar',
        description: (err as { data?: { error?: string } })?.data?.error || 'Error desconocido',
        variant: 'destructive',
      });
    } finally { setAprobando(null); }
  }

  if (!estado) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <CalendarCheck size={16} weight="bold" /> Facturación al día
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-[46ch]">
            Los cobros se asocian solos, pero su factura no se emite hasta esta fecha.
            Así la numeración no se adelanta a lo que se está facturando a mano.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Al día hasta</p>
          <p className="text-lg font-bold tabular-nums">{fecha(estado.al_dia_hasta)}</p>
          {estado.updated_at && (
            <p className="text-[10px] text-muted-foreground">
              {estado.updated_by_nombre ? `${estado.updated_by_nombre} · ` : ''}{fecha(estado.updated_at)}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 text-sm">
        <div className="bg-muted/40 rounded-md p-3">
          <p className="text-[11px] text-muted-foreground">Cobros esperando factura</p>
          <p className="font-bold tabular-nums mt-0.5">{estado.pagos_sin_factura}</p>
        </div>
        <div className="bg-muted/40 rounded-md p-3">
          <p className="text-[11px] text-muted-foreground">Importe en espera</p>
          <p className="font-bold tabular-nums mt-0.5">{fmt(estado.importe_sin_factura)}</p>
        </div>
        <div className="bg-muted/40 rounded-md p-3">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock size={11} weight="bold" /> Listos para emitir
          </p>
          <p className={`font-bold tabular-nums mt-0.5 ${estado.listos_para_emitir > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
            {estado.listos_para_emitir}
          </p>
        </div>
      </div>

      {(estado.por_dia?.length || 0) > 0 && (
        <div className="mt-4">
          <h4 className="text-[11px] font-bold text-muted-foreground mb-2">
            Cobros esperando factura, por día
          </h4>
          <div className="flex gap-1.5 flex-wrap">
            {estado.por_dia!.map((d) => {
              const dentro = !!estado.al_dia_hasta && d.dia <= String(estado.al_dia_hasta).slice(0, 10);
              return (
                <span
                  key={d.dia}
                  title={`${d.cobros} cobro${d.cobros === 1 ? '' : 's'} · ${fmt(d.importe)}`}
                  className={`text-[11px] px-2 py-1 rounded font-semibold tabular-nums ${
                    dentro
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                  }`}
                >
                  {d.dia.slice(8)}/{d.dia.slice(5, 7)} · {d.cobros}
                </span>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">
            En verde lo que ya entra dentro del corte; en ámbar lo que todavía espera.
          </p>
        </div>
      )}

      {(estado.cola?.length || 0) > 0 && (
        <div className="mt-3">
          <h4 className="text-[11px] font-bold text-muted-foreground mb-2">
            Cobros en cola ({estado.cola!.length})
          </h4>
          <div className="max-h-56 overflow-auto border border-border rounded-md">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1.5 font-bold">Fecha</th>
                  <th className="text-left px-2 py-1.5 font-bold">Cliente</th>
                  <th className="text-right px-2 py-1.5 font-bold">Importe</th>
                  <th className="text-left px-2 py-1.5 font-bold">Estado</th>
                </tr>
              </thead>
              <tbody>
                {estado.cola!.map((c) => (
                  <tr key={c.payment_id} className="border-b border-border/50 last:border-0">
                    <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{fecha(c.fecha)}</td>
                    <td className="px-2 py-1.5 truncate max-w-[180px]">{c.cliente || '—'}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(c.importe)}</td>
                    <td className="px-2 py-1.5">
                      <span className={c.dentro_del_corte
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-amber-600 dark:text-amber-400'}>
                        {c.dentro_del_corte ? 'lista para emitir' : 'esperando el corte'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(estado.proformas_pendientes?.length || 0) > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h4 className="text-[11px] font-bold text-amber-600 dark:text-amber-400 mb-2">
            Proformas esperando visto bueno ({estado.proformas_pendientes!.length})
          </h4>
          <div className="space-y-1.5">
            {estado.proformas_pendientes!.map((pf) => (
              <div key={pf.id} className="flex items-center justify-between gap-3 bg-amber-50/60 dark:bg-amber-950/10 rounded-md px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold truncate">{pf.cliente_nombre || 'Sin nombre'}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {pf.creada_por ? `${pf.creada_por} · ` : ''}{fecha(pf.created_at)}
                  </p>
                </div>
                <span className="text-[12px] font-bold tabular-nums">{fmt(pf.total)}</span>
                {puedeMover && (
                  <button
                    type="button"
                    onClick={() => aprobar(pf.id)}
                    disabled={aprobando === pf.id}
                    className="h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-40 whitespace-nowrap"
                  >
                    {aprobando === pf.id ? 'Aprobando…' : 'Aprobar y emitir'}
                  </button>
                )}
              </div>
            ))}
          </div>
          {!puedeMover && (
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Las aprueba quien gestiona la facturación.
            </p>
          )}
        </div>
      )}

      {puedeMover ? (
        <div className="flex items-end gap-2 mt-4 flex-wrap">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
              Mover el corte hasta
            </label>
            <input
              type="date"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm"
            />
          </div>
          <button
            type="button"
            onClick={guardar}
            disabled={guardando || !valor || valor === (estado.al_dia_hasta || '').slice(0, 10)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40"
          >
            <FloppyDisk size={14} weight="bold" />
            {guardando ? 'Emitiendo…' : 'Guardar y emitir lo que espera'}
          </button>
          <p className="text-[11px] text-muted-foreground w-full">
            Al guardar se emiten, por orden de fecha, las facturas de los cobros que ya entren dentro del corte.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground mt-4">
          Solo quien gestiona la facturación puede mover esta fecha.
        </p>
      )}
    </div>
  );
}
