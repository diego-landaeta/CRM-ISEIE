import { useCallback, useEffect, useState } from 'react';
import { Users, ArrowsClockwise, WarningCircle, Clock } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { lista } from '@/shared/lib/lista';

/**
 * Último lead asignado a cada gestora (#11).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTE Y NO EL DE ANTES
 *
 * Aquí había un panel que anunciaba a quién le TOCA el siguiente lead, según el
 * round-robin del CRM. El problema no era cómo estaba hecho: es que ese
 * round-robin no es quien reparte.
 *
 * Los leads automáticos los asigna **Make** en el webhook y llegan con gestora
 * puesta. El round-robin del CRM solo actúa cuando alguien crea un lead a mano,
 * que es la minoría. Así que el panel acertaba en el caso raro y fallaba en el
 * habitual — sin dar error, y enseñando un nombre con toda la seguridad del
 * mundo. Una gestora que lo mirara se creería que le toca y no le tocaría.
 *
 * Este le da la vuelta: en vez de predecir, enseña lo que ha pasado. Eso es
 * cierto venga el lead de Make o de la mano de alguien.
 *
 * EL DATO QUE IMPORTA NO ES EL ÚLTIMO LEAD
 *
 * Es **cuánto lleva cada una sin recibir uno**. Ese es el número que delata un
 * reparto torcido, y por eso va destacado y ordena la lista. Lo demás —quién,
 * cuándo, qué formación— es el contexto que hace falta para creérselo.
 *
 * Y quien está en el reparto y no ha recibido nada sale igual, con todo a cero:
 * una gestora que no recibe es justo lo que hay que ver, y si desapareciera de
 * la lista no se vería.
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface FilaGestora {
  id: number;
  gestora: string;
  avatar_url?: string | null;
  lead_id: number | null;
  lead_nombre: string | null;
  lead_entro: string | null;
  lead_producto: string | null;
  lead_canal: string | null;
  horas_sin_recibir: number | null;
  hoy: number;
  semana: number;
  mes: number;
  /** Si ha hecho algo en el CRM dentro de la ventana de la asignación (CRM#524). */
  activa?: { hace_min: number; que: string } | null;
}

interface Respuesta {
  gestoras: FilaGestora[];
  sin_responsable: number;
  ventana_min?: number;
  nota?: string;
}

/** A partir de aquí llama la atención: dos días sin un lead ya es raro. */
const HORAS_LLAMATIVAS = 48;

/*
  QUIÉN ESTÁ ACTIVA AHORA (CRM#524; Carlos, 28/10: «para saber quién está activa,
  que me haga un sombreado»). La fila de la gestora que ha hecho algo en el CRM en
  los últimos minutos de la ventana de la asignación va sombreada, con un punto y
  el porqué al pasar el ratón. Se refresca sola cada minuto.
*/
const QUE: Record<string, string> = {
  nota: 'nota', contacto: 'contacto', estado: 'cambio de estado', recordatorio: 'recordatorio', paso: 'paso del proceso',
  edicion: 'edición', whatsapp: 'WhatsApp', crear_lead: 'creó un lead', email: 'correo', producto: 'producto',
  venta: 'venta', matricula: 'matrícula', factura: 'factura', proceso: 'proceso',
};
export function textoActiva(a: { hace_min: number; que: string }): string {
  const cuando = a.hace_min <= 0 ? 'activa ahora mismo' : `activa hace ${a.hace_min} min`;
  return `${cuando} (${QUE[a.que] || a.que})`;
}
const REFRESCO_MS = 60_000;

function cuantoHace(horas: number | null): string {
  if (horas == null) return 'nunca ha recibido';
  if (horas < 1) return 'hace menos de una hora';
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
}

