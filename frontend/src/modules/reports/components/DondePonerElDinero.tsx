import { Fragment, useEffect, useMemo, useState } from 'react';
import { CaretDown, CaretRight, Coins, FileCsv, Info, TrendDown, TrendUp } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';

/**
 * «¿Dónde ponemos el dinero el mes que viene?» (#56).
 *
 * Una fila por canal —gasto, prospectos, ventas, cobrado, coste por venta y
 * retorno—, desplegable por campaña, contra el periodo anterior y descargable.
 * Incluye los canales SIN gasto (orgánico, ChatGPT, referidos, WhatsApp), que
 * suelen ser los que mejor convierten y no salen en ningún panel de publicidad.
 *
 * Lo cobrado sale de los cobros apuntados, como en Finanzas. Solo hay gasto de
 * Meta de momento: en el resto de canales el gasto sale como «—» (sin dato), no
 * como 0 €, que diría que no cuestan nada. Solo admin y super admin: lleva el gasto.
 */

interface Fila {
  leads: number; ventas: number; vendido: number; cobrado: number;
  gasto: number | null; coste_por_lead: number | null; coste_por_venta: number | null; retorno: number | null;
}
interface Campana extends Fila { campana: string; nombre: string }
interface Canal extends Fila { canal: string; tiene_gasto: boolean; es_de_pago: boolean; anterior: Fila; campanas: Campana[] }
interface Respuesta {
  periodo: { from: string; to: string };
  anterior: { from: string; to: string };
  gasto_completo: boolean;
  total: Fila & { gasto: number; coste_mezclado: number | null };
  total_anterior: Fila & { gasto: number };
  canales: Canal[];
}

const CANALES: Record<string, string> = {
  meta_ads: 'Meta Ads', google_ads: 'Google Ads', tiktok_ads: 'TikTok Ads', organico: 'Orgánico',
  chatgpt_ia: 'ChatGPT / IA', directo: 'Directo', referido: 'Referido', whatsapp: 'WhatsApp', sin_origen: 'Sin origen',
};
const etiqueta = (c: string) => CANALES[c] || c;

const eur = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(n));
const num = (n: number) => new Intl.NumberFormat('es-ES').format(n);
const dia = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

/** El cambio contra el periodo anterior, en %; null si no hay con qué comparar. */
function cambio(ahora: number | null, antes: number | null): number | null {
  if (ahora == null || antes == null || antes === 0) return null;
  return ((ahora - antes) / Math.abs(antes)) * 100;
}

/** Una flecha con el cambio. `masEsMejor`: en el coste por venta, bajar es lo bueno. */
function Delta({ ahora, antes, masEsMejor = true }: { ahora: number | null; antes: number | null; masEsMejor?: boolean }) {
  const c = cambio(ahora, antes);
  if (c == null) return <span className="text-muted-foreground">—</span>;
  if (Math.abs(c) < 0.5) return <span className="text-muted-foreground">=</span>;
  const sube = c > 0;
  const bueno = sube === masEsMejor;
  const Icono = sube ? TrendUp : TrendDown;
  return (
    <span className={`inline-flex items-center gap-0.5 tabular-nums ${bueno ? 'text-success' : 'text-destructive'}`}>
      <Icono size={11} weight="bold" /> {sube ? '+' : '−'}{Math.abs(c).toFixed(0)} %
    </span>
  );
}

