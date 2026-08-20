import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Users, Receipt, MagnifyingGlass, GraduationCap, X, Lightning,
} from '@phosphor-icons/react';

const ACTIONS = [
  {
    label: 'Buscar (Ctrl K)',
    icon: MagnifyingGlass,
    action: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })),
  },
  { label: 'Nuevo prospecto', icon: Users,        to: '/leads' },
  { label: 'Nueva venta',     icon: Receipt,      to: '/ventas' },
  { label: 'Nueva matrícula', icon: GraduationCap, to: '/matriculas' },
];

export default function ShortcutsFAB() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(a) {
    setOpen(false);
    if (a.action) a.action();
    else if (a.to) navigate(a.to);
  }

  return (
    <div ref={rootRef} className="fixed bottom-4 right-4 z-[70] lg:bottom-6 lg:right-6">
      {open && (
        <div className="absolute bottom-14 right-0 flex flex-col items-end gap-2 mb-1">
          {ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => run(a)}
              className="inline-flex items-center gap-2 h-10 pl-3 pr-4 rounded-full bg-card border border-border shadow-lg text-sm font-medium whitespace-nowrap hover:bg-muted transition-colors animate-in slide-in-from-bottom-2 fade-in duration-150"
            >
              <a.icon size={15} weight="duotone" className="text-primary flex-shrink-0" />
              <span className="whitespace-nowrap">{a.label}</span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Cerrar atajos' : 'Abrir atajos rápidos'}
        title="Atajos rápidos"
        className={`w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:bg-primary/90 transition-all ${open ? 'rotate-45' : ''}`}
      >
        {open ? <X size={18} weight="bold" /> : <Lightning size={18} weight="fill" />}
      </button>
    </div>
  );
}
