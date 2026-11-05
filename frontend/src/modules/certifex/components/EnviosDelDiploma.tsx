import { useEffect, useState } from 'react';
import { FilePdf } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { Button } from '@/shared/components/ui/button';
import { diplomasApi, type EnvioDiploma } from '../api/certifex.api';

/**
 * «Envíos» en la ficha del diploma (justificante del envío, Diego 05/11/2026).
 *
 * Cada correo al alumno que registró Certifex: «Enviado el 05/11/2026 14:03 a correo@…» o
 * «No ha salido: motivo», quién lo aprobó y un botón «Descargar justificante» que baja el
 * PDF con la fecha y hora (Madrid y UTC), el destinatario, el asunto y el identificador de
 * Brevo. Solo lectura: lo ve quien ve Diplomas.
 *
 * Los envíos de antes de que Certifex guardara el destinatario lo dicen, en vez de inventarlo.
 */

/** «05/11/2026 14:03», en hora de Madrid (la de la oficina y la del justificante). */
export function fechaHoraMadrid(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const POR_QUE_NO: Record<string, string> = {
  correo_apagado: 'el envío de correo estaba apagado en Certifex',
  sin_correo: 'el alumno no tenía correo en Certifex',
  error: 'Brevo devolvió un error al enviarlo',
};

/** La línea de un envío, tal cual se lee en la ficha. */
export function lineaDeEnvio(e: EnvioDiploma): string {
  const cuando = fechaHoraMadrid(e.en);
  const que = e.tipo === 'rechazo' ? 'Aviso de corrección: ' : '';
  if (e.resultado === 'enviado') {
    if (e.destinatario) return `${que}Enviado el ${cuando} a ${e.destinatario}`;
    return `${que}Enviado el ${cuando}`;
  }
  return `${que}No ha salido: ${POR_QUE_NO[e.resultado] || e.resultado} (${cuando})`;
}

function bajar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revocar en el mismo turno deja a algún navegador sin llegar a leer el blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function EnviosDelDiploma({ nexpediente }: { nexpediente: string }) {
  const [envios, setEnvios] = useState<EnvioDiploma[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    setEnvios(null);
    setError(null);
    // Dentro de una promesa: si algo falla al llamar, se queda en «no se pudieron cargar».
    Promise.resolve()
      .then(() => diplomasApi.envios(nexpediente))
      .then((r) => { if (vivo) setEnvios(Array.isArray(r?.data?.envios) ? r.data.envios : []); })
      .catch((e) => { if (vivo) setError((e as Error)?.message || 'No se pudieron cargar'); });
    return () => { vivo = false; };
  }, [nexpediente]);

  async function justificante(e: EnvioDiploma) {
    if (bajando != null) return;
    setBajando(e.id);
    try {
      const { blob, nombre } = await diplomasApi.justificante(nexpediente, e.id);
      bajar(blob, nombre);
    } catch (err) {
      toast({ title: 'No se pudo generar el justificante', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBajando(null);
    }
  }

  return (
    <section aria-labelledby={`envios-${nexpediente}`} className="border-b border-border px-4 py-3">
      <h3 id={`envios-${nexpediente}`} className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Envíos</h3>
      {error ? (
        <p className="text-xs text-muted-foreground">No se pudieron cargar los envíos: {error}</p>
      ) : envios == null ? (
        <p className="text-xs text-muted-foreground" aria-busy="true">Cargando envíos…</p>
      ) : envios.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aún no se le ha enviado al alumno.</p>
      ) : (
        <ul className="max-h-40 space-y-2 overflow-auto">
          {envios.map((e) => (
            <li key={e.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className={`break-words text-sm ${e.resultado === 'enviado' ? '' : 'text-destructive'}`} title="Fecha y hora de Madrid">{lineaDeEnvio(e)}</p>
                <p className="break-words text-[11px] text-muted-foreground">
                  Aprobado por {e.aprobadoPor}
                  {e.sinDetalle && ' · De antes de que se guardaran el destinatario y el identificador de Brevo'}
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => justificante(e)} disabled={bajando != null} aria-busy={bajando === e.id}>
                <FilePdf size={14} className="mr-1.5" aria-hidden="true" />
                {bajando === e.id ? 'Generando…' : 'Descargar justificante'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
