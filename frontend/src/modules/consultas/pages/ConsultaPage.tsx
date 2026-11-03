import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Paperclip, PaperPlaneRight, CheckCircle, Warning, ArrowsClockwise, X } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { Button } from '@/shared/components/ui/button';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { consultasApi, type ConsultaDetalle } from '../api/consultas.api';
import { Semaforo } from './ConsultasPage';

/*
  Una consulta (#188): la conversación entera, responder con adjuntos, cerrar y,
  para administración, reasignar. Es la dirección del botón «Responder en el
  CRM» del correo al tutor.
*/

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '');

const QUE_PASO: Record<string, string> = {
  entrada: 'Entró la consulta', asignada: 'Asignada', reasignada: 'Reasignada', leida: 'La abrió su tutor',
  respondida: 'Respondida', cerrada: 'Cerrada', reabierta: 'El alumno volvió a escribir: reabierta',
  iniciada_por_tutor: 'La empezó el tutor («Escribir al alumno»)',
  recordatorio_plazo: 'Recordatorio al tutor: se acerca el plazo',
  fuera_de_plazo: 'Fuera de plazo: avisada administración',
};

const MAX_ADJUNTOS = 5;
const MAX_MB = 10;

function mensajeDeError(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Inténtalo de nuevo.';
}

