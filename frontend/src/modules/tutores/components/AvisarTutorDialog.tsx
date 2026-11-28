/*
  «Avisar al tutor» desde Comisiones (CRM#165 / CRM-ISEIE#188). El mismo
  componente en los dos CRM.

  Diego, 25/11: «botón "Avisar al tutor" que le manda el correo de facturación
  (con la plantilla P.correo y la marca del campus), con el detalle de lo que se
  le debe y lo que tiene que facturar. Queda anotado quién y cuándo lo mandó, y
  avisa si ya se le mandó ese mes.»

  Primero se ve el correo tal cual sale —la vista previa la compone el servidor
  con la plantilla común— y solo entonces se manda. Si ya se le mandó el de ese
  mes, se dice quién y cuándo, y para repetirlo hay que marcarlo a propósito: el
  servidor contesta 409 si no.

  De aquí solo sale el asunto y una nota. A quién va y por cuánto lo decide el
  servidor: esto no sirve para mandar un correo cualquiera a cualquiera.
*/

import { useEffect, useId, useRef, useState } from 'react';
import { PaperPlaneTilt, Warning, X, ClockCounterClockwise } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { Button } from '@/shared/components/ui/button';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import { toast } from '@/shared/hooks/useToast';
import { tutoresApi, type AvisoAlTutor, type AmbitoDelAviso, type AvisoEnviado } from '../api/tutores.api';

const euros = (n: number | string) =>
  Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const MADRID = { timeZone: 'Europe/Madrid' } as const;

/** «05/03/2026», en hora de Madrid. La fila de la tabla y el diálogo dicen el mismo día. */
export function diaDelAviso(f: string | null | undefined) {
  const d = f ? new Date(f) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', ...MADRID });
}

/** «12/11/2026 a las 10:20», en hora de Madrid, como lo dice el servidor. */
export function cuandoFue(f: string) {
  const dia = diaDelAviso(f);
  if (!dia) return '';
  const hora = new Date(f).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', ...MADRID });
  return `${dia} a las ${hora}`;
}

/** La frase de «ya se le mandó». Aparte para poder probarla. */
export function textoYaMandado(mes: string, avisos: AvisoEnviado[]) {
  const [ultimo] = avisos;
  if (!ultimo) return null;
  const quien = ultimo.enviadoPor?.trim() ? ` por ${ultimo.enviadoPor.trim()}` : '';
  const frase = `Ya se le mandó el aviso de ${mes} el ${cuandoFue(ultimo.enviadoAt)}${quien}`;
  const veces = avisos.length > 1 ? ` Ya van ${avisos.length} avisos de ese mes.` : '';
  // Un nombre que acaba en punto («Ana R.») ya cierra la frase: sin esto salía «R..».
  return `${frase}${frase.endsWith('.') ? '' : '.'}${veces}`;
}

/** «avisado el 05/03/2026 por Ana R. (2 veces)», la nota de la fila de la tabla. */
export function avisadoEnLaFila(r: { avisado_at?: string | null; avisado_por_nombre?: string | null; avisos_enviados?: number | null }) {
  if (!r.avisado_at) return '';
  const por = r.avisado_por_nombre?.trim() ? ` por ${r.avisado_por_nombre.trim()}` : '';
  const veces = (r.avisos_enviados || 0) > 1 ? ` (${r.avisos_enviados} veces)` : '';
  return `avisado el ${diaDelAviso(r.avisado_at)}${por}${veces}`;
}

/** Lo que mide de ancho el correo de la plantilla común: 600 px de hoja y 12 de margen a cada lado. */
export const ANCHO_DEL_CORREO = 624;

/** La escala a la que cabe el correo entero en ese ancho (nunca lo agranda). */
export const escalaDelCorreo = (ancho: number) =>
  ancho > 0 && ancho < ANCHO_DEL_CORREO ? ancho / ANCHO_DEL_CORREO : 1;

/**
 * El correo tal cual sale, con la plantilla común y la marca del campus. En un
 * iframe sin permisos: es un documento entero, con su <head> y sus estilos, y
 * metido en la página los pisaría. Fondo blanco aunque el CRM esté en oscuro:
 * así llega.
 *
 * En un móvil el hueco mide unos 340 px y el correo 624: se veía la mitad y
 * había que desplazarlo de lado (QA del 26/11). Ahí el iframe se pinta al ancho
 * del correo y se reduce entero, como lo enseña el cliente de correo del móvil;
 * en escritorio cabe y va a tamaño real.
 */
