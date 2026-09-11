import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Circle, WarningCircle, CaretRight, ListChecks } from '@phosphor-icons/react';
import { traerPasosDeLead, type PasoDeLead } from '../api/agenda.api';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';

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
 */

function fecha(d: string) {
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export default function AgendaDelProspecto({ leadId }: { leadId: number }) {
  const [pasos, setPasos] = useState<PasoDeLead[] | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    traerPasosDeLead(leadId)
      .then((r) => { if (vivo) setPasos(r); })
      .catch(() => { if (vivo) setPasos([]); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [leadId]);

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
          {siguiente.nota_del_paso && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">{siguiente.nota_del_paso}</p>
          )}
        </div>
      ) : (
        <p className="mb-3 text-[11px] text-muted-foreground">
          No queda ningún paso pendiente con esta persona.
        </p>
      )}

      {/* Los demás, para ver por dónde va sin salir de la ficha. */}
      <ol className="space-y-1.5">
        {pasos.map((p) => {
          const esSiguiente = siguiente?.id === p.id;
          return (
            <li key={p.id} className="flex items-start gap-2 text-[12px]">
              <span className="mt-0.5 flex-shrink-0">
                {p.hecho
                  ? <CheckCircle size={14} weight="fill" className="text-emerald-600" />
                  : p.vencido
                    ? <WarningCircle size={14} weight="fill" className="text-red-500" />
                    : <Circle size={14} className="text-muted-foreground/40" />}
              </span>
              <span className={`min-w-0 flex-1 truncate ${p.hecho ? 'text-muted-foreground line-through' : esSiguiente ? 'font-semibold' : ''}`}>
                {p.nombre || p.clave}
              </span>
              <span className="flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {p.estado === 'saltado' ? 'saltado' : fecha(p.fecha_prevista)}
              </span>
            </li>
          );
        })}
      </ol>

      <Link
        to="/prospectos/cola"
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
      >
        Ver la cola del día <CaretRight size={10} weight="bold" />
      </Link>
    </div>
  );
}
