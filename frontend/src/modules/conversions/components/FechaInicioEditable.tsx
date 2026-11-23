import { useState } from 'react';
import { conversionsApi } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import { formatDate } from '@/shared/lib/format';
import { inputClass } from '@/shared/lib/ui';
import { hoyEnMadrid } from '@/shared/lib/fechas';
import { AVISO_FECHA_PASADA, ayudaFechaInicio } from './FechaInicioCurso';

/*
  La fecha de inicio del curso en la ficha de la venta (#767), y cambiarla.

  Si cambia antes de que toque matricular, la matrícula programada se mueve
  sola con ella (el trabajo de cada hora, `ajustarFechas`).
*/

interface Props {
  conversionId: number;
  /** DATE de la venta («2026-12-01») o null si se creó sin ella. */
  value: string | null | undefined;
  canEdit: boolean;
  onSaved?: (nueva: string | null) => void;
}

export default function FechaInicioEditable({ conversionId, value, canEdit, onSaved }: Props) {
  const actual = (value || '').slice(0, 10);
  const [editando, setEditando] = useState(false);
  const [nueva, setNueva] = useState(actual);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!nueva) {
      toast({ title: 'Falta la fecha', description: 'Elige la fecha de inicio del curso.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      await conversionsApi.update(conversionId, { fecha_inicio: nueva } as never);
      toast({ title: 'Fecha de inicio guardada', description: nueva < hoyEnMadrid() ? AVISO_FECHA_PASADA : undefined });
      setEditando(false);
      onSaved?.(nueva);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar la fecha', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  if (editando) {
    return (
      <div className="space-y-1.5" data-testid="fecha-inicio-editando">
        <label htmlFor={`fecha-inicio-${conversionId}`} className="block text-muted-foreground">Inicio del curso</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id={`fecha-inicio-${conversionId}`} type="date" value={nueva}
            onChange={(e) => setNueva(e.target.value)} className={`${inputClass} w-auto min-w-0 flex-1`} />
          <button type="button" onClick={guardar} disabled={guardando}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" onClick={() => { setNueva(actual); setEditando(false); }} disabled={guardando}
            className="h-9 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
        </div>
        {nueva && <p className="text-[11px] text-muted-foreground">{ayudaFechaInicio(nueva)}</p>}
      </div>
    );
  }

  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">Inicio del curso</span>
      <span className="flex items-center gap-2 min-w-0">
        <span className={actual ? 'font-medium' : 'text-muted-foreground'}>
          {actual ? formatDate(actual) : 'Sin fecha: se matricula al pagar'}
        </span>
        {canEdit && (
          <button type="button" onClick={() => { setNueva(actual); setEditando(true); }}
            className="text-xs font-semibold text-primary hover:underline flex-shrink-0">
            {actual ? 'Cambiar' : 'Poner'}
          </button>
        )}
      </span>
    </div>
  );
}
