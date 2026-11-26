import { CheckCircle, Prohibit, ArrowCounterClockwise, Warning } from '@phosphor-icons/react';
import { formatDate, formatDateTime } from '@/shared/lib/format';
import { EtiquetaEnPruebas } from '@/shared/components/ui/EnPruebas';
import type { CambioDeEstado, EstadoEnCampus, SuspensionesMoodle } from '../api/suspensionesMoodle.api';

/*
  Suspensiones y reactivaciones de Moodle en la ficha del alumno (CRM#531).

  Encima del avance en Moodle (#532), en la pestaña «Campus»: el estado de hoy por campus
  —«Al día», «Cuenta suspendida en Moodle desde … · motivo», «Reactivada en Moodle el …»—
  y el historial de cambios. Y, en la cabecera de la ficha, la etiqueta «Cuenta (o
  Matrícula) suspendida en Moodle» para verlo sin abrir la pestaña. El color va siempre con
  su texto al lado.

  Sin género (QA del 25/11/2026: «Suspendido», «Reactivado» lo decían en masculino a
  todas): lo que se suspende o se reactiva es la cuenta del campus o la matrícula de un
  curso, y se dice eso, que concuerda siempre. Como el título de la campana.

  El motivo lo deduce el CRM de sus cobros al recibir el aviso (Moodle no lo dice): por eso
  la ficha lo presenta como «según el CRM».
*/

const VIA: Record<string, string> = { ws: 'desde una integración (Make…)', cli: 'por un script', web: 'a mano en Moodle' };

type QueSeSuspende = { cuenta: boolean; cursos: { id: number; nombre: string | null }[] };

function queEsta(e: QueSeSuspende) {
  const partes: string[] = [];
  if (e.cuenta) partes.push('la cuenta del campus');
  if (e.cursos.length) partes.push(e.cursos.map((k) => k.nombre || `curso ${k.id}`).join(', '));
  return partes.join(' y ');
}

/**
 * Qué está suspendido, sin género: la cuenta entera manda; si no, la matrícula (o las
 * matrículas) de los cursos. «Suspensión» solo si el aviso no dijera ninguna de las dos.
 */
export function loSuspendido(e: QueSeSuspende): string {
  if (e.cuenta) return 'Cuenta suspendida';
  if (e.cursos.length > 1) return 'Matrículas suspendidas';
  if (e.cursos.length === 1) return 'Matrícula suspendida';
  return 'Suspensión';
}

/** La etiqueta de la cabecera: solo si sigue suspendido en algún campus. */
export function EtiquetaSuspendido({ datos }: { datos: SuspensionesMoodle | null }) {
  if (!datos?.disponible || !datos.suspendido) return null;
  const suspendidos = datos.campus.filter((c) => c.estado === 'suspendido');
  const todo = { cuenta: suspendidos.some((c) => c.cuenta), cursos: suspendidos.flatMap((c) => c.cursos) };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-destructive-soft px-2 py-0.5 text-[11px] font-bold text-destructive-soft-foreground"
      title={suspendidos[0]?.motivoTexto || undefined}
    >
      <Prohibit size={11} weight="bold" aria-hidden /> {loSuspendido(todo)} en Moodle
    </span>
  );
}

function EstadoDeUnCampus({ c, varios }: { c: EstadoEnCampus; varios: boolean }) {
  const suspendido = c.estado === 'suspendido';
  // El texto, a la derecha de la etiqueta si caben 14rem; si no (móvil), debajo, a lo ancho.
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
      {suspendido ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive-soft px-2 py-0.5 text-[11px] font-semibold text-destructive-soft-foreground">
          <Prohibit size={11} weight="bold" aria-hidden /> {loSuspendido(c)}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-foreground">
          <ArrowCounterClockwise size={11} weight="bold" aria-hidden /> Reactivada
        </span>
      )}
      <div className="min-w-0 grow basis-56 text-sm">
        <p className="text-foreground">
          {suspendido
            ? <>{loSuspendido(c)} en Moodle desde el <strong className="font-semibold">{formatDate(c.desde)}</strong></>
            : <>Reactivada en Moodle el <strong className="font-semibold">{formatDate(c.desde)}</strong></>}
          {varios && c.campus && <span className="text-muted-foreground"> · {c.campus}</span>}
        </p>
        {suspendido && queEsta(c) && <p className="text-xs text-muted-foreground">Afecta a: {queEsta(c)}</p>}
        {c.motivoTexto && (
          <p className="text-xs text-muted-foreground">
            {suspendido ? 'Motivo según el CRM: ' : ''}{c.motivoTexto}
          </p>
        )}
      </div>
    </li>
  );
}

