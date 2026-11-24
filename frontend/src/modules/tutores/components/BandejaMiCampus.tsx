import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatCircleText, CheckCircle, ClipboardText, PaperPlaneRight } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import { consultasApi, type ConsultaFila } from '@/modules/consultas/api/consultas.api';
import type { MiCampus } from '../api/tutores.api';

/*
  LO QUE HAY QUE HACER, EN UN SOLO SITIO (Diego, 24/11: «que ahí también, no solo sean
  consultas, sino que lleguen las tareas y corregirlas desde ahí… para las tutoras
  redactoras, y que puedan ver entre uno y varios campus»).

  · El selector de campus: todos juntos, o uno o varios. Se recuerda en este navegador.
  · «Por responder»: sus consultas abiertas (las de Consultas, no una copia), con el
    último mensaje y la respuesta escrita aquí mismo. La conversación entera, adjuntos y
    respuestas guardadas siguen en la consulta: «Abrir».
  · «Por corregir»: cada entrega sin nota, la más antigua primero. «Corregir» abre esa
    entrega en la pantalla de corregir de Mi campus (nota y comentario a Moodle).
*/

// ─── Qué campus se ven ──────────────────────────────────────────────────────

const CLAVE_CAMPUS = 'crm.miCampus.campus.v1';

/** Los campus elegidos la última vez; [] = todos. Sin almacenamiento (privado, pruebas), todos. */
export function leerCampusElegidos(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE_CAMPUS) || '[]');
    return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  } catch { return []; }
}

export function guardarCampusElegidos(ids: number[]) {
  try {
    if (ids.length) localStorage.setItem(CLAVE_CAMPUS, JSON.stringify(ids));
    else localStorage.removeItem(CLAVE_CAMPUS);
  } catch { /* sin almacenamiento: se elige cada vez */ }
}

/**
 * Pulsar un campus: desde «Todos», se queda solo ese; si no, se suma o se quita. Quitar el
 * último, o tenerlos todos, es lo mismo que «Todos».
 */
export function alternarCampus(elegidos: number[], id: number, total: number): number[] {
  if (!elegidos.length) return total > 1 ? [id] : [];
  const siguen = elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id];
  return siguen.length === 0 || siguen.length >= total ? [] : siguen;
}