export default function UltimoLeadAsignado(
  { projectId, issuerId }: { projectId?: number | null; issuerId?: number | null },
) {
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);

  const traer = useCallback(async () => {
    setCargando(true);
    try {
      // Sin proyecto se manda `-1`, que es lo que el CRM usa para «todos».
      const q = issuerId ? `?issuerId=${issuerId}` : '';
      const r = await client.get(`/projects/${projectId || -1}/ultimo-lead${q}`);
      // `lista()` y no `r.data` a secas: si el servidor contesta cualquier otra
      // cosa, la pantalla se queda vacía en vez de caerse entera.
      if (r.success) {
        setDatos({
          gestoras: lista(r.data?.gestoras),
          sin_responsable: Number(r.data?.sin_responsable ?? 0),
          ventana_min: r.data?.ventana_min,
          nota: r.data?.nota,
        });
      }
    } catch {
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [projectId, issuerId]);

  useEffect(() => { traer(); }, [traer]);
  // Quién está activa cambia de minuto en minuto: se refresca sola.
  useEffect(() => {
    const t = setInterval(() => { traer(); }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [traer]);

  if (!datos && !cargando) return null;

  const filas = datos?.gestoras ?? [];
  const activas = filas.filter((f) => f.activa);
  const paradas = filas.filter(
    (f) => f.horas_sin_recibir == null || f.horas_sin_recibir >= HORAS_LLAMATIVAS,
  );

  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3">
      <header className="flex items-center gap-2 flex-wrap">
        <Users size={15} weight="bold" className="text-muted-foreground" />
        <h3 className="text-sm font-semibold">Último lead de cada gestora</h3>
        {datos && datos.sin_responsable > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-warning-soft text-warning-soft-foreground">
            {datos.sin_responsable} sin gestora
          </span>
        )}
        {datos && (
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${activas.length ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground'}`}
            title={`Han hecho algo en el CRM en los últimos ${datos.ventana_min ?? 5} min`}>
            {activas.length ? `${activas.length} ${activas.length === 1 ? 'activa' : 'activas'} ahora` : 'Ninguna activa ahora'}
          </span>
        )}
        <button
          onClick={traer}
          disabled={cargando}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <ArrowsClockwise size={13} weight="bold" className={cargando ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </header>

      {paradas.length > 0 && (
        <p className="text-xs flex items-start gap-1.5 text-warning-soft-foreground">
          <WarningCircle size={14} weight="fill" className="flex-shrink-0 mt-0.5" />
          <span>
            {paradas.length === 1 ? 'Una gestora lleva' : `${paradas.length} gestoras llevan`}
            {' '}más de dos días sin recibir un lead:{' '}
            <strong>{paradas.map((f) => f.gestora.split(' ')[0]).join(', ')}</strong>.
          </span>
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-muted-foreground border-b border-border">
              <th className="text-left font-medium py-1.5 pr-3">Gestora</th>
              <th className="text-left font-medium py-1.5 pr-3">Su último lead</th>
              <th className="text-left font-medium py-1.5 pr-3">Canal</th>
              <th className="text-left font-medium py-1.5 pr-3">Cuándo</th>
              <th className="text-right font-medium py-1.5 px-2">Hoy</th>
              <th className="text-right font-medium py-1.5 px-2">Semana</th>
              <th className="text-right font-medium py-1.5 pl-2">Mes</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const parada = f.horas_sin_recibir == null || f.horas_sin_recibir >= HORAS_LLAMATIVAS;
              return (
                <tr key={f.id} className={`border-b border-border last:border-0 ${f.activa ? 'bg-success-soft' : ''}`}
                  data-activa={f.activa ? 'si' : undefined}>
                  <td className="py-2 pr-3 font-medium" title={f.activa ? textoActiva(f.activa) : undefined}>
                    {f.activa && (
                      <span className="inline-block w-2 h-2 rounded-full bg-success mr-1.5 align-middle" aria-label={textoActiva(f.activa)} />
                    )}
                    {f.gestora}
                    {f.activa && <span className="block text-[10px] font-normal text-success-soft-foreground">{textoActiva(f.activa)}</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {f.lead_nombre || <span className="italic">—</span>}
                    {f.lead_producto && (
                      <span className="block text-[10px] opacity-70">{f.lead_producto}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                    {f.lead_canal || '—'}
                  </td>
                  <td className={`py-2 pr-3 whitespace-nowrap ${parada ? 'text-warning font-semibold' : 'text-muted-foreground'}`}>
                    {parada && <Clock size={11} weight="bold" className="inline mr-1 -mt-0.5" />}
                    {cuantoHace(f.horas_sin_recibir)}
                    {f.lead_entro && (
                      <span className="block text-[10px] font-normal opacity-70">
                        {new Date(f.lead_entro).toLocaleString('es-ES',
                          { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{f.hoy}</td>
                  <td className="py-2 px-2 text-right tabular-nums">{f.semana}</td>
                  <td className="py-2 pl-2 text-right tabular-nums font-medium">{f.mes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Se dice de dónde viene el reparto para que nadie lea esto como una
          predicción. Es lo que pasó, no lo que va a pasar — y esa confusión es
          exactamente la que hundió al panel anterior. */}
      {datos?.nota && (
        <p className="text-[11px] text-muted-foreground">{datos.nota}</p>
      )}
    </section>
  );
}
