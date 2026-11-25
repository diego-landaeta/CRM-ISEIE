import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, WarningCircle, UploadSimple, FileText, ClockCounterClockwise, LinkSimple } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import {
  apostillasApi, type ApostillaConDetalle, type EdicionApostilla, type EventoApostilla,
} from '../api/apostillas.api';
import {
  ESTADOS, TIPOS_DOCUMENTO, textoDelEstado, textoDelDocumento, textoDelOrigen, estaAtascada, fraseAtascada,
  eur, rutaDelCliente, rutaDeLaVenta, type EstadoApostilla, type TipoDocumento,
} from '../lib/apostillas';
import BarraDePasos from './BarraDePasos';

/*
  La ficha de una apostilla (CRM#1130 / CRM-ISEIE#786): en qué paso está, su
  dinero (leído de la venta o del cargo), quién la lleva, el envío, sus
  documentos y su historial.

  Cambiarla, quien la gestiona (`gestionable`, lo dice el servidor). Abrir sus
  documentos, quien la gestiona (`ve_documentos`). Enlazar una «Sin asociar»,
  `apostillas.asociar`. Nada de esto escribe al alumno.
*/

const cuando = (t: string | null | undefined) => (t
  ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '');
// La clase del campo vive en un solo sitio (#106): aquí solo se ajusta el alto.
const campo = cn(inputClass, 'mt-1 block h-8 px-2');

function lineaDelHistorial(e: EventoApostilla): string {
  switch (e.tipo) {
    case 'creada': return `Creada${e.nota ? ` · ${e.nota}` : ''}`;
    case 'estado': return `${textoDelEstado(e.de)} → ${textoDelEstado(e.a)}`;
    case 'responsable': return `La lleva ${e.a || 'nadie'}${e.de ? ` (antes, ${e.de})` : ''}`;
    case 'documento': return `Documento: ${e.a}${e.nota ? ` (${textoDelDocumento(e.nota)})` : ''}`;
    case 'envio': return e.nota === 'numero_seguimiento' ? `N.º de seguimiento: ${e.a || '—'}` : `Dirección de envío: ${e.a || '—'}`;
    case 'enlazada': return `Enlazada con ${e.a}`;
    case 'datos': return `Título que se apostilla: ${e.a || '—'}`;
    default: return e.nota || e.tipo;
  }
}

interface Props {
  id: number;
  onCerrar: () => void;
  /** Tras guardar cualquier cambio (la lista y las cifras se recargan). */
  onCambio?: () => void;
}

