import { useState } from 'react';
import { GraduationCap, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import { cursosApi, TIPOS, type ResumenCampus, type TipoCurso } from '../api/cursosPendientes.api';

/**
 * Un pendiente nuevo: para cuando se vende algo que todavía no existe en el campus.
 * Una formación, un pendiente abierto por campus: si ya hay uno de esa formación,
 * el servidor no crea otro y avisa (las alumnas se suman desde su ficha).
 */
export default function NuevoPendiente({ campus, campusInicial, onCerrar, onCreado }: {
  campus: ResumenCampus[];
  campusInicial: number | null;
  onCerrar: () => void;
  onCreado: () => void;
}) {
  const [proyecto, setProyecto] = useState<number | ''>(campusInicial ?? (campus.length === 1 ? campus[0].project_id : ''));
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<TipoCurso>('curso');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!proyecto || !nombre.trim()) return;
    setGuardando(true);
    try {
      const r = await cursosApi.crear({ project_id: proyecto, nombre: nombre.trim(), tipo });
      toast(r.nuevo
        ? { title: 'Pendiente creado', description: 'Ahora hay que asignarle una tutora.' }
        : { title: 'Ya había uno abierto', description: 'Esa formación ya tiene un pendiente abierto en ese campus: no se ha duplicado.' });
      onCreado();
    } catch (e) {
      toast({ title: 'No se pudo crear', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCerrar}>
        <div role="dialog" aria-modal="true" aria-label="Nuevo pendiente"
          className="w-full max-w-md rounded-md border border-border bg-card shadow-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="flex items-center gap-2 font-semibold"><GraduationCap size={16} /> Nuevo pendiente</h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Campus" required htmlFor="np-campus">
              <select id="np-campus" value={proyecto} onChange={(e) => setProyecto(e.target.value ? Number(e.target.value) : '')} className={inputClass}>
                <option value="">Elige el campus</option>
                {campus.map((c) => <option key={c.project_id} value={c.project_id}>{c.campus}</option>)}
              </select>
            </Field>
            <Field label="Formación" required hint="Tal como se vendió." htmlFor="np-nombre">
              <input id="np-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={255} className={inputClass} />
            </Field>
            <Field label="Tipo" htmlFor="np-tipo" hint="Para medir la carga: un máster pesa más.">
              <select id="np-tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoCurso)} className={inputClass}>
                {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onCerrar} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">Cancelar</button>
            <button type="button" onClick={guardar} disabled={guardando || !proyecto || !nombre.trim()}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Crear'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
