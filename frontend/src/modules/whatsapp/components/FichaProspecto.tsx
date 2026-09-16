import { useEffect, useState } from 'react';
import {
  X, ArrowSquareOut, UserPlus, WarningCircle, Envelope, Phone,
  Briefcase, User, Package, ClockCounterClockwise,
} from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';
import { chatApi, type RespuestaFicha } from '../api/whatsapp.api';

/**
 * La ficha del prospecto, SIN salir del chat.
 *
 * El motivo de la tarea #64 no es la comodidad: salir del chat y volver recarga
 * las conversaciones, los mensajes del hilo abierto y las firmas de los
 * adjuntos. Son varios segundos, y una gestora entra y sale de la ficha cada dos
 * mensajes. Por eso esto es un popup y por eso «ver ficha completa» abre una
 * pestaña NUEVA — si navegara en la misma, al volver se recargaria todo.
 *
 * Y desde aqui se TRABAJA, no solo se mira (#112). Antes el unico boton que
 * hacia algo era «ver ficha completa», o sea que para apuntar una nota habia que
 * abrir otra pestaña — justo lo que este popup venia a evitar.
 */

const ESTADOS: Record<string, string> = {
  nuevo: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  contactado: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  interesado: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  convertido: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  perdido: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
};
const ESTADO_POR_DEFECTO = 'bg-muted text-muted-foreground';

const cuando = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

function Dato({ icono, etiqueta, valor }: { icono: React.ReactNode; etiqueta: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-muted-foreground shrink-0 mt-0.5" aria-hidden="true">{icono}</span>
      <span className="min-w-0">
        {/* La etiqueta va tambien para lector de pantalla: sin ella, «Diego R.»
            suelto no dice si es la gestora, el producto o el proyecto. */}
        <span className="sr-only">{etiqueta}: </span>
        <span className="text-sm text-foreground break-words">{valor}</span>
      </span>
    </div>
  );
}

