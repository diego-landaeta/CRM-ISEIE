import { useEffect, useState } from 'react';
import { CursorClick } from '@phosphor-icons/react';
import { widgetApi, type ResumenPulsaciones } from '../api/widget.api';

/**
 * Cuántos pulsan el botón y cuántos pasan a la conversación (Diego, 29/10).
 *
 * Por gestora: las pulsaciones que el botón le mandó, las altas que ella dio
 * con origen WhatsApp y cuántas de esas altas tienen una pulsación suya de las
 * 24 h anteriores. El cruce es por gestora y hora —el botón no sabe quién
 * pulsa—, así que «con pulsación» dice que pudo venir del botón, no que vino.
 */
const PERIODOS = [
  { clave: 'hoy', etiqueta: 'Hoy', dias: 0 },
  { clave: '7', etiqueta: '7 días', dias: 6 },
  { clave: '30', etiqueta: '30 días', dias: 29 },
] as const;

const diaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : '—');

export default function PulsacionesDelBoton({ projectId }: { projectId: number }) {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['clave']>('7');
  const [datos, setDatos] = useState<ResumenPulsaciones | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const dias = PERIODOS.find((p) => p.clave === periodo)?.dias ?? 6;
    const to = diaIso(new Date());
    const from = diaIso(new Date(Date.now() - dias * 864e5));
    let vivo = true;
    setCargando(true);
    widgetApi.pulsaciones(projectId, from, to)
      .then((r) => { if (vivo && r.success) setDatos(r.data || null); })
      .catch(() => { if (vivo) setDatos(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, periodo]);

  const filas = datos?.porGestora || [];
  const total = filas.reduce((t, f) => ({
    pulsaciones: t.pulsaciones + f.pulsaciones,
    altas: t.altas + f.altas,
    con_pulsacion: t.con_pulsacion + f.con_pulsacion,
  }), { pulsaciones: 0, altas: 0, con_pulsacion: 0 });

  return (
    <div className="bg-card border border-border rounded-md p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2"><CursorClick size={16} /> Pulsaciones del botón</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cuántos pulsan y cuántos pasan a la conversación: las altas por WhatsApp de cada gestora y cuántas tienen una pulsación suya de las 24 h anteriores.
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.clave}
              type="button"
              onClick={() => setPeriodo(p.clave)}
              className={`h-7 px-2.5 rounded-md border text-xs ${periodo === p.clave ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted'}`}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {cargando ? (
        <p className="text-xs text-muted-foreground">Cargando…</p>
      ) : !filas.length ? (
        <p className="text-xs text-muted-foreground">
          Sin pulsaciones ni altas por WhatsApp en este periodo. Si la web tiene el código de antes, no avisa de las pulsaciones: vuelve a pegar el código de abajo.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5 pr-2 font-semibold">Gestora</th>
                  <th className="text-right py-1.5 px-2 font-semibold">Pulsaciones</th>
                  <th className="text-right py-1.5 px-2 font-semibold">Altas por WhatsApp</th>
                  <th className="text-right py-1.5 px-2 font-semibold">Con pulsación</th>
                  <th className="text-right py-1.5 pl-2 font-semibold" title="Altas con pulsación, sobre las pulsaciones">Pasan a conversación</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-b border-border/60">
                    <td className="py-1.5 pr-2">{f.nombre}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{f.pulsaciones}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{f.altas}</td>
                    <td className="text-right py-1.5 px-2 tabular-nums">{f.con_pulsacion}</td>
                    <td className="text-right py-1.5 pl-2 tabular-nums">{pct(f.con_pulsacion, f.pulsaciones)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-2">Total</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{total.pulsaciones}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{total.altas}</td>
                  <td className="text-right py-1.5 px-2 tabular-nums">{total.con_pulsacion}</td>
                  <td className="text-right py-1.5 pl-2 tabular-nums">{pct(total.con_pulsacion, total.pulsaciones)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {!!datos?.paginas.length && (
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Páginas desde las que más se pulsa</p>
              <ul className="text-xs space-y-0.5">
                {datos.paginas.map((p) => (
                  <li key={p.pagina} className="flex justify-between gap-3">
                    <span className="truncate" title={p.pagina}>{p.pagina || '(sin página)'}</span>
                    <span className="tabular-nums text-muted-foreground shrink-0">{p.pulsaciones} · {p.con_alta} con alta</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
