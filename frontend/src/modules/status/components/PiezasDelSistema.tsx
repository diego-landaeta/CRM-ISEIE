import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle, WarningCircle, XCircle, Question, Clock,
  ArrowClockwise, CaretDown,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';

/**
 * «¿Está todo funcionando?», tarea #26.
 *
 * Lo que había en esta pantalla decía si hay una credencial guardada. Esto dice
 * cuándo hizo cada pieza su trabajo por última vez, que es la pregunta que se
 * hace de verdad cuando algo no llega.
 *
 * Cada bloque se pinta con lo que traiga: si una pieza vino rota, se pinta rota
 * y las demás no se enteran — el servidor ya las separa, y aquí no hay ningún
 * `map` que pueda reventar por un campo que falte.
 */

type Estado = 'bien' | 'atencion' | 'caida' | 'sin_datos' | 'sin_configurar';

interface Tarea {
  nombre: string;
  titulo: string;
  estado: 'bien' | 'fallando' | 'caida' | 'esperando';
  cadaMs: number;
  ultima: string | null;
  duracionMs: number | null;
  vueltas: number;
  fallos: number;
  corriendo: boolean;
  detalle: string | null;
}

interface Webhook {
  cuando: string;
  resultado: 'aceptado' | 'rechazado' | 'error';
  motivo: string | null;
  aceptados: number;
  rechazados: number;
}

interface Pieza {
  nombre: string;
  titulo: string;
  estado: Estado;
  resumen?: string;
  desde?: string | null;
  desdeQue?: string;
  detalle?: string | null;
  datos?: { tareas?: Tarea[]; webhook?: Webhook | null; [k: string]: unknown };
}

interface Comprobacion {
  global: Estado;
  comprobado: string;
  arribaDesdeMs: number;
  piezas: Pieza[];
}

const PINTA: Record<Estado, { texto: string; icono: typeof CheckCircle; clase: string; borde: string }> = {
  bien:           { texto: 'Funciona',         icono: CheckCircle,   clase: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200/60 dark:border-emerald-800/40', borde: 'border-emerald-200/60 dark:border-emerald-800/30' },
  atencion:       { texto: 'Atención',         icono: WarningCircle, clase: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-800/40',           borde: 'border-amber-200/60 dark:border-amber-800/30' },
  caida:          { texto: 'Caída',            icono: XCircle,       clase: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200/60 dark:border-red-800/40',                       borde: 'border-red-300/70 dark:border-red-800/40' },
  sin_datos:      { texto: 'Sin datos',        icono: Question,      clase: 'text-muted-foreground bg-muted border-border',                                                                                borde: 'border-border' },
  sin_configurar: { texto: 'Sin configurar',   icono: Question,      clase: 'text-muted-foreground bg-muted border-border',                                                                                borde: 'border-border' },
};

/** «hace 4 h», no una fecha ISO que hay que restar a ojo. */
function hace(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  if (ms < 60_000) return 'hace menos de un minuto';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.floor(h / 24)} días`;
}

function Chapa({ estado }: { estado: Estado }) {
  const p = PINTA[estado] ?? PINTA.sin_datos;
  const Icono = p.icono;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border shrink-0 ${p.clase}`}>
      <Icono size={13} weight="fill" aria-hidden="true" /> {p.texto}
    </span>
  );
}

