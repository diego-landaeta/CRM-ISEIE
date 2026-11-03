import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import {
  guardarBaremo, quitarBaremo, type BaremoAplicado, type TonoDeTramo, type TramoDelBaremo,
} from '../api/tasaCierre.api';

/**
 * El baremo de la tasa de cierre (#39): qué significa «un 8,2 %».
 *
 * Los tramos los pone quien lleva el negocio, aquí; no están escritos en el
 * código. Sin ninguno, la pantalla no etiqueta a nadie y compara a cada gestora
 * con el equipo. Un campus puede tener el suyo, que manda sobre el general.
 */

const TONOS: { valor: TonoDeTramo; rotulo: string }[] = [
  { valor: 'flojo', rotulo: 'Flojo' }, { valor: 'normal', rotulo: 'Normal' }, { valor: 'bueno', rotulo: 'Bueno' },
];

export const CLASE_DEL_TONO: Record<TonoDeTramo, string> = {
  flojo: 'bg-warning-soft text-warning-soft-foreground',
  normal: 'bg-muted text-foreground',
  bueno: 'bg-success-soft text-success-soft-foreground',
};

const PLANTILLA: TramoDelBaremo[] = [{ desde_pct: 0, etiqueta: 'Flojo', tono: 'flojo' }];

export default function BaremoDeLaTasa({ baremo, projectId, esSuperadmin, onCambio }: {
  baremo: BaremoAplicado | undefined;
  /** El campus puesto arriba, si es uno solo. */
  projectId: number | null;
  esSuperadmin: boolean;
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [tramos, setTramos] = useState<TramoDelBaremo[]>(baremo?.tramos?.length ? baremo.tramos : PLANTILLA);
  const [general, setGeneral] = useState(!projectId && esSuperadmin);
  const [guardando, setGuardando] = useState(false);

  // Sin un campus puesto, solo el general, y solo un super admin: el servidor lo exige igual.
  const puedeGuardar = general ? esSuperadmin : !!projectId;

  const cambia = (i: number, parte: Partial<TramoDelBaremo>) => setTramos((t) => t.map((x, j) => (j === i ? { ...x, ...parte } : x)));

  async function guardar() {
    setGuardando(true);
    try {
      await guardarBaremo({ ...(general ? { general: true } : { project_id: projectId! }), tramos });
      toast({ title: 'Baremo guardado' });
      setAbierto(false);
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo guardar el baremo', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  async function quitar() {
    setGuardando(true);
    try {
      await quitarBaremo(general ? { general: true } : { project_id: projectId! });
      toast({ title: 'Baremo quitado', description: 'La tasa vuelve a no etiquetarse y a compararse con el equipo.' });
      setTramos(PLANTILLA);
      setAbierto(false);
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo quitar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setAbierto((a) => !a)} aria-expanded={abierto}
        className="text-[11px] font-semibold text-primary hover:underline">
        {abierto ? 'Cerrar el baremo' : baremo?.ambito === 'ninguno' || !baremo ? 'Poner un baremo' : 'Cambiar el baremo'}
      </button>
      {abierto && (
        <div className="mt-2 rounded-lg border border-border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Cada tramo vale desde su porcentaje hasta el siguiente. El primero empieza en 0 %. Los números los decide quien lleva el negocio:
            aquí no hay umbrales por defecto.
          </p>
          {esSuperadmin && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} /> Baremo general (vale para los campus que no tengan el suyo)
            </label>
          )}
          {!general && !projectId && <p className="text-xs text-destructive">Elige un campus arriba para ponerle su baremo.</p>}
          <ul className="space-y-1.5">
            {tramos.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs">Desde
                  <input type="number" min={0} max={99.99} step={0.5} value={t.desde_pct} aria-label={`Desde (%) del tramo ${i + 1}`}
                    onChange={(e) => cambia(i, { desde_pct: Number(e.target.value) })}
                    className="h-7 w-20 rounded-md border border-border bg-card px-2 text-xs tabular-nums" /> %
                </label>
                <input value={t.etiqueta} maxLength={30} aria-label={`Etiqueta del tramo ${i + 1}`}
                  onChange={(e) => cambia(i, { etiqueta: e.target.value })}
                  className="h-7 w-36 rounded-md border border-border bg-card px-2 text-xs" />
                <select value={t.tono} aria-label={`Tono del tramo ${i + 1}`} onChange={(e) => cambia(i, { tono: e.target.value as TonoDeTramo })}
                  className="h-7 rounded-md border border-border bg-card px-1.5 text-xs">
                  {TONOS.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${CLASE_DEL_TONO[t.tono]}`}>{t.etiqueta || '—'}</span>
                {tramos.length > 1 && (
                  <button type="button" aria-label={`Quitar el tramo ${i + 1}`} onClick={() => setTramos((x) => x.filter((_, j) => j !== i))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash size={13} /></button>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {tramos.length < 6 && (
              <button type="button" onClick={() => setTramos((t) => [...t, { desde_pct: Math.min(99, (t[t.length - 1]?.desde_pct ?? 0) + 5), etiqueta: '', tono: 'normal' }])}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-bold hover:bg-muted"><Plus size={11} weight="bold" /> Añadir tramo</button>
            )}
            <span className="flex-1" />
            {baremo && baremo.ambito !== 'ninguno' && (
              <button type="button" disabled={guardando || !puedeGuardar} onClick={quitar}
                className="inline-flex h-7 items-center rounded-md border border-border px-2 text-[11px] font-bold text-destructive hover:bg-muted disabled:opacity-50">Quitar el baremo</button>
            )}
            <button type="button" disabled={guardando || !puedeGuardar} onClick={guardar}
              className="inline-flex h-7 items-center rounded-md bg-primary px-3 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar baremo'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
