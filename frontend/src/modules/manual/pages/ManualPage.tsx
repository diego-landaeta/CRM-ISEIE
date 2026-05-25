import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import {
  BookOpen, SquaresFour, Users, UserCheck, Package, Megaphone,
  MagnifyingGlass, Robot, Sparkle, Calculator, Gear, ArrowRight,
  ChartLineUp, GraduationCap, Globe, Envelope, Coins, CurrencyEur,
  Receipt, Wallet, CaretRight, Keyboard, Warning, CheckCircle, Info,
  Export, Bell, FileText, Link, WhatsappLogo, CalendarCheck,
  ArrowsDownUp, DownloadSimple, Trash, UserPlus, LockKey,
  ShieldCheck, WebhooksLogo, Tag, ToggleRight, Upload, Eye,
  MagnifyingGlass as Search, Command, Lightning,
  PlugsConnected, CalendarBlank,
} from '@phosphor-icons/react';

/* ─── Navigation ──────────────────────────────────────────── */
const SECTIONS = [
  { id: 'introduccion', label: 'Introducción', icon: BookOpen },
  { id: 'dashboard',    label: 'Dashboard',    icon: SquaresFour },
  { id: 'prospectos',   label: 'Prospectos',   icon: Users },
  { id: 'clientes',     label: 'Clientes',     icon: UserCheck },
  { id: 'productos',    label: 'Productos',    icon: Package },
  { id: 'matriculas',   label: 'Matrículas',   icon: GraduationCap },
  { id: 'campanas',     label: 'Campañas',     icon: Megaphone },
  { id: 'seo',          label: 'Tráfico orgánico', icon: MagnifyingGlass },
  { id: 'ia',           label: 'IA y Reportes', icon: Robot },
  { id: 'contabilidad', label: 'Contabilidad', icon: Calculator },
  { id: 'documentos',   label: 'Documentos',   icon: Receipt },
  { id: 'configuracion',label: 'Configuración',icon: Gear },
  { id: 'integraciones',label: 'Integraciones (Make)', icon: PlugsConnected },
  { id: 'disponibilidad',label: 'Disponibilidad',icon: CalendarBlank },
  { id: 'atajos',       label: 'Atajos',       icon: Keyboard },
];

/* ─── Primitives ──────────────────────────────────────────── */
// Asignamos un numero secuencial a cada seccion del manual — usado en
// SectionHeader y en el sidebar para dar sensacion editorial profesional.
const SECTION_NUMBER: Record<string, string> = SECTIONS.reduce((acc, s, i) => {
  acc[s.id] = String(i + 1).padStart(2, '0');
  return acc;
}, {} as Record<string, string>);

function SectionHeader({ id, icon: Icon, label, description }: {
  id: string;
  icon: React.ElementType;
  label: string;
  /** Aceptado por compat — actualmente se ignora; el diseno usa un solo acento. */
  color?: string;
  description?: string;
}) {
  const num = SECTION_NUMBER[id] || '';
  return (
    <header id={id} className="scroll-mt-6 mt-16 mb-6 first:mt-2">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-[11px] font-mono font-semibold tracking-widest text-primary/70">{num}</span>
        <span className="h-px flex-1 bg-border" />
        <Icon size={14} weight="duotone" className="text-muted-foreground" />
      </div>
      <h2 className="text-3xl font-bold tracking-tight text-foreground leading-tight">{label}</h2>
      {description && (
        <p className="text-[15px] text-muted-foreground mt-2 max-w-2xl leading-relaxed">{description}</p>
      )}
    </header>
  );
}

function SubHeader({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-4 text-base font-semibold text-foreground mt-8 mb-3 tracking-tight">
      {children}
    </h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[14.5px] text-muted-foreground leading-7 mb-3">{children}</p>;
}

function FeatureGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">{children}</div>;
}

