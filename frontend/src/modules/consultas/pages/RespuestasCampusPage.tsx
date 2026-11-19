import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import { consultasApi, type RespuestaGuardada } from '../api/consultas.api';
import ConsultasNav, { mensajeDeError, useQuienSoy } from '../components/ConsultasNav';

/*
  RESPUESTAS DEL CAMPUS (#679): las que coordinación deja preparadas para todas las
  tutoras de un campus («Plazo ampliado», «Dónde está el temario»…). Les salen en el
  chat, en «Respuestas guardadas», marcadas «Del campus». Una lista, un formulario y
  nada más.
*/

type Editando = { id: number | null; titulo: string; texto: string };

export default function RespuestasCampusPage() {
  const { activeProject } = useProjectContext() as unknown as { activeProject: { id: number; nombre: string } | null };
  const [todas, setTodas] = useState<RespuestaGuardada[] | null>(null);
  const [editando, setEditando] = useState<Editando | null>(null);
  const [borrando, setBorrando] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { coordina } = useQuienSoy();

  const cargar = useCallback(async () => {
    try {
      const r = await consultasApi.respuestas();
      setTodas(r.data || []);
    } catch (e) { toast({ title: 'No se han podido leer las respuestas', description: mensajeDeError(e), variant: 'destructive' }); setTodas([]); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const delCampus = useMemo(
    () => (todas || []).filter((r) => !r.personal && activeProject && r.project_id === activeProject.id),
    [todas, activeProject]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando || !activeProject || !editando.titulo.trim() || !editando.texto.trim()) return;
    setOcupado(true);
    try {
      const r = editando.id
        ? await consultasApi.cambiarRespuesta(editando.id, { titulo: editando.titulo, texto: editando.texto })
        : await consultasApi.crearRespuesta({ titulo: editando.titulo, texto: editando.texto, projectId: activeProject.id });
      setTodas(r.data || []);
      setEditando(null);
      toast({ title: editando.id ? 'Respuesta cambiada' : 'Respuesta añadida', description: `Ya la tienen todas las tutoras de ${activeProject.nombre}.` });
    } catch (err) {
      toast({ title: 'No se ha podido guardar', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function borrar(id: number) {
    setOcupado(true);
    try {
      const r = await consultasApi.borrarRespuesta(id);
      setTodas(r.data || []);
      setBorrando(null);
      toast({ title: 'Respuesta borrada' });
    } catch (err) {
      toast({ title: 'No se ha podido borrar', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  const formulario = editando && (
    <form onSubmit={guardar} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1.5">
        <label htmlFor="resp-titulo" className="text-secundario font-medium text-foreground">Nombre corto</label>
        <input id="resp-titulo" value={editando.titulo} maxLength={120} autoFocus
          onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} placeholder="Por ejemplo: Plazo ampliado"
          className={cn(inputClass, 'h-9')} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="resp-texto" className="text-secundario font-medium text-foreground">Texto</label>
        <textarea id="resp-texto" value={editando.texto} rows={4} maxLength={8000}
          onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
          placeholder="Hola {nombre}, …"
          className={cn(inputClass, 'block w-full resize-y py-2 leading-6')} />
        <p className="text-secundario text-muted-foreground"><code className="rounded bg-muted px-1">{'{nombre}'}</code> se cambia por el nombre del alumno al usarla.</p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={ocupado || !editando.titulo.trim() || !editando.texto.trim()}>{editando.id ? 'Guardar cambios' : 'Añadir'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
      </div>
    </form>
  );

  if (!coordina) {
    return (
      <div className="space-y-4 pb-8">
        <ConsultasNav />
        <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-secundario text-muted-foreground">
          Las respuestas del campus las prepara coordinación. Las tuyas las guardas desde el chat, en «Respuestas guardadas».
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader title="Respuestas del campus"
        subtitle={activeProject ? `Las que tienen preparadas todas las tutoras de ${activeProject.nombre}` : 'Elige un campus arriba'}
        actions={activeProject && !editando && (
          <Button size="sm" className="h-8" onClick={() => setEditando({ id: null, titulo: '', texto: '' })}>
            <Plus size={14} weight="bold" className="mr-1.5" aria-hidden /> Nueva
          </Button>
        )} />

      {!activeProject && (
        <p className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-secundario text-muted-foreground">
          Elige un campus en el selector de arriba para ver y preparar sus respuestas.
        </p>
      )}

      {activeProject && editando && !editando.id && formulario}

      {activeProject && todas && delCampus.length === 0 && !editando && (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <BookmarkSimple size={22} className="mx-auto text-muted-foreground" aria-hidden />
          <p className="mt-2 text-normal font-semibold text-foreground">Este campus aún no tiene respuestas preparadas</p>
          <p className="mx-auto mt-1 max-w-sm text-secundario text-muted-foreground">Las que añadas aquí les saldrán a todas sus tutoras en el chat, en «Respuestas guardadas».</p>
        </div>
      )}

      {activeProject && delCampus.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {delCampus.map((r) => (
            <li key={r.id} className="px-4 py-3">
              {editando?.id === r.id ? formulario : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-normal font-medium text-foreground">{r.titulo}</p>
                    <p className="line-clamp-2 text-secundario text-muted-foreground">{r.texto}</p>
                  </div>
                  {borrando === r.id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-secundario text-muted-foreground">¿Borrar?</span>
                      <Button size="sm" variant="destructive" className="h-7" disabled={ocupado} onClick={() => borrar(r.id)}>Sí</Button>
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => setBorrando(null)}>No</Button>
                    </span>
                  ) : (
                    <span className="flex shrink-0 gap-0.5">
                      <button type="button" aria-label={`Editar «${r.titulo}»`} onClick={() => setEditando({ id: r.id, titulo: r.titulo, texto: r.texto })}
                        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><PencilSimple size={15} aria-hidden /></button>
                      <button type="button" aria-label={`Borrar «${r.titulo}»`} onClick={() => setBorrando(r.id)}
                        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"><Trash size={15} aria-hidden /></button>
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
