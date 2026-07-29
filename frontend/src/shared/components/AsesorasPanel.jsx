// Panel de asesoras: los NÚMEROS, no el listado.
//
// Por asesora y mes: cuántos leads le entraron, cuántas ventas cerró, su tasa
// de conversión, lo vendido y lo cobrado ESE mes. El detalle venta a venta se
// baja desde Reportes descargables.
//
// Ojo con las tres fechas, que son distintas: los leads cuentan por su fecha de
// entrada, las ventas por su fecha de venta y los cobros por su fecha de cobro.
// Por eso una asesora puede cobrar en julio una venta que cerró en mayo.
import { useEffect, useMemo, useState } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { UsersThree, CaretDown, CaretRight } from '@phosphor-icons/react';

function fmtMoney(n) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(Number(n || 0));
}
function nombreMes(mes) {
  const [a, m] = String(mes).split('-');
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${nombres[Number(m) - 1] || mes} ${a}`;
}

export default function AsesorasPanel({ from, to }) {
  const { activeProject } = useProjectContext();
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      try {
        const p = new URLSearchParams();
        if (activeProject?.id) p.set('projectId', String(activeProject.id));
        if (from) p.set('from', from);
        if (to) p.set('to', to);
        const r = await client.get(`/reports/asesoras-mes?${p.toString()}`);
        if (vivo) setFilas(r.success ? (r.data || []) : []);
      } catch {
        if (vivo) setFilas([]);
      } finally { if (vivo) setCargando(false); }
    })();
    return () => { vivo = false; };
  }, [activeProject?.id, from, to]);

  // Agrupado por mes, con el total del mes calculado sobre sus asesoras.
  const meses = useMemo(() => {
    const acc = {};
    for (const f of filas) {
      acc[f.mes] = acc[f.mes] || { mes: f.mes, asesoras: [], leads: 0, ventas: 0, vendido: 0, cobrado: 0 };
      acc[f.mes].asesoras.push(f);
      acc[f.mes].leads += Number(f.leads || 0);
      acc[f.mes].ventas += Number(f.ventas || 0);
      acc[f.mes].vendido += Number(f.vendido || 0);
      acc[f.mes].cobrado += Number(f.cobrado || 0);
    }
    return Object.values(acc).sort((a, b) => b.mes.localeCompare(a.mes));
  }, [filas]);

  // El mes más reciente arranca desplegado: es el que se mira a diario.
  useEffect(() => {
    if (meses.length && abierto === null) setAbierto(meses[0].mes);
  }, [meses, abierto]);

  if (cargando) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">Cargando datos de asesoras…</p>
      </section>
    );
  }
  if (!meses.length) {
    return (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-base font-semibold">Asesoras</h2>
        <p className="text-xs text-muted-foreground mt-1">No hay datos en el rango seleccionado.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <UsersThree size={18} weight="regular" /> Asesoras, mes a mes
        </h2>
        <p className="text-xs text-muted-foreground">
          Leads que le entraron, ventas cerradas y dinero cobrado. Los leads cuentan por
          fecha de entrada, las ventas por fecha de venta y los cobros por fecha de cobro.
        </p>
      </div>

      <div className="space-y-2">
        {meses.map((m) => {
          const open = abierto === m.mes;
          const tasa = m.leads > 0 ? (m.ventas * 100 / m.leads) : 0;
          return (
            <div key={m.mes} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setAbierto(open ? null : m.mes)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 text-left"
              >
                {open ? <CaretDown size={13} weight="bold" /> : <CaretRight size={13} weight="bold" />}
                <span className="font-semibold text-sm capitalize flex-1">{nombreMes(m.mes)}</span>
                <span className="hidden sm:inline text-[11px] text-muted-foreground">
                  {m.leads.toLocaleString('es-ES')} leads
                </span>
                <span className="text-[11px] text-muted-foreground">{m.ventas} ventas</span>
                <span className="text-[11px] text-muted-foreground tabular-nums">{tasa.toFixed(1)}%</span>
                <span className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 w-24 text-right">
                  {fmtMoney(m.cobrado)}
                </span>
              </button>

              {open && (
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-bold">Asesora</th>
                        <th className="text-right px-3 py-2 font-bold">Leads</th>
                        <th className="text-right px-3 py-2 font-bold">Ventas</th>
                        <th className="text-right px-3 py-2 font-bold">Clientes</th>
                        <th className="text-right px-3 py-2 font-bold">Tasa</th>
                        <th className="text-right px-3 py-2 font-bold">Vendido</th>
                        <th className="text-right px-3 py-2 font-bold">Cobrado</th>
                        <th className="text-right px-3 py-2 font-bold">Ticket medio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.asesoras.map((a) => (
                        <tr key={`${m.mes}-${a.asesora}`} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2 font-medium">{a.asesora}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(a.leads).toLocaleString('es-ES')}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">{a.ventas}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{a.clientes}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(a.tasa_conversion).toFixed(1)}%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(a.vendido)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                            {fmtMoney(a.cobrado)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtMoney(a.ticket_medio)}</td>
                        </tr>
                      ))}
                      <tr className="bg-muted/40 font-bold">
                        <td className="px-3 py-2">Total del mes</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.leads.toLocaleString('es-ES')}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.ventas}</td>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2 text-right tabular-nums">{tasa.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(m.vendido)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {fmtMoney(m.cobrado)}
                        </td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-muted-foreground mt-3">
        El detalle venta a venta —cliente, contacto, importe y estado del cobro— se descarga
        en «Ventas por asesora (detalle)», justo debajo.
      </p>
    </section>
  );
}
