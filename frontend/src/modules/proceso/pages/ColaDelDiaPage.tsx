/*
  La cola del día (#90). Lo que una gestora abre por la mañana.

  UNA FILA POR PERSONA, no una por paso. Si alguien lleva tres pasos sin hacer
  sale una vez, con el más urgente: lo que necesita es que la llamen, no salir
  tres veces en la lista.

  Y no hay botón de «hecho». El paso se cierra solo cuando se registra un
  contacto —el contacto n.º N cierra el paso n.º N—, que es la misma regla que
  usa el embudo de Reportes. Un plan que hay que mantener a mano acaba
  mintiendo, y de ahí no se vuelve. Lo que sí se puede a mano es mover la fecha
  o saltarse un paso, y eso se hace desde la ficha de la persona.
*/
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  CalendarCheck, Warning, ArrowRight, CaretRight, User, ClockCounterClockwise,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { traerCola, traerResumen, type PasoEnCola, type ResumenCola, type FormacionDeLaLista } from '../api/agenda.api';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';
import { contarPorPaso, trasSacar } from '../lib/cola';
import PanelDeCola from '../components/PanelDeCola';
import StatusBadge, { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';
import { toast } from '@/shared/hooks/useToast';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { tramosDeSalud, fraseDeSalud, totalDeLaCola } from '../lib/salud';

/** «hace 3 días», «hoy», «mañana» — no una fecha que hay que restar mentalmente. */
function cuando(fecha: string, retraso: number) {
  if (retraso > 0) return { texto: retraso === 1 ? 'ayer' : `hace ${retraso} días`, urgente: true };
  if (retraso === 0) return { texto: 'hoy', urgente: false };
  if (retraso === -1) return { texto: 'mañana', urgente: false };
  const d = new Date(fecha + 'T00:00:00');
  return {
    texto: d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
    urgente: false,
  };
}

/**
 * La fecha tal cual, para poner al lado del «hace 28 dias».
 *
 * Diego, 24/09: «ni fechas». El relativo dice la urgencia pero no sirve para
 * cuadrar con nada: para eso hace falta el dia.
 */
function fechaCorta(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

function Contador({ icon: Icon, etiqueta, valor, tono, activo, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={
        'rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
        + (activo ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')
      }
    >
      <div className={'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ' + tono}>
        <Icon size={13} /> {etiqueta}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
    </button>
  );
}

/**
 * Los estados que puede tener alguien en la cola.
 *
 * Quien compro o dijo que no ya no esta: la consulta los excluye. Ofrecerlos en
 * el filtro seria ofrecer dos listas que siempre salen vacias.
 */
const ESTADOS_DE_LA_COLA = ['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'proxima_convocatoria'];

export default function ColaDelDiaPage() {
  const { activeProject, activeIssuer } = useProjectContext();
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [cola, setCola] = useState<PasoEnCola[]>([]);
  const [resumen, setResumen] = useState<ResumenCola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [gestoraId, setGestoraId] = useState<number | null>(null);
  const [estado, setEstado] = useState('');
  // El buscador va con freno: una peticion por tecla serian veinte consultas
  // para escribir «gabriela».
  const [busca, setBusca] = useState('');
  const [buscaLenta, setBuscaLenta] = useState('');
  const [producto, setProducto] = useState('');
  // El desde lo elige quien mira; el hasta sale del tramo, salvo que lo pise.
  const [desdeFecha, setDesdeFecha] = useState('');
  const [hastaFecha, setHastaFecha] = useState('');
  // El historial del panel: abierto o no. Vive AQUI y no en el panel para que
  // se quede como esta al pasar a la siguiente persona.
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [gestoras, setGestoras] = useState<Array<{ id: number; nombre: string }>>([]);

  useEffect(() => {
    const id = setTimeout(() => setBuscaLenta(busca.trim()), 350);
    return () => clearTimeout(id);
  }, [busca]);

  /** Las formaciones del ambito, para el filtro. */
  const [productos, setProductos] = useState<FormacionDeLaLista[]>([]);
  // Qué tramo se está mirando. Por defecto todo lo que ya toca —atrasado y hoy—,
  // que es con lo que se abre el día.
  //
  // Vive en la DIRECCIÓN y no en el estado del componente (#130). Guardado
  // dentro, el dashboard puede decir «mañana tienes 12» y el enlace te deja en
  // la lista entera, buscándolos — que es exactamente lo que el #132 dio por
  // inútil: «un aviso que te deja buscándolos no sirve de nada». Con el tramo
  // en la URL, el enlace deja la cola ya puesta, y además se puede compartir y
  // sobrevive a recargar.
  const [params, setParams] = useSearchParams();
  const TRAMOS = ['pendiente', 'atrasados', 'hoy', 'manana', 'semana'] as const;
  type Tramo = typeof TRAMOS[number];
  const pedido = params.get('tramo') as Tramo | null;
  const tramo: Tramo = pedido && TRAMOS.includes(pedido) ? pedido : 'pendiente';
  const setTramo = (t: Tramo) => {
    const p = new URLSearchParams(params);
    // «pendiente» es el estado de partida: no ensucia la direccion.
    if (t === 'pendiente') p.delete('tramo'); else p.set('tramo', t);
    setParams(p, { replace: true });
  };

  // ISEIE lleva una sola marca: aqui no hay sociedades ni campus que sumar,
  // asi que la cola es la del proyecto elegido y punto.
  const proyecto = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;


  // La página de la cola, y cuántos hay de verdad detrás.
  const [pagina, setPagina] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);

  // Cualquier cambio de filtro vuelve al principio: quedarse en la página siete
  // después de filtrar enseña una lista vacía que parece que no hay nada.
  useEffect(() => { setPagina(1); }, [proyecto, gestoraId, tramo, estado, buscaLenta, producto, desdeFecha, hastaFecha]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      traerCola({
        projectId: proyecto,
        // El tramo va al SERVIDOR: filtrar aquí la página que llega dejaba «Para hoy»
        // vacío en cuanto había más de 100 en la cola. Y con su «hoy», no el del navegador.
        gestoraId, hasta: hastaFecha || null, tramo: tramo === 'pendiente' ? null : tramo,
        limite: 100,
        pagina,
        estado: estado || null,
        busca: buscaLenta || null,
        productoIds: producto || null,
        desde: desdeFecha || null,
      }),
      traerResumen({ projectId: proyecto, gestoraId }),
    ]).then(([c, r]) => {
      if (!vivo) return;
      setCola(c.filas);
      setProductos(c.formaciones);
      // Si la elegida ya no la tiene nadie de la lista --otro campus, otro
      // estado--, se suelta: dejarla puesta enseña una lista vacia sin decir por que.
      if (producto && !c.formaciones.some((f) => f.ids.join(',') === producto)) setProducto('');
      setTotal(c.total);
      setTotalPaginas(c.totalPaginas);
      setResumen(r);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [proyecto, gestoraId, tramo, pagina, estado, buscaLenta, producto, desdeFecha, hastaFecha]);

  // La lista de gestoras, solo para quien puede filtrar por ellas.
  useEffect(() => {
    if (!esAdmin) return;
    client.get(`/users?limit=100${proyecto ? `&projectId=${proyecto}` : ''}`)
      .then((r: any) => {
        if (!r?.success) return;
        setGestoras((r.data || [])
          .filter((u: any) => u.active !== false)
          .map((u: any) => ({ id: u.id, nombre: u.nombre })));
      })
      .catch(() => { /* si falla, se queda sin filtro y ya */ });
  }, [esAdmin, proyecto]);

  // Las formaciones del desplegable las manda el servidor CON la cola: solo
  // las que tiene la gente de esta lista. Antes se pedia el catalogo entero
  // del ambito --500 formaciones con CEDIA-- y elegir una que nadie tenia
  // dejaba la lista vacia. Diego, 28/09.

  // Qué paso se está mirando, si es que se ha elegido uno. Va aparte del tramo
  // de fechas: se cruzan, no se sustituyen —«los atrasados del paso 2» es la
  // pregunta que de verdad se hace por la mañana—.
  const [paso, setPaso] = useState<string | null>(null);
  // A quién se está atendiendo ahora mismo. Un índice, no una fila: la lista
  // cambia debajo al ir sacando gente, y guardar la fila dejaría el panel
  // enseñando a alguien que ya no está.
  const [enFoco, setEnFoco] = useState<number | null>(null);
  const [apuntando, setApuntando] = useState(false);

  const porTramo = useMemo(() => {
    if (tramo === 'atrasados') return cola.filter((x) => x.dias_de_retraso > 0);
    if (tramo === 'hoy') return cola.filter((x) => x.dias_de_retraso === 0);
    if (tramo === 'manana') return cola.filter((x) => x.dias_de_retraso === -1);
    // «pendiente» es el arranque: lo atrasado y lo de hoy. Ya lo recorta el
    // SERVIDOR desde el 29/09 (`hasta` = hoy); volver a filtrarlo aquí sobra.
    return cola;
  }, [cola, tramo]);

  // Las cuentas por paso se sacan de lo que hay en el tramo, no de la cola
  // entera: si se está mirando lo atrasado, «paso 2: 14» tiene que ser catorce
  // atrasados y no catorce en total.
  const grupos = useMemo(() => contarPorPaso(porTramo), [porTramo]);

  const visibles = useMemo(
    () => (paso ? porTramo.filter((x) => x.clave === paso) : porTramo),
    [porTramo, paso],
  );

  // Si el filtro deja la lista sin la fila que se estaba atendiendo, se cierra
  // el panel en vez de enseñar a otra persona en su sitio.
  useEffect(() => {
    if (enFoco !== null && enFoco >= visibles.length) setEnFoco(null);
  }, [visibles.length, enFoco]);

  /**
   * Apunta el contacto y pasa al siguiente.
   *
   * NO SE MARCA EL PASO. Se apunta lo que ha pasado de verdad —una llamada, un
   * WhatsApp— y el servidor cierra el paso solo, porque lo deduce de cuántos
   * contactos lleva la persona. Por eso al volver ya no sale en la cola.
   */
  async function apuntarContacto(tipo: string, nota: string) {
    if (enFoco === null) return;
    const fila = visibles[enFoco];
    if (!fila) return;
    setApuntando(true);
    try {
      await client.post(`/leads/${fila.lead_id}/interactions`, {
        tipo,
        nota: nota || `Contacto del seguimiento ${fila.orden}`,
        fecha: new Date().toISOString(),
      });
      // Se saca de la lista aquí mismo en vez de recargar: recargar 300 filas
      // para quitar una parpadea y pierde el sitio donde ibas.
      setCola((c) => c.filter((x) => x.lead_id !== fila.lead_id));
      setEnFoco(trasSacar(visibles.length, enFoco));
      toast({ title: 'Contacto apuntado', description: `${fila.lead_nombre || 'Sin nombre'} sale de la cola.` });
      // Los contadores de arriba sí se rehacen contra el servidor, en segundo
      // plano: son los que dicen cuánto queda del día.
      traerResumen({ projectId: proyecto, gestoraId }).then((r) => { if (r) setResumen(r); }).catch(() => {});
    } catch (e) {
      const err = e as { message?: string };
      toast({
        title: 'No se ha podido apuntar',
        description: err?.message || 'Inténtalo otra vez; no se ha guardado nada.',
        variant: 'destructive',
      });
    } finally {
      setApuntando(false);
    }
  }

  /**
   * Copiar el mensaje deja rastro en su ficha — pero NO cuenta como contacto.
   *
   * El issue lo pide: «lo que copia queda apuntado; sin eso, mañana la cola
   * miente». Y va como NOTA a propósito, que es el único tipo que el recuento
   * de contactos no suma: copiar no es hablar con nadie. Si contara, la
   * persona saldría de la cola por haber copiado un texto que igual no llegó a
   * enviarse nunca — y la cola mentiría en la otra dirección, que es peor
   * porque nadie la echaría de menos.
   *
   * Si falla, se calla: el texto ya está copiado y lo que toca es escribirle,
   * no leer un aviso de que no se apuntó una nota.
   */
  function apuntarCopia(leadId: number, nombrePlantilla: string) {
    client.post(`/leads/${leadId}/interactions`, {
      tipo: 'nota',
      nota: `Copiado el mensaje «${nombrePlantilla}»`,
      fecha: new Date().toISOString(),
    }).catch(() => { /* el trabajo es escribirle, no apuntar la nota */ });
  }

  const titulo = esAdmin && !gestoraId ? 'La cola del equipo' : 'Tu día';
  const hayFiltros = Boolean(busca || producto || estado || desdeFecha || hastaFecha);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={titulo}
        subtitle="A quién le toca hoy, y quién viene arrastrado. Una fila por persona."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {esAdmin && gestoras.length > 0 && (
              <select
                value={gestoraId ?? ''}
                onChange={(e) => setGestoraId(e.target.value ? Number(e.target.value) : null)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-label="Filtrar por gestora"
              >
                <option value="">Todo el equipo</option>
                {gestoras.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            )}
          </div>
        )}
      />

      {/* CÓMO VA EL DÍA. Diego, 15/09: «no hay gráficas de cómo va, ni la
          salud». Cuatro números sueltos obligan a compararlos de cabeza; la
          barra dice en medio segundo si el día está bajo control. No inventa
          ninguna cifra: son los mismos cuatro del resumen, puestos juntos.
          (En ISEIE no existen `text-normal` ni `text-secundario`: aquí van
          `text-sm` y `text-xs`, que son su mismo tamaño en MultiCRM.) */}
      {resumen && totalDeLaCola(resumen) > 0 && (
        <section aria-label="Cómo va la cola" className="rounded-lg border border-border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className={`text-sm font-semibold ${fraseDeSalud(resumen).alerta ? 'text-destructive' : 'text-success'}`}>
              {fraseDeSalud(resumen).texto}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {totalDeLaCola(resumen)} en la cola
            </p>
          </div>

          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            {tramosDeSalud(resumen).filter((t) => t.valor > 0).map((t) => (
              <div
                key={t.clave}
                style={{ width: `${t.porcentaje}%` }}
                className={{
                  destructive: 'bg-destructive',
                  warning: 'bg-warning',
                  info: 'bg-info',
                  muted: 'bg-muted-foreground/30',
                }[t.tono]}
              />
            ))}
          </div>

          {/* La leyenda lleva las cifras: la barra sola no se puede leer, y una
              barra que hay que adivinar es peor que una lista. */}
          <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {tramosDeSalud(resumen).filter((t) => t.valor > 0).map((t) => (
              <li key={t.clave} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`h-2 w-2 rounded-full ${{
                  destructive: 'bg-destructive',
                  warning: 'bg-warning',
                  info: 'bg-info',
                  muted: 'bg-muted-foreground/30',
                }[t.tono]}`} />
                <span className="tabular-nums font-medium text-foreground">{t.valor}</span> {t.etiqueta}
              </li>
            ))}
          </ul>
        </section>
      )}

      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Contador icon={Warning} etiqueta="Atrasados" valor={resumen.atrasados}
            tono="text-destructive"
            activo={tramo === 'atrasados'}
            onClick={() => setTramo(tramo === 'atrasados' ? 'pendiente' : 'atrasados')} />
          <Contador icon={CalendarCheck} etiqueta="Para hoy" valor={resumen.hoy}
            tono="text-success"
            activo={tramo === 'hoy'}
            onClick={() => setTramo(tramo === 'hoy' ? 'pendiente' : 'hoy')} />
          <Contador icon={ArrowRight} etiqueta="Para mañana" valor={resumen.manana}
            tono="text-muted-foreground"
            activo={tramo === 'manana'}
            onClick={() => setTramo(tramo === 'manana' ? 'pendiente' : 'manana')} />
          <Contador icon={ClockCounterClockwise} etiqueta="Esta semana" valor={resumen.esta_semana}
            tono="text-muted-foreground"
            activo={tramo === 'semana'}
            onClick={() => setTramo(tramo === 'semana' ? 'pendiente' : 'semana')} />
        </div>
      )}

      {/* CUÁNTOS DE CADA PASO, que es como lo pide el issue: «agrupada por
          paso: cuántos del 1, cuántos del 2…».
          No se reordena la lista para agruparla —el orden por urgencia es lo
          que deja arriba lo que lleva más esperando, y agrupar lo escondería
          detrás del paso 1—: se cuenta y se filtra por encima del mismo orden.
          Y sirve para lo que se hace de verdad por la mañana: los del paso 2
          seguidos, que llevan el mismo mensaje. */}
      {/* LOS FILTROS. Diego, 24/09: «no veo nada de los filtros ni el estado,
          ni fechas». Estaban arriba del todo, en la esquina, lejos de la lista
          que filtran — así que no estaban. Aquí van juntos y pegados a lo que
          tocan.

          Todos los hace el SERVIDOR. Filtrar las 100 filas que se ven diría
          «no hay nadie» teniendo a la persona en la página cuatro. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre, correo o teléfono…"
            aria-label="Buscar en la cola"
            className="h-9 w-full rounded-md border border-border bg-card pl-8 pr-3 text-sm"
          />
        </div>

        <select
          value={producto}
          onChange={(e) => setProducto(e.target.value)}
          aria-label="Filtrar por formación"
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="">Cualquier formación</option>
          {productos.map((p) => (
            <option key={p.ids.join(',')} value={p.ids.join(',')}>{p.nombre} ({p.personas})</option>
          ))}
        </select>

        {/* EN QUÉ ESTADO ESTÁN. Solo los cinco que pueden salir: quien compró o
            dijo que no ya no está en la cola, así que ofrecer esos dos sería
            ofrecer dos listas siempre vacías. */}
        <select
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          aria-label="Filtrar por estado"
          className="h-9 rounded-md border border-border bg-card px-2 text-sm"
        >
          <option value="">Cualquier estado</option>
          {ESTADOS_DE_LA_COLA.map((e) => (
            <option key={e} value={e}>{STATUS_LABELS[e] || e}</option>
          ))}
        </select>

        {/* LAS FECHAS del paso. El tramo de arriba es de brocha gorda
            —atrasados, hoy, esta semana—; esto sirve para pedir un día suelto o
            un trozo de mes. El «hasta» manda sobre el tramo. */}
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Del
          <input
            type="date"
            value={desdeFecha}
            onChange={(e) => setDesdeFecha(e.target.value)}
            aria-label="Desde qué día"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          al
          <input
            type="date"
            value={hastaFecha}
            onChange={(e) => setHastaFecha(e.target.value)}
            aria-label="Hasta qué día"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm"
          />
        </label>

        {hayFiltros && (
          <button
            type="button"
            onClick={() => {
              setBusca(''); setProducto(''); setEstado(''); setDesdeFecha(''); setHastaFecha('');
            }}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={13} /> Quitar filtros
          </button>
        )}
      </div>

      {/* Con un filtro puesto, los contadores de arriba siguen contando el
          tramo entero: dicen una cosa y la lista otra, y callarlo es peor. */}
      {hayFiltros && !cargando && (
        <p className="text-[11px] text-muted-foreground">
          Filtrando: <strong className="text-foreground">{total}</strong>{' '}
          {total === 1 ? 'persona' : 'personas'}. Los contadores de arriba cuentan el tramo entero.
        </p>
      )}

      {!cargando && grupos.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            Por paso
          </span>
          <button
            type="button"
            onClick={() => setPaso(null)}
            aria-pressed={paso === null}
            aria-label={`Ver todos los pasos, ${porTramo.length}`}
            className={
              'rounded-md border px-2.5 py-1 text-normal transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
              + (paso === null ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted')
            }
          >
            Todos <span className="tabular-nums opacity-70">{porTramo.length}</span>
          </button>
          {grupos.map((g) => (
            <button
              key={g.clave}
              type="button"
              onClick={() => setPaso(paso === g.clave ? null : g.clave)}
              aria-pressed={paso === g.clave}
              title={g.nombre}
              // «Paso 2» a secas se repite en cada fila de la lista y no dice
              // de qué paso habla. Leído tiene que bastar por sí solo.
              aria-label={`Ver solo ${g.nombre}: ${g.cuantos}${g.atrasados > 0 ? `, ${g.atrasados} con retraso` : ''}`}
              className={
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-normal transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
                + (paso === g.clave ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted')
              }
            >
              <span>Paso {g.orden}</span>
              <span className="tabular-nums opacity-70">{g.cuantos}</span>
              {/* Cuántos de ese paso llegan tarde. Un «14» a secas no dice si
                  ese grupo urge o simplemente es grande. */}
              {g.atrasados > 0 && (
                <span className="rounded bg-destructive-soft px-1 text-[10px] font-bold tabular-nums text-destructive-soft-foreground">
                  {g.atrasados} tarde
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {cargando ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={tramo === 'atrasados' ? 'Nada atrasado' : 'Nada pendiente'}
          description={
            resumen && resumen.atrasados + resumen.hoy === 0
              ? 'Todo el proceso al día. Un contacto cierra el paso que toca, en su día o después.'
              : 'No hay nada en este tramo. Prueba con otro de los de arriba.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visibles.map((p, i) => {
            const c = cuando(p.fecha_prevista, p.dias_de_retraso);
            return (
              <button
                key={p.lead_id}
                type="button"
                // Abre el panel, no la ficha. Salir a la ficha por cada persona
                // es lo que rompía el hilo: se hacía uno, atrás, y a buscar por
                // dónde ibas. La ficha entera sigue a un clic, dentro.
                onClick={() => setEnFoco(i)}
                className={
                  'w-full text-left rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 '
                  + 'focus:outline-none focus:ring-2 focus:ring-primary/40 '
                  + (c.urgente ? 'border-l-4 border-l-destructive border-border' : 'border-border')
                }
              >
                <div className="flex items-start gap-3">
                  {/* Un «2» suelto no dice nada. Ahora dice de que va: es el
                      seguimiento numero 2, y debajo cuantos lleva hechos.
                      Diego: «esto no se entiende de los pasos · falta poner la
                      cantidad de seguimiento que es». */}
                  <span className="mt-0.5 flex w-[4.5rem] shrink-0 flex-col items-center justify-center rounded-md bg-muted px-1.5 py-1 text-muted-foreground">
                    <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Paso</span>
                    <span className="text-sm font-bold tabular-nums leading-tight">{p.orden}</span>
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold truncate">{p.lead_nombre || 'Sin nombre'}</span>
                      {/* El paso, en pastilla y no en gris pegado al nombre.
                          Diego, 15/09: «no se distingue qué paso es». Con
                          veinte filas iguales, un texto secundario del mismo
                          tamaño que el resto no se lee: se salta.
                          La pastilla del campus que lleva MultiCRM al lado no
                          va aquí: ISEIE es una sola marca y la cola nunca
                          mezcla campus. */}
                      <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info-soft-foreground">
                        {p.paso_nombre || p.clave}
                      </span>
                      <span className={
                        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide '
                        + (c.urgente
                          ? 'bg-destructive-soft text-destructive-soft-foreground'
                          : 'bg-muted text-muted-foreground')
                      }>
                        {c.texto}
                      </span>
                      {/* La fecha de verdad al lado del relativo, y en qué
                          estado está. Sin esto se filtra por «contactado» y la
                          lista no dice cuál es cuál. */}
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {fechaCorta(p.fecha_prevista)}
                      </span>
                      <StatusBadge status={p.lead_estado} showIcon className="shrink-0" />
                    </div>

                    {/* Los canales, EN ORDEN: la flecha dice por dónde se
                        intenta primero. */}
                    {(p.canales || []).length > 0 && (
                      <ol className="flex flex-wrap items-center gap-1" aria-label="Canales, en orden">
                        {p.canales!.map((canal, i) => {
                          const Icono = iconoDeCanal(canal);
                          return (
                            <li key={canal} className="flex items-center gap-1">
                              {i > 0 && <CaretRight size={9} weight="bold" className="text-muted-foreground/50" />}
                              <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]">
                                {Icono && <Icono size={11} />} {nombreDeCanal(canal)}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}

                    {/* La formación, y el aviso de las plazas cuando el paso
                        las menciona. El número NO sale del CRM: lo llevan en
                        admisiones, y el documento dice que se comprueba antes
                        de cada envío y nunca se arrastra el del mensaje
                        anterior. Aquí solo se recuerda. */}
                    {(p.producto || p.avisa_plazas) && (
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        {p.producto && (
                          <span className="text-muted-foreground truncate max-w-[22rem]">{p.producto}</span>
                        )}
                        {/* El aviso no depende de que se sepa la formacion: el
                            mensaje habla de plazas igual, y hay que ir a
                            mirarlas igual. */}
                        {p.avisa_plazas && (
                          <span
                            className="rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning-soft-foreground"
                            title="Este mensaje dice cuántas plazas quedan. El número no lo lleva el CRM: compruébalo antes de enviar y no copies el del mensaje anterior."
                          >
                            comprueba las plazas
                          </span>
                        )}
                      </p>
                    )}

                    {/* La chuleta. Va aquí y no escondida detrás de un clic:
                        es lo que hace falta MIENTRAS se escribe el mensaje. */}
                    {p.paso_nota && (
                      <p className="text-[11px] text-muted-foreground">{p.paso_nota}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {esAdmin && !gestoraId && p.gestora && (
                      <div className="inline-flex items-center gap-1"><User size={11} />{p.gestora}</div>
                    )}
                    <div className="tabular-nums">
                      {p.contactos === 0
                        ? 'sin contactar aún'
                        : `${p.contactos} ${p.contactos === 1 ? 'contacto hecho' : 'contactos hechos'}`}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* LA PAGINACIÓN. Antes la cola cortaba en 300 sin decirlo mientras los
          contadores de arriba contaban todas, así que quien la trabajaba de
          arriba abajo creía haberla terminado con gente sin tocar. */}
      {totalPaginas > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <span className="text-secundario tabular-nums text-muted-foreground">
            Página {pagina} de {totalPaginas} · {total} en la cola
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagina <= 1 || cargando}
              onClick={() => setPagina((n) => Math.max(1, n - 1))}
              className="rounded-md border border-border px-2.5 py-1.5 text-normal font-semibold hover:bg-muted disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={pagina >= totalPaginas || cargando}
              onClick={() => setPagina((n) => Math.min(totalPaginas, n + 1))}
              className="rounded-md border border-border px-2.5 py-1.5 text-normal font-semibold hover:bg-muted disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Un contacto con la persona <strong className="text-foreground">cierra el paso que toca</strong> si ya ha
        llegado su día, y solo uno por día: apuntar varios no adelanta los siguientes. Para mover una fecha o
        saltarse un paso, entra en su ficha.
      </p>

      {enFoco !== null && visibles[enFoco] && (
        <PanelDeCola
          fila={visibles[enFoco]}
          posicion={enFoco + 1}
          total={visibles.length}
          guardando={apuntando}
          onContactado={(tipo, nota) => apuntarContacto(tipo, nota)}
          onPlantillaCopiada={(nombre) => apuntarCopia(visibles[enFoco].lead_id, nombre)}
          historialAbierto={historialAbierto}
          onAlternarHistorial={() => setHistorialAbierto((x) => !x)}
          onAnterior={() => setEnFoco((n) => (n === null ? null : Math.max(0, n - 1)))}
          onSiguiente={() => setEnFoco((n) => (n === null ? null : Math.min(visibles.length - 1, n + 1)))}
          onCerrar={() => setEnFoco(null)}
        />
      )}
    </div>
  );
}
