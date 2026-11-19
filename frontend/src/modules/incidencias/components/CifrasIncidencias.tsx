import type { MetricasIncidencias, TipoIncidencia } from '../api/incidencias.api';
import { TIPOS, ORDEN_TIPOS, nombreDelMes } from '../lib/incidencias';

/**
 * Las cifras de las incidencias (#253): por persona, por tipo y por mes,
 * «para decidir formación».
 *
 * Salen del servidor con los MISMOS filtros que la lista, así que el total de
 * aquí es el número de la lista. Por persona y por mes suman ese total; por
 * tipo suma más si alguna tiene dos tipos, y se dice debajo.
 */
export default function CifrasIncidencias({ m, onPersona }: {
  m: MetricasIncidencias;
  /** Pulsar una persona filtra la lista por ella. */
  onPersona?: (userId: number) => void;
}) {
  if (!m.total) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Sin incidencias con estos filtros.</p>;
  }
  const sumaTipos = m.porTipo.reduce((s, t) => s + t.total, 0);

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card overflow-hidden">
        <h3 className="px-tarjeta py-3 text-sm font-semibold border-b border-border">Por persona</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Quién la causó</th>
                {ORDEN_TIPOS.map((t) => <th key={t} className="text-right font-medium px-3 py-2 whitespace-nowrap">{TIPOS[t].label}</th>)}
                <th className="text-right font-medium px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {m.porPersona.map((p) => (
                <tr key={p.userId ?? 'nadie'} className="border-t border-border">
                  <td className="px-3 py-2">
                    {p.userId && onPersona ? (
                      <button type="button" onClick={() => onPersona(p.userId!)} className="hover:underline text-left">
                        {p.nombre || `Usuario ${p.userId}`}
                      </button>
                    ) : (p.nombre || <span className="text-muted-foreground italic">Nadie del CRM</span>)}
                  </td>
                  {ORDEN_TIPOS.map((t) => (
                    <td key={t} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p[t] || ''}</td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{p.total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30">
                <td className="px-3 py-2 font-medium">Total</td>
                {ORDEN_TIPOS.map((t) => (
                  <td key={t} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {m.porTipo.find((x) => x.tipo === t)?.total || ''}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{m.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {sumaTipos > m.total && (
          <p className="px-tarjeta py-2 text-secundario text-muted-foreground border-t border-border">
            Las columnas de tipo suman {sumaTipos} y no {m.total}: una incidencia con dos tipos (capa 8 y fallo del CRM) cuenta en los dos.
          </p>
        )}
      </section>

      <section className="rounded-md border border-border bg-card overflow-hidden">
        <h3 className="px-tarjeta py-3 text-sm font-semibold border-b border-border">Por mes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left font-medium px-3 py-2">Mes</th>
                {ORDEN_TIPOS.map((t) => <th key={t} className="text-right font-medium px-3 py-2 whitespace-nowrap">{TIPOS[t].label}</th>)}
                <th className="text-right font-medium px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {m.porMes.map((fila) => (
                <tr key={fila.mes} className="border-t border-border">
                  <td className="px-3 py-2 capitalize">{nombreDelMes(fila.mes)}</td>
                  {ORDEN_TIPOS.map((t) => (
                    <td key={t} className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {fila[t as TipoIncidencia] || ''}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">{fila.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
