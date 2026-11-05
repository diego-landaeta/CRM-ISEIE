import { useEffect, useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import { diplomasApi, type EnvioBrevo, type EnviosDeDiploma } from '../api/certifex.api';

/**
 * «Envíos» en la ficha del diploma (justificante del envío, Diego 05/11/2026).
 *
 * Los correos del diploma tal y como los registró Brevo (la misma cuenta que usa Certifex):
 * cuándo se envió, a quién, si se entregó y si se abrió, con el asunto, el remitente y el
 * identificador (Message-ID). «Imprimir justificante» abre una hoja limpia con esos datos
 * para imprimir o guardar en PDF desde el navegador.
 */

/** «05/11/2026 19:28» en hora de Madrid (la de la oficina). */
export function fechaHoraMadrid(iso: string | null | undefined, { segundos = false } = {}): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(segundos ? { second: '2-digit' } : {}), hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}${segundos ? `:${p.second}` : ''}`;
}

/** «05/11/2026 18:28:01 UTC». */
function fechaHoraUtc(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}/${d.toISOString().slice(0, 4)} ${d.toISOString().slice(11, 19)} UTC`;
}

const PROBLEMA: Record<string, string> = {
  hardBounces: 'Rebote definitivo', softBounces: 'Rebote temporal', bounces: 'Rebote', blocked: 'Bloqueado',
  spam: 'Marcado como spam', invalid: 'Dirección no válida', error: 'Error', deferred: 'Aplazado', unsubscribed: 'Baja',
};
export const problemaEnTexto = (e: string) => PROBLEMA[e] || e;