export default function FichaProspecto({
  conversacionId,
  deQuien,
  onCerrar,
  onCrearProspecto,
}: {
  conversacionId: number;
  /** De quien es la sesion que se esta mirando. Ver el comentario en `chatApi.ficha`. */
  deQuien?: number | null;
  onCerrar: () => void;
  onCrearProspecto?: (telefono: string | null, nombre: string | null) => void;
}) {
  const [datos, setDatos] = useState<RespuestaFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Reintentar tiene que VOLVER A PEDIR. Poniendo solo los estados a cero el
  // efecto no se dispara —depende de la conversacion, que no ha cambiado— y el
  // boton se queda girando sin ir a ninguna parte.
  const [intento, setIntento] = useState(0);
  const p = datos?.prospecto ?? null;

  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  /**
   * Apuntar la nota y cambiar el estado se hacen distinto a proposito.
   *
   * La nota se RECARGA al guardar: la lista de interacciones es del servidor y
   * quiero que salga con su fecha y su autor de verdad, no una inventada aqui.
   * Son dos peticiones, pero es la accion menos frecuente y la que mas se mira
   * despues.
   *
   * El estado se pinta al momento y se deshace si falla: es un solo valor, se
   * ve arriba, y esperar medio segundo a que cambie una pildora se nota.
   */
  async function guardarNota() {
    const texto = nota.trim();
    if (!texto || !p?.id) return;
    setGuardando(true);
    try {
      const r = await chatApi.apuntarNota(p.id, texto);
      if (!r?.success) throw new Error(r?.error || 'No se pudo guardar');
      setNota('');
      setIntento((n) => n + 1);          // vuelve a pedir la ficha con la nota dentro
    } catch (e) {
      toast({
        title: 'No se pudo guardar la nota',
        description: (e as { message?: string })?.message || 'Vuelve a intentarlo.',
        variant: 'destructive',
      });
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarEstado(status: string) {
    if (!p?.id || status === p.status) return;
    const antes = p.status;
    setDatos((d) => (d?.prospecto ? { ...d, prospecto: { ...d.prospecto, status } } : d));
    try {
      const r = await chatApi.cambiarEstado(p.id, status);
      if (!r?.success) throw new Error(r?.error || 'No se pudo cambiar');
    } catch (e) {
      setDatos((d) => (d?.prospecto ? { ...d, prospecto: { ...d.prospecto, status: antes } } : d));
      const motivo = (e as { message?: string })?.message;
      toast({
        title: 'No se pudo cambiar el estado',
        // El motivo del servidor cuando lo hay: «ese contacto es de otra
        // gestora» no se adivina mirando la pantalla.
        description: motivo && !/^Error \d/.test(motivo) ? motivo : 'Se queda como estaba.',
        variant: 'destructive',
      });
    }
  }

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    chatApi.ficha(conversacionId, deQuien)
      .then((r) => {
        if (!vivo) return;
        if (r.success) setDatos(r.data);
        else setError(r.error || 'No se pudo cargar la ficha');
      })
      .catch((e) => { if (vivo) setError(e?.message || 'No se pudo cargar la ficha'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [conversacionId, deQuien, intento]);

  // Cerrar con Escape, como cualquier dialogo del CRM.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar(); };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
        onClick={onCerrar}
        role="presentation"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ficha del prospecto"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-lg border border-border
                     bg-background shadow-xl"
        >
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Ficha del prospecto</h2>
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar la ficha"
              className="shrink-0 text-muted-foreground hover:text-foreground rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-4">
            {/* 1 · Cargando */}
            {cargando && (
              <div className="space-y-3" aria-live="polite" aria-busy="true">
                <span className="sr-only">Cargando la ficha…</span>
                <div className="h-5 w-2/3 rounded bg-muted animate-pulse" />
                <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
                <div className="h-4 w-1/2 rounded bg-muted animate-pulse" />
                <div className="h-4 w-2/5 rounded bg-muted animate-pulse" />
              </div>
            )}

            {/* 2 · Error, con salida */}
            {!cargando && error && (
              <div className="text-center py-4">
                <WarningCircle size={28} className="mx-auto text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <p className="mt-2 text-sm text-foreground">{error}</p>
                <button
                  type="button"
                  onClick={() => setIntento((n) => n + 1)}
                  className="mt-3 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium
                             hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Reintentar
                </button>
              </div>
            )}

            {/* 3 · Sin prospecto. No es un fallo: hay muchas conversaciones de
                gente que escribe y aun no esta en el CRM, y desde aqui se crea
                con el telefono ya puesto. */}
            {!cargando && !error && datos && !p && (
              <div className="text-center py-2">
                <UserPlus size={30} className="mx-auto text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm text-foreground font-medium">
                  {datos.esGrupo ? 'Esto es un grupo' : 'Esta persona no está en el CRM'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {datos.esGrupo
                    ? 'Los grupos no tienen ficha de prospecto.'
                    : 'Escribe desde este número, pero todavía no tiene ficha.'}
                </p>
                {datos.telefono && !datos.esGrupo && (
                  <>
                    <p className="mt-3 text-sm text-foreground tabular-nums">{datos.telefono}</p>
                    {onCrearProspecto && (
                      <button
                        type="button"
                        onClick={() => onCrearProspecto(datos.telefono, datos.nombre ?? null)}
                        className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-md
                                   bg-primary text-primary-foreground text-sm font-medium
                                   hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <UserPlus size={15} weight="bold" aria-hidden="true" />
                        Crear la ficha con este número
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 4 · Lleno */}
            {!cargando && !error && p && (
              <div className="space-y-4">
                <div>
                  <p className="font-semibold text-foreground break-words">{p.nombre}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {/* El estado NO se dice solo con color: lleva su texto
                        dentro. Un color a secas no lo lee ni quien no lo
                        distingue ni un lector de pantalla. */}
                    {/* El estado se CAMBIA desde aqui (#112). Antes era texto
                        y habia que irse a Prospectos.
                        Un <select> de verdad: se abre con teclado, lo lee un
                        lector de pantalla y en el movil sale la rueda del
                        sistema. Y sigue diciendo su texto, no solo el color. */}
                    <select
                      value={p.status}
                      onChange={(e) => cambiarEstado(e.target.value)}
                      aria-label="Estado del prospecto"
                      title="Cambiar el estado"
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border-0 cursor-pointer
                                  focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                                  ${ESTADOS[p.status] || ESTADO_POR_DEFECTO}`}
                    >
                      {!STATUS_LABELS[p.status] && <option value={p.status}>{p.status}</option>}
                      {Object.entries(STATUS_LABELS).map(([valor, texto]) => (
                        <option key={valor} value={valor}>{texto}</option>
                      ))}
                    </select>
                    {p.reincidente && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        reincidente
                      </span>
                    )}
                    {p.lead_duplicado_de && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        duplicado del #{p.lead_duplicado_de}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Dato icono={<Briefcase size={15} />} etiqueta="Proyecto" valor={p.proyecto} />
                  <Dato icono={<User size={15} />} etiqueta="Gestora" valor={p.responsable} />
                  <Dato icono={<Package size={15} />} etiqueta="Producto de interés" valor={p.producto} />
                  <Dato icono={<Envelope size={15} />} etiqueta="Correo" valor={p.email} />
                  <Dato icono={<Phone size={15} />} etiqueta="Teléfono" valor={p.telefono} />
                  <Dato
                    icono={<ClockCounterClockwise size={15} />}
                    etiqueta="Entró"
                    valor={cuando(p.fecha_solicitud || p.created_at)}
                  />
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Últimas interacciones
                  </p>
                  {datos.interacciones?.length ? (
                    <ul className="space-y-2">
                      {datos.interacciones.map((i) => (
                        <li key={i.id} className="text-sm border-l-2 border-border pl-2.5">
                          <span className="text-xs text-muted-foreground">
                            {i.tipo}{i.quien ? ` · ${i.quien}` : ''}{cuando(i.fecha) ? ` · ${cuando(i.fecha)}` : ''}
                          </span>
                          {i.nota && <p className="text-foreground break-words">{i.nota}</p>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">Todavía no hay ninguna anotada.</p>
                  )}

                  {/* Apuntar una nota SIN salir (#112).
                      Es lo que la gestora acaba de hacer —hablar con la
                      persona— y el sitio natural para escribirlo es donde esta
                      mirando. Va debajo de las interacciones para que se vea
                      donde va a aparecer. */}
                  <div className="mt-3">
                    <label htmlFor="ficha-nota" className="sr-only">Apuntar una nota</label>
                    <textarea
                      id="ficha-nota"
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                      onKeyDown={(e) => {
                        // Ctrl/Cmd + Enter guarda. Enter a secas hace salto de
                        // linea: una nota de varias lineas es lo normal.
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); guardarNota(); }
                      }}
                      rows={2}
                      maxLength={2000}
                      placeholder="Apuntar lo que has hablado…"
                      className="w-full text-sm px-2.5 py-2 rounded-md border border-border bg-background
                                 resize-y focus:outline-none focus:border-primary"
                    />
                    <div className="flex items-center justify-between gap-2 mt-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        Ctrl + Enter para guardar
                      </span>
                      <button
                        type="button"
                        onClick={guardarNota}
                        disabled={!nota.trim() || guardando}
                        className="h-8 px-3 rounded-md text-xs font-semibold bg-primary text-primary-foreground
                                   disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {guardando ? 'Guardando…' : 'Apuntar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* En pestaña NUEVA, y esto es el motivo de la tarea entera: navegando
              en la misma, al volver se recarga el chat, la sesion de WhatsApp y
              el historial. Son varios segundos cada vez.

              La direccion sale de `BASE_URL` y no escrita a mano: produccion
              cuelga de /crm y staging de /testeo, y un enlace fijo llevaria a
              una pagina en blanco en uno de los dos. */}
          {!cargando && !error && p && (
            <div className="p-4 border-t border-border">
              <a
                href={`${import.meta.env.BASE_URL}prospectos/${p.id}`.replace(/\/{2,}/g, '/')}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 h-9 px-4 rounded-md w-full justify-center
                           bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Ver ficha completa
                <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
              </a>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Se abre en otra pestaña para no recargar el chat.
              </p>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
}
