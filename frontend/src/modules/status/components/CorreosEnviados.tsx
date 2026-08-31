import { useCallback, useEffect, useState } from 'react';
import {
  EnvelopeSimple, CheckCircle, XCircle, ShieldWarning, ArrowClockwise,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';

/**
 * Los correos que el CRM intento mandar, y los que no salieron.
 *
 * Es la cuarta subfase de la tarea #27, y sin ella el resto no se puede
 * comprobar: los 3.133 intentos perdidos de ISEIE y MultiCRM estaban en el log
 * del servidor, y por eso no los vio nadie. Un registro que hay que consultar
 * por SSH no es un registro, es un archivo.
 *
 * Aqui se ve de un vistazo lo que uno pregunta de verdad: **que NO salio**.
 */

type Envio = {
  id: number;
  clave: string | null;
  destinatarios: string;
  asunto: string;
  etiquetas: string[] | null;
  estado: 'enviado' | 'fallido' | 'bloqueado';
  intentos: number;
  error: string | null;
  created_at: string;
};

type Resumen = { enviado: number; fallido: number; bloqueado: number };

const ESTADOS = {
  enviado: {
    icono: CheckCircle,
    color: 'text-emerald-600 dark:text-emerald-400',
    fondo: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300',
    texto: 'Salió',
  },
  fallido: {
    icono: XCircle,
    color: 'text-rose-600 dark:text-rose-400',
    fondo: 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300',
    texto: 'No salió',
  },
  bloqueado: {
    icono: ShieldWarning,
    color: 'text-amber-600 dark:text-amber-400',
    fondo: 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300',
    texto: 'Frenado',
  },
} as const;

const cuando = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};

export default function CorreosEnviados() {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [resumen, setResumen] = useState<Resumen>({ enviado: 0, fallido: 0, bloqueado: 0 });
  const [filtro, setFiltro] = useState<'' | Envio['estado']>('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await client.get(`/status/correos${filtro ? `?estado=${filtro}` : ''}`);
      if (!r.success) throw new Error(r.error || 'No se pudo leer el registro');
      setEnvios(r.data.envios || []);
      setResumen(r.data.resumen || { enviado: 0, fallido: 0, bloqueado: 0 });
    } catch (e) {
      setError((e as Error).message);
      setEnvios([]);
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
        <div className="min-w-0">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <EnvelopeSimple size={17} aria-hidden="true" />
            Correos del CRM
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Lo que se intentó mandar en las últimas 24 horas, saliera o no.
          </p>
        </div>
        <button
          type="button"
          onClick={cargar}
          disabled={cargando}
          className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border
                     hover:bg-muted text-sm font-medium text-muted-foreground disabled:opacity-50
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowClockwise size={14} weight="bold" className={cargando ? 'animate-spin' : ''} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      {/* El resumen es filtro a la vez: se pulsa y se ve solo eso. Lo que uno
          quiere saber es «¿cuántos NO salieron?» y poder pulsarlo. */}
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        {(['enviado', 'fallido', 'bloqueado'] as const).map((e) => {
          const E = ESTADOS[e];
          const puesto = filtro === e;
          return (
            <button
              key={e}
              type="button"
              onClick={() => setFiltro(puesto ? '' : e)}
              aria-pressed={puesto}
              className={`p-3 text-center hover:bg-muted/50 transition-colors ${puesto ? 'bg-muted' : ''}
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`}
            >
              <span className={`block text-2xl font-semibold tabular-nums ${E.color}`}>
                {resumen[e]}
              </span>
              {/* El estado NO se dice solo con color: lleva su palabra debajo. */}
              <span className="block text-xs text-muted-foreground mt-0.5">{E.texto}</span>
            </button>
          );
        })}
      </div>

      <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
        {/* 1 · Cargando */}
        {envios === null && !error && (
          <div className="p-4 space-y-2" aria-busy="true">
            <span className="sr-only">Cargando los correos…</span>
            {[0, 1, 2].map((i) => <div key={i} className="h-10 rounded bg-muted animate-pulse" />)}
          </div>
        )}

        {/* 2 · Error */}
        {error && (
          <div className="p-6 text-center">
            <p className="text-sm text-foreground">{error}</p>
            <button type="button" onClick={cargar}
              className="mt-2 text-sm underline text-muted-foreground hover:text-foreground">
              Reintentar
            </button>
          </div>
        )}

        {/* 3 · Vacío, y 4 · vacío por el filtro, que no es lo mismo */}
        {envios?.length === 0 && !error && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {filtro
              ? <>Ninguno con ese estado.{' '}
                  <button type="button" onClick={() => setFiltro('')} className="underline">
                    Ver todos
                  </button>
                </>
              : 'El CRM no ha intentado mandar ningún correo todavía.'}
          </div>
        )}

        {/* 5 · Lleno */}
        {envios?.map((e) => {
          const E = ESTADOS[e.estado] || ESTADOS.fallido;
          const Icono = E.icono;
          return (
            <div key={e.id} className="p-3 flex items-start gap-3">
              <Icono size={16} weight="fill" className={`shrink-0 mt-0.5 ${E.color}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground break-words">{e.asunto}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${E.fondo}`}>
                    {E.texto}
                  </span>
                  {e.intentos > 1 && (
                    <span className="text-[10px] text-muted-foreground">{e.intentos} intentos</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground break-all mt-0.5">{e.destinatarios}</p>
                {/* El motivo, entero: es lo único que dice qué hacer. */}
                {e.error && (
                  <p className="text-xs mt-1 text-amber-700 dark:text-amber-400 break-words">{e.error}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {cuando(e.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