/** La línea de un envío: «Enviado el … (hora de Madrid) a correo · Entregado el … · Abierto el …». */
export function lineaDeEnvio(e: EnvioBrevo): string {
  const partes = [];
  const a = e.destinatario ? ` a ${e.destinatario}` : '';
  if (e.enviadoEn) partes.push(`Enviado el ${fechaHoraMadrid(e.enviadoEn)} (hora de Madrid)${a}`);
  else partes.push(`Enviado${a}`);
  if (e.entregadoEn) partes.push(`Entregado el ${fechaHoraMadrid(e.entregadoEn)}`);
  if (e.abiertoEn) partes.push(`Abierto el ${fechaHoraMadrid(e.abiertoEn)}`);
  for (const p of e.problemas) partes.push(`${problemaEnTexto(p.evento)} el ${fechaHoraMadrid(p.fecha)}${p.motivo ? ` (${p.motivo})` : ''}`);
  return partes.join(' · ');
}

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** La hoja del justificante, en HTML, para imprimir (una página). */
export function hojaJustificante(datos: EnviosDeDiploma, e: EnvioBrevo, ahora = new Date()): string {
  const filas: [string, string][] = [
    ['Alumno', datos.alumno || '—'],
    ['Formación', datos.titulacion || '—'],
    ['Nº de expediente', datos.nexpediente],
    ['Campus', datos.centro],
    ['Enviado', e.enviadoEn ? `${fechaHoraMadrid(e.enviadoEn, { segundos: true })} (hora de Madrid) · ${fechaHoraUtc(e.enviadoEn)}` : 'No consta'],
    ['Entregado', e.entregadoEn ? `${fechaHoraMadrid(e.entregadoEn, { segundos: true })} (hora de Madrid) · ${fechaHoraUtc(e.entregadoEn)}` : 'No consta'],
    ['Abierto', e.abiertoEn ? `${fechaHoraMadrid(e.abiertoEn, { segundos: true })} (hora de Madrid)` : 'No consta'],
    ...e.problemas.map((p): [string, string] => [problemaEnTexto(p.evento), `${fechaHoraMadrid(p.fecha, { segundos: true })} (hora de Madrid)${p.motivo ? ` · ${p.motivo}` : ''}`]),
    ['Destinatario', e.destinatario || datos.email || '—'],
    ['Asunto', e.asunto || '—'],
    ['Remitente', e.remitente || '—'],
    ['Identificador (Message-ID)', e.messageId],
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Justificante de envío · ${esc(datos.nexpediente)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Helvetica, Arial, sans-serif; color: #1c2630; margin: 0; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .campus { color: #5c6673; margin: 0 0 14px; font-size: 13px; }
  hr { border: 0; border-top: 2px solid #1f4e79; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; width: 34%; vertical-align: top; padding: 6px 10px 6px 0; font-weight: bold; }
  td { padding: 6px 0; vertical-align: top; word-break: break-word; }
  tr + tr th, tr + tr td { border-top: 1px solid #e3e7eb; }
  .mono { font-family: 'Courier New', monospace; font-size: 11px; }
  .pie { margin-top: 28px; color: #5c6673; font-size: 10px; border-top: 1px solid #c9ced4; padding-top: 8px; }
</style></head><body>
<h1>Justificante de envío del diploma</h1>
<p class="campus">${esc(datos.centro)}</p>
<hr>
<table>${filas.map(([k, v]) => `<tr><th>${esc(k)}</th><td${k.startsWith('Identificador') ? ' class="mono"' : ''}>${esc(v)}</td></tr>`).join('')}</table>
<p class="pie">Generado el ${esc(fechaHoraMadrid(ahora.toISOString()))} (hora de Madrid) desde el CRM, con los datos del registro de envíos de Brevo, el servicio con el que Certifex manda el correo del diploma.</p>
</body></html>`;
}

/** Imprime la hoja en un marco oculto: sin ventanas emergentes que el navegador bloquee. */
function imprimir(html: string) {
  const marco = document.createElement('iframe');
  marco.setAttribute('aria-hidden', 'true');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(marco);
  const doc = marco.contentDocument;
  if (!doc || !marco.contentWindow) { marco.remove(); return; }
  doc.open();
  doc.write(html);
  doc.close();
  const quitar = () => setTimeout(() => marco.remove(), 1000);
  marco.contentWindow.addEventListener('afterprint', quitar);
  setTimeout(() => { marco.contentWindow?.focus(); marco.contentWindow?.print(); }, 50);
}

export default function EnviosBrevo({ nexpediente }: { nexpediente: string }) {
  const [datos, setDatos] = useState<EnviosDeDiploma | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setError(null);
    // Dentro de una promesa: si algo falla al llamar, la ficha sigue y lo dice aquí.
    Promise.resolve()
      .then(() => diplomasApi.envios(nexpediente))
      .then((r) => { if (vivo) setDatos(r.data); })
      .catch((e) => { if (vivo) setError((e as Error)?.message || 'No se pudieron cargar'); });
    return () => { vivo = false; };
  }, [nexpediente]);

  return (
    <section id="envios" aria-labelledby="envios-titulo" className="border-b border-border px-4 py-3">
      <h3 id="envios-titulo" className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Envíos</h3>
      {error ? (
        <p className="text-xs text-muted-foreground">No se pudieron cargar los envíos: {error}</p>
      ) : !datos ? (
        <p className="text-xs text-muted-foreground" aria-busy="true">Consultando Brevo…</p>
      ) : datos.envios.length === 0 ? (
        <p className="text-xs text-muted-foreground">{datos.motivo || 'No hay ningún envío de este diploma.'}</p>
      ) : (
        <ul className="max-h-48 space-y-3 overflow-auto">
          {datos.envios.map((e) => (
            <li key={e.messageId} className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className={`break-words text-sm ${e.problemas.length && !e.entregadoEn ? 'text-destructive' : ''}`}>{lineaDeEnvio(e)}</p>
                <p className="break-words text-[11px] text-muted-foreground">
                  {e.asunto && <>Asunto: {e.asunto}</>}{e.remitente && <> · Remitente: {e.remitente}</>}
                </p>
                <p className="break-all font-mono text-[10px] text-muted-foreground">Message-ID: {e.messageId}</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => imprimir(hojaJustificante(datos, e))}>
                <Printer size={14} className="mr-1.5" aria-hidden="true" /> Imprimir justificante
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
