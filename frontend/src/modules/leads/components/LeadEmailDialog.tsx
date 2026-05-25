import { useEffect, useState } from 'react';
import { X, EnvelopeSimple, PaperPlaneTilt, FileText } from '@phosphor-icons/react';
import { leadEmailsApi } from '../api/lead-emails.api';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import { emailTemplatesApi, type EmailTemplate } from '@/modules/email-templates/api/templates.api';
import { useProjectContext } from '@/contexts/ProjectContext';

interface LeadEmailDialogProps {
  open: boolean;
  leadId: number;
  leadName?: string | null;
  leadEmail?: string | null;
  onClose: () => void;
  onSent?: () => void;
}

export default function LeadEmailDialog({
  open, leadId, leadName, leadEmail, onClose, onSent,
}: LeadEmailDialogProps) {
  const { activeProject } = useProjectContext();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  // CRM-185 fase 2: plantillas. Se cargan al abrir; al elegir una se renderiza
  // server-side con los datos del lead y se prefilla asunto/cuerpo.
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | ''>('');
  const [renderingTemplate, setRenderingTemplate] = useState(false);

  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setSending(false);
      setSelectedTemplateId('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || !activeProject?.id) return;
    let cancelled = false;
    emailTemplatesApi.list(activeProject.id, false)
      .then(res => { if (!cancelled && res.success && res.data) setTemplates(res.data); })
      .catch(() => { /* silencioso, seccion opcional */ });
    return () => { cancelled = true; };
  }, [open, activeProject?.id]);

  async function applyTemplate(templateId: number) {
    if (!activeProject?.id) return;
    setRenderingTemplate(true);
    try {
      const res = await emailTemplatesApi.render(templateId, activeProject.id, leadId);
      if (res.success && res.data) {
        setSubject(res.data.subject);
        setBody(res.data.body_html);
      }
    } catch {
      toast({ title: 'Error aplicando plantilla', variant: 'destructive' });
    } finally { setRenderingTemplate(false); }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function send(): Promise<void> {
    if (!subject.trim() || !body.trim()) {
      toast({ title: 'Faltan campos', description: 'Asunto y cuerpo son obligatorios', variant: 'destructive' });
      return;
    }
    if (!leadEmail) {
      toast({ title: 'Sin email', description: 'El lead no tiene email registrado', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      // El backend espera HTML — convertimos saltos de linea a <br/> para que
      // el usuario pueda escribir prosa sin pensar en HTML. Si pega HTML lo
      // respetamos (heuristica: si ya tiene tags lo dejamos tal cual).
      const looksLikeHtml = /<\w+[^>]*>/.test(body);
      const body_html = looksLikeHtml ? body : body.replace(/\n/g, '<br/>');
      const body_text = looksLikeHtml ? body.replace(/<[^>]+>/g, '') : body;

      const res = await leadEmailsApi.send(leadId, { subject: subject.trim(), body_html, body_text });
      if (res.success) {
        toast({ title: 'Email enviado', description: leadEmail });
        onSent?.();
        onClose();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo enviar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-email-title"
        className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <EnvelopeSimple size={16} weight="duotone" className="text-primary shrink-0" />
            <div className="min-w-0">
              <h2 id="lead-email-title" className="font-semibold text-sm">Enviar email</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                {leadName ? `${leadName} · ` : ''}{leadEmail || 'Sin email'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {!leadEmail && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md p-3 text-xs text-amber-700 dark:text-amber-400">
              Este lead no tiene email. Edita la ficha y añade uno antes de enviar.
            </div>
          )}
          {templates.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <FileText size={11} /> Usar plantilla
              </label>
              <Select<number | ''>
                value={selectedTemplateId}
                onChange={(v) => {
                  setSelectedTemplateId(v);
                  if (v !== '') applyTemplate(v);
                }}
                options={[
                  { value: '' as const, label: '— Seleccionar plantilla —' },
                  ...templates.map(t => ({ value: t.id as number, label: t.name })),
                ]}
                ariaLabel="Plantilla de email"
                disabled={renderingTemplate || sending || !leadEmail}
              />
              {renderingTemplate && (
                <p className="text-[10px] text-muted-foreground mt-1">Aplicando plantilla…</p>
              )}
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Asunto</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={500}
              placeholder="Asunto del email"
              autoFocus
              disabled={sending || !leadEmail}
              className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mensaje</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              maxLength={50000}
              placeholder="Hola...&#10;&#10;Saltos de línea se respetan automáticamente. Puedes pegar HTML si quieres formato más rico."
              disabled={sending || !leadEmail}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all disabled:opacity-50 font-mono leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              {body.length} / 50000
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="inline-flex items-center justify-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || !leadEmail || !subject.trim() || !body.trim()}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <PaperPlaneTilt size={14} weight="bold" />
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