function FeatureCard({ icon: Icon, title, children }: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  /** Aceptado por compat; ignorado para uniformidad visual. */
  color?: string;
}) {
  return (
    <div className="group rounded-xl border border-border bg-card hover:border-primary/30 transition-colors p-4">
      {Icon && (
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-7 h-7 rounded-lg bg-muted/60 flex items-center justify-center group-hover:bg-primary/10 transition-colors">
            <Icon size={13} weight="duotone" className="text-foreground/70 group-hover:text-primary transition-colors" />
          </div>
          <span className="text-[13px] font-semibold text-foreground tracking-tight">{title}</span>
        </div>
      )}
      {!Icon && title && <p className="text-[13px] font-semibold text-foreground mb-1.5 tracking-tight">{title}</p>}
      <p className="text-[13px] text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

type Step = string | { title: string; desc: string };
function Steps({ items }: { items: Step[] }) {
  return (
    <ol className="my-5 space-y-1 relative">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} className="flex gap-4 items-start relative pb-4">
            {!last && <span aria-hidden className="absolute left-[13px] top-7 bottom-0 w-px bg-border" />}
            <div className="relative w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center flex-shrink-0 z-10 text-[12px] font-mono font-semibold text-foreground/70">
              {i + 1}
            </div>
            <div className="flex-1 pt-0.5">
              {typeof item === 'string'
                ? <p className="text-[14px] text-muted-foreground leading-relaxed">{item}</p>
                : <>
                    <p className="text-[14px] font-semibold text-foreground tracking-tight">{item.title}</p>
                    <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
                  </>
              }
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Callout({ type = 'info', children }: { type?: 'info' | 'warning' | 'success' | 'tip' | 'warn'; children: React.ReactNode }) {
  const cfg = {
    info: { icon: Info,        accent: 'border-l-blue-500',    ic: 'text-blue-500' },
    tip:  { icon: CheckCircle, accent: 'border-l-emerald-500', ic: 'text-emerald-500' },
    warn: { icon: Warning,     accent: 'border-l-amber-500',   ic: 'text-amber-500' },
  };
  const c = cfg[type];
  const Icon = c.icon;
  return (
    <aside className={`flex gap-3 p-4 my-4 rounded-r-lg bg-muted/30 border-l-4 ${c.accent}`}>
      <Icon size={16} className={`${c.ic} mt-0.5 flex-shrink-0`} weight="fill" />
      <p className="text-[13.5px] leading-relaxed text-foreground/85">{children}</p>
    </aside>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center px-2 py-0.5 rounded-md bg-card border border-border shadow-sm text-[11px] font-mono font-semibold text-foreground/80 mx-0.5">
      {children}
    </kbd>
  );
}

function StatusBadge({ label, color }: { label: string; color: string }) {
  const colors = {
    blue:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    sky:    'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    amber:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    red:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    green:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    gray:   'bg-muted text-muted-foreground',
    indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${colors[color]}`}>
      {label}
    </span>
  );
}

/* ─── Main component ──────────────────────────────────────── */
export default function ManualPage() {
  const [activeId, setActiveId] = useState('introduccion');
  const contentRef = useRef(null);

  function scrollTo(id) {
    const el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActiveId(id); }
  }

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting);
        if (vis.length > 0) setActiveId(vis[0].target.id);
      },
      { rootMargin: '-8% 0px -72% 0px', threshold: 0 }
    );
    const hs = contentRef.current?.querySelectorAll('[id]') || [];
    hs.forEach(h => obs.observe(h));
    return () => obs.disconnect();
  }, []);

  // Agrupacion editorial del sidebar — 3 categorias semantica claras.
  const NAV_GROUPS: { label: string; ids: string[] }[] = [
    { label: 'Empezar',    ids: ['introduccion', 'dashboard', 'atajos'] },
    { label: 'Operación',  ids: ['prospectos', 'clientes', 'productos', 'matriculas'] },
    { label: 'Análisis',   ids: ['campanas', 'seo', 'ia'] },
    { label: 'Sistema',    ids: ['contabilidad', 'documentos', 'configuracion'] },
  ];

  return (
    <div className="flex gap-10 max-w-[1240px] pb-24">

      {/* ── Sidebar ── */}
      <aside className="hidden lg:block w-56 flex-shrink-0">
        <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto pr-2">
          <p className="text-[10px] font-mono font-semibold tracking-[0.18em] uppercase text-muted-foreground/70 px-2 mb-4">
            Manual · v0.1
          </p>
          <nav className="space-y-5">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 mb-2">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.ids.map(id => {
                    const s = SECTIONS.find(x => x.id === id);
                    if (!s) return null;
                    const active = activeId === s.id;
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => scrollTo(s.id)}
                        className={`w-full flex items-center gap-3 pl-2 pr-2 py-1.5 rounded-md text-[13px] transition-all text-left ${
                          active
                            ? 'text-foreground font-semibold bg-muted'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className={`text-[10px] font-mono w-6 text-right tabular-nums ${active ? 'text-primary' : 'text-muted-foreground/60'}`}>
                          {SECTION_NUMBER[s.id]}
                        </span>
                        <span className="truncate">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* ── Content ── */}
      <main ref={contentRef} className="flex-1 min-w-0">

        {/* Hero — minimalista editorial */}
        <header className="mb-14 pt-2">
          <div className="flex items-center gap-2 mb-6">
            <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-primary">Documentación</span>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[11px] font-mono text-muted-foreground/70 tabular-nums">v0.1 · Beta</span>
          </div>
          <h1 className="text-[44px] sm:text-[52px] font-bold tracking-tight leading-[1.05] text-foreground">
            Manual de usuario.
          </h1>
          <p className="text-lg text-muted-foreground mt-4 max-w-2xl leading-relaxed">
            Guía completa de MultiCRM. Todos los módulos, flujos y atajos en un único sitio,
            organizados para que encuentres lo que buscas en menos de 30 segundos.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {[
              { id: 'prospectos',   label: 'Empezar con prospectos' },
              { id: 'documentos',   label: 'Emitir factura' },
              { id: 'configuracion',label: 'Crear un usuario' },
              { id: 'atajos',       label: 'Atajos de teclado' },
            ].map(q => (
              <button
                type="button"
                key={q.id}
                onClick={() => scrollTo(q.id)}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-border bg-card hover:border-primary/40 hover:bg-muted/50 transition-colors text-[12.5px] text-foreground/80"
              >
                {q.label}
                <ArrowRight size={11} weight="bold" className="text-muted-foreground" />
              </button>
            ))}
          </div>

          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-0 border-y border-border divide-x divide-border">
            {[
              { kpi: '13', label: 'módulos' },
              { kpi: '3',  label: 'roles' },
              { kpi: '∞',  label: 'proyectos' },
              { kpi: '15+', label: 'atajos' },
            ].map(item => (
              <div key={item.label} className="px-4 py-4 first:pl-0">
                <div className="text-2xl font-bold tabular-nums tracking-tight">{item.kpi}</div>
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/70 mt-0.5">{item.label}</div>
              </div>
            ))}
          </div>
        </header>

        {/* ── INTRODUCCIÓN ── */}
        <SectionHeader id="introduccion" icon={BookOpen} label="Introducción" color="blue"
          description="¿Qué es MultiCRM y cómo está organizado?" />
        <P>
          MultiCRM es un CRM interno multi-proyecto para gestionar el ciclo completo de ventas:
          captación de prospectos, conversión, cobro y análisis de campañas. Cada usuario pertenece
          a uno o más proyectos que se seleccionan en el desplegable del menú lateral.
        </P>

        <SubHeader id="roles">Roles de acceso</SubHeader>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 my-3">
          {[
            { role: 'Superadmin', color: 'violet', desc: 'Acceso total al sistema. Crea y desactiva usuarios, ve todos los proyectos y toda la configuración.', icon: ShieldCheck },
            { role: 'Admin', color: 'blue', desc: 'Acceso operativo completo dentro de sus proyectos. Puede crear usuarios pero no gestionarlos globalmente.', icon: LockKey },
            { role: 'Gestor', color: 'gray', desc: 'Solo ve sus proyectos asignados. En prospectos, gestiona únicamente los leads asignados a él.', icon: Users },
          ].map(r => {
            const borderColors = { violet: 'border-violet-200 dark:border-violet-900', blue: 'border-blue-200 dark:border-blue-900', gray: 'border-border' };
            const bgColors = { violet: 'bg-violet-50/60 dark:bg-violet-950/20', blue: 'bg-blue-50/60 dark:bg-blue-950/20', gray: 'bg-muted/40' };
            return (
              <div key={r.role} className={`rounded-xl border p-4 ${borderColors[r.color]} ${bgColors[r.color]}`}>
                <div className="flex items-center gap-2 mb-2">
                  <StatusBadge label={r.role} color={r.color} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{r.desc}</p>
              </div>
            );
          })}
        </div>
        <Callout type="tip">
          Si no ves alguna sección en el menú, tu rol no tiene acceso o el módulo está desactivado para ese proyecto.
          Un Admin puede habilitarlo en Configuración → Proyecto → Módulos.
        </Callout>

        {/* ── DASHBOARD ── */}
        <SectionHeader id="dashboard" icon={SquaresFour} label="Dashboard" color="violet"
          description="Vista general del proyecto: KPIs, tareas del día y pipeline" />
        <P>La pantalla principal con una visión de 360° del estado del proyecto en tiempo real.</P>

        <SubHeader>KPIs principales</SubHeader>
        <FeatureGrid>
          <FeatureCard icon={Users} title="Total prospectos" color="blue">
            Suma de todos los leads del proyecto activos e inactivos.
          </FeatureCard>
          <FeatureCard icon={Lightning} title="Nuevos" color="orange">
            Prospectos en estado «Nuevo» o «Por contactar» pendientes de gestión.
          </FeatureCard>
          <FeatureCard icon={CheckCircle} title="Convertidos" color="green">
            Prospectos que han llegado a estado «Convertido» con compra registrada.
          </FeatureCard>
          <FeatureCard icon={ChartLineUp} title="Tasa de conversión" color="violet">
            Porcentaje de convertidos sobre el total de prospectos del proyecto.
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>Panel «Tu día de hoy»</SubHeader>
        <P>Resumen de tareas urgentes que aparece en la parte superior del dashboard:</P>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-3">
          {[
            { icon: Bell, label: 'Pendientes', desc: 'Recordatorios vencidos hoy', color: 'text-orange-500' },
            { icon: Users, label: 'Nuevos hoy', desc: 'Prospectos llegados hoy y esta semana', color: 'text-blue-500' },
            { icon: Warning, label: 'Inactivos', desc: 'Sin actividad reciente, necesitan contacto', color: 'text-amber-500' },
            { icon: Receipt, label: 'Cobros vencidos', desc: 'Pagos atrasados en cuentas por cobrar', color: 'text-red-500' },
            { icon: CurrencyEur, label: 'Ingresos hoy', desc: 'Importe cobrado en el día actual', color: 'text-emerald-500' },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex gap-2.5 p-3 rounded-lg border border-border bg-card">
                <Icon size={16} className={`${item.color} flex-shrink-0 mt-0.5`} weight="duotone" />
                <div>
                  <p className="text-xs font-bold text-foreground">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
        <Callout type="warn">
          Los recordatorios vencidos aparecen marcados en rojo. Resuélvelos antes de que se acumulen —
          haz clic en cualquiera para ir directamente a la ficha del prospecto.
        </Callout>

        {/* ── PROSPECTOS ── */}
        <SectionHeader id="prospectos" icon={Users} label="Prospectos" color="emerald"
          description="El núcleo del CRM — gestión completa del funnel de ventas" />

        <SubHeader>Lista y filtros</SubHeader>
        <FeatureGrid>
          <FeatureCard icon={Search} title="Búsqueda" color="blue">
            Filtra por nombre, email o teléfono en tiempo real.
          </FeatureCard>
          <FeatureCard icon={Tag} title="Estado" color="violet">
            Nuevo · Por contactar · Contactado · En seguimiento · Convertido · No interesado
          </FeatureCard>
          <FeatureCard icon={Megaphone} title="Canal de origen" color="orange">
            Meta Ads · Google Ads · TikTok Ads · Orgánico · ChatGPT IA · Referido · Directo
          </FeatureCard>
          <FeatureCard icon={Users} title="Responsable" color="green">
            Filtra por gestor asignado (solo Admin/Superadmin).
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>Vista pipeline</SubHeader>
        <P>
          Accesible desde el botón «Pipeline» en la cabecera. Muestra columnas Kanban por estado.
          Arrastra las tarjetas para cambiar el estado — los cambios se guardan al instante.
        </P>

        <SubHeader>Ficha del prospecto</SubHeader>
        <P>Haz clic en cualquier prospecto para abrir su ficha completa con 6 paneles:</P>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 my-3">
          {[
            { icon: FileText, title: 'Datos personales', desc: 'Nombre, email, teléfono, origen, estado y responsable. Editables con el botón «Editar»', color: 'blue' },
            { icon: Tag, title: 'UTMs y campaña', desc: 'Parámetros de seguimiento del tráfico (utm_source, utm_medium, utm_campaign…)', color: 'violet' },
            { icon: ChartLineUp, title: 'Timeline', desc: 'Historial cronológico de llamadas, emails, WhatsApp y notas del equipo', color: 'emerald' },
            { icon: CalendarCheck, title: 'Recordatorios', desc: 'Seguimientos programados con fecha y nota. Aparecen en el Dashboard del día', color: 'orange' },
            { icon: CurrencyEur, title: 'Conversiones', desc: 'Productos comprados, importes, pagos parciales y estado de cobro', color: 'green' },
            { icon: Package, title: 'Dossier', desc: 'Enlace temporal del PDF del producto para enviárselo al prospecto (15 min)', color: 'default' },
          ].map(item => {
            const Icon = item.icon;
            return <FeatureCard key={item.title} icon={Icon} title={item.title} color={item.color}>{item.desc}</FeatureCard>;
          })}
        </div>

        <SubHeader>Registrar una conversión</SubHeader>
        <Steps items={[
          { title: 'Cambia el estado a «Convertido»', desc: 'O usa el botón «+ Conversión» en la sección de conversiones de la ficha' },
          { title: 'Rellena el formulario', desc: 'Producto del catálogo, importe total, método de pago y fecha de venta' },
          { title: 'Registra pagos parciales', desc: 'Desde la conversión creada, usa «+ Pago» para ir añadiendo cobros. El sistema calcula el pendiente automáticamente' },
        ]} />

        <SubHeader>Acciones masivas</SubHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-3">
          {[
            { icon: Tag, label: 'Cambiar estado', color: 'text-blue-500' },
            { icon: UserPlus, label: 'Asignar gestor', color: 'text-violet-500' },
            { icon: DownloadSimple, label: 'Exportar CSV', color: 'text-emerald-500' },
            { icon: Trash, label: 'Eliminar', color: 'text-red-500' },
          ].map(a => {
            const Icon = a.icon;
            return (
              <div key={a.label} className="flex items-center gap-2 p-2.5 rounded-lg border border-border bg-card">
                <Icon size={14} className={a.color} weight="duotone" />
                <span className="text-xs font-semibold text-foreground">{a.label}</span>
              </div>
            );
          })}
        </div>
        <Callout type="info">
          Selecciona prospectos con los checkboxes de la tabla. Aparece la barra de acciones en la parte inferior.
        </Callout>

        <SubHeader>Crear audiencia para Meta</SubHeader>
        <P>
          En <strong>Prospectos → Crear audiencia</strong> exporta segmentos en formato CSV compatible
          con Meta Custom Audiences. Los emails se hashean con SHA-256 antes de exportar (requisito de Meta).
          Usa los presets (No convertidos, Convertidos, Solo pagado, Orgánico) o crea un filtro personalizado.
        </P>

        {/* ── CLIENTES ── */}
        <SectionHeader id="clientes" icon={UserCheck} label="Clientes" color="sky"
          description="Prospectos convertidos con historial de compras y estado de cobro" />
        <P>
          Vista enriquecida de todos los prospectos con estado «Convertido» y al menos una compra registrada.
        </P>
        <FeatureGrid>
          <FeatureCard icon={CurrencyEur} title="Financiero" color="green">
            Total facturado, total cobrado e importe pendiente por cliente.
          </FeatureCard>
          <FeatureCard icon={Package} title="Historial de compras" color="blue">
            Todos los productos comprados con fechas y método de pago.
          </FeatureCard>
        </FeatureGrid>
        <Callout type="tip">
          Para editar datos del cliente (email, teléfono…) ve a su ficha en Prospectos.
          Los clientes se sincronizan automáticamente con el prospecto.
        </Callout>

        {/* ── PRODUCTOS ── */}
        <SectionHeader id="productos" icon={Package} label="Productos" color="amber"
          description="Catálogo del proyecto con dossiers PDF versionados" />
        <P>Cada proyecto tiene su propio catálogo de productos con precios, categorías y materiales de venta.</P>
        <FeatureGrid>
          <FeatureCard icon={Package} title="Catálogo" color="orange">
            Crea, edita o archiva productos. Asigna categorías y subcategorías para organizarlos.
          </FeatureCard>
          <FeatureCard icon={FileText} title="Precio por defecto" color="blue">
            El precio del producto se autocompletará al registrar una conversión.
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>Dossiers PDF</SubHeader>
        <Steps items={[
          { title: 'Sube el PDF desde la ficha del producto', desc: 'Drag & drop o clic. Se guarda en almacenamiento privado.' },
          { title: 'El sistema guarda versiones', desc: 'Subir un nuevo PDF no elimina el anterior — el historial queda intacto.' },
          { title: 'Genera un enlace temporal desde la ficha del prospecto', desc: 'Válido 15 minutos. Cópialo y envíalo por WhatsApp o email.' },
        ]} />
        <Callout type="warn">
          Los enlaces de dossier caducan a los 15 minutos por seguridad. No los guardes en plantillas reutilizables —
          genera uno nuevo cada vez que necesites enviárselo a alguien.
        </Callout>

        {/* ── MATRÍCULAS ── */}
        <SectionHeader id="matriculas" icon={GraduationCap} label="Matrículas" color="indigo"
          description="Solicitudes de admisión para proyectos educativos" />
        <P>
          Módulo específico para gestionar el proceso de admisión de alumnos, desde la solicitud inicial hasta la validación.
        </P>
        <div className="flex flex-wrap gap-2 my-3">
          {[
            { label: 'Solicitud admisión', color: 'sky' },
            { label: 'Datos validados', color: 'indigo' },
            { label: 'Pendiente', color: 'amber' },
            { label: 'Validada', color: 'green' },
            { label: 'Rechazada', color: 'red' },
          ].map(s => <StatusBadge key={s.label} label={s.label} color={s.color} />)}
        </div>

        <SubHeader>Webhooks de admisión</SubHeader>
        <P>
          Las matrículas pueden llegar automáticamente desde formularios externos.
          En la pestaña «Webhooks de admisión» genera tokens, obtén el endpoint y configura tu formulario.
        </P>

        {/* ── CAMPAÑAS ── */}
        <SectionHeader id="campanas" icon={Megaphone} label="Campañas publicitarias" color="rose"
          description="Meta Ads + Google Ads sincronizados con datos reales del CRM" />
        <Callout type="info">
          Los datos se sincronizan automáticamente cada noche. Las APIs de Meta y Google tienen una
          latencia de 24-48h para datos consolidados — es normal ver datos del día anterior.
        </Callout>
        <FeatureGrid>
          <FeatureCard icon={Megaphone} title="Vista consolidada" color="violet">
            Gasto + clicks + prospectos CRM + CPA real unificados para Meta y Google en el período seleccionado.
          </FeatureCard>
          <FeatureCard icon={ChartLineUp} title="CPA real" color="orange">
            Coste por adquisición calculado con prospectos del CRM atribuidos por utm_campaign,
            no con conversiones de Meta/Google.
          </FeatureCard>
          <FeatureCard icon={Globe} title="Meta Ads" color="blue">
            KPIs por campaña: inversión, clicks, CPC, prospectos CRM y CPA real.
          </FeatureCard>
          <FeatureCard icon={Search} title="Google Ads" color="green">
            Igual que Meta, más tabla de keywords con clicks, impresiones, CTR y posición media.
          </FeatureCard>
        </FeatureGrid>

        {/* ── SEO ── */}
        <SectionHeader id="seo" icon={MagnifyingGlass} label="Tráfico orgánico (SEO)" color="teal"
          description="Google Search Console integrado directamente en el CRM" />
        <FeatureGrid>
          <FeatureCard icon={Search} title="Clicks e impresiones" color="blue">
            Visitas orgánicas reales desde Google y veces que el sitio apareció en resultados.
          </FeatureCard>
          <FeatureCard icon={ChartLineUp} title="CTR y posición media" color="green">
            Porcentaje de clics sobre impresiones y posición media global en los resultados.
          </FeatureCard>
          <FeatureCard icon={Tag} title="Top 20 keywords" color="violet">
            Las palabras clave con más clicks con su CTR y posición individual.
          </FeatureCard>
          <FeatureCard icon={Megaphone} title="Gráfica consolidada" color="orange">
            Evolución mensual de tráfico orgánico vs pagado vs prospectos CRM (12 meses).
          </FeatureCard>
        </FeatureGrid>
        <Callout type="warn">
          Los datos de GSC tienen un retraso de 2-3 días. La fecha de última actualización
          se muestra en el banner superior de la página.
        </Callout>

        {/* ── IA ── */}
        <SectionHeader id="ia" icon={Robot} label="IA y Reportes" color="violet"
          description="Dashboard Stripe para proyectos SaaS + reportes automáticos con Claude" />

        <SubHeader>Dashboard IA</SubHeader>
        <FeatureGrid>
          <FeatureCard icon={CurrencyEur} title="MRR" color="green">
            Ingresos mensuales recurrentes con evolución de los últimos 12 meses.
          </FeatureCard>
          <FeatureCard icon={Users} title="Suscripciones" color="blue">
            Usuarios con plan activo y churn rate mensual (tasa de cancelación).
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>Reportes CRM (datos)</SubHeader>
        <P>
          La página <strong>Reportes</strong> muestra los datos del CRM en el período seleccionado:
          KPIs (total prospectos, tasa conversión, ventas cobradas, por cobrar), pipeline por estado,
          ingresos mensuales, distribución por canal, rendimiento por gestor y top productos.
          Botón <strong>CSV</strong> exporta un archivo con todas las secciones; botón <strong>PDF</strong>
          genera un informe formateado (header con branding, KPIs, tablas) listo para imprimir o enviar.
        </P>

        <SubHeader>Reportes IA</SubHeader>
        <P>
          Genera informes mensuales de rendimiento con inteligencia artificial (Claude de Anthropic).
          El reporte analiza todos los datos del proyecto y produce un informe completo en markdown:
        </P>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 my-3">
          {['Resumen ejecutivo del mes', 'Análisis de prospectos por canal y estado',
            'Rendimiento campañas vs tráfico orgánico', 'Conversiones y facturación del período',
            'Recomendaciones de mejora', 'Exportación a PDF con un clic (markdown → PDF cliente-side)',
          ].map(item => (
            <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
              <CheckCircle size={13} className="text-emerald-500 flex-shrink-0" weight="fill" />
              {item}
            </div>
          ))}
        </div>

        {/* ── CONTABILIDAD ── */}
        <SectionHeader id="contabilidad" icon={Calculator} label="Contabilidad" color="emerald"
          description="Control financiero completo del proyecto" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 my-3">
          {[
            { icon: CurrencyEur, title: 'Ingresos', desc: 'Lista de conversiones con estado de cobro (facturado / cobrado / pendiente).', color: 'green' },
            { icon: Receipt, title: 'Egresos', desc: 'Gastos del proyecto con categorías, pagos parciales y filtros por fecha.', color: 'orange' },
            { icon: Wallet, title: 'Cuentas por cobrar', desc: 'Conversiones con importe pendiente. Las vencidas se destacan en rojo.', color: 'blue' },
            { icon: Receipt, title: 'Cuentas por pagar', desc: 'Egresos pendientes de pago con fecha de vencimiento y alertas.', color: 'violet' },
            { icon: Coins, title: 'Comisiones', desc: 'Cálculo automático de comisiones por ventas para cada gestor.', color: 'orange' },
            { icon: FileText, title: 'Nóminas', desc: 'Generación de períodos: salario fijo + horas extra + comisiones.', color: 'default' },
          ].map(item => {
            const Icon = item.icon;
            return <FeatureCard key={item.title} icon={Icon} title={item.title} color={item.color}>{item.desc}</FeatureCard>;
          })}
        </div>
        <Callout type="tip">
          Los registros de «Cuentas por cobrar» se crean automáticamente al registrar una conversión.
          No necesitas duplicar el trabajo — solo registra la conversión desde la ficha del prospecto.
        </Callout>

        {/* ── DOCUMENTOS ── */}
        <SectionHeader id="documentos" icon={Receipt} label="Documentos" color="rose"
          description="Facturas y certificados emitidos en PDF, pixel-perfect del template original" />
        <P>
          Genera facturas y certificados en PDF directamente desde el CRM, sin depender de Canva o
          herramientas externas. Cada documento se numera secuencialmente por proyecto y queda
          archivado con auditoría fiscal completa.
        </P>

        <SubHeader>Crear factura</SubHeader>
        <Steps items={[
          { title: 'Datos del cliente', desc: 'Busca por nombre/email para autocompletar desde tu base de prospectos. DNI/NIF y fecha son obligatorios.' },
          { title: 'Líneas de la factura', desc: 'Añade cuantas líneas necesites con descripción, cantidad y precio. Puedes elegir productos del catálogo para autocompletar precios.' },
          { title: 'IVA exento o aplicable', desc: 'Por defecto, exento (Art. 20.1.9° LIVA — servicios educativos). Desactiva el toggle para introducir un % de IVA aplicable.' },
          { title: 'Vista previa o generar', desc: 'Vista previa renderiza la factura sin numerarla. Generar la emite, descarga el PDF y avanza el contador.' },
        ]} />

        <SubHeader>Facturas con muchas líneas (multi-página)</SubHeader>
        <P>
          Hasta 22 líneas, la factura cabe en una sola página con el layout pixel-perfect del Canva.
          A partir de 23 líneas, el sistema cambia automáticamente a layout multi-página: la cabecera de
          la tabla (DESCRIPCIÓN · CANTIDAD · PRECIO · TOTAL) se repite en cada página, el footer rosa-palo
          con LOPD aparece en cada página, y el sello + totales quedan fijados en una página final dedicada.
        </P>

        <SubHeader>Crear certificado de finalización</SubHeader>
        <Steps items={[
          { title: 'Datos del alumno', desc: 'Nombre completo, DNI/NIE y email (opcional para envío automático).' },
          { title: 'Datos del curso', desc: 'Nombre del diplomado, horas totales, fecha inicio, fecha fin y fecha de expedición. Las fechas se introducen en formato natural ("7 de mayo de 2026") con calendario integrado.' },
          { title: 'Plan de estudios', desc: 'Lista de módulos del curso (página 2 del certificado). Añade los que apliquen.' },
          { title: 'Generar', desc: 'Se descarga un PDF con dos páginas A4 horizontales — diploma + plan de estudios. La línea de firma del alumno queda vacía para firma manual.' },
        ]} />

        <Callout type="tip">
          Los datos fijos del emisor (ISEIE Innovation School S.L.: razón social, NIF, dirección) y del certificado
          (Director, Responsable de Formación, modalidad, ciudad) se guardan como predeterminados.
          Solo necesitas cambiarlos si emites para otra entidad.
        </Callout>

        <SubHeader>Numeración automática</SubHeader>
        <P>
          Cada proyecto tiene contadores independientes para facturas (FAC-2026-0001) y certificados
          (CERT-2026-0001). El siguiente número aparece en el formulario antes de generar — puedes
          editarlo manualmente si necesitas saltar o retroceder (la numeración continúa desde el valor
          que pongas).
        </P>

        <SubHeader>Configuración avanzada</SubHeader>
        <P>
          En <strong>Configuración → Numeración docs</strong> (solo SA/Admin) tienes el panel de
          administración cross-proyecto:
        </P>
        <FeatureGrid>
          <FeatureCard icon={Receipt} title="Editar contadores" color="orange">
            Cambia el próximo número de cualquier proyecto. Útil al migrar desde otro sistema o
            recuperar numeración.
          </FeatureCard>
          <FeatureCard icon={Envelope} title="Email automático" color="green">
            Toggle por proyecto. Si está activo, al generar una factura/certificado se envía
            automáticamente al cliente/alumno con el PDF adjunto vía Brevo.
          </FeatureCard>
          <FeatureCard icon={ChartLineUp} title="Histograma 12 meses" color="blue">
            Gráfica de documentos emitidos en los últimos 12 meses por tipo (facturas vs certificados).
          </FeatureCard>
          <FeatureCard icon={ShieldCheck} title="Audit log fiscal" color="violet">
            Cada generación, descarga, regeneración, eliminación y envío queda registrado con usuario, IP
            y user-agent (requisito Hacienda).
          </FeatureCard>
        </FeatureGrid>

        <Callout type="warn">
          Una vez generado el PDF, el documento queda guardado y la numeración avanza. Si necesitas
          regenerar el PDF (ej. cambio en la plantilla), usa <strong>Regenerar</strong> desde la lista —
          mantiene el mismo número. La eliminación es irreversible y rompe la secuencia legal.
        </Callout>

        {/* ── CONFIGURACIÓN ── */}
        <SectionHeader id="configuracion" icon={Gear} label="Configuración" color="orange"
          description="Gestión de usuarios, proyectos, módulos, API keys y webhooks" />
        <Callout type="info">Solo accesible para roles Admin y Superadmin.</Callout>

        <SubHeader>Crear un nuevo usuario</SubHeader>
        <Steps items={[
          { title: 'Rellena nombre, email y rol', desc: 'Elige Admin o Gestor. El Superadmin no se puede crear desde el panel.' },
          { title: 'Asigna proyectos', desc: 'El usuario solo verá los proyectos que le asignes.' },
          { title: 'El usuario recibe el email de bienvenida', desc: 'Brevo envía automáticamente un enlace para que establezca su contraseña. El enlace caduca en 48h.' },
        ]} />

        <SubHeader>Configuración del proyecto</SubHeader>
        <FeatureGrid>
          <FeatureCard icon={Globe} title="Identidad" color="blue">
            Nombre, emoji o logo del proyecto. El logo se muestra en el selector del sidebar.
          </FeatureCard>
          <FeatureCard icon={Sparkle} title="Color de marca" color="violet">
            Hex personalizado por proyecto (ej. #3b82f6). Se aplica al sidebar, botones y acentos al
            activar el proyecto. Vacío = color por defecto del CRM.
          </FeatureCard>
          <FeatureCard icon={ToggleRight} title="Módulos activos" color="green">
            Activa o desactiva Leads, Matrículas, Contabilidad, Documentos, etc. Solo aparecen en el menú
            los módulos habilitados.
          </FeatureCard>
          <FeatureCard icon={LockKey} title="API keys" color="violet">
            Credenciales de Meta Ads, Google Ads, Stripe, GSC, Brevo encriptadas con AES-256. Validación
            real al pulsar «Probar» (Google Ads valida el refresh_token contra OAuth2 de Google).
          </FeatureCard>
          <FeatureCard icon={Tag} title="Campos personalizados" color="orange">
            Añade campos extra a la ficha del prospecto (texto, número, fecha, lista, sí/no). Agrúpalos por sección.
          </FeatureCard>
          <FeatureCard icon={Envelope} title="Email automático docs" color="green">
            Toggle desde «Configuración → Numeración docs» que activa el envío automático de facturas y
            certificados al cliente al generarse.
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>Webhook de leads</SubHeader>
        <div className="my-3 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Globe size={16} weight="duotone" className="text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Endpoint</p>
              <code className="text-[11px] text-muted-foreground">POST /api/leads/webhook</code>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <LockKey size={16} weight="duotone" className="text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Autenticación</p>
              <code className="text-[11px] text-muted-foreground">Header: X-API-Key: &lt;clave_del_proyecto&gt;</code>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileText size={16} weight="duotone" className="text-primary" />
            </div>
            <div>
              <p className="text-xs font-bold text-foreground">Campos</p>
              <code className="text-[11px] text-muted-foreground">nombre, email, telefono, canal, utm_source, utm_medium, utm_campaign</code>
            </div>
          </div>
        </div>
        <Callout type="tip">
          El lead se asigna por round-robin automático al gestor con menos carga del proyecto.
          La respuesta del webhook es menor de 500ms — el email de notificación al gestor se envía de forma asíncrona.
        </Callout>

        {/* ── INTEGRACIONES (MAKE) ── */}
        <SectionHeader id="integraciones" icon={PlugsConnected} label="Integraciones (Make)" color="violet"
          description="Cómo conectar tu escenario de Make para que mande leads al CRM con todos los datos, incluido a quién asignárselo" />

        <Callout type="info">
          Esta sección asume que ya tienes un escenario en Make que recibe emails / formularios, filtra spam y mapea los campos.
          Aquí solo añadiremos el paso final: <strong>POST al CRM</strong> con los datos limpios.
        </Callout>

        <SubHeader>1. Obtener el API key del proyecto</SubHeader>
        <Steps items={[
          { title: 'Abre Configuración → Webhooks', desc: 'Acceso desde el sidebar (sólo Admin/Superadmin).' },
          { title: 'Copia URL y API key', desc: 'Verás la URL del webhook y el API key. Copia ambos — los pegarás en Make. Si necesitas regenerar la key, hay un botón "Regenerar" (invalida la anterior).' },
        ]} />

        <SubHeader>2. Añadir el módulo HTTP en Make</SubHeader>
        <Steps items={[
          { title: 'Abre tu escenario en Make', desc: 'Al final del flujo (después del Router que filtra spam y mapea los campos JSON).' },
          { title: 'Añade un módulo «HTTP → Make a request»', desc: 'En la rama "no es spam". Es el módulo del icono naranja.' },
          { title: 'URL', desc: 'Pega la URL del webhook que copiaste. Tiene esta forma: https://crm.iseih.com/api/leads/webhooks/{slug-del-proyecto}' },
          { title: 'Method', desc: 'POST' },
          { title: 'Headers (añade 2)', desc: 'Authorization: Bearer TU_API_KEY  ·  Content-Type: application/json' },
          { title: 'Body type', desc: 'Raw' },
          { title: 'Content type', desc: 'JSON (application/json)' },
          { title: 'Parse response', desc: 'Yes — así Make podrá ramificar según el lead_id devuelto.' },
        ]} />

        <SubHeader>3. Pegar el JSON del body</SubHeader>
        <p className="text-xs text-muted-foreground mb-2">
          En «Request content» pega este JSON y reemplaza los <code className="px-1 rounded bg-muted">{`{{...}}`}</code> por los placeholders de tu escenario.
          El módulo que mapea los campos suele estar 1 o 2 antes del HTTP — Make te lo deja arrastrar.
        </p>
        <pre className="my-3 p-3 rounded-lg bg-zinc-950 text-zinc-100 text-[11px] leading-relaxed overflow-x-auto">
{`{
  "nombre": "{{2.nombre}}",
  "email": "{{2.email}}",
  "telefono": "{{2.telefono}}",
  "producto_interes": "{{2.programa_interes}}",
  "canal": "directo",
  "responsable_email": "{{2.gestor_asignado_email}}",
  "notas": "{{2.mensaje_original}}",
  "idempotency_key": "{{1.headers.\`message-id\`}}",
  "custom_fields": {
    "spam_score": "{{2.spam_score}}",
    "scenario": "Psiko Contestacion Auto"
  }
}`}
        </pre>

        <SubHeader>4. Cómo decidir el gestor desde Make</SubHeader>
        <p className="text-xs text-muted-foreground mb-2">
          El campo <code className="px-1 rounded bg-muted">responsable_email</code> es <strong>opcional</strong>.
          Si lo mandas, el CRM asigna directo a ese gestor (saltando round-robin). Si lo omites, aplica round-robin respetando disponibilidad. Tres formas de hacerlo:
        </p>
        <FeatureGrid>
          <FeatureCard icon={Robot} title="Lo decide tu GPT mapeador" color="violet">
            En el prompt del módulo "json con campos mapeados" añade reglas como:
            <em> "si el programa contiene 'TEPT' → responsable_email='dayana@iseih.com'; si es 'Neuromodulación' → 'ana@iseih.com'"</em>. El GPT devuelve el campo y Make lo pasa al HTTP.
          </FeatureCard>
          <FeatureCard icon={ArrowsDownUp} title="Router de Make" color="blue">
            Crea ramas según el contenido (idioma, programa, país, hora). Cada rama setea su propio <code>responsable_email</code> antes del HTTP.
          </FeatureCard>
          <FeatureCard icon={UserPlus} title="No lo asignas" color="green">
            Omites el campo. El CRM aplica round-robin entre gestores activos y disponibles del proyecto.
          </FeatureCard>
        </FeatureGrid>

        <SubHeader>5. Campos que acepta el webhook</SubHeader>
        <div className="rounded-xl border border-border overflow-hidden my-3">
          {[
            { name: 'nombre',              req: 'sí', desc: 'Nombre del lead.' },
            { name: 'email',               req: '*',  desc: 'Email del lead. Opcional si hay teléfono.' },
            { name: 'telefono',            req: '*',  desc: 'Teléfono. Opcional si hay email. Hace falta al menos uno de los dos.' },
            { name: 'producto_interes',    req: 'no', desc: 'Nombre del producto. Se busca en el catálogo del proyecto.' },
            { name: 'producto_interes_id', req: 'no', desc: 'Id del producto si lo conoces (más fiable que por nombre).' },
            { name: 'canal',               req: 'no', desc: 'meta_ads · google_ads · tiktok_ads · whatsapp · organico · chatgpt_ia · referido · directo. Si no viene, se detecta por UTMs.' },
            { name: 'responsable_email',   req: 'no', desc: 'Email del gestor a quien asignar. Saltea round-robin.' },
            { name: 'responsable_id',      req: 'no', desc: 'Id del gestor (alternativa al email; si vienen los dos, prioriza id).' },
            { name: 'idempotency_key',     req: 'no', desc: 'Clave única para que los reintentos de Make no dupliquen. Muy recomendado.' },
            { name: 'custom_fields',       req: 'no', desc: 'Objeto JSON con cualquier dato extra (spam_score, scenario, fuente…).' },
            { name: 'notas',               req: 'no', desc: 'Texto libre, máx 2000 caracteres.' },
            { name: 'landing_url',         req: 'no', desc: 'URL de la página de origen.' },
            { name: 'utm_source / utm_medium / utm_campaign / utm_content / utm_term', req: 'no', desc: 'Tracking de campaña.' },
          ].map((row, i) => (
            <div key={i} className={`grid grid-cols-[180px_50px_1fr] gap-3 px-4 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
              <code className="text-[11px] font-mono text-primary self-center">{row.name}</code>
              <span className={`text-[10px] font-bold uppercase self-center ${row.req === 'sí' ? 'text-red-600' : row.req === '*' ? 'text-amber-600' : 'text-muted-foreground'}`}>{row.req}</span>
              <p className="text-[11px] text-muted-foreground self-center">{row.desc}</p>
            </div>
          ))}
        </div>
        <Callout type="warn">
          <strong>email o teléfono</strong> (marcados con <code>*</code>): debes mandar al menos uno. Si Make filtra emails que no tienen ni email ni teléfono, no llegarán al CRM.
        </Callout>

        <SubHeader>6. Idempotency: evitar duplicados en reintentos</SubHeader>
        <p className="text-xs text-muted-foreground mb-2">
          Make puede reintentar un módulo si falla la red. Si en cada reintento crea un nuevo lead, terminarás con duplicados.
          Solución: manda un <code className="px-1 rounded bg-muted">idempotency_key</code> único por evento.
          Si dentro de 24h el CRM recibe la misma key, devuelve el lead que ya creó en lugar de duplicarlo.
        </p>
        <Callout type="tip">
          Buen valor para la key: el <code>message-id</code> del email original, o <code>{`{{project}}-{{email}}-{{fecha_dia}}`}</code>. Cualquier string único basta.
        </Callout>

        <SubHeader>7. Respuesta del webhook</SubHeader>
        <pre className="my-3 p-3 rounded-lg bg-zinc-950 text-zinc-100 text-[11px] leading-relaxed overflow-x-auto">
{`{
  "success": true,
  "data": {
    "lead_id": 1234,
    "responsable_id": 12,
    "assignment_source": "webhook",   // o "round_robin"
    "duplicado": false,
    "reincidente": false,
    "canal": "whatsapp"
  }
}`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Si fue un reintento idempotente, la respuesta incluirá <code>idempotent_replay: true</code> y el mismo <code>lead_id</code> que la primera vez.
        </p>

        <SubHeader>8. Probar antes de ir a producción</SubHeader>
        <Steps items={[
          { title: 'Pulsa «Run once» en Make', desc: 'Con un email de prueba que sepas que pasa el filtro de spam.' },
          { title: 'Verifica el HTTP en el panel de Make', desc: 'Debe devolver código 201 y el cuerpo con lead_id.' },
          { title: 'Ve a Prospectos en el CRM', desc: 'El lead debe aparecer en la lista, con el gestor asignado correcto (revisa la columna «Gestor»).' },
          { title: 'Si algo sale 400/401', desc: 'Mira el mensaje de error en el panel de Make. Causas típicas: API key mal, slug del proyecto mal escrito, falta email y teléfono, o un campo con valor inválido (canal fuera del enum).' },
        ]} />

        <Callout type="warn">
          Si activas el escenario con «Immediately as data arrives» y tu Make procesa cientos de emails al día, considera añadir un <strong>Sleep de 1s</strong> antes del HTTP para no saturar la API. El webhook tolera ráfagas, pero es mejor ir suave.
        </Callout>

        {/* ── DISPONIBILIDAD ── */}
        <SectionHeader id="disponibilidad" icon={CalendarBlank} label="Disponibilidad de gestores" color="amber"
          description="Saltar gestores que no están trabajando hoy o que están de vacaciones — sin tocar el round-robin" />

        <Callout type="info">
          Cuando un gestor no está disponible, el round-robin lo <strong>salta</strong> al asignar nuevos leads.
          El reparto sigue funcionando con el resto del equipo. Cuando vuelve, recibe normalmente.
        </Callout>

        <SubHeader>Dónde se gestiona</SubHeader>
        <Steps items={[
          { title: 'Ve a Configuración → tab «Disponibilidad»', desc: 'Lista todos los gestores del CRM con su estado actual.' },
          { title: 'Toggle Disponible / No disponible', desc: 'Botón verde/rojo a la derecha de cada gestor. Al marcar como No disponible, el sistema pide un motivo opcional ("enfermo", "formación", etc.) que queda registrado.' },
          { title: 'Botón «Bloques»', desc: 'Despliega un panel para programar ausencias futuras (vacaciones, baja, formación). Indica fecha inicio, fecha fin y motivo. El sistema lo aplica automáticamente cuando llega el día y lo desactiva cuando termina.' },
        ]} />

        <SubHeader>Qué se considera "no disponible"</SubHeader>
        <FeatureGrid>
          <FeatureCard icon={ToggleRight} title="Toggle manual" color="orange">
            Botón rojo "No disponible" activado. Útil para ausencias del momento (enfermo hoy, urgencia familiar).
          </FeatureCard>
          <FeatureCard icon={CalendarBlank} title="Bloque activo" color="amber">
            Hay un bloque programado donde <strong>hoy</strong> está entre la fecha de inicio y la de fin. Útil para vacaciones planificadas.
          </FeatureCard>
        </FeatureGrid>

        <Callout type="warn">
          <strong>Excepción</strong>: si Make manda <code>responsable_email</code> en el webhook, el CRM asigna a ese gestor aunque esté no disponible.
          Se asume que Make sabe lo que hace y a veces se quiere meter en su cola un lead específico aunque esté de baja.
        </Callout>

        <SubHeader>Casos de uso típicos</SubHeader>
        <div className="rounded-xl border border-border overflow-hidden my-3">
          {[
            { case: 'Hoy no vienes a trabajar', sol: 'Toggle rojo "No disponible" + motivo "ausencia". Lo desactivas mañana.' },
            { case: 'Vacaciones del 1 al 15 de agosto', sol: 'Bloque: 2026-08-01 → 2026-08-15. Motivo: "Vacaciones". Se activa solo el 1 de agosto.' },
            { case: 'Formación 2 días al mes', sol: 'Un bloque por cada día/rango. Puedes tener varios bloques futuros.' },
            { case: 'Gestor de baja médica indefinida', sol: 'Toggle rojo "No disponible" con motivo "Baja médica". No tiene fecha de vuelta, lo reactivas cuando sea.' },
          ].map((row, i) => (
            <div key={i} className={`grid grid-cols-[280px_1fr] gap-4 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
              <p className="text-xs font-semibold text-foreground">{row.case}</p>
              <p className="text-xs text-muted-foreground">{row.sol}</p>
            </div>
          ))}
        </div>

        <Callout type="tip">
          Los leads que se reciben mientras un gestor está no disponible <strong>no se le encolan</strong> — se reparten entre el resto. Al volver, no le llega un "atraso", recibe los nuevos al ritmo normal del round-robin.
        </Callout>

        {/* ── ATAJOS ── */}
        <SectionHeader id="atajos" icon={Keyboard} label="Atajos de teclado" color="indigo"
          description="Navega el CRM sin levantar las manos del teclado" />
        <p className="text-xs font-bold uppercase text-muted-foreground/60 mt-3 mb-1.5">Generales</p>
        <div className="rounded-xl border border-border overflow-hidden mb-3">
          {[
            { keys: ['Ctrl', 'K'], desc: 'Abre la paleta de búsqueda rápida — navega a cualquier sección o busca un prospecto, cliente o producto' },
            { keys: ['Ctrl', 'B'], desc: 'Contrae o expande la barra lateral — modo compacto solo iconos vs. modo expandido' },
            { keys: ['?'], desc: 'Abre el modal de ayuda con todos los atajos de teclado disponibles' },
            { keys: ['Esc'], desc: 'Cierra la paleta de búsqueda o cualquier modal abierto' },
          ].map((row, i) => (
            <div key={i} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="flex items-center gap-1 flex-shrink-0 w-28">
                {row.keys.map((k, j) => (
                  <span key={j}>
                    <Kbd>{k}</Kbd>
                    {j < row.keys.length - 1 && <span className="text-[10px] text-muted-foreground mx-0.5">+</span>}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
          ))}
        </div>

        <p className="text-xs font-bold uppercase text-muted-foreground/60 mt-3 mb-1.5">Navegación rápida (pulsa G luego la tecla)</p>
        <div className="rounded-xl border border-border overflow-hidden mb-3">
          {[
            { keys: ['G', 'D'], desc: 'Ir a Dashboard' },
            { keys: ['G', 'L'], desc: 'Ir a Prospectos' },
            { keys: ['G', 'C'], desc: 'Ir a Clientes' },
            { keys: ['G', 'P'], desc: 'Ir a Productos' },
            { keys: ['G', 'R'], desc: 'Ir a Reportes' },
            { keys: ['G', 'A'], desc: 'Ir a Contabilidad' },
            { keys: ['G', 'S'], desc: 'Ir a Configuración' },
          ].map((row, i) => (
            <div key={i} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="flex items-center gap-1 flex-shrink-0 w-28">
                {row.keys.map((k, j) => (
                  <span key={j}>
                    <Kbd>{k}</Kbd>
                    {j < row.keys.length - 1 && <span className="text-[10px] text-muted-foreground mx-0.5">luego</span>}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
          ))}
        </div>

        <p className="text-xs font-bold uppercase text-muted-foreground/60 mt-3 mb-1.5">Acciones contextuales</p>
        <div className="rounded-xl border border-border overflow-hidden mb-3">
          {[
            { keys: ['N'], desc: 'Crear nuevo según la página actual (prospecto en /leads, producto en /products, etc.)' },
            { keys: ['↑', '↓'], desc: 'Navega por los resultados de la paleta de búsqueda' },
            { keys: ['↵'], desc: 'Selecciona el resultado resaltado y navega a esa sección o prospecto' },
          ].map((row, i) => (
            <div key={i} className={`flex items-center gap-4 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="flex items-center gap-1 flex-shrink-0 w-28">
                {row.keys.map((k, j) => (
                  <span key={j}>
                    <Kbd>{k}</Kbd>
                    {j < row.keys.length - 1 && <span className="text-[10px] text-muted-foreground mx-0.5">o</span>}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{row.desc}</p>
            </div>
          ))}
        </div>

        <Callout type="tip">
          Los atajos <strong>sin modificadores</strong> (<Kbd>?</Kbd>, <Kbd>G</Kbd>, <Kbd>N</Kbd>) se desactivan
          automáticamente cuando estás escribiendo en un campo de texto, así que escribir "necesario" no dispara "n".
          Si te quedas atrapado en un input, pulsa <Kbd>Esc</Kbd> para volver a usar los atajos.
        </Callout>

        {/* Footer — editorial */}
        <footer className="mt-20 pt-8 border-t border-border">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="text-[11px] font-mono font-semibold uppercase tracking-[0.18em] text-muted-foreground/70 mb-2">
                Fin del manual
              </p>
              <h3 className="text-xl font-bold tracking-tight">¿Falta algo o detectaste un error?</h3>
              <p className="text-[14px] text-muted-foreground mt-2 max-w-md leading-relaxed">
                Comunícalo al equipo de desarrollo. El manual evoluciona con el producto y cada
                aporte mejora la experiencia para todos.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => scrollTo('introduccion')}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card hover:bg-muted text-[13px] font-medium text-foreground/80"
              >
                Volver al inicio
                <ArrowRight size={12} weight="bold" className="rotate-[-90deg]" />
              </button>
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between gap-4 text-[11px] font-mono text-muted-foreground/60">
            <span>MULTICRM · MANUAL DE USUARIO</span>
            <span>v0.1.0 · BETA</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
