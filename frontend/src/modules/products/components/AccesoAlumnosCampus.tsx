import { useEffect, useState } from 'react';
import { Clock, FloppyDisk } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import { alumnosApi, type ReglaDeAcceso } from '../api/alumnos.api';

/**
 * El tiempo de acceso de los alumnos del campus (CRM#1113): cuántos meses dura el
 * acceso de cada tipo de formación cuando la formación no tiene fecha de fin ni
 * duración publicada. Vacío = la de serie (curso 3, diplomado 6, máster 12).
 * Solo para quien edita el catálogo (`products.edit`).
 */

const TIPOS: Array<{ id: 'curso' | 'diplomado' | 'master'; texto: string }> = [
  { id: 'curso', texto: 'Curso' },
  { id: 'diplomado', texto: 'Diplomado' },
  { id: 'master', texto: 'Máster' },
];

type Form = Record<'curso' | 'diplomado' | 'master', string>;
const formDe = (r: ReglaDeAcceso): Form => ({ curso: String(r.curso), diplomado: String(r.diplomado), master: String(r.master) });

export default function AccesoAlumnosCampus({ campusId, regla, alGuardar }: {
  campusId: number;
  regla: ReglaDeAcceso;
  alGuardar: (r: ReglaDeAcceso) => void;
}) {
  const [form, setForm] = useState<Form>(() => formDe(regla));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setForm(formDe(regla)); }, [regla]);

  const valor = (t: keyof Form) => (form[t].trim() === '' ? null : Number(form[t]));
  const malo = TIPOS.find((t) => {
    const v = valor(t.id);
    return v !== null && (!Number.isInteger(v) || v < 1 || v > 120);
  });

  async function guardar() {
    setGuardando(true);
    try {
      const r = await alumnosApi.guardarRegla(campusId, { curso: valor('curso'), diplomado: valor('diplomado'), master: valor('master') });
      if (r.data) alGuardar(r.data);
      toast({ title: 'Tiempo de acceso guardado' });
    } catch (e) {
      toast({ title: 'No se ha podido guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <details className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-foreground">
        <Clock size={15} aria-hidden="true" /> Tiempo de acceso de los alumnos
        <span className="text-xs font-normal text-muted-foreground">
          (curso {regla.curso}, diplomado {regla.diplomado}, máster {regla.master} meses{regla.configurada ? '' : ' · de serie'})
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          Para las formaciones sin fecha de fin ni duración publicada: cuántos meses tiene acceso un alumno desde su inicio (o
          desde la venta). Vacío = la de serie. Si la formación tiene fecha de fin o duración, mandan esas.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          {TIPOS.map((t) => (
            <label key={t.id} className="flex flex-col gap-1 text-xs font-medium text-foreground">
              {t.texto} (meses)
              <input
                type="number" min={1} max={120} inputMode="numeric" value={form[t.id]}
                onChange={(e) => setForm((f) => ({ ...f, [t.id]: e.target.value }))}
                aria-label={`Meses de acceso: ${t.texto}`} className={`${inputClass} w-24`}
              />
            </label>
          ))}
          <button
            type="button" onClick={guardar} disabled={guardando || Boolean(malo)}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <FloppyDisk size={14} aria-hidden="true" /> {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        {malo && <p className="text-xs text-destructive" role="alert">{malo.texto}: entre 1 y 120 meses.</p>}
      </div>
    </details>
  );
}
