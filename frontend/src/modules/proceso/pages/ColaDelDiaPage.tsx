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
import { traerCola, traerResumen, type PasoEnCola, type ResumenCola } from '../api/agenda.api';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';
import { contarPorPaso, trasSacar } from '../lib/cola';
import PanelDeCola from '../components/PanelDeCola';
import { toast } from '@/shared/hooks/useToast';

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

export default function ColaDelDiaPage() {
  const { activeProject } = useProjectContext();
  const { user } = useAuth();
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [cola, setCola] = useState<PasoEnCola[]>([]);
  const [resumen, setResumen] = useState<ResumenCola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [gestoraId, setGestoraId] = useState<number | null>(null);
  const [gestoras, setGestoras] = useState<Array<{ id: number; nombre: string }>>([]);
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

  // Mañana y la semana piden un `hasta` más largo; lo demás se filtra encima.
  const hasta = useMemo(() => {
    if (tramo !== 'manana' && tramo !== 'semana') return null;
    const d = new Date();
    d.setDate(d.getDate() + (tramo === 'manana' ? 1 : 7));
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${String(d.getDate()).padStart(2, '0')}`;
  }, [tramo]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      traerCola({ projectId: proyecto, gestoraId, hasta, limite: 300 }),
      traerResumen({ projectId: proyecto, gestoraId }),
    ]).then(([c, r]) => {
      if (!vivo) return;
      setCola(c);
      setResumen(r);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [proyecto, gestoraId, hasta]);

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

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={titulo}
        subtitle="A quién le toca hoy, y quién viene arrastrado. Una fila por persona."
        actions={esAdmin && gestoras.length > 0 ? (
          <select
            value={gestoraId ?? ''}
            onChange={(e) => setGestoraId(e.target.value ? Number(e.target.value) : null)}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Filtrar por gestora"
          >
            <option value="">Todo el equipo</option>
            {gestoras.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
        ) : null}
      />

      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Contador icon={Warning} etiqueta="Atrasados" valor={resumen.atrasados}
            tono="text-red-600 dark:text-red-400"
            activo={tramo === 'atrasados'}
            onClick={() => setTramo(tramo === 'atrasados' ? 'pendiente' : 'atrasados')} />
          <Contador icon={CalendarCheck} etiqueta="Para hoy" valor={resumen.hoy}
            tono="text-emerald-600 dark:text-emerald-400"
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
              // «Seg. 2» a secas se repite en cada fila de la lista y no dice
              // de qué paso habla. Leído tiene que bastar por sí solo.
              aria-label={`Ver solo ${g.nombre}: ${g.cuantos}${g.atrasados > 0 ? `, ${g.atrasados} con retraso` : ''}`}
              className={
                'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-normal transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
                + (paso === g.clave ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted')
              }
            >
              <span>Seg. {g.orden}</span>
              <span className="tabular-nums opacity-70">{g.cuantos}</span>
              {/* Cuántos de ese paso llegan tarde. Un «14» a secas no dice si
                  ese grupo urge o simplemente es grande. */}
              {g.atrasados > 0 && (
                <span className="rounded bg-red-100 px-1 text-[10px] font-bold tabular-nums text-red-700 dark:bg-red-950/40 dark:text-red-300">
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
              ? 'Todo el proceso al día. Los pasos se cierran solos al registrar un contacto.'
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
                  + (c.urgente ? 'border-l-4 border-l-red-500 border-border' : 'border-border')
                }
              >
                <div className="flex items-start gap-3">
                  {/* Un «2» suelto no dice nada. Ahora dice de que va: es el
                      seguimiento numero 2, y debajo cuantos lleva hechos.
                      Diego: «esto no se entiende de los pasos · falta poner la
                      cantidad de seguimiento que es». */}
                  <span className="mt-0.5 flex shrink-0 flex-col items-center justify-center rounded-md bg-muted px-2 py-1 text-muted-foreground">
                    <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">Seg.</span>
                    <span className="text-sm font-bold tabular-nums leading-tight">{p.orden}</span>
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold truncate">{p.lead_nombre || 'Sin nombre'}</span>
                      <span className="text-xs text-muted-foreground">
                        Seguimiento {p.orden} · {p.paso_nombre || p.clave}
                      </span>
                      <span className={
                        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide '
                        + (c.urgente
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          : 'bg-muted text-muted-foreground')
                      }>
                        {c.texto}
                      </span>
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
                            className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
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

      <p className="text-[11px] text-muted-foreground">
        Los pasos <strong className="text-foreground">se cierran solos</strong> al registrar un contacto con la
        persona: no hay que marcarlos. Para mover una fecha o saltarse un paso, entra en su ficha.
      </p>

      {enFoco !== null && visibles[enFoco] && (
        <PanelDeCola
          fila={visibles[enFoco]}
          posicion={enFoco + 1}
          total={visibles.length}
          guardando={apuntando}
          onContactado={(tipo, nota) => apuntarContacto(tipo, nota)}
          onPlantillaCopiada={(nombre) => apuntarCopia(visibles[enFoco].lead_id, nombre)}
          onAnterior={() => setEnFoco((n) => (n === null ? null : Math.max(0, n - 1)))}
          onSiguiente={() => setEnFoco((n) => (n === null ? null : Math.min(visibles.length - 1, n + 1)))}
          onCerrar={() => setEnFoco(null)}
        />
      )}
    </div>
  );
}
