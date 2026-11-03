import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight, ChatCircleDots, CurrencyEur, UserPlus } from '@phosphor-icons/react';
import client from '@/shared/api/client';

/**
 * «Qué ha pasado hoy» (#13): la actividad reciente, de más nueva a más vieja.
 *
 * Altas de prospectos, ventas, cambios de estado y contactos. Cada gestora ve lo
 * suyo (sus prospectos y lo que hizo ella) y quien manda, lo de sus campus: el
 * recorte lo pone el servidor con la sesión. Cada fila lleva a la ficha.
 *
 * No cuenta nada por su cuenta: lee lo que el CRM ya apunta (`GET /api/actividad`,
 * que recoge de las tablas de siempre en vez de mantener una tabla de actividad
 * aparte). Callado si falla: es un bloque de apoyo.
 */

interface Evento {
  tipo: 'lead_creado' | 'venta_creada' | 'estado_cambiado' | 'contacto';
  fecha: string;
  lead_id: number | null;
  proyecto: string;
  texto: string;
}
interface Pagina { eventos: Evento[]; siguiente: string | null }

const ICONO = {
  lead_creado: UserPlus,
  venta_creada: CurrencyEur,
  estado_cambiado: ArrowsLeftRight,
  contacto: ChatCircleDots,
} as const;

const TONO: Record<Evento['tipo'], string> = {
  lead_creado: 'bg-primary/10 text-primary',
  venta_creada: 'bg-success-soft text-success-soft-foreground',
  estado_cambiado: 'bg-muted text-muted-foreground',
  contacto: 'bg-muted text-muted-foreground',
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

export default function ActividadDeHoy(
  { projectId = null, issuerId = null, mostrarProyecto = false }:
  { projectId?: number | null; issuerId?: number | null; mostrarProyecto?: boolean },
) {
  const navigate = useNavigate();
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [siguiente, setSiguiente] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);

  const pedir = useCallback(async (before: string | null): Promise<Pagina> => {
    const p = new URLSearchParams({ limit: '15' });
    if (issuerId) p.set('issuerId', String(issuerId));
    else if (projectId) p.set('projectId', String(projectId));
    if (before) p.set('before', before);
    const r = (await client.get(`/actividad?${p.toString()}`)) as unknown as { success?: boolean; data?: Pagina };
    if (!r.success || !r.data) throw new Error('sin datos');
    return r.data;
  }, [projectId, issuerId]);

  useEffect(() => {
    let vivo = true;
    setFallo(false);
    pedir(null)
      .then((d) => { if (vivo) { setEventos(d.eventos); setSiguiente(d.siguiente); } })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [pedir]);

  async function verMas() {
    if (!siguiente) return;
    setCargandoMas(true);
    try {
      const d = await pedir(siguiente);
      setEventos((e) => [...(e || []), ...d.eventos]);
      setSiguiente(d.siguiente);
    } catch { /* se queda como está */ } finally { setCargandoMas(false); }
  }

  if (fallo || !eventos) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <h2 className="font-semibold text-base">Qué ha pasado hoy</h2>
      <p className="text-xs text-muted-foreground mb-3">Altas, ventas, cambios de estado y contactos, de lo más nuevo a lo más viejo.</p>

      {eventos.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">Todavía no ha pasado nada hoy.</p>
      ) : (
        <ul className="divide-y divide-border">
          {eventos.map((e, i) => {
            const Icono = ICONO[e.tipo];
            const abre = e.lead_id ? () => navigate(`/leads/${e.lead_id}`) : undefined;
            return (
              <li key={`${e.tipo}-${e.fecha}-${e.lead_id}-${i}`}>
                <button
                  type="button" onClick={abre} disabled={!abre}
                  className="flex w-full items-start gap-2.5 py-2 text-left hover:bg-muted/40 disabled:hover:bg-transparent"
                >
                  <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${TONO[e.tipo]}`}>
                    <Icono size={13} weight="bold" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    {e.texto}
                    {mostrarProyecto && <span className="ml-1.5 text-[11px] text-muted-foreground">· {e.proyecto}</span>}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{hora(e.fecha)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {siguiente && (
        <button
          type="button" onClick={verMas} disabled={cargandoMas}
          className="mt-2 h-8 w-full rounded-md border border-border text-xs font-semibold hover:bg-muted disabled:opacity-50"
        >{cargandoMas ? 'Cargando…' : 'Ver más'}</button>
      )}
    </div>
  );
}