export default function ConsultaPage() {
  const { id } = useParams();
  const consultaId = Number(id);
  const [c, setC] = useState<ConsultaDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [faltaTexto, setFaltaTexto] = useState(false);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [tutores, setTutores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [nuevoTutor, setNuevoTutor] = useState<number | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    let r;
    try {
      r = await consultasApi.ver(consultaId);
      if (r.success && r.data) { setC(r.data); setError(null); }
    } catch (e) { setError(mensajeDeError(e)); return; }
    // Aparte: si falla la lista de tutores, la consulta se ve igual (solo falta reasignar).
    if (r.success && r.data?.puedes === 'admin') {
      try {
        const t = await consultasApi.tutoresPosibles(consultaId);
        if (t.success && t.data) setTutores(t.data);
      } catch { setTutores([]); }
    }
  }, [consultaId]);

  useEffect(() => { cargar(); }, [cargar]);

  function elegirArchivos(lista: FileList | null) {
    const nuevos = [...adjuntos, ...Array.from(lista || [])];
    const grande = nuevos.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (grande) { toast({ title: 'Adjunto demasiado grande', description: `«${grande.name}» pasa de ${MAX_MB} MB.`, variant: 'destructive' }); return; }
    if (nuevos.length > MAX_ADJUNTOS) { toast({ title: 'Demasiados adjuntos', description: `Como mucho ${MAX_ADJUNTOS} por respuesta.`, variant: 'destructive' }); return; }
    setAdjuntos(nuevos);
    if (archivo.current) archivo.current.value = '';
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!texto.trim()) { setFaltaTexto(true); return; }
    setOcupado(true);
    try {
      const r = await consultasApi.responder(consultaId, texto.trim(), adjuntos);
      if (r.success && r.data) {
        setC({ ...c!, ...r.data.consulta });
        setTexto(''); setAdjuntos([]); setFaltaTexto(false);
        if (r.data.enviado) toast({ title: 'Respuesta enviada', description: 'Le llega al alumno en el campus.' });
        else toast({ title: 'Respuesta guardada, pero no ha llegado al campus', description: r.data.error || '', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'No se ha podido responder', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  /** Reintentar: puede volver a fallar (sin token, campus caído): se dice, no «enviada». */
  async function reintentar(mensajeId: number) {
    setOcupado(true);
    try {
      const r = await consultasApi.reintentar(mensajeId);
      if (r.data?.enviado) toast({ title: 'Respuesta enviada al campus' });
      else toast({ title: 'Sigue sin llegar al campus', description: r.data?.error || 'Inténtalo más tarde.', variant: 'destructive' });
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha podido reintentar', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function hacer(fn: () => Promise<{ success: boolean; data?: unknown }>, hecho: string) {
    setOcupado(true);
    try {
      const r = await fn();
      if (r.success) { toast({ title: hecho }); await cargar(); }
    } catch (err) {
      toast({ title: 'No se ha podido', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Link to="/consultas" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft size={14} /> Consultas</Link>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }
  if (!c) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="space-y-4 pb-8 max-w-4xl mx-auto">
      <Link to="/consultas" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowLeft size={14} /> Consultas</Link>

      <header className="rounded-lg border border-border bg-card p-4 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold">{c.alumno_nombre || 'Alumno sin nombre'}</h1>
            <p className="text-xs text-muted-foreground break-words">
              {c.alumno_email ? `${c.alumno_email} · ` : ''}{c.campus}{c.empresa ? ` (${c.empresa})` : ''}{c.curso_nombre ? ` · ${c.curso_nombre}` : ''}
            </p>
          </div>
          <Semaforo c={c} plazoHoras={c.plazoHoras} />
        </div>
        <p className="text-xs text-muted-foreground">
          {c.tutor ? `Tutor: ${c.tutor}` : 'Sin tutor asignado'} · Entró el {fecha(c.entrada_at)}
          {c.primera_respuesta_at ? ` · Primera respuesta el ${fecha(c.primera_respuesta_at)}` : ''}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {c.estado !== 'cerrada' && (
            <Button variant="outline" size="sm" disabled={ocupado}
              onClick={() => hacer(() => consultasApi.cerrar(consultaId), 'Consulta cerrada')}>
              <CheckCircle size={14} weight="bold" className="mr-1.5" /> Cerrar la consulta
            </Button>
          )}
        </div>
      </header>

      {c.puedes === 'admin' && (
        <section className="rounded-lg border border-border bg-card p-4">
          <Field label="Reasignar a otro tutor" hint="Solo tutores matriculados en este campus y disponibles.">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select<number | null>
                  value={nuevoTutor}
                  onChange={setNuevoTutor}
                  ariaLabel="Reasignar a otro tutor"
                  options={[{ value: null, label: tutores.some((t) => t.id !== c.tutor_id) ? 'Elige el tutor…' : 'No hay otro tutor que pueda recibirla' },
                    ...tutores.filter((t) => t.id !== c.tutor_id).map((t) => ({ value: t.id, label: t.nombre }))]}
                />
              </div>
              <Button size="sm" disabled={ocupado || !nuevoTutor}
                onClick={() => nuevoTutor && hacer(() => consultasApi.reasignar(consultaId, nuevoTutor), 'Consulta reasignada').then(() => setNuevoTutor(null))}>
                Reasignar
              </Button>
            </div>
          </Field>
        </section>
      )}

      <ol className="space-y-3" aria-label="Conversación">
        {c.mensajes.map((m) => {
          const delTutor = m.autor === 'tutor';
          return (
            <li key={m.id} className={`flex ${delTutor ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${delTutor ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
                <p className="text-xs font-semibold text-muted-foreground">
                  {delTutor ? (m.autor_nombre || 'Tutor') : (c.alumno_nombre || 'Alumno')} · {fecha(m.escrito_at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words">{m.texto}</p>
                {m.adjuntos.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {m.adjuntos.map((a) => (
                      <li key={a.id}>
                        <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          onClick={() => consultasApi.abrirAdjunto(a).catch((err) => toast({ title: 'No se ha podido abrir', description: mensajeDeError(err), variant: 'destructive' }))}>
                          <Paperclip size={12} /> {a.nombre}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {delTutor && !m.en_el_campus && (
                  <div role="alert" className="mt-2 rounded border border-warning/30 bg-warning-soft px-2 py-1 text-xs text-warning-soft-foreground">
                    <p className="flex items-start gap-1"><Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
                      No ha llegado al campus{m.error_envio ? `: ${m.error_envio}` : '.'}</p>
                    <button type="button" disabled={ocupado} className="mt-1 inline-flex items-center gap-1 font-semibold hover:underline"
                      onClick={() => reintentar(m.id)}>
                      <ArrowsClockwise size={12} /> Reintentar
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {c.puedes === 'tutor' && (
        <form onSubmit={enviar} noValidate className="rounded-lg border border-border bg-card p-4 space-y-3">
          <Field label="Tu respuesta" htmlFor="consulta-respuesta" required
            error={faltaTexto ? 'Falta la respuesta: escríbela aquí.' : undefined}
            hint="Le llega al alumno en el campus, como un mensaje tuyo.">
            <textarea id="consulta-respuesta" value={texto} onChange={(e) => { setTexto(e.target.value); if (e.target.value.trim()) setFaltaTexto(false); }}
              rows={5} maxLength={20000} className={`${inputClass} h-auto py-2`} />
          </Field>
          {adjuntos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Adjuntos">
              {adjuntos.map((f, i) => (
                <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-xs">
                  <Paperclip size={12} /> {f.name}
                  <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive"><X size={12} weight="bold" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <input ref={archivo} type="file" multiple className="sr-only" id="consulta-adjuntos"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => elegirArchivos(e.target.files)} />
              <label htmlFor="consulta-adjuntos" className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted">
                <Paperclip size={14} /> Adjuntar
              </label>
              <span className="ml-2 text-xs text-muted-foreground">PDF, imágenes, Word, Excel o texto · hasta {MAX_MB} MB · {MAX_ADJUNTOS} como mucho</span>
            </div>
            <Button type="submit" disabled={ocupado}>
              <PaperPlaneRight size={14} weight="bold" className="mr-1.5" /> {ocupado ? 'Enviando…' : 'Responder'}
            </Button>
          </div>
        </form>
      )}

      <details className="rounded-lg border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Historial</summary>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {c.eventos.map((e, i) => (
            <li key={i}>{fecha(e.at)} · {QUE_PASO[e.tipo] || e.tipo}{e.quien ? ` · ${e.quien}` : ''}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
