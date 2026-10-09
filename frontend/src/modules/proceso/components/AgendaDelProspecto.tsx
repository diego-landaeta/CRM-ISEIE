import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Circle, WarningCircle, CaretRight, ListChecks, CircleNotch, Plus } from '@phosphor-icons/react';
import { traerPasosDeLead, ajustarPaso, anadirSeguimiento, type PasoDeLead } from '../api/agenda.api';
import { toast } from '@/shared/hooks/useToast';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';
import PlantillaDelPaso from './PlantillaDelPaso';
import type { DatosParaRellenar } from '@/modules/whatsapp/lib/plantilla';
import type { EmailTemplate } from '@/modules/email-templates/api/templates.api';
import { fechaCorta, fechaAplazada, APLAZAMIENTOS } from '../lib/fechasDelPaso';

/**
 * El proceso comercial de ESTA persona, en su ficha.
 *
 * Diego: «en los prospectos también debería salir: próximos pasos».
 *
 * La cola del día responde «¿a quién le toca hoy?». Esto responde la otra
 * pregunta, la que se hace al abrir una ficha: «¿por dónde voy con esta
 * persona, y qué le toca ahora?». Hasta ahora había que acordarse, o mirar la
 * cola y buscarla.
 *
 * Se marca UN paso como «el siguiente» —el primero pendiente— y no varios: si
 * alguien lleva tres sin hacer, lo que necesita es que le llamen una vez, no
 * tres avisos.
 *
 * LA LISTA SE PUEDE TACHAR. Un paso se cierra de dos formas: apuntando el
 * contacto, que es la buena porque deja el texto de lo que se hablo, o
 * marcandolo aqui, que es la que faltaba. Sin ella, el paso que se cumple sin
 * escribir —contesto la madre, ya tenia la informacion— se quedaba pendiente
 * para siempre y la persona salia en la cola del dia cada mañana.
 *
 * DESDE EL 09/10 LA CASILLA ES LA QUE MANDA (Diego: «que sea manual pero que
 * aparezca por hacer, porque uno lo toca y luego no quiere funcionar»). Antes un
 * paso salía hecho también por los contactos apuntados, y esa casilla ya no se
 * podía tocar: pulsarla no hacía nada. Ahora cada paso está «por hacer» hasta
 * que la gestora lo marca; si ya hay un contacto que lo daría, se dice al lado.
 *
 * Y DESPUÉS DEL PASO 4, «+ Seguimiento» añade el 5, el 6… (antes no había
 * casilla para quien seguía hablando con la persona).
 */

// La fecha como día del calendario: con `new Date(d)` a secas, al oeste de
// Greenwich el paso de hoy salía fechado ayer (rescatado de la PR #150).
const fecha = fechaCorta;

