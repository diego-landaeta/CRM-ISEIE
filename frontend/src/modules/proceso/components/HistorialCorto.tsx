// Lo que ya ha pasado con esta persona, dentro del panel.
//
// Diego, 24/09: «aquí le añadiría el historial que tiene también como apoyo,
// sin tener que ver la ficha entera».
//
// Antes, para saber qué se le había dicho a alguien había que cerrar el panel,
// abrir su ficha, leer y volver a la cola —y volver significaba perder el sitio
// en la lista—. Con veinte personas al día eso es veinte viajes, así que en la
// práctica no se miraba: se llamaba a ciegas y se repetía lo de la semana
// pasada.
//
// VA PLEGADO. El panel existe para escribir el mensaje del paso, y eso tiene
// que seguir siendo lo primero que se ve. El historial es apoyo: se abre cuando
// hace falta, y al abrirlo se queda abierto mientras se recorre la cola, porque
// quien lo mira una vez lo suele querer en todas.
//
// SE PIDE AL ABRIRLO, no al pintar la fila. Son cien filas por página; traer el
// historial de todas para que se lean dos sería castigar al servidor por nada.

import { useEffect, useState } from 'react';
import { CaretDown, ChatCircleDots, Phone, EnvelopeSimple, Note, ArrowsClockwise } from '@phosphor-icons/react';
import client from '@/shared/api/client';

type Evento = {
  clave: string;
  cuando: string;
  tipo: string;
  texto: string;
  quien: string | null;
};

const ICONO: Record<string, typeof Phone> = {
  llamada: Phone,
  whatsapp: ChatCircleDots,
  email: EnvelopeSimple,
  nota: Note,
  estado: ArrowsClockwise,
};

/** «hace 3 días», «hace 2 meses» — una fecha obliga a restar. */
function hace(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return meses < 12 ? `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}` : `hace ${Math.floor(meses / 12)} años`;
}

export default function HistorialCorto({
  leadId,
  abierto,
  onAlternar,
}: {
  leadId: number;
  /** Lo decide quien llama, para que se quede abierto al pasar de persona. */
  abierto: boolean;
  onAlternar: () => void;
}) {
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    if (!abierto || !leadId) return;
    let vivo = true;
    setEventos(null);
    setFallo(false);
    client.get(`/leads/${leadId}`)
      .then((r: any) => {
        if (!vivo) return;
        if (!r?.success) { setFallo(true); return; }
        const d = r.data || {};
        const interacciones: Evento[] = (d.interactions || []).map((i: any, n: number) => ({
          clave: `i-${i.id ?? n}`,
          cuando: i.fecha || i.created_at,
          tipo: i.tipo || 'nota',
          texto: i.nota || '(sin nota)',
          quien: i.usuario_nombre || i.created_by_nombre || null,
        }));
        const estados: Evento[] = (d.statusHistory || []).map((h: any, n: number) => ({
          clave: `e-${h.id ?? n}`,
          cuando: h.created_at || h.fecha,
          tipo: 'estado',
          texto: `Pasó a «${h.status_nuevo}»${h.motivo ? ` · ${h.motivo}` : ''}`,
          quien: h.changed_by_nombre || null,
        }));
        setEventos([...interacciones, ...estados]
          .filter((e) => e.cuando)
          .sort((a, b) => new Date(b.cuando).getTime() - new Date(a.cuando).getTime())
          .slice(0, 8));
      })
      .catch(() => { if (vivo) setFallo(true); });
    return () => { vivo = false; };
  }, [leadId, abierto]);

  return (
    <div className="wa-historial-corto">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierto}
        className="flex w-full items-center gap-1.5 rounded px-1 py-1 text-normal font-semibold text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <CaretDown size={12} weight="bold" className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
        {abierto ? 'Ocultar el historial' : 'Ver el historial'}
      </button>

      {abierto && (
        <div className="mt-1.5">
          {eventos === null && !fallo && (
            <p className="text-secundario text-muted-foreground">Cargando…</p>
          )}
          {fallo && (
            <p className="text-secundario text-muted-foreground">
              No se ha podido traer el historial. Está en su ficha.
            </p>
          )}
          {eventos !== null && eventos.length === 0 && (
            <p className="text-secundario text-muted-foreground">
              Nada todavía: nadie le ha escrito desde que entró.
            </p>
          )}
          {eventos !== null && eventos.length > 0 && (
            <ol className="space-y-1.5">
              {eventos.map((e) => {
                const Icono = ICONO[e.tipo] || Note;
                return (
                  <li key={e.clave} className="flex items-baseline gap-2 text-normal">
                    <Icono size={12} className="translate-y-0.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground">{e.texto}</span>
                      {e.quien && <span className="text-muted-foreground"> · {e.quien}</span>}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                      {hace(e.cuando)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
