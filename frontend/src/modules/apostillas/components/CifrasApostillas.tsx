import { useEffect, useState } from 'react';
import { Stamp } from '@phosphor-icons/react';
import { apostillasApi, type Ambito, type CifrasApostillas as Cifras } from '../api/apostillas.api';
import { ESTADOS, eur, mesTexto, textoDelEstado } from '../lib/apostillas';

/*
  Las cifras de las apostillas (Diego, 25/11: «un producto propio que tiene que
  poder medirse en las estadísticas»): cuántas, cuánto dinero, por estado, por
  campus y por mes. Sale en Clientes › Apostillas y en Reportes, con el ámbito
  (campus o empresa) y, en Reportes, con su rango de fechas.

  Las canceladas o reembolsadas cuentan en su estado pero no suman dinero.
*/

interface Props {
  ambito: Ambito;
  from?: string;
  to?: string;
  /** En Reportes lleva su título y su marco; en el apartado va bajo la cabecera. */
  conTitulo?: boolean;
  /** Para volver a pedirlas tras un cambio. */
  recarga?: number;
}

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{etiqueta}</p>
      <p className="text-lg font-semibold tabular-nums">{valor}</p>
      {detalle && <p className="text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}

export default function CifrasApostillas({ ambito, from, to, conTitulo = false, recarga = 0 }: Props) {
  const [c, setC] = useState<Cifras | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clave = JSON.stringify(ambito);

  useEffect(() => {
    let vivo = true;
    setError(null);
    apostillasApi.cifras(ambito, { from, to })
      .then((r) => { if (vivo) setC(r?.data || null); })
      .catch((e: { message?: string }) => { if (vivo) { setC(null); setError(e?.message || 'No se pudieron cargar las cifras'); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, from, to, recarga]);

  if (error) return conTitulo ? null : <p className="text-sm text-destructive">{error}</p>;
  if (!c) return null;
  // En Reportes, sin ninguna apostilla en el rango no se pinta nada.
  if (conTitulo && c.total === 0) return null;

  const maxEstado = Math.max(1, ...c.por_estado.map((e) => e.n));
  const porEstado = ESTADOS.map((e) => ({ ...e, n: c.por_estado.find((x) => x.estado === e.clave)?.n || 0 }));

  const cuerpo = (
    <div className="space-y-3" data-testid="cifras-apostillas">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Dato etiqueta="Apostillas" valor={String(c.total)} detalle={c.total - c.vivas ? `${c.total - c.vivas} canceladas` : undefined} />
        <Dato etiqueta="Vendido" valor={eur(c.importe)} detalle={`${c.pagadas} pagadas del todo`} />
        <Dato etiqueta="Cobrado" valor={eur(c.cobrado)} />
        <Dato etiqueta="Atascadas" valor={String(c.atascadas)}
          detalle={c.sin_asociar ? `${c.sin_asociar} sin asociar` : 'Llevan los días del aviso en el mismo paso'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-sm">
        <div className="rounded-md border border-border p-3">
          <h4 className="text-[12px] font-semibold mb-2">Por estado</h4>
          <ul className="space-y-1.5">
            {porEstado.map((e) => (
              <li key={e.clave} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[12px]">
                <span className="truncate">{e.texto}</span>
                <span className="tabular-nums font-medium">{e.n}</span>
                <span className="col-span-2 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                  <span className="block h-full bg-primary/70" style={{ width: `${(e.n / maxEstado) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-border p-3 overflow-x-auto">
          <h4 className="text-[12px] font-semibold mb-2">Por campus</h4>
          {c.por_campus.length === 0 ? <p className="text-[12px] text-muted-foreground">Ninguna todavía.</p> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-muted-foreground">
                <th className="font-medium pb-1">Campus</th><th className="font-medium pb-1 text-right">N.º</th>
                <th className="font-medium pb-1 text-right">Vendido</th><th className="font-medium pb-1 text-right">Cobrado</th>
              </tr></thead>
              <tbody>
                {c.por_campus.map((f) => (
                  <tr key={f.project_id} className="border-t border-border">
                    <td className="py-1 pr-2">{f.campus}</td><td className="py-1 text-right tabular-nums">{f.n}</td>
                    <td className="py-1 text-right tabular-nums">{eur(f.importe)}</td><td className="py-1 text-right tabular-nums">{eur(f.cobrado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-md border border-border p-3 overflow-x-auto">
          <h4 className="text-[12px] font-semibold mb-2">Por mes</h4>
          {c.por_mes.length === 0 ? <p className="text-[12px] text-muted-foreground">Ninguna todavía.</p> : (
            <table className="w-full text-[12px]">
              <thead><tr className="text-left text-muted-foreground">
                <th className="font-medium pb-1">Mes</th><th className="font-medium pb-1 text-right">N.º</th>
                <th className="font-medium pb-1 text-right">Vendido</th><th className="font-medium pb-1 text-right">Cobrado</th>
              </tr></thead>
              <tbody>
                {[...c.por_mes].reverse().map((m) => (
                  <tr key={m.mes} className="border-t border-border">
                    <td className="py-1 pr-2">{mesTexto(m.mes)}</td><td className="py-1 text-right tabular-nums">{m.n}</td>
                    <td className="py-1 text-right tabular-nums">{eur(m.importe)}</td><td className="py-1 text-right tabular-nums">{eur(m.cobrado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  if (!conTitulo) return cuerpo;
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5" aria-labelledby="cifras-apostillas-titulo">
      <div className="mb-3">
        <h3 id="cifras-apostillas-titulo" className="font-semibold text-sm flex items-center gap-2">
          <Stamp size={16} /> Apostillas de La Haya
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Las vendidas en el rango (fecha de la venta o del cobro), por estado, campus y mes. Las canceladas no suman dinero.
          {' '}Estado actual: {porEstado.filter((e) => e.n).map((e) => `${e.n} ${textoDelEstado(e.clave).toLowerCase()}`).join(' · ') || '—'}.
        </p>
      </div>
      {cuerpo}
    </section>
  );
}