export default function AgendaDelProspecto({
  leadId,
  projectId = null,
  datos,
  nombreProyecto,
  alCopiar,
  alCorreo,
  alCambiar,
}: {
  leadId: number;
  /** De qué proyecto es: sus plantillas son las que valen. */
  projectId?: number | null;
  /** Lo que hace falta para rellenar el mensaje. Sin esto no se ofrece. */
  datos?: DatosParaRellenar;
  nombreProyecto?: string | null;
  /** Copiar el mensaje deja una nota en su historial. */
  alCopiar?: (nombrePlantilla: string) => void;
  /** Escribir el correo de este paso, con su plantilla ya puesta. */
  alCorreo?: (plantilla: EmailTemplate) => void;
  /**
   * Se ha marcado o desmarcado un paso. La ficha lo necesita porque el estado
   * del prospecto se mueve con el —«contactado», «en seguimiento»— y si no se
   * refresca, la cabecera sigue enseñando el de antes.
   */
  alCambiar?: () => void;
}) {
  const [pasos, setPasos] = useState<PasoDeLead[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    traerPasosDeLead(leadId)
      .then((r) => { if (vivo) setPasos(r); })
      .catch(() => { if (vivo) setPasos([]); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [leadId]);

  async function alternar(p: PasoDeLead) {
    if (guardando) return;
    setGuardando(p.id);
    try {
      await ajustarPaso(p.id, { estado: p.a_mano ? 'pendiente' : 'hecho' });
      // Se vuelve a pedir la lista entera en vez de tocarla aqui: al marcar un
      // paso cambia tambien cual es «el siguiente» y la cuenta de arriba, y
      // calcular eso dos veces —en el servidor y aqui— es como empiezan a no
      // coincidir.
      setPasos(await traerPasosDeLead(leadId));
      alCambiar?.();
    } catch {
      toast({ title: 'No se pudo guardar', description: 'Vuelve a intentarlo.', variant: 'destructive' });
    } finally {
      setGuardando(null);
    }
  }

  /**
   * Aplazar o saltar el paso que toca. Rescatado de la PR #150 de Fabián: son
   * decisiones de la gestora —«con esta persona, dentro de tres días», «este
   * paso con ella no aplica»— y el servidor ya las aceptaba, pero no había
   * dónde pulsarlas. «Planificar el proceso», que traía también, no: metería
   * en el proceso a gente de antes del 01/09.
   */
  async function cambiarPaso(p: PasoDeLead, datos: Parameters<typeof ajustarPaso>[1], aviso: string) {
    if (guardando) return;
    setGuardando(p.id);
    try {
      await ajustarPaso(p.id, datos);
      setPasos(await traerPasosDeLead(leadId));
      alCambiar?.();
      toast({ title: aviso });
    } catch {
      toast({ title: 'No se pudo guardar', description: 'Vuelve a intentarlo.', variant: 'destructive' });
    } finally {
      setGuardando(null);
    }
  }

  /** «+ Seguimiento»: uno más, por hacer, para hoy. Se aplaza como cualquier paso. */
  async function nuevoSeguimiento() {
    if (guardando) return;
    setGuardando(-1);
    try {
      const nuevo = await anadirSeguimiento(leadId);
      if (!nuevo) throw new Error('sin respuesta');
      setPasos(await traerPasosDeLead(leadId));
      alCambiar?.();
      toast({ title: `Seguimiento ${nuevo.orden} añadido`, description: 'Queda por hacer, para hoy.' });
    } catch {
      toast({ title: 'No se pudo añadir el seguimiento', description: 'Vuelve a intentarlo.', variant: 'destructive' });
    } finally {
      setGuardando(null);
    }
  }

  if (cargando) return null;

  // Sin pasos planificados la tarjeta no aparece: un prospecto que ya compró, o
  // uno anterior al proceso, no tiene agenda y una tarjeta vacía solo estorba.
  if (!pasos || pasos.length === 0) return null;

  const siguiente = pasos.find((p) => !p.hecho && p.estado === 'pendiente') || null;
  const hechos = pasos.filter((p) => p.hecho).length;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks size={16} weight="duotone" className="text-blue-600" />
          Proceso comercial
        </h3>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {hechos} de {pasos.length}
        </span>
      </div>

      {siguiente ? (
        <div className={
          'mb-3 rounded-lg border p-2.5 '
          + (siguiente.vencido
            ? 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30'
            : 'border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30')
        }>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Ahora le toca
          </p>
          <p className="mt-0.5 text-sm font-semibold">
            {siguiente.nombre || siguiente.clave}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {siguiente.vencido
              ? `Se le debía haber escrito hace ${siguiente.dias_de_retraso} ${siguiente.dias_de_retraso === 1 ? 'día' : 'días'}`
              : siguiente.dias_de_retraso === 0
                ? 'Le toca hoy'
                : `Le toca el ${fecha(siguiente.fecha_prevista)}`}
          </p>
          {(siguiente.canales || []).length > 0 && (
            <ol className="mt-1.5 flex flex-wrap items-center gap-1" aria-label="Canales, en orden">
              {siguiente.canales!.map((canal, i) => {
                const Icono = iconoDeCanal(canal);
                return (
                  <li key={canal} className="flex items-center gap-1">
                    {i > 0 && <CaretRight size={9} weight="bold" className="text-muted-foreground/50" />}
                    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[11px]">
                      {Icono && <Icono size={11} />} {nombreDeCanal(canal)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {/* El mensaje de este paso dice cuantas plazas quedan, y ese numero
              NO lo lleva el CRM: lo llevan en admisiones. Aqui solo se
              recuerda, porque el documento pide comprobarlo antes de CADA
              envio y no arrastrar el del mensaje anterior. */}
          {siguiente.avisa_plazas && (
            <p className="mt-1.5 rounded bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Comprueba cuántas plazas quedan antes de enviar. No las lleva el CRM.
            </p>
          )}
          {siguiente.nota_del_paso && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{siguiente.nota_del_paso}</p>
          )}

          {/* Aplazar o saltar ESTE paso. La fecha se cuenta desde hoy, no desde
              la que tenía: un paso atrasado aplazado «a mañana» cae mañana. */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Aplazar o saltar este paso">
            <span className="text-[11px] text-muted-foreground">Aplazar:</span>
            {APLAZAMIENTOS.map(({ dias, texto }) => (
              <button
                key={dias}
                type="button"
                disabled={guardando === siguiente.id}
                onClick={() => cambiarPaso(siguiente, { fecha_prevista: fechaAplazada(dias) }, `Paso aplazado: ${texto.toLowerCase()}`)}
                className="rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
              >
                {texto}
              </button>
            ))}
            <button
              type="button"
              disabled={guardando === siguiente.id}
              onClick={() => cambiarPaso(siguiente, { estado: 'saltado' }, 'Paso saltado: pasa al siguiente')}
              title="Este paso no aplica con esta persona: se salta y le toca el siguiente"
              className="rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Saltar este paso
            </button>
          </div>

          {/* Y su mensaje, ya escrito (#89: «qué paso toca, por qué, y su
              plantilla»). Hasta ahora decía cuál toca y había que ir al chat a
              buscar el texto; ahora está donde se lee la ficha.

              Se copia para pegarlo y ajustarlo: el CRM no manda nada. */}
          {datos && (
            <div className="mt-2">
              <PlantillaDelPaso
                projectId={projectId}
                pasoClave={siguiente.clave}
                datos={datos}
                nombreProyecto={nombreProyecto}
                compacto
                alCopiar={(p) => alCopiar?.(p.label)}
                alCorreo={alCorreo}
              />
            </div>
          )}
        </div>
      ) : (
        <p className="mb-3 text-[11px] text-muted-foreground">
          No queda ningún paso pendiente con esta persona.
        </p>
      )}

      {/* La checklist: por dónde va, y dónde se marca lo que ya está hecho. */}
      <ol className="space-y-0.5">
        {pasos.map((p) => {
          const esSiguiente = siguiente?.id === p.id;
          const esperando = guardando === p.id;
          const conContacto = !p.hecho && !!p.con_contacto;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => alternar(p)}
                disabled={esperando}
                aria-pressed={p.hecho}
                title={
                  p.a_mano
                    ? `Lo marcó ${p.hecho_por_nombre || 'alguien'}. Púlsalo para desmarcarlo.`
                    : conContacto
                      ? 'Ya hay un contacto apuntado para este paso. Márcalo cuando lo hayas dado.'
                      : 'Marcar este paso como hecho'
                }
                className={
                  'flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12px] '
                  + 'transition-colors hover:bg-muted/60 disabled:opacity-60'
                }
              >
                <span className="mt-0.5 flex-shrink-0">
                  {esperando
                    ? <CircleNotch size={14} className="animate-spin text-muted-foreground" />
                    : p.hecho
                      ? <CheckCircle size={14} weight="fill" className="text-emerald-600" />
                      : p.vencido
                        ? <WarningCircle size={14} weight="fill" className="text-red-500" />
                        : <Circle size={14} className="text-muted-foreground/40" />}
                </span>
                <span className={`min-w-0 flex-1 truncate ${p.hecho ? 'text-muted-foreground line-through' : esSiguiente ? 'font-semibold' : ''}`}>
                  {p.nombre || p.clave}
                </span>
                {conContacto && (
                  <span className="flex-shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground" title="Hay un contacto apuntado">
                    contactado
                  </span>
                )}
                <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {p.estado === 'saltado' ? 'saltado' : fecha(p.fecha_prevista)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* Un seguimiento más, tras los pasos del proceso: el 5, el 6… */}
      <button
        type="button"
        onClick={nuevoSeguimiento}
        disabled={guardando !== null}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
      >
        {guardando === -1 ? <CircleNotch size={12} className="animate-spin" /> : <Plus size={12} weight="bold" />}
        Seguimiento {pasos.length + 1}
      </button>

      {/* Que se sepa sin preguntar: la casilla no manda nada, solo apunta. */}
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Marca cada paso cuando lo hayas dado: apuntar el contacto no lo marca solo.
        La casilla no envía nada.
      </p>

      <Link
        to="/leads/cola"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        Ver la cola del día <CaretRight size={10} weight="bold" />
      </Link>
    </div>
  );
}
