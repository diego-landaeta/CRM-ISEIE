import { useState, useRef, useEffect } from 'react';
import { Paperclip, User, Package } from '@phosphor-icons/react';

export type AttachType = 'lead' | 'product';

interface MenuItem {
  type: AttachType;
  label: string;
  icon: any;
  color: string;
  bg: string;
}

const ITEMS: MenuItem[] = [
     { type: 'lead', label: 'Prospecto', icon: User, color: 'text-info', bg: 'bg-info-soft' },
  { type: 'product', label: 'Producto', icon: Package, color: 'text-warning', bg: 'bg-warning-soft' },
];

interface Props {
  onSelect: (type: AttachType) => void;
}

export default function AttachMenu({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      {open && (
        <div className="absolute bottom-full mb-3 left-0 bg-card border border-border rounded-xl shadow-xl p-1.5 min-w-[170px] z-50">
          {ITEMS.map(item => (
            <button
              key={item.type}
              onClick={() => { onSelect(item.type); setOpen(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
            >
              <div className={`w-8 h-8 rounded-full ${item.bg} ${item.color} flex items-center justify-center flex-shrink-0`}>
                <item.icon size={16} weight="fill" />
              </div>
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 ${
          open ? 'text-primary bg-primary/10 rotate-45' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        title="Adjuntar"
      >
        <Paperclip size={20} weight="regular" />
      </button>
    </div>
  );
}
