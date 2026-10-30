import { useEffect, useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';

/**
 * Si cada gestora responde en WhatsApp, y lo que apunta (Diego, 30/10: «medir
 * actividad, si está activa en el WhatsApp respondiendo»).
 *
 * Lo de los chats sale de su número conectado al CRM; sin número, solo cuenta lo
 * que apunta en la ficha (que desde el chat ya puede ser un WhatsApp, una llamada
 * o un correo, y cuenta como contacto).
 */
interface Fila {
  id: number;
  nombre: string;
  chats: number;
  respondidos: number;
  sin_responder: number;
  mediana_min: number | null;
  texto: number;
  voz: number;
  ultimo_mensaje_del_numero: string | null;
  a_whatsapp: number;
  a_llamadas: number;
  a_correos: number;
  a_notas: number;
}

const PERIODOS = [
  { clave: 'hoy', etiqueta: 'Hoy', dias: 0 },
  { clave: '7', etiqueta: '7 días', dias: 6 },
  { clave: '30', etiqueta: '30 días', dias: 29 },
] as const;

const diaIso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

function tiempo(min: number | null) {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${min % 60} min` : `${Math.round(h / 24)} d`;
}

function numero(ultimo: string | null) {
  if (!ultimo) return { texto: 'Sin conectar', aviso: true };
  const dias = (Date.now() - new Date(ultimo).getTime()) / 864e5;
  const cuando = new Date(ultimo).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  return dias > 2 ? { texto: `Callado desde el ${cuando}`, aviso: true } : { texto: 'Conectado', aviso: false };
}

export default function ActividadWhatsappPage() {
  const { activeProject, activeIssuerId, activeIssuer } = useProjectContext() as {
    activeProject: { id?: number; nombre?: string } | null;
    activeIssuerId?: number | null;
    activeIssuer?: { nombre?: string } | null;
  };
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['clave']>('7');
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pid = !activeIssuerId && activeProject?.id && Number(activeProject.id) > 0 ? Number(activeProject.id) : null;

  useEffect(() => {
    const dias = PERIODOS.find((p) => p.clave === periodo)?.dias ?? 6;
    const qs = new URLSearchParams({
      ...(activeIssuerId ? { issuerId: String(activeIssuerId) } : pid ? { projectId: String(pid) } : {}),
      from: diaIso(new Date(Date.now() - dias * 864e5)),
      to: diaIso(new Date()),
    });
    let vivo = true;
    setCargando(true);
    setError(null);
    client.get<{ filas: Fila[] }>(`/whatsapp/actividad?${qs}`)
      .then((r) => { if (vivo) setFilas(r.success ? r.data?.filas || [] : []); })
      .catch((e: { message?: string }) => { if (vivo) setError(e?.message || 'No se pudo cargar'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [periodo, activeIssuerId, pid]);

  const ambito = activeIssuerId ? activeIssuer?.nombre || 'la empresa' : pid ? activeProject?.nombre : 'todos los campus';

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title={(<span className="flex items-center gap-2"><ChartBar size={20} /> Actividad en WhatsApp</span>) as unknown as string}
        subtitle={`Si cada gestora responde y lo que apunta · ${ambito}`}
      />

      <div className="flex gap-1">
        {PERIODOS.map((p) => (
          <button
            key={p.clave}
            type="button"
            onClick={() => setPeriodo(p.clave)}
            className={`h-8 px-3 rounded-md border text-xs ${periodo === p.clave ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border hover:bg-muted'}`}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      <div className="bg-card border border-border rounded-md p-4">
        {cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !filas.length ? (
          <p className="text-sm text-muted-foreground">Nadie ha tenido actividad en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="text-left py-1.5 pr-2 font-semibold">Gestora</th>
                  <th className="text-left py-1.5 px-2 font-semibold">Su número</th>
                  <th className="text-right py-1.5 px-2 font-semibold" title="Chats en los que la persona escribió">Le escribieron</th>
                  <th className="text-right py-1.5 px-2 font-semibold">Respondió</th>
                  <th className="text-right py-1.5 px-2 font-semibold" title="Chats que acaban en un mensaje de la persona">Sin responder</th>
                  <th className="text-right py-1.5 px-2 font-semibold" title="Mediana entre el primer mensaje y su respuesta">Tarda</th>
                  <th className="text-right py-1.5 px-2 font-semibold" title="Mensajes que mandó: escritos / audios">Mandó</th>
                  <th className="text-right py-1.5 pl-2 font-semibold" title="Apuntados en la ficha: WhatsApp · llamadas · correos · notas">Apuntó</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const n = numero(f.ultimo_mensaje_del_numero);
                  return (
                    <tr key={f.id} className="border-b border-border/60">
                      <td className="py-1.5 pr-2">{f.nombre}</td>
                      <td className={`py-1.5 px-2 text-xs ${n.aviso ? 'text-muted-foreground' : 'text-success'}`}>{n.texto}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{f.chats}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{f.respondidos}</td>
                      <td className={`text-right py-1.5 px-2 tabular-nums ${f.sin_responder ? 'font-semibold text-warning-soft-foreground' : ''}`}>{f.sin_responder}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{tiempo(f.mediana_min)}</td>
                      <td className="text-right py-1.5 px-2 tabular-nums">{f.texto} / {f.voz}</td>
                      <td className="text-right py-1.5 pl-2 tabular-nums whitespace-nowrap">{f.a_whatsapp} · {f.a_llamadas} · {f.a_correos} · {f.a_notas}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground mt-3">
          «Le escribieron», «Respondió», «Sin responder», «Tarda» y «Mandó» salen de su número de WhatsApp conectado al CRM (WhatsApp › Conexión); sin número conectado salen a cero.
          «Apuntó» son los contactos que registró en la ficha: WhatsApp · llamadas · correos · notas.
        </p>
      </div>
    </div>
  );
}
