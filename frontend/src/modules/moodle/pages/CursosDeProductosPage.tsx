import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, GraduationCap, LinkSimple, MagnifyingGlass, PencilSimple, Warning, X } from '@phosphor-icons/react';
import ElegirCampus from '@/shared/components/ui/ElegirCampus';
import BuscadorEnLista from '@/shared/components/ui/BuscadorEnLista';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import { useCampusDeLaPantalla } from '@/shared/hooks/useCampusDeLaPantalla';
import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';
import { toast } from '@/shared/hooks/useToast';
import {
  cursosProductoApi, type CursoDelMoodle, type ProductoConCurso, type ResumenCursosProducto,
} from '../api/cursosProducto.api';

/**
 * Académico › Cursos de Moodle (CRM#957): qué curso de Moodle es cada producto
 * del catálogo, campus a campus. Lo necesita la matrícula automática (#767): sin
 * curso, no sabe dónde matricular a quien compra ese producto.
 *
 * Una fila por producto (una línea): su curso o «Sin curso», y «Elegir» /
 * «Cambiar» / quitar. El curso se elige de la lista que da el Moodle del campus,
 * escribiendo. Al elegirlo se guarda; el servidor comprueba que el curso existe
 * en ese Moodle y guarda el nombre que dice Moodle.
 */

type Filtro = 'todos' | 'sin_curso' | 'con_curso' | 'vendidos_sin_curso';
const FILTROS: Array<{ id: Filtro; label: string; corto?: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'sin_curso', label: 'Sin curso' },
  { id: 'con_curso', label: 'Con curso' },
  // En el móvil, «Vendidos»: los cuatro caben en una línea.
  { id: 'vendidos_sin_curso', label: 'Vendidos sin curso', corto: 'Vendidos' },
];

const cuenta = (f: Filtro, r: ResumenCursosProducto) => (
  { todos: r.total, sin_curso: r.sin_curso, con_curso: r.con_curso, vendidos_sin_curso: r.vendidos_sin_curso }[f]);

const nombreCurso = (c: { curso_nombre?: string | null; nombre?: string | null }, id: number) =>
  c.curso_nombre || c.nombre || `Curso ${id}`;

const pasaFiltro = (p: ProductoConCurso, f: Filtro) => {
  if (f === 'sin_curso') return !p.cursos.length;
  if (f === 'con_curso') return p.cursos.length > 0;
  if (f === 'vendidos_sin_curso') return !p.cursos.length && p.ventas > 0;
  return true;
};