const chip = 'inline-flex h-8 items-center rounded-full border px-3 text-secundario font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SelectorCampus({ todos, elegidos, cambiar, cargando }: {
  todos: Array<{ projectId: number; campus: string }>;
  elegidos: number[];
  cambiar: (ids: number[]) => void;
  cargando?: boolean;
}) {
  const todosActivos = elegidos.length === 0;
  const estilo = (activo: boolean) => cn(chip, activo
    ? 'border-primary bg-primary/10 text-primary'
    : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground');
  return (
    <div role="group" aria-label="Campus que ves" data-recorrido="mi-campus-selector" aria-busy={cargando || undefined}
      className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-secundario text-muted-foreground">Campus:</span>
      <button type="button" aria-pressed={todosActivos} onClick={() => cambiar([])} className={estilo(todosActivos)}>
        Todos <span className="ml-1 tabular-nums opacity-70">{todos.length}</span>
      </button>
      {todos.map((c) => {
        const activo = !todosActivos && elegidos.includes(c.projectId);
        return (
          <button key={c.projectId} type="button" aria-pressed={activo} onClick={() => cambiar(alternarCampus(elegidos, c.projectId, todos.length))}
            className={estilo(activo)}>
            {c.campus}
          </button>
        );
      })}
    </div>
  );
}

// ─── Por corregir ───────────────────────────────────────────────────────────

export interface EntregaPorCorregir {
  projectId: number; campus: string; cursoId: number; curso: string | null;
  tareaId: number; tarea: string | null; alumnoId: number; alumno: string | null; entregadaAt: string | null;
}

/** Todas las entregas sin nota de lo leído, la más antigua primero (sin fecha, al final). */
export function entregasPorCorregir(datos: MiCampus | null): EntregaPorCorregir[] {
  const lista: EntregaPorCorregir[] = [];
  for (const c of datos?.campus || []) {
    for (const k of c.cursos) {
      for (const t of k.tareas) {
        for (const e of t.sinCorregir) {
          lista.push({
            projectId: c.projectId, campus: c.campus, cursoId: k.id, curso: k.nombre,
            tareaId: t.id, tarea: t.nombre, alumnoId: e.alumnoId, alumno: e.alumno, entregadaAt: e.entregadaAt,
          });
        }
      }
    }
  }
  const t = (x: string | null) => (x ? new Date(x).getTime() : Number.MAX_SAFE_INTEGER);
  return lista.sort((a, b) => t(a.entregadaAt) - t(b.entregadaAt));
}

const corregirEn = (e: EntregaPorCorregir) => `/mis-cursos/campus/tarea/${e.projectId}/${e.cursoId}/${e.tareaId}?alumno=${e.alumnoId}`;

function haceCuanto(iso: string | null) {
  if (!iso) return null;
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

const VISIBLES = 6;

function Cabecera({ icono, titulo, n, tono }: { icono: React.ReactNode; titulo: string; n: number; tono: 'duda' | 'corregir' }) {
  return (
    <h3 className="flex items-center gap-2 py-2 text-normal font-semibold text-foreground">
      <span aria-hidden className={cn('grid h-7 w-7 place-items-center rounded-md',
        tono === 'corregir' ? 'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground' : 'bg-info-soft dark:bg-info/15 text-info-soft-foreground')}>
        {icono}
      </span>
      {titulo}
      <span className="rounded-full bg-muted px-2 py-0.5 text-secundario font-medium tabular-nums text-muted-foreground">{n}</span>
    </h3>
  );
}

function VerMas({ total, todas, alternar }: { total: number; todas: boolean; alternar: () => void }) {
  if (total <= VISIBLES) return null;
  return (
    <button type="button" onClick={alternar} className="mt-1 text-secundario font-medium text-primary hover:underline">
      {todas ? 'Ver menos' : `Ver las ${total}`}
    </button>
  );
}

export function PorCorregir({ entregas }: { entregas: EntregaPorCorregir[] }) {
  const [todas, setTodas] = useState(false);
  const vistas = todas ? entregas : entregas.slice(0, VISIBLES);
  return (
    <div data-recorrido="mi-campus-corregir" data-testid="por-corregir">
      <Cabecera tono="corregir" icono={<ClipboardText size={14} weight="bold" />} titulo="Por corregir" n={entregas.length} />
      {entregas.length === 0 ? (
        <p className="flex items-center gap-1.5 pb-2 text-secundario text-muted-foreground">
          <CheckCircle size={13} weight="fill" className="text-success" aria-hidden /> Ninguna entrega esperando nota.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {vistas.map((e) => (
            <li key={`${e.projectId}-${e.tareaId}-${e.alumnoId}`} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-normal font-medium text-foreground">{e.alumno || 'Alumno'} <span className="font-normal text-muted-foreground">· {e.tarea || 'Tarea'}</span></p>
                <p className="truncate text-secundario text-muted-foreground">
                  {e.campus} · {e.curso || `Curso ${e.cursoId}`}{e.entregadaAt ? ` · entregada ${haceCuanto(e.entregadaAt)}` : ''}
                </p>
              </div>
              <Link to={corregirEn(e)} aria-label={`Corregir la entrega de ${e.alumno || 'el alumno'} en ${e.tarea || 'la tarea'}`}
                className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-card px-3 text-secundario font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Corregir
              </Link>
            </li>
          ))}
        </ul>
      )}
      <VerMas total={entregas.length} todas={todas} alternar={() => setTodas((x) => !x)} />
    </div>
  );
}

// ─── Por responder ──────────────────────────────────────────────────────────

function ConsultaPorResponder({ c, plazoHoras, respondida }: { c: ConsultaFila; plazoHoras: number; respondida: (id: number) => void }) {
  const [abierta, setAbierta] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const desde = c.espera_desde || c.entrada_at;
  const fueraDePlazo = desde ? Date.now() - new Date(desde).getTime() > plazoHoras * 3600000 : false;
  const campo = `respuesta-${c.id}`;

  async function enviar() {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setEnviando(true);
    try {
      const r = await consultasApi.responder(c.id, limpio, []);
      if (r?.data && r.data.enviado === false) {
        toast({ title: 'Respuesta guardada, pero no ha llegado al campus', description: r.data.error || 'Reinténtalo desde la consulta.', variant: 'destructive' });
      } else {
        toast({ title: 'Respuesta enviada', description: `${c.alumno_nombre || 'El alumno'} la verá en Moodle.` });
      }
      respondida(c.id);
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido enviar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <li className="py-2" data-testid="consulta-por-responder">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-normal font-medium text-foreground">{c.alumno_nombre || 'Alumno'}</p>
          <p className="truncate text-secundario text-muted-foreground">
            {c.campus}{c.curso_nombre ? ` · ${c.curso_nombre}` : ''}
            {desde && <> · <span className={fueraDePlazo ? 'font-medium text-destructive' : ''}>espera {haceCuanto(desde)}</span></>}
          </p>
          {c.ultimo_mensaje && (
            <p className="mt-1 line-clamp-2 text-secundario text-foreground/80">«{c.ultimo_mensaje}»</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link to={`/consultas/${c.id}`} className="inline-flex h-8 items-center rounded-md px-2 text-secundario font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            Abrir
          </Link>
          {!abierta && (
            <Button size="sm" variant="outline" className="h-8 text-secundario" onClick={() => setAbierta(true)} aria-controls={campo}>
              Responder
            </Button>
          )}
        </div>
      </div>
      {abierta && (
        <div className="mt-2 space-y-2">
          <label htmlFor={campo} className="sr-only">Tu respuesta a {c.alumno_nombre || 'el alumno'}</label>
          <textarea id={campo} value={texto} autoFocus rows={3} maxLength={20000}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } }}
            placeholder="Escribe tu respuesta. Le llega al alumno en Moodle, a tu nombre."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-normal text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="mr-auto text-secundario text-muted-foreground">Ctrl + Intro para enviar. Para adjuntar, ábrela.</span>
            <Button size="sm" variant="ghost" className="h-8 text-secundario" onClick={() => { setAbierta(false); setTexto(''); }} disabled={enviando}>Cancelar</Button>
            <Button size="sm" className="h-8 text-secundario" onClick={enviar} disabled={enviando || !texto.trim()}>
              <PaperPlaneRight size={13} className="mr-1.5" aria-hidden /> {enviando ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

export function PorResponder({ consultas, plazoHoras, error, respondida }: {
  consultas: ConsultaFila[] | null; plazoHoras: number; error: string | null; respondida: (id: number) => void;
}) {
  const [todas, setTodas] = useState(false);
  const lista = consultas || [];
  const vistas = todas ? lista : lista.slice(0, VISIBLES);
  return (
    <div data-recorrido="mi-campus-responder" data-testid="por-responder">
      <Cabecera tono="duda" icono={<ChatCircleText size={14} weight="bold" />} titulo="Por responder" n={lista.length} />
      {error ? (
        <p className="pb-2 text-secundario text-muted-foreground">{error} <Link to="/consultas" className="font-medium text-primary hover:underline">Ir a Consultas</Link></p>
      ) : consultas === null ? (
        <div className="h-10 animate-pulse rounded-md bg-muted" aria-label="Leyendo tus consultas" />
      ) : lista.length === 0 ? (
        <p className="flex items-center gap-1.5 pb-2 text-secundario text-muted-foreground">
          <CheckCircle size={13} weight="fill" className="text-success" aria-hidden /> Ninguna consulta esperando respuesta.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {vistas.map((c) => <ConsultaPorResponder key={c.id} c={c} plazoHoras={plazoHoras} respondida={respondida} />)}
        </ul>
      )}
      <VerMas total={lista.length} todas={todas} alternar={() => setTodas((x) => !x)} />
    </div>
  );
}
