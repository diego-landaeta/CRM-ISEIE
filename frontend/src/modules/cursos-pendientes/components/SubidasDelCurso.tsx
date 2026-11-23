import { useEffect, useState } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import { cursosApi, type PuntoSubida, type Subida } from '../api/cursosPendientes.api';

/**
 * La lista de control de subidas de un curso, en su ficha (#771): vídeos de los
 * directores en YouTube, módulos en Moodle y datos de directores para la web.
 *
 *   · la ve quien ve el curso; marcarla, quien tiene «Gestionar colaboraciones»
 *     (`puedeMarcar`), que es quien lleva las subidas;
 *   · cada punto: hecho, enlace o nota, desde cuándo falta y su fecha límite
 *     (la fecha límite se puede mover);
 *   · si el curso todavía no tiene la lista (se abre sola al pasar a «entregado»),
 *     quien puede marcar la abre con un botón.
 */

const fecha = (iso: string | null) => (iso
  ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

/** AAAA-MM-DD del día local de una marca de tiempo; '' si no hay. */
const diaLocal = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-CA') : '';
};

export default function SubidasDelCurso({ cursoId, subidas, puedeMarcar, cancelado, onCambio }: {
  cursoId: number; subidas: Subida[]; puedeMarcar: boolean; cancelado: boolean; onCambio: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function hacer(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try {
      await fn();
      if (ok) toast({ title: ok });
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  if (!subidas.length) {
    if (!puedeMarcar || cancelado) return null;
    return (
      <section className="space-y-2 rounded-md border border-dashed border-border p-3">
        <p className="text-[11px] font-bold uppercase text-muted-foreground">Subidas de contenido</p>
        <p className="text-xs text-muted-foreground">Este curso todavía no tiene su lista de subidas. Se abre sola cuando el curso pasa a «Entregado».</p>
        <button type="button" disabled={ocupado} onClick={() => hacer(() => cursosApi.abrirSubidas(cursoId), 'Lista de subidas abierta')}
          className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] font-bold hover:bg-muted disabled:opacity-50">
          Abrir la lista de subidas
        </button>
      </section>
    );
  }

  const hechos = subidas.filter((s) => s.hecho).length;
  return (
    <section>
      <p className="mb-2 text-[11px] font-bold uppercase text-muted-foreground">
        Subidas de contenido ({hechos}/{subidas.length})
      </p>
      <ul className="divide-y divide-border rounded-md border border-border">
        {subidas.map((s) => (
          <PuntoDeSubida key={s.punto} s={s} puedeMarcar={puedeMarcar && !cancelado} ocupado={ocupado}
            guardar={(cuerpo, ok) => hacer(() => cursosApi.marcarSubida(cursoId, s.punto as PuntoSubida, cuerpo), ok)} />
        ))}
      </ul>
    </section>
  );
}

function PuntoDeSubida({ s, puedeMarcar, ocupado, guardar }: {
  s: Subida; puedeMarcar: boolean; ocupado: boolean;
  guardar: (cuerpo: { hecho?: boolean; enlace?: string | null; nota?: string | null; fecha_limite?: string }, ok?: string) => void;
}) {
  const [enlace, setEnlace] = useState(s.enlace || '');
  const [nota, setNota] = useState(s.nota || '');
  const [limite, setLimite] = useState(s.fecha_limite);
  useEffect(() => { setEnlace(s.enlace || ''); setNota(s.nota || ''); setLimite(s.fecha_limite); }, [s.enlace, s.nota, s.fecha_limite]);
  // El día en que se abrió la lista: la fecha límite no puede ser anterior (QA de
  // /testeo del 18/11). Lo da el servidor; si no, el día local de `desde`.
  const minimo = s.abierta_el || diaLocal(s.desde);

  return (
    <li className={`space-y-1.5 px-3 py-2 text-sm ${s.atrasado ? 'bg-destructive/5' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {puedeMarcar ? (
          <label className="inline-flex flex-1 items-center gap-1.5 font-semibold">
            <input type="checkbox" checked={s.hecho} disabled={ocupado}
              onChange={(e) => guardar({ hecho: e.target.checked }, e.target.checked ? 'Marcado como hecho' : undefined)} />
            {s.nombre}
          </label>
        ) : (
          <p className="inline-flex flex-1 items-center gap-1.5 font-semibold">
            {s.hecho && <CheckCircle size={14} weight="fill" className="text-success-soft-foreground" />}{s.nombre}
          </p>
        )}
        {s.hecho ? (
          <span className="text-[11px] text-muted-foreground">Hecho el {fecha(s.hecho_at)}{s.hecho_por ? ` · ${s.hecho_por}` : ''}</span>
        ) : (
          <span className={`text-[11px] ${s.atrasado ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>
            {s.atrasado && <Warning size={11} weight="fill" className="mr-0.5 inline" />}
            Falta desde el {fecha(s.desde)} · límite {fecha(s.fecha_limite)}
            {s.atrasado && s.dias_de_retraso ? ` (${s.dias_de_retraso} d tarde)` : ''}
          </span>
        )}
      </div>
      {s.enlace && !puedeMarcar && (
        <a href={s.enlace} target="_blank" rel="noreferrer" className="block break-all text-xs text-primary underline">{s.enlace}</a>
      )}
      {s.nota && !puedeMarcar && <p className="text-xs text-muted-foreground">{s.nota}</p>}
      {puedeMarcar && (
        <div className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
          <input value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="Enlace (https://…)" aria-label={`Enlace: ${s.nombre}`}
            className={inputClass}
            onBlur={() => { if (enlace.trim() !== (s.enlace || '')) guardar({ enlace: enlace.trim() || null }); }} />
          <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota" aria-label={`Nota: ${s.nombre}`}
            className={inputClass}
            onBlur={() => { if (nota.trim() !== (s.nota || '')) guardar({ nota: nota.trim() || null }); }} />
          {!s.hecho && (
            <input type="date" value={limite} min={minimo || undefined} aria-label={`Fecha límite: ${s.nombre}`} className={inputClass}
              onChange={(e) => setLimite(e.target.value)}
              onBlur={() => {
                if (!limite || limite === s.fecha_limite) return;
                // Antes de abrir la lista no puede vencer: nacería ya atrasada. El servidor también lo rechaza.
                if (minimo && limite < minimo) {
                  toast({ title: 'Esa fecha no vale', description: `La fecha límite no puede ser anterior al día en que se abrió la lista (${fecha(minimo)}).`, variant: 'destructive' });
                  setLimite(s.fecha_limite);
                  return;
                }
                guardar({ fecha_limite: limite }, 'Fecha límite cambiada');
              }} />
          )}
        </div>
      )}
    </li>
  );
}