export default function DondePonerElDinero({ from, to }: { from: string; to: string }) {
  const { user } = useAuth() as { user: { role?: string } | null };
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id: number } | null; activeIssuerId: number | null;
  };
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const permitido = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    if (!permitido) return undefined;
    let vivo = true;
    setCargando(true); setError(null);
    const p = new URLSearchParams();
    ponerAmbito(p, { activeIssuerId, activeProject });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    client.get(`/informes/canales/dinero?${p.toString()}`)
      .then((r: unknown) => {
        const cuerpo = r as { success?: boolean; data?: Respuesta };
        if (vivo) setDatos(cuerpo.success ? cuerpo.data || null : null);
      })
      .catch((e: Error) => { if (vivo) setError(e?.message || 'No se pudo cargar'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [permitido, activeProject?.id, activeIssuerId, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const mejorCobrado = useMemo(() => Math.max(1, ...(datos?.canales.map((c) => c.cobrado) || [1])), [datos]);

  if (!permitido) return null;

  function alternar(canal: string) {
    setAbiertos((a) => { const n = new Set(a); if (n.has(canal)) n.delete(canal); else n.add(canal); return n; });
  }

  function descargar() {
    if (!datos) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const n = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));
    const cab = ['Canal', 'Campaña', 'Gasto', 'Prospectos', 'Ventas', 'Cobrado', 'Coste por venta', 'Retorno', 'Cobrado periodo anterior', 'Gasto periodo anterior'];
    const filas: string[] = [cab.map(esc).join(';')];
    for (const c of datos.canales) {
      filas.push([etiqueta(c.canal), '', n(c.gasto), c.leads, c.ventas, n(c.cobrado), n(c.coste_por_venta), n(c.retorno), n(c.anterior.cobrado), n(c.anterior.gasto)].map(esc).join(';'));
      for (const k of c.campanas) {
        filas.push([etiqueta(c.canal), k.nombre, n(k.gasto), k.leads, k.ventas, n(k.cobrado), n(k.coste_por_venta), n(k.retorno), '', ''].map(esc).join(';'));
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${filas.join('\n')}`], { type: 'text/csv;charset=utf-8;' }));
    a.download = `donde-poner-el-dinero-${datos.periodo.from}_${datos.periodo.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2"><Coins size={18} /> ¿Dónde ponemos el dinero?</h2>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Por canal y por campaña: lo que cuesta, lo que entra y lo que se cobra de verdad. Los canales sin gasto
            —orgánico, ChatGPT, referidos, WhatsApp— salen igual: suelen ser los que mejor convierten.
          </p>
        </div>
        <button
          type="button" onClick={descargar} disabled={!datos?.canales.length}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold hover:bg-muted disabled:opacity-40"
        ><FileCsv size={14} weight="bold" /> Descargar CSV</button>
      </div>

      {cargando ? (
        <div className="h-40 rounded-md bg-muted/40 animate-pulse" />
      ) : error ? (
        <p className="text-sm text-destructive py-3">{error}</p>
      ) : !datos || !datos.canales.length ? (
        <p className="text-sm text-muted-foreground py-3">No hay prospectos ni gasto en este periodo.</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground mb-2">
            {dia(datos.periodo.from)} – {dia(datos.periodo.to)}, comparado con {dia(datos.anterior.from)} – {dia(datos.anterior.to)}.
            Se cuentan los prospectos que entraron en el periodo y lo que han cobrado hasta hoy: el periodo anterior ha tenido más
            tiempo para cobrar, así que su cobrado puede crecer todavía.
          </p>
          {!datos.gasto_completo && (
            <p className="flex items-start gap-1.5 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground mb-3" role="status">
              <Info size={14} weight="bold" className="mt-0.5 shrink-0" />
              <span>
                Hay prospectos de canales de pago de los que el CRM aún no conoce el gasto (Google Ads, TikTok). El coste por venta total solo
                cuenta Meta; en esos canales el gasto sale como «—».
              </span>
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Canal</th>
                  <th className="px-3 py-2 text-right font-bold">Gasto</th>
                  <th className="px-3 py-2 text-right font-bold">Prospectos</th>
                  <th className="px-3 py-2 text-right font-bold">Ventas</th>
                  <th className="px-3 py-2 text-right font-bold">Cobrado</th>
                  <th className="px-3 py-2 text-right font-bold">Coste por venta</th>
                  <th className="px-3 py-2 text-right font-bold">Retorno</th>
                  <th className="px-3 py-2 text-right font-bold" title="Cobrado de este periodo frente al anterior">Cobrado vs anterior</th>
                  <th className="px-3 py-2 text-left font-bold w-24">Peso</th>
                </tr>
              </thead>
              <tbody>
                {datos.canales.map((c) => {
                  const abierto = abiertos.has(c.canal);
                  const puedeAbrir = c.campanas.length > 0;
                  return (
                    <Fragment key={c.canal}>
                      <tr
                        className={`border-b border-border/50 hover:bg-muted/40 ${puedeAbrir ? 'cursor-pointer' : ''}`}
                        onClick={puedeAbrir ? () => alternar(c.canal) : undefined}
                      >
                        <td className="px-3 py-2 font-semibold">
                          <span className="inline-flex items-center gap-1">
                            {puedeAbrir ? (abierto ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />) : <span className="w-[11px]" />}
                            {etiqueta(c.canal)}
                            {c.es_de_pago && !c.tiene_gasto && (
                              <span className="ml-1 rounded bg-warning-soft px-1 py-px text-[9px] font-semibold text-warning-soft-foreground"
                                title="Es un canal de pago, pero el CRM aún no tiene su gasto">gasto sin conectar</span>
                            )}
                            {!c.es_de_pago && c.canal !== 'sin_origen' && (
                              <span className="ml-1 rounded bg-muted px-1 py-px text-[9px] font-semibold text-muted-foreground">sin gasto</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums" title={c.gasto == null ? 'El CRM no tiene el gasto de este canal' : undefined}>{eur(c.gasto)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(c.leads)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{num(c.ventas)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{eur(c.cobrado)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{eur(c.coste_por_venta)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${c.retorno == null ? '' : c.retorno >= 0 ? 'text-success' : 'text-destructive'}`}>{eur(c.retorno)}</td>
                        <td className="px-3 py-2 text-right"><Delta ahora={c.cobrado} antes={c.anterior.cobrado} /></td>
                        <td className="px-3 py-2">
                          <span className="block h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(3, (c.cobrado / mejorCobrado) * 100)}%` }} />
                        </td>
                      </tr>
                      {abierto && c.campanas.map((k) => (
                        <tr key={`${c.canal}-${k.campana}`} className="border-b border-border/30 bg-muted/20">
                          <td className="px-3 py-1.5 pl-9 text-muted-foreground truncate max-w-[260px]" title={k.nombre}>{k.nombre}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eur(k.gasto)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{num(k.leads)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{num(k.ventas)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eur(k.cobrado)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eur(k.coste_por_venta)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${k.retorno == null ? '' : k.retorno >= 0 ? 'text-success' : 'text-destructive'}`}>{eur(k.retorno)}</td>
                          <td /><td />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(datos.total.gasto)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(datos.total.leads)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(datos.total.ventas)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{eur(datos.total.cobrado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums"
                    title={`Gasto conocido entre las ventas de los canales con gasto. Entre todas las ventas saldría ${eur(datos.total.coste_mezclado)}.`}>
                    {eur(datos.total.coste_por_venta)}
                  </td>
                  <td />
                  <td className="px-3 py-2 text-right"><Delta ahora={datos.total.cobrado} antes={datos.total_anterior.cobrado} /></td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
