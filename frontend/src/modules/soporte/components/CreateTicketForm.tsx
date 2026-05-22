import { useEffect, useRef, useState } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useLocation } from 'react-router-dom';
import { toast } from '@/shared/hooks/useToast';
import Select from '@/shared/components/ui/Select';
import {
  X, Bug, Lightning, Question, Image as ImageIcon, PaperPlaneRight,
} from '@phosphor-icons/react';
import { createTicket, TICKET_SEVERITY } from '../lib/tickets';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 1 * 1024 * 1024;

type TicketKind = 'bug' | 'feature' | 'question';
type TicketSeverity = 'low' | 'medium' | 'high' | 'critical';

interface Attachment {
  name: string;
  dataUrl: string;
  size: number;
}

interface FormState {
  kind: TicketKind;
  severity: TicketSeverity;
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  whyItMatters: string;
  url: string;
}

export default function CreateTicketForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const { activeProject } = useProjectContext();
  const location = useLocation();
  const [form, setForm] = useState<FormState>({
    kind: 'bug',
    severity: 'medium',
    title: '',
    description: '',
    steps: '',
    expected: '',
    actual: '',
    whyItMatters: '',
    url: window.location.origin + location.pathname,
  });
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setForm((f) => ({ ...f, url: window.location.origin + location.pathname }));
  }, [location.pathname]);

  function patch(diff: Partial<FormState>) { setForm((f) => ({ ...f, ...diff })); }

  async function handleFiles(files: File[]) {
    const valid: File[] = [];
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Solo imagenes', description: `${file.name} no es imagen`, variant: 'destructive' });
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast({ title: 'Imagen muy grande', description: `${file.name}: max 1 MB`, variant: 'destructive' });
        continue;
      }
      if (attachments.length + valid.length >= MAX_FILES) {
        toast({ title: `Maximo ${MAX_FILES} imagenes`, variant: 'destructive' });
        break;
      }
      valid.push(file);
    }
    const dataUrls = await Promise.all(valid.map((f) => new Promise<Attachment>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, dataUrl: reader.result as string, size: f.size });
      reader.readAsDataURL(f);
    })));
    setAttachments((a) => [...a, ...dataUrls]);
  }

  function removeAttachment(idx: number) {
    setAttachments((a) => a.filter((_, i) => i !== idx));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast({ title: 'Falta titulo', variant: 'destructive' });
      return;
    }
    createTicket({
      ...form,
      attachments,
      projectId: activeProject?.id,
      projectName: activeProject?.nombre,
    });
    toast({ title: 'Ticket creado', description: 'Lo recibimos. Responderemos pronto.' });
    onSubmitted?.();
  }

  return (
    <form onSubmit={submit} className="flex-1 overflow-y-auto sidebar-scroll p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <KindSelector value={form.kind} onChange={(k) => patch({ kind: k })} />
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Severidad</span>
          <Select<TicketSeverity>
            value={form.severity}
            onChange={(v) => patch({ severity: v })}
            options={Object.entries(TICKET_SEVERITY).map(([k, v]) => ({ value: k as TicketSeverity, label: v.label }))}
            ariaLabel="Severidad"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Titulo *</span>
        <input
          autoFocus
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={form.kind === 'bug' ? 'Ej: Boton de exportar CSV no funciona' : form.kind === 'feature' ? 'Ej: Filtrar prospectos por tags' : 'Ej: Como configuro un webhook?'}
          className="w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm"
        />
      </label>

      {form.kind === 'bug' && (
        <>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Que sucedio?</span>
            <textarea
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={3}
              placeholder="Describe el problema en pocas frases."
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Pasos para reproducir</span>
            <textarea
              value={form.steps}
              onChange={(e) => patch({ steps: e.target.value })}
              rows={3}
              placeholder={"1. Voy a /leads\n2. Hago click en exportar\n3. ..."}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm font-mono resize-y"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Esperabas que...</span>
              <textarea
                value={form.expected}
                onChange={(e) => patch({ expected: e.target.value })}
                rows={2}
                placeholder="Se descargue el CSV"
                className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Pero en lugar...</span>
              <textarea
                value={form.actual}
                onChange={(e) => patch({ actual: e.target.value })}
                rows={2}
                placeholder="No pasa nada / sale error rojo"
                className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
              />
            </label>
          </div>
        </>
      )}

      {form.kind === 'feature' && (
        <>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Tu idea</span>
            <textarea
              value={form.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={3}
              placeholder="Describe la mejora con detalle"
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Por que importa?</span>
            <textarea
              value={form.whyItMatters}
              onChange={(e) => patch({ whyItMatters: e.target.value })}
              rows={2}
              placeholder="Que problema resuelve / a quien beneficia"
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
            />
          </label>
        </>
      )}

      {form.kind === 'question' && (
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Tu pregunta</span>
          <textarea
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={4}
            placeholder="Pregunta lo que necesites"
            className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm resize-y"
          />
        </label>
      )}

      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">URL de la pagina (auto)</span>
        <input
          value={form.url}
          onChange={(e) => patch({ url: e.target.value })}
          className="w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-xs font-mono"
        />
      </label>

      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
          Capturas <span className="font-normal normal-case">(opcional, max {MAX_FILES} · 1 MB c/u)</span>
        </span>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(Array.from(e.dataTransfer.files)); }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-md p-3 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/20 hover:bg-muted/40'
          }`}
        >
          <ImageIcon size={20} weight="regular" className="mx-auto text-muted-foreground mb-1" />
          <p className="text-xs text-muted-foreground">Arrastra imagenes o <span className="text-primary font-medium">selecciona archivos</span></p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleFiles(Array.from(e.target.files || []))}
            className="hidden"
          />
        </div>
        {attachments.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
            {attachments.map((a, i) => (
              <div key={i} className="relative group">
                <img src={a.dataUrl} alt={a.name} loading="lazy" decoding="async" className="w-full h-16 object-cover rounded border border-border" />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label={`Quitar ${a.name}`}
                  className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-500 transition flex items-center justify-center"
                >
                  <X size={10} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-3 border-t border-border flex justify-end">
        <button type="submit" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90">
          <PaperPlaneRight size={14} weight="bold" /> Enviar ticket
        </button>
      </div>
    </form>
  );
}

function KindSelector({ value, onChange }: { value: TicketKind; onChange: (k: TicketKind) => void }) {
  const KINDS: Array<{ k: TicketKind; label: string; Icon: any; color: string }> = [
    { k: 'bug', label: 'Bug', Icon: Bug, color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30' },
    { k: 'feature', label: 'Mejora', Icon: Lightning, color: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30' },
    { k: 'question', label: 'Pregunta', Icon: Question, color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30' },
  ];
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">Tipo</span>
      <div className="grid grid-cols-3 gap-1">
        {KINDS.map(({ k, label, Icon, color }) => {
          const active = value === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              className={`h-9 inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-colors ${
                active ? color + ' ring-1 ring-current' : 'bg-muted/30 text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon size={12} weight={active ? 'fill' : 'regular'} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
