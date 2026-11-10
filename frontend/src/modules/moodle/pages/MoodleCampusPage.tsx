import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowsClockwise, GearSix, GraduationCap, MagnifyingGlass, WarningCircle, X } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { cn } from '@/shared/lib/utils';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Card from '@/shared/components/ui/Card';
import Select from '@/shared/components/ui/Select';
import Paginacion from '@/shared/components/ui/Paginacion';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import {
  moodleApi, type CampusMoodle, type CategoriaMoodle, type CursoMoodle, type FiltroEstado, type ListaCursos, type OrdenCursos, type RespuestaCampus, type SentidoOrden,
} from '../api/moodle.api';
import ConectarMoodle from '../components/ConectarMoodle';
import AjustesConexion from '../components/AjustesConexion';
import EstadoDeCursos from '../components/EstadoDeCursos';
import TablaCursos from '../components/TablaCursos';
import DetalleCurso from '../components/DetalleCurso';
import ParaRevisar from '../components/ParaRevisar';

/**
 * Conexión → Moodle → un campus (#335): sus cursos.
 *
 *   volver · estado de los cursos (cinco tarjetas con su recuento) · «Para revisar» · buscador y
 *   categoría · tabla ordenable y paginada · detalle de un curso en un panel lateral.
 *
 * Lo que se está viendo (estado, búsqueda, categoría, orden, página y filas) vive en la
 * DIRECCIÓN: recargar, volver atrás o pasar el enlace a otra persona deja la pantalla como estaba.
 * Se llega desde la lista de campus (`/conexion/moodle`).
 */

const ESTADOS: FiltroEstado[] = ['activos', 'proximos', 'terminados', 'ocultos', 'todos'];
const ORDENES: OrdenCursos[] = ['nombre', 'categoria', 'inicio', 'fin'];
const FILAS = [10, 25, 50, 100];
/** Lo que NO se escribe en la dirección: es lo de siempre. */
const POR_DEFECTO: Record<string, string> = { estado: 'activos', orden: 'nombre', sentido: 'asc', filas: '25', pagina: '1' };

const hace = (s: number | undefined) => {
  if (s === undefined || s < 45) return 'Datos recién leídos de Moodle';
  const min = Math.round(s / 60);
  return `Datos de hace ${min} min`;
};

function Volver() {
  return (
    <Link
      to="/conexion/moodle"
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <ArrowLeft size={15} weight="bold" /> Todos los campus
    </Link>
  );
}

