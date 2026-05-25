import { useState, useEffect, useMemo } from 'react';
import { X, WhatsappLogo, Copy, CheckCircle, Plus, Trash } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

const STORAGE_KEY = 'crm.whatsapp.templates.v1';

const DEFAULT_TEMPLATES: WhatsappTemplate[] = [
  {
    id: 'default-bienvenida',
    label: 'Bienvenida',
    body: 'Hola {nombre}, te contacto desde ISEIE. Vi tu interés en {producto} y quería resolver tus dudas. ¿Cuándo te viene bien hablar?',
  },
  {
    id: 'default-seguimiento',
    label: 'Seguimiento amable',
    body: 'Hola {nombre}, ¿qué tal? Te escribo para retomar el tema del {producto}. ¿Tienes algún momento esta semana?',
  },
  {
    id: 'default-recordatorio-pago',
    label: 'Recordatorio de pago',
    body: 'Hola {nombre}, te recuerdo que está pendiente el pago de la cuota de tu programa. Cualquier duda me avisas. Gracias.',
  },
];

export interface WhatsappTemplate {
  id: string;
  label: string;
  body: string;
}

export interface WhatsappTemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  lead?: { id: number | string; nombre?: string | null; telefono?: string | null; producto_interes?: string | null } | null;
}

function loadTemplates(): WhatsappTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_TEMPLATES;
  } catch { return DEFAULT_TEMPLATES; }
}

function saveTemplates(t: WhatsappTemplate[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch {}
}

function fillTemplate(body: string, lead?: WhatsappTemplatesDialogProps['lead']): string {
  if (!body) return '';
  return body
    .replace(/\{nombre\}/g, lead?.nombre || 'amigo/a')
    .replace(/\{producto\}/g, lead?.producto_interes || 'nuestro programa');
}

function cleanPhone(p: string | null | undefined): string {
  return (p || '').replace(/[^\d]/g, '');
}

export default function WhatsappTemplatesDialog({ open, onClose, lead }: WhatsappTemplatesDialogProps) {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>(() => loadTemplates());
  const [activeId, setActiveId] = useState<string>('');
  const [editing, setEditing] = useState<WhatsappTemplate | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (open && !activeId && templates[0]) setActiveId(templates[0].id);
  }, [open, templates, activeId]);

  const active = useMemo(() => templates.find((t) => t.id === activeId) || templates[0], [templates, activeId]);
  const filledBody = useMemo(() => active ? fillTemplate(active.body, lead) : '', [active, lead]);
  const phone = cleanPhone(lead?.telefono);

  if (!open) return null;

  function copyToClipboard() {
    if (!filledBody) return;
    navigator.clipboard?.writeText(filledBody).then(
      () => toast({ title: 'Mensaje copiado al portapapeles' }),
      () => toast({ title: 'No se pudo copiar', variant: 'destructive' })
    );
  }

  function openWhatsApp() {
    if (!phone) {
      toast({ title: 'El lead no tiene teléfono', variant: 'destructive' });
      return;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(filledBody)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function addTemplate() {
    const id = `custom-${Date.now()}`;
    const t: WhatsappTemplate = { id, label: 'Nueva plantilla', body: 'Hola {nombre}, …' };
    const next = [...templates, t];
    setTemplates(next);
    saveTemplates(next);
    setActiveId(id);
    setEditing(t);
  }

  async function deleteTemplate(id: string) {
    if (id.startsWith('default-')) {
      toast({ title: 'No puedes borrar las plantillas por defecto', variant: 'destructive' });
      return;
    }
    if (!(await confirm({ title: 'Eliminar plantilla', message: '¿Eliminar esta plantilla?', tone: 'destructive', confirmLabel: 'Eliminar' }))) return;
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    saveTemplates(next);
    if (activeId === id) setActiveId(next[0]?.id || '');
  }

  function saveEdit() {
    if (!editing) return;
    const next = templates.map((t) => t.id === editing.id ? editing : t);
    setTemplates(next);
    saveTemplates(next);
    setEditing(null);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2"><WhatsappLogo size={20} weight="duotone" className="text-emerald-600 dark:text-emerald-400" /> Plantillas WhatsApp</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {lead?.nombre ? `Para enviar a ${lead.nombre}` : 'Sin lead seleccionado'} · usa {`{nombre}`} y {`{producto}`} como placeholders.
            </p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-0">
          <aside className="border-b sm:border-b-0 sm:border-r border-border overflow-y-auto p-2 max-h-48 sm:max-h-none">
            <div className="space-y-1">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setActiveId(t.id); setEditing(null); }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeId === t.id ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-muted/60'
                  }`}
                >
                  {t.label}
                </button>
              ))}
              <button
                onClick={addTemplate}
                className="w-full text-left px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 inline-flex items-center gap-1.5 transition-colors"
              >
                <Plus size={11} weight="bold" /> Nueva plantilla
              </button>
            </div>
          </aside>

          <main className="overflow-y-auto p-5 space-y-3">
            {!active ? (
              <p className="text-sm text-muted-foreground">Selecciona una plantilla.</p>
            ) : editing ? (
              <>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Título</label>
                  <input
                    type="text"
                    value={editing.label}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Mensaje</label>
                  <textarea
                    rows={6}
                    value={editing.body}
                    onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                    className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm outline-none focus:border-primary resize-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setEditing(null)} className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted">Cancelar</button>
                  <button onClick={saveEdit} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">Guardar plantilla</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{active.label}</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditing(active)}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >Editar</button>
                    {!active.id.startsWith('default-') && (
                      <button
                        onClick={() => deleteTemplate(active.id)}
                        title="Eliminar plantilla"
                        className="text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 p-1.5 rounded-md transition-colors"
                      >
                        <Trash size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm whitespace-pre-wrap leading-relaxed">
                  {filledBody}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
                  >
                    <Copy size={13} weight="bold" /> Copiar texto
                  </button>
                  <button
                    onClick={openWhatsApp}
                    disabled={!phone}
                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!phone ? 'El lead no tiene teléfono' : ''}
                  >
                    <WhatsappLogo size={13} weight="bold" /> Abrir WhatsApp
                  </button>
                  {phone && (
                    <span className="ml-auto text-xs text-muted-foreground inline-flex items-center gap-1">
                      <CheckCircle size={11} weight="fill" className="text-emerald-500" />
                      +{phone}
                    </span>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
