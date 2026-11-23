import { useState, useRef, type KeyboardEvent } from 'react';
import { PaperPlaneRight, User, Package, X } from '@phosphor-icons/react';
import AttachMenu, { type AttachType } from './AttachMenu';
import LeadPicker from './LeadPicker';
import ProductPicker from './ProductPicker';

interface Attachment {
  type: 'lead' | 'product';
  id: number;
  label: string;
}

interface Props {
  onSend: (body: string, referencedLeadId?: number) => Promise<void>;
  onTyping?: () => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onTyping, disabled }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [activePicker, setActivePicker] = useState<AttachType | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSend(trimmed, attachment?.type === 'lead' ? attachment.id : undefined);
      setText('');
      setAttachment(null);
      if (ref.current) ref.current.style.height = 'auto';
      ref.current?.focus();
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleChange(value: string) {
    setText(value);
    onTyping?.();
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function handleAttachSelect(type: AttachType) {
    if (type === 'lead' || type === 'product') {
      setActivePicker(type);
    }
  }

  const AttachIcon = attachment?.type === 'lead' ? User : Package;

  return (
    <div className="relative border-t border-border bg-card/80 backdrop-blur-sm">
      {/* Pickers centrados */}
      <LeadPicker
        open={activePicker === 'lead'}
        onSelect={(lead) => {
          setAttachment({ type: 'lead', id: lead.id, label: lead.nombre });
          setActivePicker(null);
          ref.current?.focus();
        }}
        onClose={() => setActivePicker(null)}
      />
      <ProductPicker
        open={activePicker === 'product'}
        onSelect={(product) => {
          setAttachment({ type: 'product', id: product.id, label: product.nombre });
          setActivePicker(null);
          ref.current?.focus();
        }}
        onClose={() => setActivePicker(null)}
      />

      {/* Adjunto preview */}
      {attachment && (
        <div className="flex items-center justify-center py-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
            <AttachIcon size={14} weight="fill" />
            {attachment.label}
            <button onClick={() => setAttachment(null)} className="ml-1 hover:text-destructive">
              <X size={12} weight="bold" />
            </button>
          </span>
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3">
        <AttachMenu onSelect={handleAttachSelect} />
        <textarea
          ref={ref}
          value={text}
          onChange={e => handleChange(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Escribe un mensaje"
          disabled={disabled || sending}
          rows={1}
          className="flex-1 resize-none rounded-xl bg-muted/40 border border-border/50 px-4 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 min-h-[36px]"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending || disabled}
          title="Enviar (Enter)"
          className="flex-shrink-0 w-9 h-9 rounded-full bg-success hover:bg-success/90 disabled:bg-muted disabled:text-muted-foreground text-success-foreground flex items-center justify-center transition-colors"
        >
          <PaperPlaneRight size={18} weight="fill" />
        </button>
      </div>
    </div>
  );
}