export default function CursosDeProductosPage() {
  const campus = useCampusDeLaPantalla();
  const [productos, setProductos] = useState<ProductoConCurso[]>([]);
  const [resumen, setResumen] = useState<ResumenCursosProducto | null>(null);
  const [cursos, setCursos] = useState<CursoDelMoodle[] | null>(null);
  const [errorMoodle, setErrorMoodle] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [cargandoCursos, setCargandoCursos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [editando, setEditando] = useState<number | null>(null);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState<ProductoConCurso | null>(null);

  const cargarProductos = useCallback(async (id: number) => {
    setCargando(true);
    setError(null);
    try {
      const r = await cursosProductoApi.productos(id);
      setProductos(r.data?.productos ?? []);
      setResumen(r.data?.resumen ?? null);
    } catch (e) {
      setError((e as Error).message);
      setProductos([]);
      setResumen(null);
    } finally { setCargando(false); }
  }, []);

  const cargarCursos = useCallback(async (id: number, refrescar = false) => {
    setCargandoCursos(true);
    setErrorMoodle(null);
    try {
      const r = await cursosProductoApi.cursosMoodle(id, refrescar);
      setCursos(r.data?.cursos ?? []);
    } catch (e) {
      setCursos(null);
      setErrorMoodle((e as Error).message);
    } finally { setCargandoCursos(false); }
  }, []);

  useEffect(() => {
    setEditando(null);
    setTexto('');
    if (!campus.id) { setProductos([]); setResumen(null); setCursos(null); return; }
    cargarProductos(campus.id);
    cargarCursos(campus.id);
  }, [campus.id, cargarProductos, cargarCursos]);

  const visibles = useMemo(() => productos
    .filter((p) => pasaFiltro(p, filtro))
    .filter((p) => !texto.trim() || casaPorTrozos(texto, p.nombre, p.cursos.map((c) => nombreCurso(c, c.curso_moodle_id)).join(' '))),
  [productos, filtro, texto]);

  const opciones = useMemo(() => (cursos ?? []).map((c) => ({
    id: c.id,
    nombre: nombreCurso(c, c.id),
    nota: `#${c.id}${c.visible ? '' : ' · oculto'}`,
  })), [cursos]);

  function ponerCursos(productoId: number, nuevos: ProductoConCurso['cursos']) {
    const lista = productos.map((p) => (p.id === productoId ? { ...p, cursos: nuevos } : p));
    setProductos(lista);
    const sin = lista.filter((p) => !p.cursos.length);
    setResumen({ total: lista.length, con_curso: lista.length - sin.length, sin_curso: sin.length, vendidos_sin_curso: sin.filter((p) => p.ventas > 0).length });
  }

  async function unir(p: ProductoConCurso, cursoId: number | null) {
    if (!campus.id || cursoId == null) return;
    setGuardando(p.id);
    try {
      const r = await cursosProductoApi.unir(campus.id, p.id, cursoId);
      ponerCursos(p.id, [{ curso_moodle_id: cursoId, curso_nombre: r.data?.curso_nombre ?? null }]);
      setEditando(null);
      toast({ title: 'Curso guardado', description: `${p.nombre} → ${r.data?.curso_nombre ?? `curso ${cursoId}`}` });
    } catch (e) {
      toast({ title: 'No se pudo guardar el curso', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(null); }
  }

  async function quitar() {
    const p = quitando;
    if (!campus.id || !p) return;
    setGuardando(p.id);
    try {
      await cursosProductoApi.quitar(campus.id, p.id);
      ponerCursos(p.id, []);
      toast({ title: 'Curso quitado', description: `${p.nombre} se queda sin curso de Moodle` });
    } catch (e) {
      toast({ title: 'No se pudo quitar el curso', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(null); setQuitando(null); }
  }

  const sinMoodle = !!errorMoodle;

  return (
    <div className="space-y-3 pb-8">
      {/* Cabecera: una línea. */}
      <div className="flex items-center gap-2 sm:gap-3">
        <h1 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground sm:text-lg">
          <GraduationCap size={20} weight="duotone" aria-hidden="true" className="shrink-0 text-primary" />
          <span className="truncate">Cursos de Moodle</span>
        </h1>
        {resumen && (
          <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:inline">
            {resumen.con_curso} de {resumen.total} con curso
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {campus.id && (
            <button type="button" onClick={() => campus.id && cargarCursos(campus.id, true)} disabled={cargandoCursos}
              title="Volver a pedir la lista de cursos a Moodle" aria-label="Actualizar cursos"
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-60"
              data-recorrido="cursos-producto-actualizar">
              <ArrowClockwise size={13} weight="bold" aria-hidden="true" className={cargandoCursos ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Actualizar cursos</span>
            </button>
          )}
          <VerRecorrido id="cursos-producto" listo={!!campus.id && !cargando && productos.length > 0} compacto />
        </div>
      </div>

      <ElegirCampus campus={campus} que="los productos" />

      {!campus.id ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Elige un campus para ver sus productos.
        </p>
      ) : (
        <>
          {errorMoodle && (
            <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" role="status">
              <Warning size={15} weight="bold" aria-hidden="true" className="shrink-0" />
              <span className="min-w-0">{errorMoodle}</span>
            </p>
          )}
          {resumen && resumen.vendidos_sin_curso > 0 && (
            <button type="button" onClick={() => setFiltro('vendidos_sin_curso')}
              className="flex w-full items-center gap-2 rounded-md bg-destructive-soft px-3 py-2 text-left text-sm text-destructive-soft-foreground hover:opacity-90"
              data-recorrido="cursos-producto-aviso">
              <Warning size={15} weight="bold" aria-hidden="true" className="shrink-0" />
              <span className="min-w-0 flex-1">
                <strong className="font-semibold tabular-nums">{resumen.vendidos_sin_curso}</strong>
                {resumen.vendidos_sin_curso === 1 ? ' producto vendido sin curso' : ' productos vendidos sin curso'}
                <span className="hidden sm:inline">: la matrícula automática no puede matricular a sus alumnos</span>
              </span>
              <span className="shrink-0 text-xs font-semibold underline">Ver</span>
            </button>
          )}

          {/* Buscar y filtrar. */}
          <div className="flex flex-wrap items-center gap-2" data-recorrido="cursos-producto-filtros">
            <label className="flex h-8 min-w-0 flex-1 basis-56 items-center gap-2 rounded-md border border-border bg-card px-2.5 focus-within:border-primary">
              <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
              <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar producto o curso…"
                aria-label="Buscar producto o curso" autoComplete="off"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {texto && (
                <button type="button" onClick={() => setTexto('')} aria-label="Limpiar búsqueda" className="text-muted-foreground hover:text-foreground">
                  <X size={13} weight="bold" />
                </button>
              )}
            </label>
            <div className="flex max-w-full gap-1 overflow-x-auto" role="group" aria-label="Filtrar productos">
              {FILTROS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id} title={f.label}
                  className={`inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-xs font-semibold sm:px-2.5 ${filtro === f.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>
                  <span className="sm:hidden">{f.corto ?? f.label}</span>
                  <span className="hidden sm:inline">{f.label}</span>
                  {resumen && <span className="tabular-nums opacity-70">{cuenta(f.id, resumen)}</span>}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground" role="alert">{error}</p>
          ) : cargando ? (
            <div className="space-y-1" aria-busy="true" aria-label="Cargando productos">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-md bg-muted/60 animate-pulse" />)}
            </div>
          ) : visibles.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {productos.length === 0 ? 'Este campus no tiene productos en el catálogo.' : 'Ningún producto con ese filtro.'}
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card" data-recorrido="cursos-producto-lista">
              {visibles.map((p) => {
                const curso = p.cursos[0];
                const abierto = editando === p.id;
                const ocupado = guardando === p.id;
                return (
                  <li key={p.id} data-producto={p.id}>
                    <div className="flex items-center gap-2 px-3 py-2 sm:gap-3">
                      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-3">
                        <div className="flex min-w-0 items-center gap-1.5 sm:w-[45%] sm:shrink-0">
                          <span className="truncate text-sm font-medium text-foreground" title={p.nombre}>{p.nombre}</span>
                          {!p.activo && <span className="shrink-0 rounded bg-muted px-1.5 text-[11px] text-muted-foreground">desactivado</span>}
                          {p.ventas > 0 && (
                            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums" title="Ventas de este producto en el campus">
                              {p.ventas} {p.ventas === 1 ? 'venta' : 'ventas'}
                            </span>
                          )}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5 text-xs sm:text-sm">
                          {curso ? (
                            <>
                              <LinkSimple size={13} aria-hidden="true" className="shrink-0 text-success" />
                              <span className="truncate text-foreground" title={nombreCurso(curso, curso.curso_moodle_id)}>
                                {nombreCurso(curso, curso.curso_moodle_id)}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">#{curso.curso_moodle_id}</span>
                              {p.cursos.length > 1 && (
                                <span className="shrink-0 text-[11px] text-muted-foreground" title={p.cursos.map((c) => nombreCurso(c, c.curso_moodle_id)).join(' · ')}>
                                  +{p.cursos.length - 1}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className={p.ventas > 0 ? 'font-medium text-destructive' : 'text-muted-foreground'}>Sin curso</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => setEditando(abierto ? null : p.id)} disabled={sinMoodle || ocupado}
                          title={sinMoodle ? 'El Moodle del campus no responde' : undefined}
                          className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                          <PencilSimple size={13} weight="bold" aria-hidden="true" />
                          {curso ? 'Cambiar' : 'Elegir'}
                        </button>
                        {curso && (
                          <button type="button" onClick={() => setQuitando(p)} disabled={ocupado}
                            aria-label={`Quitar el curso de ${p.nombre}`} title="Quitar el curso"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive-soft hover:text-destructive-soft-foreground disabled:opacity-50">
                            <X size={14} weight="bold" />
                          </button>
                        )}
                      </div>
                    </div>
                    {abierto && (
                      <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <BuscadorEnLista
                            opciones={opciones}
                            valor={null}
                            excluir={p.cursos.length === 1 ? [p.cursos[0].curso_moodle_id] : []}
                            onElegir={(id) => unir(p, id)}
                            autoFocus
                            placeholder={cargandoCursos ? 'Cargando cursos de Moodle…' : `Busca entre los ${opciones.length} cursos del Moodle…`}
                            sinResultados="Ningún curso de este Moodle con «{texto}»."
                            yaEstaFuera="«{nombre}» ya es su curso."
                          />
                        </div>
                        <button type="button" onClick={() => setEditando(null)} disabled={ocupado}
                          className="h-9 shrink-0 rounded-md px-2.5 text-xs font-semibold text-muted-foreground hover:bg-muted">
                          {ocupado ? 'Guardando…' : 'Cancelar'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!quitando}
        tone="destructive"
        title="¿Quitar el curso?"
        message={quitando ? `«${quitando.nombre}» se queda sin curso de Moodle: la matrícula automática no podrá matricular a quien lo compre.` : ''}
        confirmLabel="Quitar"
        loading={guardando != null}
        onConfirm={quitar}
        onCancel={() => setQuitando(null)}
      />
    </div>
  );
}
