import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, PaperPlaneTilt, FloppyDisk, FilePdf, Trash, PaperclipHorizontal, DownloadSimple, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { rfcApi, RfcDetail, ESTADO_LABELS, ESTADO_COLORS } from '../api/changeRequests.api';
import { toast } from '@/shared/hooks/useToast';

const SignaturePad = lazy(() => import('../components/SignaturePad'));

const ROL_LABELS: Record<string, string> = { ceo: 'CEO / Sponsor', pm: 'Project Manager', dev: 'Desarrollador' };
const DECISION_LABELS: Record<string, string> = { a_favor: 'A favor', en_contra: 'En contra', diferir: 'Diferir' };
const DECISION_COLORS: Record<string, string> = {
  a_favor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  en_contra: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  diferir: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
};

export default function ChangeRequestDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth() as { user: { userId: number; role: string } | null };
  const [rfc, setRfc] = useState<RfcDetail | null>(null);
  const [draft, setDraft] = useState<Partial<RfcDetail>>({});
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPm = ['project_manager', 'admin', 'superadmin'].includes(user?.role || '');
  const isCeo = user?.role === 'superadmin';
  const isOwner = rfc?.solicitante_user_id === user?.userId;
  const canEditSolicitante = isOwner || isPm;
  const canEditPM = isPm;

  function load() {
    if (!id) return;
    rfcApi.get(parseInt(id))
      .then((r: any) => { setRfc(r?.data || null); setDraft({}); })
      .catch((err: any) => toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' }));
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  function setField<K extends keyof RfcDetail>(field: K, value: RfcDetail[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }
  function getField<K extends keyof RfcDetail>(field: K): RfcDetail[K] | null | undefined {
    return draft[field] !== undefined ? (draft[field] as any) : rfc?.[field];
  }

  async function save() {
    if (!rfc || Object.keys(draft).length === 0) return;
    setSaving(true);
    try {
      const r = await rfcApi.update(rfc.id, draft);
      setRfc(r.data);
      setDraft({});
      toast({ title: 'Guardado' });
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function sendToCeo() {
    if (!rfc) return;
    if (!confirm(`Enviar ${rfc.codigo_rfc} al CEO para revisión? Cambiará el estado a "Enviado al CEO" y se enviará email.`)) return;
    setSaving(true);
    try {
      const r = await rfcApi.update(rfc.id, { ...draft, estado: 'enviado_ceo' });
      setRfc(r.data);
      setDraft({});
      toast({ title: 'Enviado al CEO', description: 'Recibirá un email con el RFC para aprobación.' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function approveAs(rol: 'ceo' | 'pm' | 'dev', decision: 'a_favor' | 'en_contra' | 'diferir', firmaData?: string, comentarios?: string) {
    if (!rfc) return;
    try {
      const r = await rfcApi.approve(rfc.id, { rol, decision, firmaData, comentarios });
      setRfc(r.data);
      toast({ title: 'Firma registrada', description: `${ROL_LABELS[rol]}: ${DECISION_LABELS[decision]}` });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!rfc || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    try {
      await rfcApi.uploadAttachment(rfc.id, file);
      toast({ title: 'Archivo subido' });
      load();
    } catch (err: any) {
      toast({ title: 'Error subiendo archivo', description: err?.message, variant: 'destructive' });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function deleteAttachment(aid: number) {
    if (!confirm('Eliminar este adjunto?')) return;
    try {
      await rfcApi.deleteAttachment(aid);
      load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  }

  function generatePdf() {
    // Versión simple: usar window.print() con CSS @media print
    window.print();
  }

  async function handleReopen() {
    if (!rfc) return;
    const motivo = window.prompt(
      `Reabrir ${rfc.codigo_rfc}?\n\nMotivo (mínimo 3 caracteres). Se borra la firma del CEO y el RFC vuelve a "En análisis" para que el PM pueda ajustar y volver a enviar. Las firmas de PM y DEV se conservan en el historial.`
    );
    if (!motivo || motivo.trim().length < 3) {
      if (motivo !== null) toast({ title: 'Motivo requerido', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const r = await rfcApi.reopen(rfc.id, motivo.trim());
      setRfc(r.data);
      toast({ title: 'RFC reabierta', description: 'Vuelve al estado "En análisis".' });
    } catch (err: any) {
      toast({ title: 'Error al reabrir', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!rfc) return <div className="h-40 bg-muted/40 rounded animate-pulse" />;

  const hasChanges = Object.keys(draft).length > 0;

  return (
    <div className="space-y-5 pb-8 print:pb-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <div>
          <button onClick={() => navigate('/solicitudes-cambio')} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={12} /> Volver
          </button>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-base font-mono font-bold text-muted-foreground">{rfc.codigo_rfc}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ESTADO_COLORS[rfc.estado] || 'bg-muted'}`}>
              {ESTADO_LABELS[rfc.estado] || rfc.estado}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-2">{rfc.titulo}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Solicitante: <strong>{rfc.solicitante_nombre}</strong> ({rfc.solicitante_email})
            · {new Date(rfc.fecha_solicitud).toLocaleDateString('es-ES')}
            · Proyecto: <strong>{rfc.proyecto_nombre}</strong>
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {hasChanges && (
            <button onClick={save} disabled={saving}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
          {isPm && rfc.estado !== 'aprobado' && rfc.estado !== 'rechazado' && rfc.estado !== 'diferido' && (
            <button onClick={sendToCeo} disabled={saving}
              className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              <PaperPlaneTilt size={14} weight="bold" /> Enviar al CEO
            </button>
          )}
          {isPm && (rfc.estado === 'rechazado' || rfc.estado === 'diferido' || rfc.estado === 'aprobado') && (
            <button onClick={handleReopen} disabled={saving}
              title="Volver a abrir esta RFC para ajustar y reenviar al CEO"
              className="h-9 px-3 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-950/50 disabled:opacity-50 inline-flex items-center gap-1.5">
              <ArrowCounterClockwise size={14} weight="bold" /> Reabrir
            </button>
          )}
          <button onClick={generatePdf}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted inline-flex items-center gap-1.5">
            <FilePdf size={14} weight="bold" /> PDF
          </button>
        </div>
      </div>

      {/* SECCIÓN 1: Datos del solicitante */}
      <Card title="1. Descripción del cambio (solicitante)">
        <Field label="Título" disabled={!canEditSolicitante}>
          <input
            value={(getField('titulo') as string) || ''}
            onChange={(e) => setField('titulo', e.target.value)}
            disabled={!canEditSolicitante}
            className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm disabled:opacity-60"
          />
        </Field>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
          <Checkbox label="Modifica alcance" disabled={!canEditSolicitante}
            checked={!!getField('modifica_alcance')}
            onChange={(v) => setField('modifica_alcance', v as any)} />
          <Checkbox label="Modifica cronograma" disabled={!canEditSolicitante}
            checked={!!getField('modifica_cronograma')}
            onChange={(v) => setField('modifica_cronograma', v as any)} />
          <Checkbox label="Modifica costos" disabled={!canEditSolicitante}
            checked={!!getField('modifica_costos')}
            onChange={(v) => setField('modifica_costos', v as any)} />
          <Checkbox label="Modifica riesgos" disabled={!canEditSolicitante}
            checked={!!getField('modifica_riesgos')}
            onChange={(v) => setField('modifica_riesgos', v as any)} />
        </div>
        <TextArea label="Descripción resumida" disabled={!canEditSolicitante}
          value={(getField('descripcion_resumida') as string) || ''}
          onChange={(v) => setField('descripcion_resumida', v as any)} />
        <TextArea label="Objetivo / intención" disabled={!canEditSolicitante}
          value={(getField('objetivo_intencion') as string) || ''}
          onChange={(v) => setField('objetivo_intencion', v as any)} />
        <TextArea label="Motivo de negocio" disabled={!canEditSolicitante}
          value={(getField('motivo_negocio') as string) || ''}
          onChange={(v) => setField('motivo_negocio', v as any)} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <TextArea label="Beneficios KPI / marca" disabled={!canEditSolicitante}
            value={(getField('beneficios_kpi') as string) || ''}
            onChange={(v) => setField('beneficios_kpi', v as any)} />
          <TextArea label="Beneficios comerciales" disabled={!canEditSolicitante}
            value={(getField('beneficios_comercial') as string) || ''}
            onChange={(v) => setField('beneficios_comercial', v as any)} />
          <TextArea label="Beneficios operación" disabled={!canEditSolicitante}
            value={(getField('beneficios_operacion') as string) || ''}
            onChange={(v) => setField('beneficios_operacion', v as any)} />
        </div>
      </Card>

      {/* SECCIÓN 2: Parte técnica (PM) */}
      <Card title="2. Análisis técnico (Project Manager)" subtitle={!canEditPM ? 'Solo el PM puede editar esta sección' : undefined}>
        <p className="text-xs text-muted-foreground -mt-2 mb-3">
          Opciones consideradas — añade comparativas de cómo implementar el cambio.
        </p>
        <OpcionesConsideradasEditor
          value={(getField('opciones_consideradas') as any) || []}
          onChange={(v) => setField('opciones_consideradas', v as any)}
          disabled={!canEditPM}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
          <TextArea label="Impacto en alcance (WBS)" disabled={!canEditPM}
            value={(getField('impacto_alcance') as string) || ''}
            onChange={(v) => setField('impacto_alcance', v as any)} />
          <TextArea label="Impacto en tiempo" disabled={!canEditPM}
            value={(getField('impacto_tiempo') as string) || ''}
            onChange={(v) => setField('impacto_tiempo', v as any)} />
          <TextArea label="Impacto en costo" disabled={!canEditPM}
            value={(getField('impacto_costo') as string) || ''}
            onChange={(v) => setField('impacto_costo', v as any)} />
          <TextArea label="Riesgos (nuevos o aumentados) y mitigación" disabled={!canEditPM}
            value={(getField('impacto_riesgos') as string) || ''}
            onChange={(v) => setField('impacto_riesgos', v as any)} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
          <Field label="Recomendación PM" disabled={!canEditPM}>
            <select disabled={!canEditPM}
              value={(getField('recomendacion_decision') as string) || ''}
              onChange={(e) => setField('recomendacion_decision', e.target.value as any)}
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm disabled:opacity-60">
              <option value="">—</option>
              <option value="aprobar">Aprobar</option>
              <option value="rechazar">Rechazar</option>
              <option value="diferir">Diferir (condicionar)</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <TextArea label="Justificación de la recomendación" disabled={!canEditPM}
              value={(getField('recomendacion_justif') as string) || ''}
              onChange={(v) => setField('recomendacion_justif', v as any)} />
          </div>
        </div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Plan de implementación (si se aprueba)</h4>
        <TextArea label="Alcance / piloto" disabled={!canEditPM}
          value={(getField('plan_alcance') as string) || ''}
          onChange={(v) => setField('plan_alcance', v as any)} />
        <TextArea label="Hitos / fechas" disabled={!canEditPM}
          value={(getField('plan_hitos') as string) || ''}
          onChange={(v) => setField('plan_hitos', v as any)} />
        <TextArea label="Responsables" disabled={!canEditPM}
          value={(getField('plan_responsables') as string) || ''}
          onChange={(v) => setField('plan_responsables', v as any)} />
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-4 mb-2">Línea base de versiones</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Versión Alcance" disabled={!canEditPM}>
            <input type="text" disabled={!canEditPM} placeholder="ej. S-1.0"
              value={(getField('baseline_alcance') as string) || ''}
              onChange={(e) => setField('baseline_alcance', e.target.value as any)}
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm disabled:opacity-60" />
          </Field>
          <Field label="Versión Cronograma" disabled={!canEditPM}>
            <input type="text" disabled={!canEditPM} placeholder="ej. T-1.0"
              value={(getField('baseline_cronograma') as string) || ''}
              onChange={(e) => setField('baseline_cronograma', e.target.value as any)}
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm disabled:opacity-60" />
          </Field>
          <Field label="Versión Costos" disabled={!canEditPM}>
            <input type="text" disabled={!canEditPM} placeholder="ej. C-1.0"
              value={(getField('baseline_costos') as string) || ''}
              onChange={(e) => setField('baseline_costos', e.target.value as any)}
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm disabled:opacity-60" />
          </Field>
        </div>
      </Card>

      {/* SECCIÓN 3: Aprobaciones CCB */}
      <Card title="3. Aprobaciones del CCB (firmas)">
        <p className="text-xs text-muted-foreground mb-3">
          Cada miembro del CCB firma su decisión. Cuando el CEO firma, el RFC pasa a su estado final (Aprobado / Rechazado / Diferido).
        </p>
        <div className="space-y-3">
          {rfc.approvals.map((a) => (
            <ApprovalRow key={a.id} approval={a} rfcId={rfc.id}
              canSignAs={
                (a.rol === 'ceo' && isCeo) ||
                (a.rol === 'pm' && isPm) ||
                (a.rol === 'dev')
              }
              onSigned={(decision, firmaData, comentarios) => approveAs(a.rol, decision, firmaData, comentarios)}
            />
          ))}
        </div>
      </Card>

      {/* SECCIÓN 4: Adjuntos */}
      <Card title="4. Adjuntos">
        <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" accept="image/*,application/pdf" />
        <button onClick={() => fileInputRef.current?.click()}
          className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted inline-flex items-center gap-1.5">
          <PaperclipHorizontal size={14} /> Subir foto o PDF
        </button>
        {rfc.attachments.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-3 italic">Sin adjuntos.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {rfc.attachments.map((att) => (
              <li key={att.id} className="flex items-center justify-between gap-2 bg-muted/30 rounded p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{att.file_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {att.mime_type} · {(att.size_bytes / 1024).toFixed(0)} KB ·{' '}
                    {new Date(att.uploaded_at).toLocaleString('es-ES')}
                  </p>
                </div>
                <a href={rfcApi.downloadAttachmentUrl(att.id)} target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                  <DownloadSimple size={12} /> Descargar
                </a>
                <button onClick={() => deleteAttachment(att.id)}
                  className="text-xs text-red-600 hover:underline inline-flex items-center gap-1">
                  <Trash size={12} /> Eliminar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 print:break-inside-avoid">
      <h2 className="text-base font-bold mb-1">{title}</h2>
      {subtitle && <p className="text-[11px] text-muted-foreground mb-3">{subtitle}</p>}
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={`text-[11px] font-bold uppercase tracking-wider mb-1.5 block ${disabled ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>{label}</label>
      {children}
    </div>
  );
}

function TextArea({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label={label} disabled={disabled}>
      <textarea disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} rows={2}
        className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-y disabled:opacity-60" />
    </Field>
  );
}

function Checkbox({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-sm cursor-pointer ${disabled ? 'opacity-60' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} className="w-4 h-4" />
      {label}
    </label>
  );
}

function OpcionesConsideradasEditor({ value, onChange, disabled }: { value: any[]; onChange: (v: any[]) => void; disabled?: boolean }) {
  function add() {
    onChange([...value, { opcion: '', descripcion: '', costo: '', tiempo: '', riesgos: '' }]);
  }
  function remove(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }
  function update(i: number, patch: any) {
    onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  }
  return (
    <div className="space-y-2">
      {value.map((op, i) => (
        <div key={i} className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
          <div className="flex gap-2">
            <input disabled={disabled} placeholder="Opción (A / B / C)"
              value={op.opcion || ''} onChange={(e) => update(i, { opcion: e.target.value })}
              className="w-20 h-9 px-2 rounded border border-border bg-card text-sm" />
            <input disabled={disabled} placeholder="Descripción"
              value={op.descripcion || ''} onChange={(e) => update(i, { descripcion: e.target.value })}
              className="flex-1 h-9 px-2 rounded border border-border bg-card text-sm" />
            {!disabled && (
              <button onClick={() => remove(i)} className="text-red-600 px-2"><Trash size={14} /></button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input disabled={disabled} placeholder="Costo" value={op.costo || ''} onChange={(e) => update(i, { costo: e.target.value })} className="h-8 px-2 rounded border border-border bg-card text-xs" />
            <input disabled={disabled} placeholder="Tiempo" value={op.tiempo || ''} onChange={(e) => update(i, { tiempo: e.target.value })} className="h-8 px-2 rounded border border-border bg-card text-xs" />
            <input disabled={disabled} placeholder="Riesgos" value={op.riesgos || ''} onChange={(e) => update(i, { riesgos: e.target.value })} className="h-8 px-2 rounded border border-border bg-card text-xs" />
            <input disabled={disabled} placeholder="Comentarios" value={op.comentarios || ''} onChange={(e) => update(i, { comentarios: e.target.value })} className="h-8 px-2 rounded border border-border bg-card text-xs" />
          </div>
        </div>
      ))}
      {!disabled && (
        <button onClick={add} className="text-xs text-primary hover:underline">+ Añadir opción</button>
      )}
    </div>
  );
}

function ApprovalRow({ approval, rfcId, canSignAs, onSigned }: {
  approval: any;
  rfcId: number;
  canSignAs: boolean;
  onSigned: (decision: 'a_favor' | 'en_contra' | 'diferir', firmaData?: string, comentarios?: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [decision, setDecision] = useState<'a_favor' | 'en_contra' | 'diferir'>('a_favor');
  const [firma, setFirma] = useState<string | null>(null);
  const [comentarios, setComentarios] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const isSigned = approval.decision != null;

  // Lazy load signature when expanding a signed approval.
  useEffect(() => {
    if (showForm && isSigned && approval.has_firma && !savedSignature) {
      rfcApi.getSignature(approval.id).then((r: any) => setSavedSignature(r?.data?.firma_data || null)).catch(() => {});
    }
  }, [showForm, isSigned, approval.has_firma, approval.id, savedSignature]);

  return (
    <div className="border border-border rounded-md p-3 bg-muted/10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">{ROL_LABELS[approval.rol]}</span>
          {isSigned && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${DECISION_COLORS[approval.decision]}`}>
              {DECISION_LABELS[approval.decision]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {isSigned ? (
            <>
              <span className="text-muted-foreground">{approval.user_nombre || '—'}</span>
              <button onClick={() => setShowForm(!showForm)} className="text-primary hover:underline">
                {showForm ? 'Ocultar' : 'Ver detalle'}
              </button>
            </>
          ) : canSignAs ? (
            <button onClick={() => setShowForm(!showForm)} className="text-primary hover:underline font-semibold">
              {showForm ? 'Cancelar' : 'Firmar mi decisión'}
            </button>
          ) : (
            <span className="text-muted-foreground italic">Pendiente</span>
          )}
        </div>
      </div>

      {showForm && (
        <div className="mt-3 space-y-3 pt-3 border-t border-border">
          {isSigned ? (
            <>
              <p className="text-xs text-muted-foreground">
                Firmado por <strong>{approval.user_nombre}</strong> · {approval.firma_at && new Date(approval.firma_at).toLocaleString('es-ES')}
              </p>
              {approval.comentarios && (
                <p className="text-sm italic">"{approval.comentarios}"</p>
              )}
              {savedSignature ? (
                <img src={savedSignature} alt="Firma" className="max-w-xs border border-border rounded bg-white" />
              ) : (
                <p className="text-xs text-muted-foreground italic">Sin firma gráfica registrada.</p>
              )}
            </>
          ) : (
            <>
              <div className="flex gap-2 flex-wrap">
                {['a_favor', 'en_contra', 'diferir'].map((d) => (
                  <button key={d} onClick={() => setDecision(d as any)}
                    className={`px-3 py-1.5 rounded text-xs font-semibold border-2 ${decision === d ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}>
                    {DECISION_LABELS[d]}
                  </button>
                ))}
              </div>
              <Suspense fallback={<div className="h-40 bg-muted/40 rounded animate-pulse" />}>
                <SignaturePad value={firma} onChange={setFirma} />
              </Suspense>
              <textarea value={comentarios} onChange={(e) => setComentarios(e.target.value)} placeholder="Comentarios opcionales…" rows={2}
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
              <button
                onClick={() => { onSigned(decision, firma || undefined, comentarios || undefined); setShowForm(false); }}
                disabled={!firma}
                className="h-9 px-4 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                Registrar firma
              </button>
              {!firma && <p className="text-[11px] text-muted-foreground">Dibuja tu firma para activar el botón.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