function VistaPrevia({ html }: { html: string }) {
  const caja = useRef<HTMLDivElement | null>(null);
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 });
  useEffect(() => {
    const el = caja.current;
    if (!el) return undefined;
    const medir = () => setMedida({ ancho: el.clientWidth, alto: el.clientHeight });
    medir();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const escala = escalaDelCorreo(medida.ancho);
  const reducido = escala < 1;
  return (
    <div ref={caja} data-escala={escala.toFixed(3)}
      className="relative w-full h-[26rem] sm:h-[30rem] overflow-hidden rounded-md border border-border bg-white">
      <iframe title="Vista previa del correo al tutor" sandbox="" srcDoc={html}
        className="absolute left-0 top-0 border-0 bg-white"
        style={reducido
          ? { width: medida.ancho / escala, height: medida.alto / escala, transform: `scale(${escala})`, transformOrigin: '0 0' }
          : { width: '100%', height: '100%' }} />
    </div>
  );
}

interface Props {
  tutorId: number;
  periodo: string;
  /** El campus o la empresa de la pantalla: la cifra del correo es la de la fila. */
  ambito: AmbitoDelAviso;
  onClose: () => void;
  /** Ya se mandó: la pantalla recarga para pintar «avisado el …». */
  onEnviado: () => void;
}

export default function AvisarTutorDialog({ tutorId, periodo, ambito, onClose, onEnviado }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const tituloId = useId();
  const [aviso, setAviso] = useState<AvisoAlTutor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asunto, setAsunto] = useState('');
  const [nota, setNota] = useState('');
  const [repetir, setRepetir] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Si el servidor dice que ya se mandó (otra persona a la vez), se enseña aquí.
  const [yaMandadoServidor, setYaMandadoServidor] = useState<string | null>(null);
  // Por qué no salió, dentro del diálogo: el aviso emergente tapaba el botón de
  // enviar a 1280 (QA del 26/11).
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  useModalAccesible(ref, { open: true, onClose, bloqueado: enviando });

  const { projectId = null, issuerId = null } = ambito;
  useEffect(() => {
    let vivo = true;
    tutoresApi.previoDelAviso(tutorId, periodo, { projectId, issuerId })
      .then((r) => {
        if (!vivo) return;
        if (!r.success || !r.data) throw new Error(r.error || 'No se ha podido preparar el aviso.');
        setAviso(r.data);
        setAsunto(r.data.asunto);
      })
      .catch((e: unknown) => { if (vivo) setError(e instanceof Error ? e.message : 'No se ha podido preparar el aviso.'); });
    return () => { vivo = false; };
  }, [tutorId, periodo, projectId, issuerId]);

  const yaMandado = aviso ? (textoYaMandado(aviso.mes, aviso.avisos) || yaMandadoServidor) : null;
  const falta = Boolean(yaMandado) && !repetir;

  async function enviar() {
    if (!aviso || falta) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const r = await tutoresApi.avisarTutor({
        tutorId, periodo, projectId, issuerId,
        asunto: asunto.trim() && asunto.trim() !== aviso.asunto ? asunto.trim() : null,
        nota: nota.trim() || null,
        repetir: Boolean(yaMandado) && repetir,
      });
      if (!r.success) throw new Error(r.error || 'No se ha enviado.');
      toast({ title: `Avisado ${aviso.nombre}`, description: `Correo enviado a ${aviso.email}.` });
      onEnviado();
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number; data?: { code?: string } };
      if (err?.status === 409 || err?.data?.code === 'YA_AVISADO') {
        setYaMandadoServidor(err.message || 'Ya se le mandó el aviso de ese mes.');
        setRepetir(false);
      } else {
        // El motivo entero: «no se pudo enviar» a secas manda a mirar el sitio
        // equivocado (el freno de tutores, la lista blanca de pruebas, Brevo).
        // En el diálogo y no en un aviso emergente, que tapaba el botón.
        setErrorEnvio(err?.message || '');
      }
    } finally { setEnviando(false); }
  }

  const varias = (aviso?.grupos.length || 0) > 1;

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-stretch sm:items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={() => !enviando && onClose()} />
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId}
          className="relative bg-card border border-border sm:rounded-lg shadow-2xl w-full sm:max-w-3xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col">
          <div className="flex items-start justify-between gap-3 p-4 border-b border-border shrink-0">
            <div className="min-w-0">
              <h2 id={tituloId} className="font-semibold truncate">
                Avisar a {aviso?.nombre || 'el tutor'}
              </h2>
              <p className="text-xs text-muted-foreground truncate">
                {aviso ? `${aviso.email} · ${aviso.mes}` : 'Preparando el correo…'}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={enviando} aria-label="Cerrar"
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground shrink-0">
              <X size={16} weight="bold" />
            </button>
          </div>

          <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
            {error && (
              <p role="alert" className="text-sm rounded-md bg-destructive-soft text-destructive-soft-foreground p-3">{error}</p>
            )}
            {!aviso && !error && (
              <p className="text-sm text-muted-foreground">Preparando la vista previa…</p>
            )}

            {aviso && (
              <>
                {/* Lo que se le debe y lo que tiene que facturar, antes que el correo. */}
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border border-border p-2.5">
                    <dt className="text-xs text-muted-foreground">Se le debe</dt>
                    <dd className="font-semibold tabular-nums">{euros(aviso.pendiente)}</dd>
                  </div>
                  <div className="rounded-md border border-border p-2.5">
                    <dt className="text-xs text-muted-foreground">
                      {varias ? `A facturar, en ${aviso.grupos.length} facturas` : 'A facturar (+ IVA − retención)'}
                    </dt>
                    <dd className="font-semibold tabular-nums">{euros(aviso.cuenta.total)}</dd>
                  </div>
                </dl>

                {yaMandado && (
                  <div role="alert" className="rounded-md bg-warning-soft text-warning-soft-foreground border border-warning/30 p-3 text-sm space-y-2">
                    <p className="flex gap-2">
                      <ClockCounterClockwise size={16} weight="bold" className="shrink-0 mt-0.5" />
                      <span>{yaMandado}</span>
                    </p>
                    <label className="flex items-center gap-2 font-medium cursor-pointer">
                      <input type="checkbox" checked={repetir} onChange={(e) => setRepetir(e.target.checked)}
                        disabled={enviando} className="h-4 w-4 accent-current" />
                      Mandárselo otra vez
                    </label>
                  </div>
                )}

                <label className="block text-xs">
                  <span className="text-muted-foreground">Asunto</span>
                  <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={200} disabled={enviando}
                    className="mt-1 w-full h-9 px-2.5 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/40" />
                </label>

                <label className="block text-xs">
                  <span className="text-muted-foreground">Nota para el tutor (opcional)</span>
                  <textarea value={nota} onChange={(e) => setNota(e.target.value)} maxLength={2000} rows={2} disabled={enviando}
                    placeholder="Una devolución, algo que explicarle… Va en un recuadro dentro del correo."
                    className="mt-1 w-full px-2.5 py-2 rounded-md border border-border bg-background text-sm outline-none focus:ring-2 focus:ring-primary/40 resize-y" />
                </label>

                {!aviso.tieneIban && (
                  <p className="text-xs flex gap-1.5 text-warning-soft-foreground">
                    <Warning size={14} weight="fill" className="shrink-0 mt-0.5" />
                    <span>No tenemos su IBAN. El correo se lo pide: cuando conteste, hay que meterlo en su ficha.</span>
                  </p>
                )}

                {/* El correo tal cual sale (ver «VistaPrevia»). */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Vista previa{nota.trim() ? ' (la nota se añade al enviar)' : ''}
                  </p>
                  <VistaPrevia html={aviso.html} />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-border shrink-0">
            {errorEnvio !== null && (
              <p role="alert" className="basis-full sm:basis-auto sm:flex-1 min-w-0 text-sm rounded-md bg-destructive-soft text-destructive-soft-foreground px-3 py-2">
                <strong>No se ha enviado.</strong>{errorEnvio ? ` ${errorEnvio}` : ''}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button size="sm" onClick={enviar} disabled={!aviso || enviando || falta}
              title={falta ? 'Marca «Mandárselo otra vez» para repetirlo' : undefined}>
              <PaperPlaneTilt size={14} weight="bold" className="mr-1.5" />
              {enviando ? 'Enviando…' : yaMandado ? 'Mandar otra vez' : `Enviar a ${aviso?.email || 'el tutor'}`}
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