export default function MoodleCampusPage() {
  const { campusId } = useParams();
  const id = Number(campusId);
  const { user } = useAuth() as { user: { role?: string } | null };

  const [campus, setCampus] = useState<CampusMoodle | null | undefined>(undefined); // undefined = cargando; null = no existe
  const [params, setParams] = useSearchParams();
  const estadoUrl = params.get('estado') as FiltroEstado;
  const estado: FiltroEstado = ESTADOS.includes(estadoUrl) ? estadoUrl : 'activos';
  const busqueda = params.get('q') ?? '';
  const categoria = Number(params.get('cat')) > 0 ? Number(params.get('cat')) : null;
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);
  const limiteUrl = Number(params.get('filas'));
  const limite = FILAS.includes(limiteUrl) ? limiteUrl : 25;
  const ordenUrl = params.get('orden') as OrdenCursos;
  const orden: OrdenCursos = ORDENES.includes(ordenUrl) ? ordenUrl : 'nombre';
  const sentido: SentidoOrden = params.get('sentido') === 'desc' ? 'desc' : 'asc';
  /** Cambia lo que se ve: lo escribe en la dirección (sin añadir una entrada al historial por cada tecla). */
  const cambiar = useCallback((cambios: Record<string, string | number | null>) => {
    setParams((previos) => {
      const nuevos = new URLSearchParams(previos);
      for (const [k, v] of Object.entries(cambios)) {
        if (v === null || v === '' || String(v) === POR_DEFECTO[k]) nuevos.delete(k);
        else nuevos.set(k, String(v));
      }
      return nuevos;
    }, { replace: true });
  }, [setParams]);
  const [texto, setTexto] = useState(busqueda);
  const [categorias, setCategorias] = useState<CategoriaMoodle[]>([]);
  const [version, setVersion] = useState(0);
  const [lista, setLista] = useState<ListaCursos | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorMoodle, setErrorMoodle] = useState<string | null>(null);
  const [curso, setCurso] = useState<CursoMoodle | null>(null);
  const [funciones, setFunciones] = useState<string[]>([]);
  const [ajustes, setAjustes] = useState(false);
  const [confirmarBaja, setConfirmarBaja] = useState(false);
  const [dandoDeBaja, setDandoDeBaja] = useState(false);
  const puedeConectar = user?.role === 'superadmin';

  const cargarCampus = useCallback(async (refrescar = false) => {
    try {
      const r = await moodleApi.campus({ proyectoId: id, refrescar });
      const d = r.data as RespuestaCampus;
      setCampus(d.campus[0] ?? null);
      setFunciones(d.funciones ?? []);
    } catch (e) {
      // 403: el campus no es suyo (o no existe). No se distingue: no se le dice cuáles hay.
      setCampus(null);
      if (!/acceso/i.test((e as Error).message)) toast({ title: 'No se pudo cargar el campus', description: (e as Error).message, variant: 'destructive' });
    }
  }, [id]);
  useEffect(() => { setCampus(undefined); cargarCampus(); }, [cargarCampus]);

  // Medio segundo después de dejar de escribir, la búsqueda pasa a la dirección.
  useEffect(() => {
    if (texto.trim() === busqueda) return undefined;
    const t = setTimeout(() => cambiar({ q: texto.trim(), pagina: null }), 400);
    return () => clearTimeout(t);
  }, [texto, busqueda, cambiar]);

  const conectado = !!campus?.configurado;

  useEffect(() => {
    setCategorias([]); setCurso(null); setLista(null); setErrorMoodle(null);
    if (!conectado) return;
    moodleApi.categorias(id)
      .then((r) => setCategorias((r.data as { categorias: CategoriaMoodle[] }).categorias))
      .catch(() => { /* sin categorías el filtro no sale; la tabla avisa si el Moodle no responde */ });
  }, [id, conectado]);

  const cargarCursos = useCallback(async (refrescar = false) => {
    if (!conectado) return;
    setCargando(true);
    setErrorMoodle(null);
    try {
      const r = await moodleApi.cursos({ proyectoId: id, estado, texto: busqueda, categoriaId: categoria, pagina, limite, orden, sentido, refrescar });
      setLista(r.data as ListaCursos);
    } catch (e) {
      setLista(null);
      setErrorMoodle((e as Error).message || 'El Moodle de este campus no responde');
    } finally { setCargando(false); }
  }, [id, conectado, estado, busqueda, categoria, pagina, limite, orden, sentido]);
  useEffect(() => { cargarCursos(); }, [cargarCursos]);

  const opcionesCategoria = useMemo(() => [
    { value: null as number | null, label: 'Todas las categorías' },
    ...categorias.map((c) => ({ value: c.id as number | null, label: `${'· '.repeat(Math.max(0, c.profundidad - 1))}${c.nombre} (${c.cursos})` })),
  ], [categorias]);

  const hayFiltros = texto !== '' || categoria !== null;
  const limpiar = () => { setTexto(''); cambiar({ q: null, cat: null, pagina: null }); };
  const actualizar = async () => { setVersion((v) => v + 1); await cargarCampus(true); await cargarCursos(true); };
  /** Pulsar la cabecera ordenada la invierte; pulsar otra, la ordena de la A a la Z. */
  const ordenarPor = (campo: OrdenCursos) => cambiar({ orden: campo, sentido: campo === orden && sentido === 'asc' ? 'desc' : 'asc', pagina: null });

  const desconectar = async () => {
    setDandoDeBaja(true);
    try {
      await moodleApi.desconectar(id);
      toast({ title: 'Moodle desconectado', description: 'Este campus vuelve a estar pendiente de conectar.' });
      setConfirmarBaja(false);
      setAjustes(false);
      await cargarCampus(true);
    } catch (e) {
      toast({ title: 'No se pudo desconectar', description: (e as Error).message, variant: 'destructive' });
    } finally { setDandoDeBaja(false); }
  };
  const tras = async () => { setAjustes(false); setVersion((v) => v + 1); await cargarCampus(true); await cargarCursos(true); };
  const pedirBaja = () => { setAjustes(false); setConfirmarBaja(true); };

  /** Conexión y Actualizar. En el móvil la barra de arriba no tiene sitio para ellos: salen en la pantalla. */
  const acciones = (clase: string) => (
    <>
      {puedeConectar && (
        <button type="button" onClick={() => setAjustes((a) => !a)} aria-expanded={ajustes} className={cn('h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted', clase)}>
          <GearSix size={15} weight="bold" /> Conexión
        </button>
      )}
      <button type="button" onClick={actualizar} className={cn('h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted', clase)}>
        <ArrowsClockwise size={15} weight="bold" /> Actualizar
      </button>
    </>
  );

  const cabecera = (
    <PageHeader
      title={campus?.nombre ?? 'Moodle'}
      subtitle="Cursos de su Moodle · solo lectura"
      actions={conectado && acciones('hidden sm:inline-flex')}
    />
  );

  if (campus === undefined) return <div className="space-y-6">{cabecera}<Volver /><SkeletonTable rows={6} columns={5} /></div>;

  if (campus === null || !Number.isInteger(id)) {
    return (
      <div className="space-y-6">
        {cabecera}
        <Volver />
        <Card><EmptyState icon={GraduationCap} title="Este campus no existe o no tienes acceso" description="Elige uno de la lista de campus." /></Card>
      </div>
    );
  }

  if (!campus.configurado) {
    return (
      <div className="space-y-6">
        {cabecera}
        <Volver />
        <Card padding="md">
          {puedeConectar ? (
            <ConectarMoodle campus={campus} funciones={funciones} onConectado={tras} />
          ) : (
            <EmptyState
              icon={GraduationCap}
              title={`${campus.nombre} no tiene Moodle conectado`}
              description="Lo conecta un super admin desde esta misma pantalla, con un token de solo lectura de su Moodle."
            />
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {cabecera}

      <p className="truncate text-base font-semibold sm:hidden">{campus.nombre}</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Volver />
        <div className="flex items-center gap-2 sm:hidden">{acciones('inline-flex')}</div>
        {lista && <p className="text-xs text-muted-foreground">{hace(lista.resumen.de_cache ? lista.resumen.actualizado_hace_s : 0)}</p>}
      </div>

      <EstadoDeCursos valor={estado} cursos={campus.cursos} onChange={(e) => cambiar({ estado: e, pagina: null })} />

      <ParaRevisar proyectoId={id} version={version} onVer={setCurso} />

      <Card padding="none" overflowHidden>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5">
          <div className="relative min-w-[16rem] flex-1">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar un curso por su nombre…"
              aria-label="Buscar un curso"
              className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          {categorias.length > 0 && (
            <Select<number | null> ariaLabel="Categoría" value={categoria} onChange={(v) => cambiar({ cat: v, pagina: null })} options={opcionesCategoria} />
          )}
          {hayFiltros && (
            <button type="button" onClick={limpiar} className="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
              <X size={14} weight="bold" /> Limpiar
            </button>
          )}
          {lista && <Paginacion variante="compacta" pagina={lista.pagina} limite={lista.limite} total={lista.total} unidad="cursos" onPagina={(n) => cambiar({ pagina: n })} className="ml-auto" />}
        </div>

        {errorMoodle ? (
          <div role="alert" className="m-5 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning-soft-foreground">
            <WarningCircle size={20} weight="fill" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">El Moodle de {campus.nombre} no ha respondido</p>
              <p className="mt-0.5 text-xs">{errorMoodle}</p>
              <button type="button" onClick={() => cargarCursos(true)} className="mt-2 text-xs font-semibold underline">Reintentar</button>
            </div>
          </div>
        ) : cargando && !lista ? (
          <SkeletonTable rows={6} columns={5} className="border-0" />
        ) : lista && lista.total === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Ningún curso con ese filtro"
            description="Cambia el estado, la categoría o la búsqueda."
            action={hayFiltros ? <button type="button" onClick={limpiar} className="text-sm font-semibold text-primary hover:underline">Limpiar los filtros</button> : null}
          />
        ) : lista ? (
          <div className={cargando ? 'opacity-60 transition-opacity' : undefined}>
            <TablaCursos cursos={lista.cursos} elegido={curso?.curso_id ?? null} onElegir={setCurso} orden={orden} sentido={sentido} onOrden={ordenarPor} />
            <Paginacion
              className="border-t border-border bg-muted/20"
              pagina={lista.pagina}
              limite={lista.limite}
              total={lista.total}
              unidad="cursos"
              onPagina={(n) => cambiar({ pagina: n })}
              onLimite={(n) => cambiar({ filas: n, pagina: null })}
            />
          </div>
        ) : null}
      </Card>

      {curso && <DetalleCurso curso={curso} proyectoId={id} onCerrar={() => setCurso(null)} />}

      {ajustes && puedeConectar && (
        <AjustesConexion campus={campus} funciones={funciones} onCerrar={() => setAjustes(false)} onCambiado={tras} onDesconectar={pedirBaja} />
      )}

      <ConfirmDialog
        open={confirmarBaja}
        tone="destructive"
        title={`Desconectar el Moodle de ${campus.nombre}`}
        message="Se borra el token guardado: dejarán de verse sus cursos aquí y Claude no podrá consultarlos. El Moodle no se toca, y se puede volver a conectar cuando quieras."
        confirmLabel="Desconectar"
        loading={dandoDeBaja}
        onConfirm={desconectar}
        onCancel={() => setConfirmarBaja(false)}
      />
    </div>
  );
}
