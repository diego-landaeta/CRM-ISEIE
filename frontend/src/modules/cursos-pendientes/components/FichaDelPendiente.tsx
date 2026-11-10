import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, EnvelopeSimple, Warning, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import client from '@/shared/api/client';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import {
  cursosApi, ESTADOS, TIPOS, type Alumna, type Detalle,
} from '../api/cursosPendientes.api';

/**
 * La ficha de un pendiente (#336): lo que hace la tutora y lo que supervisa quien manda.
 *
 *   · cabecera con estado, fecha, avance y los botones para avanzar;
 *   · al cambiar la fecha se pide el motivo, que queda en el historial;
 *   · «Marcar publicado» pide la URL definitiva: el servidor comprueba que es del
 *     dominio del campus y que responde;
 *   · tras publicar, por alumna: «Habilitada» y «Avisada»; cuando todas están
 *     habilitadas, el curso pasa solo a «Cerrado»;
 *   · las alumnas traen su nombre, correo y teléfono de su ficha y la fecha de su compra.
 *
 * Qué puede hacer cada una lo decide el servidor (una tutora no asigna ni
 * cancela); aquí solo se esconden los botones que no le tocan.
 */

const fecha = (iso: string | null) => (iso
  ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

const ACCIONES: Record<string, string> = {
  creado: 'Creado', alumna_sumada: 'Alumna sumada', tutora_cambiada: 'Tutora cambiada', fecha_movida: 'Fecha movida',
  estado_cambiado: 'Estado cambiado', avance: 'Avance', publicado: 'Publicado', alumna_marcada: 'Alumna marcada', cerrado_solo: 'Cerrado solo',
};

interface Tutora { id: number; nombre: string }

export default function FichaDelPendiente({ id, esTutora, supervisa, onCerrar, onCambio }: {
  id: number; esTutora: boolean; supervisa: boolean; onCerrar: () => void; onCambio: () => void;
}) {
  const [c, setC] = useState<Detalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tutoras, setTutoras] = useState<Tutora[]>([]);
  const [fechaNueva, setFechaNueva] = useState('');
  const [motivo, setMotivo] = useState('');
  const [url, setUrl] = useState('');
  const [sinComprobar, setSinComprobar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [notas, setNotas] = useState('');

  const cargar = useCallback(async () => {
    try {
      const d = await cursosApi.detalle(id);
      setC(d);
      setFechaNueva(d.fecha_comprometida?.slice(0, 10) || '');
      setNotas(d.notas || '');
    } catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    if (!supervisa || !c) return;
    (client.get('/tutores', { params: { projectId: c.project_id } }) as unknown as Promise<{ data?: Tutora[] }>)
      .then((r) => setTutoras((r.data || []).map((t) => ({ id: t.id, nombre: t.nombre }))))
      .catch(() => setTutoras([]));
  }, [supervisa, c?.project_id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function hacer(fn: () => Promise<unknown>, ok?: string) {
    setOcupado(true);
    try {
      await fn();
      if (ok) toast({ title: ok });
      await cargar();
      onCambio();
    } catch (e) {
      const err = e as Error & { code?: string; response?: { data?: { code?: string } } };
      if ((err.response?.data?.code || err.code) === 'DOMINIO_DESCONOCIDO' && supervisa) setSinComprobar(true);
      toast({ title: 'No se pudo hacer', description: err.message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  if (error) {
    return (
      <Portal><div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCerrar}>
        <p className="rounded-md bg-card p-5 text-sm">{error}</p>
      </div></Portal>
    );
  }
  if (!c) return null;

  const abierto = ['pendiente_asignar', 'asignado', 'en_desarrollo', 'publicado'].includes(c.estado);
  const hayFecha = !!c.fecha_comprometida;
  const cambiaFecha = fechaNueva && fechaNueva !== (c.fecha_comprometida?.slice(0, 10) || '');
  const puedeActuar = abierto && (supervisa || esTutora);

  function marcar(a: Alumna, cuerpo: { estado?: 'habilitada' | 'en_espera' | 'cancelada'; avisada?: boolean }) {
    return hacer(async () => {
      const r = await cursosApi.marcarAlumna(c!.id, a.id, cuerpo);
      if (r.cerrado) toast({ title: 'Todas habilitadas: el curso pasa a «Cerrado»' });
    });
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onCerrar}>
        <aside
          role="dialog" aria-modal="true" aria-label={`Pendiente: ${c.nombre}`}
          className="h-full w-full max-w-2xl overflow-y-auto border-l border-border bg-card shadow-lg" onClick={(e) => e.stopPropagation()}
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-3">
            <div>
              <h2 className="text-base font-semibold">{c.nombre}</h2>
              <p className="text-xs text-muted-foreground">
                {c.campus} · {TIPOS[c.tipo]} · <strong>{ESTADOS[c.estado]}</strong>
                {c.retrasado && <span className="ml-2 inline-flex items-center gap-1 font-bold text-destructive"><Warning size={12} weight="fill" /> Retrasado</span>}
              </p>
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="space-y-5 p-5">
            {/* Cabecera: tutora, fecha y avance */}
            <section className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground" htmlFor="fp-tutora">Tutora</label>
                {supervisa && abierto ? (
                  <select id="fp-tutora" value={c.tutor_id ?? ''} disabled={ocupado} className={inputClass}
                    onChange={(e) => hacer(() => cursosApi.modificar(c.id, { tutor_id: e.target.value ? Number(e.target.value) : null }), 'Tutora actualizada')}>
                    <option value="">Sin asignar</option>
                    {/* La que ya tiene siempre sale, aunque no esté en la lista del campus. */}
                    {c.tutor_id && !tutoras.some((t) => t.id === c.tutor_id) && <option value={c.tutor_id}>{c.tutora}</option>}
                    {tutoras.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                  </select>
                ) : <p className="mt-1 text-sm">{c.tutora || 'Sin asignar'}</p>}
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground" htmlFor="fp-fecha">Fecha comprometida</label>
                {puedeActuar && c.estado !== 'publicado' ? (
                  <div className="mt-1 space-y-1.5">
                    <input id="fp-fecha" type="date" value={fechaNueva} onChange={(e) => setFechaNueva(e.target.value)} className={inputClass} />
                    {hayFecha && cambiaFecha && (
                      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo del cambio (obligatorio)" className={inputClass} aria-label="Motivo del cambio de fecha" />
                    )}
                    {cambiaFecha && (
                      <button type="button" disabled={ocupado || (hayFecha && !motivo.trim())}
                        onClick={() => hacer(() => cursosApi.modificar(c.id, { fecha_comprometida: fechaNueva, ...(hayFecha ? { motivo } : {}) }).then(() => setMotivo('')), 'Fecha guardada')}
                        className="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
                        Guardar fecha
                      </button>
                    )}
                    {c.veces_movida_fecha > 0 && <p className="text-[11px] text-muted-foreground">Movida {c.veces_movida_fecha} {c.veces_movida_fecha === 1 ? 'vez' : 'veces'}.</p>}
                  </div>
                ) : <p className="mt-1 text-sm">{fecha(c.fecha_comprometida)}{c.fecha_publicacion ? ` · publicado el ${fecha(c.fecha_publicacion)}` : ''}</p>}
              </div>
            </section>

            {puedeActuar && (c.estado === 'asignado' || c.estado === 'en_desarrollo') && (
              <section className="space-y-2">
                <p className="text-[11px] font-bold uppercase text-muted-foreground">Avance</p>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={c.avance_foto} disabled={ocupado} onChange={(e) => hacer(() => cursosApi.modificar(c.id, { avance_foto: e.target.checked }))} /> Foto</label>
                  <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={c.avance_video} disabled={ocupado} onChange={(e) => hacer(() => cursosApi.modificar(c.id, { avance_video: e.target.checked }))} /> Vídeo</label>
                  <label className="inline-flex items-center gap-1.5">Módulos
                    <select value={c.avance_modulos} disabled={ocupado} aria-label="Avance de los módulos" className="h-7 rounded-md border border-border bg-card px-1.5 text-xs"
                      onChange={(e) => hacer(() => cursosApi.modificar(c.id, { avance_modulos: Number(e.target.value) }))}>
                      {[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n} %</option>)}
                    </select>
                  </label>
                </div>
              </section>
            )}

            {puedeActuar && c.estado === 'asignado' && (
              <button type="button" disabled={ocupado || !c.fecha_comprometida}
                onClick={() => hacer(() => cursosApi.modificar(c.id, { estado: 'en_desarrollo' }), 'En desarrollo')}
                title={c.fecha_comprometida ? undefined : 'Pon primero la fecha comprometida'}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50">
                Pasar a «En desarrollo»
              </button>
            )}

            {puedeActuar && c.estado === 'en_desarrollo' && (
              <section className="space-y-2 rounded-md border border-border p-3">
                <p className="text-[11px] font-bold uppercase text-muted-foreground">Marcar publicado</p>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… la dirección definitiva del curso" className={inputClass} aria-label="URL definitiva" />
                <p className="text-[11px] text-muted-foreground">Se comprueba que es del dominio de este campus y que responde.</p>
                {supervisa && sinComprobar && (
                  <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={sinComprobar} onChange={(e) => setSinComprobar(e.target.checked)} /> Publicar sin comprobar (este campus no tiene dominio conocido)</label>
                )}
                <button type="button" disabled={ocupado || !url.trim()}
                  onClick={() => hacer(() => cursosApi.publicar(c.id, { url: url.trim(), ...(sinComprobar ? { sin_comprobar: true } : {}) }), 'Publicado')}
                  className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50">
                  Marcar publicado
                </button>
              </section>
            )}

            {c.url_publicada && <p className="text-xs">Publicado en <a href={c.url_publicada} target="_blank" rel="noreferrer" className="text-primary underline break-all">{c.url_publicada}</a></p>}

            {/* Alumnas */}
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase text-muted-foreground">Alumnas en espera ({c.alumnas.length})</p>
              {c.alumnas.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay ninguna.</p> : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {c.alumnas.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <div className="min-w-[180px] flex-1">
                        <p className="font-semibold">{a.nombre}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {a.email || <span className="text-warning-soft-foreground">sin correo</span>} · {a.telefono || <span className="text-warning-soft-foreground">sin teléfono</span>}
                          {a.fecha_compra ? ` · compró el ${fecha(a.fecha_compra)}` : ''}
                        </p>
                      </div>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${a.estado === 'habilitada' ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted'}`}>
                        {a.estado === 'en_espera' ? 'En espera' : a.estado === 'habilitada' ? 'Habilitada' : 'Cancelada'}
                      </span>
                      {a.avisada && <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"><EnvelopeSimple size={11} /> avisada</span>}
                      {puedeActuar && (
                        <span className="inline-flex gap-1">
                          {a.estado !== 'habilitada' && (
                            <button type="button" disabled={ocupado || !['publicado', 'cerrado'].includes(c.estado)}
                              title={c.estado === 'publicado' ? undefined : 'Solo con el curso publicado'}
                              onClick={() => marcar(a, { estado: 'habilitada' })}
                              className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">
                              <CheckCircle size={11} weight="bold" /> Habilitada
                            </button>
                          )}
                          <button type="button" disabled={ocupado} onClick={() => marcar(a, { avisada: !a.avisada })}
                            className="inline-flex h-6 items-center rounded-md border border-border px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-40">
                            {a.avisada ? 'Quitar «avisada»' : 'Avisada'}
                          </button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {puedeActuar && (
              <section>
                <label className="text-[11px] font-bold uppercase text-muted-foreground" htmlFor="fp-notas">Notas</label>
                <textarea id="fp-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={3} className={`${inputClass} mt-1`}
                  onBlur={() => { if (notas !== (c.notas || '')) hacer(() => cursosApi.modificar(c.id, { notas: notas || null })); }} />
              </section>
            )}

            {supervisa && abierto && (
              <section className="rounded-md border border-border p-3">
                {!cancelando ? (
                  <button type="button" onClick={() => setCancelando(true)} className="text-xs font-bold text-destructive hover:underline">Cancelar este pendiente</button>
                ) : (
                  <div className="space-y-2">
                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la cancelación (obligatorio)" className={inputClass} aria-label="Motivo de la cancelación" />
                    <div className="flex gap-2">
                      <button type="button" disabled={ocupado || !motivo.trim()}
                        onClick={() => hacer(() => cursosApi.modificar(c.id, { estado: 'cancelado', motivo }).then(() => { setMotivo(''); setCancelando(false); }), 'Cancelado')}
                        className="inline-flex h-7 items-center rounded-md bg-destructive px-2.5 text-[11px] font-bold text-destructive-foreground disabled:opacity-50">Cancelar pendiente</button>
                      <button type="button" onClick={() => setCancelando(false)} className="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] font-bold">Volver</button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Historial */}
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase text-muted-foreground">Historial</p>
              <ul className="space-y-1 text-xs">
                {c.historial.map((h) => (
                  <li key={h.id} className="flex gap-2 text-muted-foreground">
                    <span className="w-28 shrink-0 tabular-nums">{new Date(h.created_at).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                    <span><strong className="text-foreground">{ACCIONES[h.accion] || h.accion}</strong>{h.persona ? ` · ${h.persona}` : ''}{h.motivo ? ` · «${h.motivo}»` : ''}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </Portal>
  );
}
