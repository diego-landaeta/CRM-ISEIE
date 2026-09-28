import { useEffect, useState } from 'react';
import { EnvelopeSimple, ChatCircleText, Eye } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { envioDeUnLead, enviarLoRevisado, noEnviar, type EnvioDeUnLead } from '../api/feedback.api';

/**
 * El correo de «¿por qué has desistido?» de ESTA persona, en su ficha.
 *
 * Tres casos:
 *   · Esperando revisión («quiero verlo»): los dos botones, enviar o no enviar.
 *     Es lo único que se puede hacer aquí; lo demás lo decide el CRM solo.
 *   · Contestó: su respuesta, a la vista. La gestora que le llame mañana tiene
 *     que ver «me pareció caro» sin ir a buscarlo (#169).
 *   · Enviado, parado o sin correo: una línea que lo dice.
 *
 * Si nunca se le preguntó no pinta nada: una caja vacía en cada ficha sería
 * ruido para el 90 % de la gente.
 */

const MOTIVO: Record<string, string> = {
  precio: 'El precio', fechas: 'Las fechas no le encajan', pensando: 'Todavía se lo está pensando',
  otro_centro: 'Eligió otro centro', no_interesa: 'Ya no le interesa',
  sin_respuesta: 'No le contestaron a tiempo', otro: 'Otro motivo',
};
const DISPARO: Record<string, string> = { descarte: 'al descartarlo', dia7: 'al 7.º día sin comprar' };
const dia = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-ES') : '');

export default function FeedbackDeLaFicha({ leadId }: { leadId: number }) {
  const [envio, setEnvio] = useState<EnvioDeUnLead | undefined>(undefined);
  const [yendo, setYendo] = useState(false);

  const cargar = () => envioDeUnLead(leadId).then(setEnvio).catch(() => setEnvio(null));
  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [leadId]);

  if (!envio) return null;

  async function decidir(enviar: boolean) {
    setYendo(true);
    try {
      const r = await (enviar ? enviarLoRevisado(leadId) : noEnviar(leadId));
      if (!r?.success) throw new Error(r?.error || 'No se ha podido');
      toast({ title: enviar ? 'Correo de feedback enviado' : 'No se enviará' });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setYendo(false);
    }
  }

  const caja = 'rounded-lg border p-3 text-sm';

  if (envio.estado === 'revision') {
    return (
      <div className={`${caja} border-warning bg-warning-soft`}>
        <p className="flex items-center gap-1.5 font-semibold"><Eye size={15} /> Correo de feedback pendiente de revisar</p>
        <p className="mt-1 text-muted-foreground">
          Se preparó {DISPARO[envio.disparador]} y alguien pidió verlo antes. La copia de vista previa está en su correo.
        </p>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={yendo} onClick={() => decidir(true)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">Enviar ahora</button>
          <button type="button" disabled={yendo} onClick={() => decidir(false)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">No enviar</button>
        </div>
      </div>
    );
  }

  if (envio.respondido_at) {
    // Todo lo que contestó, pregunta a pregunta. Si la respuesta es de la
    // encuesta vieja (solo motivo y comentario), se enseña eso.
    const resp = envio.respuestas || {};
    const preguntas = (envio.preguntas || []).filter((p) => resp[p.clave] !== undefined);
    type P = {
      clave: string; tipo: string; escribir?: string; opciones?: Array<{ clave: string; texto: string }>;
      sub?: { clave: string; opciones: Array<{ clave: string; texto: string }> };
    };
    const valor = (p: P, v: unknown) => {
      const texto = (x: unknown) => p.opciones?.find((o) => o.clave === String(x))?.texto || String(x);
      if (p.tipo === 'escala') return `${v} de 5 · ${texto(v)}`;
      if (p.tipo === 'texto') return `«${v}»`;
      // Lo que escribió en «Otro», pegado a esa opción.
      const otro = resp[`${p.clave}_otro`];
      const lista = Array.isArray(v) ? v : [v];
      const dicho = lista.map((x) => (x === p.escribir && otro ? `${texto(x)}: «${otro}»` : texto(x))).join(', ');
      // «Sí, que me contacte más adelante · En 2 o 3 meses»
      const sub = p.sub && resp[p.sub.clave] ? p.sub.opciones.find((o) => o.clave === resp[p.sub!.clave])?.texto : null;
      return sub ? `${dicho} · ${sub}` : dicho;
    };
    return (
      <div className={`${caja} border-border bg-muted/30`}>
        <p className="flex items-center gap-1.5 font-semibold"><ChatCircleText size={15} /> Contestó al feedback · {dia(envio.respondido_at)}</p>
        {preguntas.length > 0 ? (
          <dl className="mt-2 space-y-1.5">
            {preguntas.map((p) => (
              <div key={p.clave}>
                <dt className="text-xs text-muted-foreground">{p.texto}</dt>
                <dd className={p.tipo === 'texto' ? 'italic' : ''}>{valor(p, resp[p.clave])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <>
            <p className="mt-1">{MOTIVO[envio.motivo || ''] || envio.motivo}</p>
            {envio.comentario && <p className="mt-1 italic text-muted-foreground">«{envio.comentario}»</p>}
          </>
        )}
      </div>
    );
  }

  const linea = {
    enviado: `Se le mandó el correo de feedback ${DISPARO[envio.disparador]} el ${dia(envio.enviado_at)}. Todavía no ha contestado.`,
    bloqueado: 'El correo de feedback no salió: lo paró el freno de correos de pruebas.',
    sin_correo: 'No se le pudo mandar el correo de feedback: no tiene correo.',
    fallido: `El correo de feedback no salió${envio.nota_envio ? `: ${envio.nota_envio}` : '.'}`,
    cancelado: 'Se decidió no mandarle el correo de feedback.',
    pendiente: 'El correo de feedback está saliendo.',
  }[envio.estado] || null;
  if (!linea) return null;
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
      <EnvelopeSimple size={14} className="mt-0.5 shrink-0" /> {linea}
    </p>
  );
}