/** Un cambio del historial, sin género: «Cuenta suspendida», «Matrícula reactivada»… */
export function cambioDicho(h: Pick<CambioDeEstado, 'ambito' | 'suspendido'>): string {
  return `${h.ambito === 'curso' ? 'Matrícula' : 'Cuenta'} ${h.suspendido ? 'suspendida' : 'reactivada'}`;
}

function FilaHistorial({ h, varios }: { h: CambioDeEstado; varios: boolean }) {
  const curso = h.ambito === 'curso' ? (h.curso?.nombre || `curso ${h.curso?.id}`) : null;
  return (
    <li className="flex flex-col gap-0.5 py-2 text-xs sm:flex-row sm:items-baseline sm:gap-3">
      <span className="shrink-0 tabular-nums text-muted-foreground sm:w-40">{formatDateTime(h.fecha)}</span>
      <span className="min-w-0 text-foreground">
        <strong className={h.suspendido ? 'font-semibold text-destructive-soft-foreground' : 'font-semibold text-success-soft-foreground'}>
          {cambioDicho(h)}
        </strong>
        {curso ? ` · ${curso}` : ''}
        {varios && h.campus ? ` · ${h.campus}` : ''}
        {h.via && VIA[h.via] ? <span className="text-muted-foreground"> · {VIA[h.via]}</span> : null}
        {h.motivoTexto && h.suspendido && <span className="block text-muted-foreground">{h.motivoTexto}</span>}
        {h.motivoTexto && !h.suspendido && h.motivo === 'pago' && <span className="block text-muted-foreground">{h.motivoTexto}</span>}
      </span>
    </li>
  );
}

export default function SuspensionesMoodleBloque({
  datos, cargando, error,
}: { datos: SuspensionesMoodle | null; cargando: boolean; error: string | null }) {
  if (!datos?.disponible && !error) {
    if (!cargando) return null;
    return <div className="h-14 rounded-xl bg-muted animate-pulse" aria-busy="true" aria-label="Leyendo las suspensiones" />;
  }
  const varios = new Set((datos?.historial || []).map((h) => h.projectId)).size > 1;
  return (
    <section aria-label="Estado en Moodle" className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-bold text-foreground">Estado en Moodle</h4>
        <EtiquetaEnPruebas />
      </div>
      {error ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Warning size={15} className="mt-0.5 shrink-0 text-warning" aria-hidden />
          No se han podido leer las suspensiones: {error}
        </p>
      ) : !datos || datos.campus.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-foreground">
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success-soft-foreground">
            <CheckCircle size={11} weight="fill" aria-hidden /> Al día
          </span>
          <span className="text-xs text-muted-foreground">Moodle no ha avisado de ninguna suspensión.</span>
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {datos.campus.map((c) => <EstadoDeUnCampus key={c.projectId} c={c} varios={datos.campus.length > 1 || varios} />)}
          </ul>
          {datos.historial.length > 0 && (
            <details className="group" open={datos.historial.length <= 5}>
              <summary className="cursor-pointer rounded text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                Historial de cambios ({datos.historial.length})
              </summary>
              <ul className="mt-1.5 divide-y divide-border/60">
                {datos.historial.map((h) => <FilaHistorial key={h.id} h={h} varios={varios} />)}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