export default function ApostillaDialog({ id, onCerrar, onCambio }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { can } = usePermission();
  const [a, setA] = useState<ApostillaConDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState<EdicionApostilla & { estado?: EstadoApostilla }>({});
  const [personas, setPersonas] = useState<Array<{ id: number; nombre: string }>>([]);
  const [tipoDoc, setTipoDoc] = useState<TipoDocumento>('diploma');
  const [enlace, setEnlace] = useState({ leadId: '', conversionId: '' });
  useModalAccesible(ref, { open: true, onClose: onCerrar, bloqueado: guardando });

  function poner(d: ApostillaConDetalle) {
    setA(d);
    setForm({
      estado: d.estado, responsableId: d.responsable_id, formacion: d.formacion || '',
      direccionEnvio: d.direccion_envio || '', numeroSeguimiento: d.numero_seguimiento || '', nota: '',
    });
  }

  useEffect(() => {
    let vivo = true;
    apostillasApi.ver(id)
      .then((r) => { if (vivo && r?.data) poner(r.data); })
      .catch((e: { data?: { error?: string }; message?: string }) => { if (vivo) setError(e?.data?.error || e?.message || 'No se pudo abrir'); });
    return () => { vivo = false; };
  }, [id]);

  useEffect(() => {
    if (!a?.gestionable) return;
    apostillasApi.personas().then((r) => setPersonas(r?.data || [])).catch(() => {});
  }, [a?.gestionable]);

  function fallo(titulo: string, err: unknown) {
    const e = err as { data?: { error?: string }; message?: string };
    toast({ title: titulo, description: e?.data?.error || e?.message, variant: 'destructive' });
  }

  async function guardar() {
    if (!a) return;
    const cambios: EdicionApostilla = {};
    if (form.estado && form.estado !== a.estado) cambios.estado = form.estado;
    if ((form.responsableId ?? null) !== (a.responsable_id ?? null)) cambios.responsableId = form.responsableId ?? null;
    if ((form.formacion || '') !== (a.formacion || '')) cambios.formacion = form.formacion || null;
    if ((form.direccionEnvio || '') !== (a.direccion_envio || '')) cambios.direccionEnvio = form.direccionEnvio || null;
    if ((form.numeroSeguimiento || '') !== (a.numero_seguimiento || '')) cambios.numeroSeguimiento = form.numeroSeguimiento || null;
    if (form.nota?.trim()) cambios.nota = form.nota.trim();
    if (!Object.keys(cambios).length) { toast({ title: 'No hay nada que cambiar' }); return; }
    if (cambios.estado === 'cancelada' && !cambios.nota) {
      toast({ title: 'Falta el motivo', description: 'Para cancelarla, escribe el motivo en la nota.', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await apostillasApi.editar(a.id, cambios);
      if (r?.data) poner(r.data);
      toast({ title: cambios.estado ? `Pasa a «${textoDelEstado(cambios.estado)}»` : 'Apostilla guardada' });
      onCambio?.();
    } catch (err) { fallo('No se pudo guardar', err); } finally { setGuardando(false); }
  }

  async function subir(file: File | undefined) {
    if (!a || !file) return;
    setGuardando(true);
    try {
      await apostillasApi.subirDocumento(a.id, file, tipoDoc);
      const r = await apostillasApi.ver(a.id);
      if (r?.data) poner(r.data);
      toast({ title: 'Documento subido', description: 'Se guarda en el CRM; no se manda a nadie.' });
      onCambio?.();
    } catch (err) { fallo('No se pudo subir el documento', err); } finally { setGuardando(false); }
  }

  async function enlazar() {
    if (!a) return;
    const leadId = Number(enlace.leadId);
    if (!Number.isInteger(leadId) || leadId < 1) { toast({ title: 'Escribe el n.º de ficha del cliente', variant: 'destructive' }); return; }
    const conversionId = enlace.conversionId ? Number(enlace.conversionId) : null;
    setGuardando(true);
    try {
      await apostillasApi.enlazar(a.id, { leadId, conversionId });
      const r = await apostillasApi.ver(a.id);
      if (r?.data) poner(r.data);
      toast({ title: 'Apostilla enlazada con su cliente' });
      onCambio?.();
    } catch (err) { fallo('No se pudo enlazar', err); } finally { setGuardando(false); }
  }

  const atascada = a ? estaAtascada(a) : false;
  const titulo = a ? `Apostilla ${a.cliente ? `de ${a.cliente}` : 'sin asociar'}` : 'Apostilla';

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={() => !guardando && onCerrar()}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={titulo}
          className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-md border border-border bg-card shadow-sm"
          onClick={(e) => e.stopPropagation()}>
          <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold truncate">{titulo}</h2>
              {a && (
                <p className="text-[12px] text-muted-foreground truncate">
                  {a.campus} · {textoDelOrigen(a.origen)} · n.º {a.id}{!a.gestionable && ' · Solo lectura'}
                </p>
              )}
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" disabled={guardando}
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
              <X size={14} weight="bold" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm">
            {error && <p className="text-destructive">{error}</p>}
            {!a && !error && <p className="text-muted-foreground">Cargando…</p>}
            {a && (
              <>
                <BarraDePasos estado={a.estado} diasEnEstado={a.dias_en_estado} atascada={atascada} />
                {atascada && (
                  <p className="flex items-start gap-1.5 rounded-md bg-warning-soft px-3 py-2 text-[12px] text-warning-soft-foreground" role="alert">
                    <WarningCircle size={14} weight="bold" className="mt-0.5 shrink-0" />
                    {fraseAtascada(a)}. El aviso salta a los {a.dias_aviso} días.
                  </p>
                )}

                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
                  <div><dt className="text-muted-foreground">Importe</dt><dd className="font-semibold tabular-nums">{eur(a.importe)}</dd></div>
                  <div><dt className="text-muted-foreground">Cobrado</dt><dd className="font-semibold tabular-nums">{eur(a.cobrado)}</dd></div>
                  <div><dt className="text-muted-foreground">Pagada</dt><dd className={a.pagada ? 'font-semibold text-success' : 'font-semibold text-warning-soft-foreground'}>{a.pagada ? 'Sí' : 'Todavía no'}</dd></div>
                  <div><dt className="text-muted-foreground">Gestora</dt><dd className="truncate">{a.gestora || '—'}</dd></div>
                </dl>

                <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                  {a.lead_id && <Link className="text-primary hover:underline" to={rutaDelCliente(a.lead_id)}>Ficha del cliente</Link>}
                  {a.conversion_id && <Link className="text-primary hover:underline" to={rutaDeLaVenta(a.conversion_id)}>Venta n.º {a.conversion_id}{a.venta_producto ? ` · ${a.venta_producto}` : ''}</Link>}
                  {!a.lead_id && a.cobro_email && <span className="text-muted-foreground">Pagó: {a.cobro_email}</span>}
                </p>

                {!a.lead_id && can('apostillas.asociar') && (
                  <fieldset disabled={guardando} className="rounded-md border border-border p-3 space-y-2">
                    <legend className="px-1 text-[12px] font-semibold flex items-center gap-1"><LinkSimple size={13} /> Enlazar con su cliente</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[12px]"><span className="text-muted-foreground">N.º de ficha del cliente</span>
                        <input className={campo} inputMode="numeric" value={enlace.leadId} onChange={(e) => setEnlace({ ...enlace, leadId: e.target.value })} /></label>
                      <label className="text-[12px]"><span className="text-muted-foreground">N.º de venta (opcional)</span>
                        <input className={campo} inputMode="numeric" value={enlace.conversionId} onChange={(e) => setEnlace({ ...enlace, conversionId: e.target.value })} /></label>
                    </div>
                    <div className="flex justify-end">
                      <button type="button" onClick={enlazar} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted">Enlazar</button>
                    </div>
                  </fieldset>
                )}

                <fieldset disabled={!a.gestionable || guardando} className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-[12px]"><span className="text-muted-foreground">Paso</span>
                      <select className={campo} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value as EstadoApostilla })}>
                        {ESTADOS.map((e) => <option key={e.clave} value={e.clave}>{e.texto}</option>)}
                      </select></label>
                    <label className="text-[12px]"><span className="text-muted-foreground">La lleva</span>
                      <select className={campo} value={form.responsableId ?? ''}
                        onChange={(e) => setForm({ ...form, responsableId: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">{a.gestora ? `Su gestora (${a.gestora})` : 'Nadie en concreto'}</option>
                        {a.responsable_id && !personas.some((p) => p.id === a.responsable_id) && <option value={a.responsable_id}>{a.responsable}</option>}
                        {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select></label>
                  </div>
                  <label className="block text-[12px]"><span className="text-muted-foreground">Título que se apostilla</span>
                    <input className={campo} maxLength={500} value={form.formacion || ''} onChange={(e) => setForm({ ...form, formacion: e.target.value })} /></label>
                  <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-2">
                    <label className="text-[12px]"><span className="text-muted-foreground">Dirección de envío</span>
                      <input className={campo} maxLength={1000} value={form.direccionEnvio || ''} onChange={(e) => setForm({ ...form, direccionEnvio: e.target.value })} /></label>
                    <label className="text-[12px]"><span className="text-muted-foreground">N.º de seguimiento</span>
                      <input className={campo} maxLength={120} value={form.numeroSeguimiento || ''} onChange={(e) => setForm({ ...form, numeroSeguimiento: e.target.value })} /></label>
                  </div>
                  <label className="block text-[12px]"><span className="text-muted-foreground">Nota{form.estado === 'cancelada' && form.estado !== a.estado ? ' (el motivo, obligatoria)' : ''}</span>
                    <textarea className={cn(campo, 'h-auto py-1')} rows={2} maxLength={2000} value={form.nota || ''} onChange={(e) => setForm({ ...form, nota: e.target.value })} /></label>
                  {a.notas && <p className="text-[12px] text-muted-foreground whitespace-pre-line">Última nota: {a.notas}</p>}
                  {a.gestionable && (
                    <div className="flex justify-end">
                      <button type="button" onClick={guardar} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50">
                        {guardando ? 'Guardando…' : 'Guardar'}
                      </button>
                    </div>
                  )}
                </fieldset>
                <p className="text-[11px] text-muted-foreground">Al alumno no se le escribe nada: los avisos son solo para el equipo, en la campana.</p>

                <section className="space-y-2" aria-label="Documentos">
                  <h3 className="text-[12px] font-semibold flex items-center gap-1.5"><FileText size={13} /> Documentos ({a.documentos.length})</h3>
                  {a.documentos.length > 0 && (
                    <ul className="space-y-1">
                      {a.documentos.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-2 text-[12px] border-b border-border pb-1">
                          <span className="min-w-0 truncate">{textoDelDocumento(d.tipo)} · {d.nombre}</span>
                          {a.ve_documentos
                            ? <button type="button" className="text-primary hover:underline shrink-0"
                              onClick={() => apostillasApi.abrirDocumento(d.id).catch((e) => fallo('No se pudo abrir', e))}>Abrir</button>
                            : <span className="text-muted-foreground shrink-0">Solo quien la gestiona</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {a.gestionable && (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-[12px]"><span className="text-muted-foreground">Tipo</span>
                        <select className={campo} value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value as TipoDocumento)}>
                          {TIPOS_DOCUMENTO.map((t) => <option key={t.clave} value={t.clave}>{t.texto}</option>)}
                        </select></label>
                      <label className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-border text-[12px] font-semibold hover:bg-muted cursor-pointer">
                        <UploadSimple size={13} /> Subir (PDF o imagen, 10 MB)
                        <input type="file" className="sr-only" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={guardando}
                          onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                    </div>
                  )}
                </section>

                {a.eventos.length > 0 && (
                  <details className="text-[12px]" open>
                    <summary className="cursor-pointer text-muted-foreground flex items-center gap-1.5">
                      <ClockCounterClockwise size={13} weight="bold" /> Historial ({a.eventos.length})
                    </summary>
                    <ul className="mt-2 space-y-1.5" aria-label="Historial de la apostilla">
                      {a.eventos.map((e) => (
                        <li key={e.id} className="border-l-2 border-border pl-2">
                          <span className="font-medium">{lineaDelHistorial(e)}</span>
                          {e.tipo === 'estado' && e.nota && <span className="block text-muted-foreground">{e.nota}</span>}
                          <span className="block text-[11px] text-muted-foreground">{[e.usuario || 'El CRM', cuando(e.created_at)].filter(Boolean).join(' · ')}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
