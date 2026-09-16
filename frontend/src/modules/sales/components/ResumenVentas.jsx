import { useEffect, useState } from 'react';
import {
  Receipt, CurrencyEur, CheckCircle, Clock, Users, ChartBar,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';

// Las cifras de venta del periodo. Vienen de /sales/resumen, que ya recorta a
// la gestora que pregunta: si entra una gestora ve lo suyo, no lo del equipo.

const eur = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(Number(n) || 0);

const num = (n) => new Intl.NumberFormat('es-ES').format(Number(n) || 0);

function Cifra({ icon: Icon, etiqueta, valor, pie }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
        <Icon size={15} weight="duotone" />
        <span className="text-[11px] font-bold uppercase tracking-wide">{etiqueta}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">{valor}</div>
      {pie ? <div className="text-xs text-muted-foreground mt-0.5">{pie}</div> : null}
    </div>
  );
}

export default function ResumenVentas({ projectId, from, to, responsableId = null }) {
  const [d, setD] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!projectId) return undefined;
    let vivo = true;
    setCargando(true);
    const p = new URLSearchParams({ projectId: String(projectId) });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (responsableId) p.set('responsableId', String(responsableId));
    client.get(`/ventas/resumen?${p}`)
      .then((r) => { if (vivo) setD(r.success ? r.data : null); })
      .catch(() => { if (vivo) setD(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to, responsableId]);

  if (cargando || !d) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-card border border-border rounded-lg p-4 h-[92px] animate-pulse" />
        ))}
      </div>
    );
  }

  const cuotas = d.cuotas || {};
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Cifra icon={Receipt} etiqueta="Ventas" valor={num(d.ventas)}
        pie={`${num(d.clientes)} ${d.clientes === 1 ? 'cliente' : 'clientes'}`} />
      <Cifra icon={CurrencyEur} etiqueta="Vendido" valor={eur(d.importe)}
        pie={`ticket medio ${eur(d.ticket_medio)}`} />
      {/* Cobrado DE ESAS VENTAS, aunque el pago entrara despues del periodo.
          La tarta de abajo cuenta otra cosa: el dinero que entro EN el periodo,
          venga de una venta de ahora o de una de hace meses. */}
      <Cifra icon={CheckCircle} etiqueta="Cobrado de esas ventas" valor={eur(d.cobrado)}
        pie={`${num(d.liquidadas)} ${d.liquidadas === 1 ? 'venta saldada' : 'ventas saldadas'}`} />
      <Cifra icon={Clock} etiqueta="Pendiente" valor={eur(d.pendiente)}
        pie={`${num(d.con_saldo)} con saldo`} />
      <Cifra icon={ChartBar} etiqueta="Cuotas" valor={`${num(cuotas.cobradas)} / ${num(cuotas.total)}`}
        pie={cuotas.vencidas ? `${num(cuotas.vencidas)} vencidas` : `${num(cuotas.pendientes)} por cobrar`} />
    </div>
  );
}
