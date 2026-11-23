import { useEffect, useState } from 'react';
import { Funnel } from '@phosphor-icons/react';
import { verEmbudo, type Embudo, type FilaEmbudo } from '../api/linksPago.api';

/*
  EL EMBUDO DE LOS LINKS (CRM#987; Diego, 21/11/2026).

  Arriba en «Links de pago»: por gestora y por campus, para el periodo elegido,
  los links creados, abiertos y pagados, con su % y lo cobrado, y en las cuotas
  del cobro automático las cobradas solas, las fallidas y las pendientes. Cada uno
  ve solo lo suyo: lo recorta el servidor con el ámbito de siempre.
*/

type Periodo = 'mes' | 'anterior' | '30' | 'otro';

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());

export function fechasDe(p: Periodo, hoyIso = hoy()): { desde: string; hasta: string } | null {
  const [a, m] = hoyIso.split('-').map(Number);
  if (p === 'mes') return { desde: `${hoyIso.slice(0, 7)}-01`, hasta: hoyIso };
  if (p === 'anterior') {
    const ini = new Date(Date.UTC(a, m - 2, 1));
    const fin = new Date(Date.UTC(a, m - 1, 0));
    return { desde: ini.toISOString().slice(0, 10), hasta: fin.toISOString().slice(0, 10) };
  }
  if (p === '30') {
    const d = new Date(`${hoyIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 29);
    return { desde: d.toISOString().slice(0, 10), hasta: hoyIso };
  }
  return null;
}

const errorDe = (e: unknown) => {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'error de red';
};
const euros = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const pct = (n: number | null) => (n == null ? '—' : `${String(n).replace('.', ',')} %`);

function Fila({ f, total = false }: { f: FilaEmbudo & { nombre?: string }; total?: boolean }) {
  const td = `px-2 py-1.5 text-right tabular-nums ${total ? 'font-semibold' : ''}`;
  return (
    <tr className={total ? 'border-t-2 border-border' : 'border-t border-border'}>
      <th scope="row" className={`px-2 py-1.5 text-left font-medium ${total ? 'font-semibold' : ''}`}>{total ? 'Total' : f.nombre}</th>
      <td className={td}>{f.creados}</td>
      <td className={td}>{f.abiertos} <span className="text-muted-foreground text-xs">({pct(f.pct_abiertos)})</span></td>
      <td className={td}>{f.pagados} <span className="text-muted-foreground text-xs">({pct(f.pct_pagados)})</span></td>
      <td className={td}>{euros(f.cobrado)}</td>
      <td className={td}>{f.cuotas_cobradas}</td>
      <td className={`${td} ${f.cuotas_fallidas ? 'text-destructive' : ''}`}>{f.cuotas_fallidas}</td>
      <td className={td}>{f.cuotas_pendientes}</td>
    </tr>
  );
}

export default function EmbudoLinks({ ambito }: { ambito?: { projectId?: number; issuerId?: number } }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [otro, setOtro] = useState(() => fechasDe('mes') as { desde: string; hasta: string });
  const [vista, setVista] = useState<'gestora' | 'campus'>('gestora');
  const [datos, setDatos] = useState<Embudo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fechas = periodo === 'otro' ? otro : fechasDe(periodo);
  const desde = fechas?.desde; const hasta = fechas?.hasta;
  const ambitoClave = JSON.stringify(ambito || {});

  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return undefined;
    let vigente = true;
    setError(null);
    verEmbudo({ desde, hasta, ambito: JSON.parse(ambitoClave) })
      // Solo un resumen de verdad (con su total): otra cosa es que el servidor no lo tiene.
      .then((r) => { if (vigente) setDatos(r?.data?.total ? r.data : null); })
      .catch((e) => { if (vigente) { setDatos(null); setError(`No se ha podido cargar el resumen: ${errorDe(e)}`); } });
    return () => { vigente = false; };
  }, [desde, hasta, ambitoClave]);

  const filas = (vista === 'gestora' ? datos?.por_gestora : datos?.por_campus) || [];
  const boton = (activo: boolean) => `h-8 px-3 rounded-full text-xs font-semibold border ${activo ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`;

  return (
    <section className="bg-card rounded-lg border border-border p-3 sm:p-4 space-y-3" aria-labelledby="embudo-titulo" data-recorrido="links-embudo">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="embudo-titulo" className="font-semibold text-sm flex items-center gap-1.5 mr-auto">
          <Funnel size={16} aria-hidden="true" /> Resumen: creados, abiertos y pagados
        </h2>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Periodo">
          {([['mes', 'Este mes'], ['anterior', 'Mes pasado'], ['30', 'Últimos 30 días'], ['otro', 'Otras fechas']] as const).map(([v, t]) => (
            <button key={v} type="button" aria-pressed={periodo === v} onClick={() => setPeriodo(v)} className={boton(periodo === v)}>{t}</button>
          ))}
        </div>
      </div>
      {periodo === 'otro' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="embudo-desde">Desde</label>
          <input id="embudo-desde" type="date" value={otro.desde} max={otro.hasta} onChange={(e) => setOtro((o) => ({ ...o, desde: e.target.value }))}
            className="h-8 px-2 rounded-md border border-border bg-card" />
          <label htmlFor="embudo-hasta">hasta</label>
          <input id="embudo-hasta" type="date" value={otro.hasta} min={otro.desde} onChange={(e) => setOtro((o) => ({ ...o, hasta: e.target.value }))}
            className="h-8 px-2 rounded-md border border-border bg-card" />
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Agrupar por">
        <button type="button" aria-pressed={vista === 'gestora'} onClick={() => setVista('gestora')} className={boton(vista === 'gestora')}>Por gestora</button>
        <button type="button" aria-pressed={vista === 'campus'} onClick={() => setVista('campus')} className={boton(vista === 'campus')}>Por campus</button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {datos && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th scope="col" className="px-2 py-1 text-left font-semibold">{vista === 'gestora' ? 'Gestora' : 'Campus'}</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Creados</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Abiertos</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Pagados</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Cobrado</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold" title="Cuotas del cobro automático que vencen en el periodo">Cuotas cobradas</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Fallidas</th>
                <th scope="col" className="px-2 py-1 text-right font-semibold">Pendientes</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-3 text-center text-muted-foreground">No hay links ni cuotas en este periodo.</td></tr>
              )}
              {filas.map((f) => <Fila key={vista === 'gestora' ? `g${f.user_id ?? 'sin'}` : `c${f.project_id}`} f={f} />)}
              {filas.length > 1 && <Fila f={datos.total} total />}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Abiertos y pagados, sobre los links creados en el periodo. Cobrado: lo que entró por esos links, en euros. Cuotas: las del cobro
            automático que vencen en el periodo.
          </p>
        </div>
      )}
    </section>
  );
}
