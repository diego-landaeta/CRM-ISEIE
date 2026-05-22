import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass, SquaresFour, Users, UserCheck, Package, Receipt,
  CurrencyEur, Calculator, ChartLineUp, Bell, Gear, UserCircle, Pulse,
  Envelope, EnvelopeOpen, Globe, FilePdf, ShieldCheck, GraduationCap,
  Calendar, TreeStructure, TextT, Lightning, ListNumbers, Megaphone,
  Wallet, Question, Power, Command,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';

const ITEMS = [
  // Navegación principal
  { id: 'dashboard',       label: 'Dashboard',                 to: '/dashboard',                    icon: SquaresFour,    group: 'Ir a' },
  { id: 'leads',           label: 'Prospectos',                to: '/leads',                        icon: Users,          group: 'Ir a' },
  { id: 'pipeline',        label: 'Pipeline',                  to: '/leads/pipeline',               icon: ChartLineUp,    group: 'Ir a' },
  { id: 'clients',         label: 'Clientes',                  to: '/clients',                      icon: UserCheck,      group: 'Ir a' },
  { id: 'products',        label: 'Productos',                 to: '/products',                     icon: Package,        group: 'Ir a' },
  { id: 'products-tree',   label: 'Productos por categoría',   to: '/products/tree',                icon: TreeStructure,  group: 'Ir a' },
  { id: 'matriculas',      label: 'Matrículas',                to: '/matriculas',                   icon: GraduationCap,  group: 'Ir a' },
  { id: 'sales',           label: 'Ventas',                    to: '/sales',                        icon: Receipt,        group: 'Ir a' },
  { id: 'commissions',     label: 'Comisiones',                to: '/commissions',                  icon: CurrencyEur,    group: 'Ir a' },
  { id: 'expenses',        label: 'Egresos',                   to: '/expenses',                     icon: Wallet,         group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'accounting',      label: 'Contabilidad',              to: '/accounting',                   icon: Calculator,     group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'payable',         label: 'Cuentas por pagar',         to: '/accounting/payable',           icon: Calculator,     group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'payroll',         label: 'Nóminas',                   to: '/payroll',                      icon: CurrencyEur,    group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'documents',       label: 'Documentos',                to: '/documentos',                   icon: FilePdf,        group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'forms',           label: 'Formularios',               to: '/forms',                        icon: Globe,          group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'make',            label: 'Make / Webhooks',           to: '/make-webhooks',                icon: Globe,          group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'wc',              label: 'WooCommerce',               to: '/woocommerce',                  icon: Globe,          group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'sequences',       label: 'Secuencias de email',       to: '/email-sequences',              icon: Envelope,       group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'templates',       label: 'Plantillas de email',       to: '/email-templates',              icon: EnvelopeOpen,   group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'reports',         label: 'Reportes',                  to: '/reports',                      icon: ChartLineUp,    group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'activity',        label: 'Actividad',                 to: '/activity',                     icon: Pulse,          group: 'Ir a' },
  { id: 'notifications',   label: 'Notificaciones',            to: '/notifications',                icon: Bell,           group: 'Ir a' },
  { id: 'roles',           label: 'Roles y usuarios',          to: '/roles',                        icon: ShieldCheck,    group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'fields',          label: 'Campos personalizados',     to: '/configuracion/campos',         icon: TextT,          group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'categories',      label: 'Categorías',                to: '/configuracion/categorias-arbol', icon: TreeStructure, group: 'Ir a' },
  { id: 'channels',        label: 'Canales',                   to: '/configuracion/canales',        icon: Megaphone,      group: 'Ir a' },
  { id: 'shortcuts',       label: 'Atajos rápidos',            to: '/configuracion/atajos',         icon: Lightning,      group: 'Ir a' },
  { id: 'doc-config',      label: 'Numeración documentos',     to: '/documentos/config',            icon: ListNumbers,    group: 'Ir a',  roles: ['admin', 'superadmin'] },
  { id: 'status',          label: 'Estado del sistema',        to: '/status',                       icon: Pulse,          group: 'Sistema' },
  { id: 'profile',         label: 'Mi cuenta',                 to: '/profile',                      icon: UserCircle,     group: 'Sistema' },
  { id: 'settings',        label: 'Configuración',             to: '/settings',                     icon: Gear,           group: 'Sistema' },
  { id: 'preferences',     label: 'Mis preferencias',          to: '/preferences',                  icon: Gear,           group: 'Sistema' },
  { id: 'manual',          label: 'Manual del CRM',            to: '/manual',                       icon: Question,       group: 'Sistema' },
  { id: 'soporte',         label: 'Soporte',                   to: '/soporte',                      icon: Question,       group: 'Sistema' },
  { id: 'income',          label: 'Ingresos',                  to: '/accounting/income',            icon: CurrencyEur,    group: 'Ir a', roles: ['admin', 'superadmin'] },
  { id: 'revenue',         label: 'Conversiones',              to: '/revenue',                      icon: Receipt,        group: 'Ir a', roles: ['admin', 'superadmin'] },
  { id: 'receivable',      label: 'Cuentas por cobrar',        to: '/accounting/receivable',        icon: Wallet,         group: 'Ir a', roles: ['admin', 'superadmin'] },
];

function normalize(s) {
  return (s || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export default function CommandPalette() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const role = user?.role || 'gestor';

  // Atajo global Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e) {
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey);
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const visible = ITEMS.filter((it) => !it.roles || it.roles.includes(role) || role === 'superadmin' || role === 'soporte');
    const items = visible.concat([
      { id: '__logout', label: 'Cerrar sesión', icon: Power, group: 'Acciones', action: 'logout' },
    ]);
    if (!q.trim()) return items;
    const needle = normalize(q);
    return items.filter((it) => normalize(it.label).includes(needle) || normalize(it.group).includes(needle));
  }, [q, role]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((it) => {
      const arr = map.get(it.group) || [];
      arr.push(it);
      map.set(it.group, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  // Mapa idx → item para navegación con flechas
  const flat = filtered;

  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(0);
  }, [flat.length, activeIdx]);

  // Scroll del item activo a la vista
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  async function runItem(it) {
    if (!it) return;
    setOpen(false);
    if (it.action === 'logout') {
      try { await logout(); } catch {}
      navigate('/login');
      return;
    }
    if (it.to) navigate(it.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(flat[activeIdx]);
    }
  }

  if (!open) return null;

  let runningIdx = 0;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <MagnifyingGlass size={16} weight="bold" className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar páginas, atajos, acciones…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Sin coincidencias para "{q}"
            </div>
          ) : (
            grouped.map(([groupLabel, items]) => (
              <div key={groupLabel} className="py-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {groupLabel}
                </div>
                {items.map((it) => {
                  const idx = runningIdx++;
                  const isActive = idx === activeIdx;
                  const Icon = it.icon;
                  return (
                    <button
                      key={it.id}
                      data-idx={idx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => runItem(it)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/60'
                      }`}
                    >
                      <Icon size={16} weight={isActive ? 'duotone' : 'regular'} className="flex-shrink-0" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {isActive && (
                        <kbd className="text-[9px] font-mono font-semibold px-1 py-0.5 rounded border border-primary/30 bg-primary/10">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground/70 bg-muted/30">
          <span className="inline-flex items-center gap-1.5">
            <Command size={10} /> + K  para abrir/cerrar
          </span>
          <span className="hidden sm:inline-flex items-center gap-2">
            <span>↑ ↓ navegar</span>
            <span>↵ seleccionar</span>
          </span>
        </div>
      </div>
    </div>
  );
}
