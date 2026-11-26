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

/** «12/11/2026 a las 10:20», en hora de Madrid, como lo dice el servidor. */
export function cuandoFue(f: string) {
  const d = new Date(f);
  if (Number.isNaN(d.getTime())) return '';
  const zona = { timeZone: 'Europe/Madrid' } as const;
  const dia = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', ...zona });
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', ...zona });
  return `${dia} a las ${hora}`;
}

/** La frase de «ya se le mandó». Aparte para poder probarla. */
export function textoYaMandado(mes: string, avisos: AvisoEnviado[]) {
  const [ultimo] = avisos;
  if (!ultimo) return null;
  const quien = ultimo.enviadoPor ? ` por ${ultimo.enviadoPor}` : '';
  const veces = avisos.length > 1 ? ` Ya van ${avisos.length} avisos de ese mes.` : '';
  return `Ya se le mandó el aviso de ${mes} el ${cuandoFue(ultimo.enviadoAt)}${quien}.${veces}`;
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
        toast({ title: 'No se ha enviado', description: err?.message || '', variant: 'destructive' });
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

                {/* El correo tal cual sale, con la plantilla común y la marca del
                    campus. En un iframe sin permisos: es un documento entero, con
                    su <head> y sus estilos, y metido en la página los pisaría.
                    Fondo blanco aunque el CRM esté en oscuro: así llega. */}
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Vista previa{nota.trim() ? ' (la nota se añade al enviar)' : ''}
                  </p>
                  <iframe title="Vista previa del correo al tutor" sandbox="" srcDoc={aviso.html}
                    className="w-full h-[26rem] sm:h-[30rem] rounded-md border border-border bg-white" />
                </div>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 p-4 border-t border-border shrink-0">
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