/** El desglose de las doce tareas, plegado: sano ocupa una línea, roto se abre. */
function Tareas({ tareas }: { tareas: Tarea[] }) {
  const malas = tareas.filter((t) => t.estado === 'caida' || t.estado === 'fallando');
  // Si hay algo mal se abre solo. Que el problema esté escondido tras un clic
  // es la forma de que nadie lo vea.
  const [abierto, setAbierto] = useState(malas.length > 0);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <CaretDown size={12} weight="bold" className={`transition-transform ${abierto ? '' : '-rotate-90'}`} aria-hidden="true" />
        {abierto ? 'Ocultar' : 'Ver'} las {tareas.length} tareas
      </button>

      {abierto && (
        <ul className="mt-2 space-y-1.5">
          {tareas.map((t) => {
            const mal = t.estado === 'caida' || t.estado === 'fallando';
            return (
              <li key={t.nombre} className="flex items-start justify-between gap-3 text-xs">
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${mal ? 'text-red-600 dark:text-red-400 font-medium' : 'text-foreground'}`}>
                    {t.titulo}
                  </span>
                  {t.detalle && mal && (
                    <span className="block text-red-600/80 dark:text-red-400/80 break-words">{t.detalle}</span>
                  )}
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {t.corriendo ? 'ahora mismo'
                    : t.estado === 'esperando' ? 'aún no le toca'
                    : hace(t.ultima) ?? 'nunca'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function PiezasDelSistema() {
  const [datos, setDatos] = useState<Comprobacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await client.get('/status/piezas');
      if (!r.success) throw new Error(r.error || 'No se pudo comprobar');
      if (vivo.current) setDatos(r.data as Comprobacion);
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se pudo comprobar');
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    vivo.current = true;
    cargar();
    // Cada minuto. Una pantalla de estado que hay que refrescar a mano se mira
    // una vez y se deja abierta mintiendo.
    const t = setInterval(cargar, 60_000);
    return () => { vivo.current = false; clearInterval(t); };
  }, [cargar]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <h2 className="font-bold">Cómo está ahora mismo</h2>
          {datos && <Chapa estado={datos.global} />}
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted text-sm font-medium transition-colors text-muted-foreground disabled:opacity-50"
        >
          <ArrowClockwise size={14} weight="bold" className={cargando ? 'animate-spin' : ''} aria-hidden="true" />
          Comprobar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm bg-card border border-border rounded-xl p-4">
          <WarningCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
          <span className="text-foreground">{error}</span>
          <button type="button" onClick={cargar} className="underline text-muted-foreground">Reintentar</button>
        </div>
      )}

      {!datos && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" aria-busy="true">
          <span className="sr-only">Comprobando el sistema…</span>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      )}

      {datos && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {datos.piezas.map((p) => {
              const pinta = PINTA[p.estado] ?? PINTA.sin_datos;
              const cuando = hace(p.desde);
              return (
                <div key={p.nombre} className={`bg-card border rounded-xl p-5 space-y-2 ${pinta.borde}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-sm min-w-0">{p.titulo}</p>
                    <Chapa estado={p.estado} />
                  </div>

                  {p.resumen && <p className="text-xs text-muted-foreground leading-relaxed">{p.resumen}</p>}

                  {cuando && (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      {/* Cada pieza dice de qué es su fecha. Con un «Última
                          vez» para todas, la de la API —que es el último
                          ERROR— se leía como si fuera lo contrario. */}
                      <Clock size={12} aria-hidden="true" /> {p.desdeQue ?? 'Última vez'}, {cuando}
                    </p>
                  )}

                  {/* El motivo, entero y sin recortar: si algo está roto, lo que
                      hace falta es saber qué, no un «error» a secas. */}
                  {p.detalle && (
                    <p className="text-xs text-red-600 dark:text-red-400 break-words bg-red-50 dark:bg-red-950/30 rounded-md px-2 py-1.5">
                      {p.detalle}
                    </p>
                  )}

                  {/* El webhook va aparte del cobro porque son dos cosas
                      distintas: puede entrar dinero por el sondeo con el
                      webhook rechazado desde hace semanas. */}
                  {p.datos?.webhook && (
                    <p className={`text-xs ${p.datos.webhook.resultado === 'aceptado'
                      ? 'text-muted-foreground'
                      : 'text-amber-600 dark:text-amber-400'}`}>
                      Último webhook {hace(p.datos.webhook.cuando)}: {p.datos.webhook.resultado}
                      {p.datos.webhook.rechazados > 0 && ` · ${p.datos.webhook.rechazados} rechazados`}
                    </p>
                  )}

                  {p.datos?.tareas && p.datos.tareas.length > 0 && <Tareas tareas={p.datos.tareas} />}
                </div>
              );
            })}
          </div>

          <p className="text-xs text-muted-foreground">
            Comprobado {hace(datos.comprobado) ?? 'ahora'}, y se repite solo cada minuto.
            {' '}El servidor lleva {hace(new Date(Date.now() - datos.arribaDesdeMs).toISOString())?.replace('hace ', '') ?? 'poco'} en marcha
            {' '}— tras un reinicio, las tareas tardan en tener algo que contar.
          </p>
        </>
      )}
    </section>
  );
}
