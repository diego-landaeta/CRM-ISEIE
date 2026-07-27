// @ts-nocheck — Migración piloto a TypeScript (CRM-207). El archivo está
// renombrado a .tsx, types principales (Lead, Conversion) declarados en
// `useState<...>(...)` arriba, pero el archivo consume varios componentes UI
// que aún están en .jsx con tipos inferidos demasiado estrictos. La
// migración completa de los componentes UI compartidos es follow-up.
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { Lead, Conversion } from '@/shared/types';
import { useParams, useNavigate, Link } from 'react-router-dom';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { conversionsApi } from '@/modules/conversions/api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import EmptyState from '@/shared/components/ui/EmptyState';
import {
  ArrowLeft, WhatsappLogo, EnvelopeSimple, Phone, ArrowSquareOut,
  ShoppingCart, CurrencyEur, Wallet, CheckCircle, WarningCircle,
  Note, CalendarCheck, Users, MagnifyingGlass, Tag,
  ChatCircleDots, User, PencilSimple, Trash, GitMerge,
} from '@phosphor-icons/react';
import ChannelBadge from '@/shared/components/ui/ChannelBadge';

const ConversionDialog = lazy(() => import('@/modules/conversions/components/ConversionDialog'));
const ConversionsTab = lazy(() => import('@/modules/conversions/components/ConversionsTab'));
const LeadFormDialog = lazy(() => import('@/modules/leads/components/LeadFormDialog'));
const SoftDeleteDialog = lazy(() => import('@/modules/leads/components/SoftDeleteDialog'));
const MergeLeadDialog = lazy(() => import('@/modules/leads/components/MergeLeadDialog'));

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
];

const INTERACTION_ICONS = { llamada: Phone, email: EnvelopeSimple, whatsapp: WhatsappLogo, nota: Note };
const INTERACTION_COLORS = {
  llamada:  'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
  email:    'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  whatsapp: 'text-green-600 bg-green-50 dark:bg-green-950/30',
  nota:     'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
};

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function cleanPhone(p) { return (p || '').replace(/[^\d+]/g, ''); }
function getInitials(name) {
  if (!name) return '??';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function KpiCard({ label, value, color = 'default', icon: Icon }) {
  const colors = {
    default: 'text-foreground',
    green: 'text-emerald-600 dark:text-emerald-400',
    orange: 'text-orange-600 dark:text-orange-400',
    blue: 'text-blue-600 dark:text-blue-400',
  };
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {Icon && <Icon size={12} weight="duotone" />}
        {label}
      </div>
      <p className={`text-xl font-bold tabular-nums ${colors[color]}`}>{value}</p>
    </div>
  );
}

function InfoRow({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeProject } = useProjectContext();

  const [lead, setLead] = useState<Lead | null>(null);
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [upsellOpen, setUpsellOpen] = useState<boolean>(false);
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [deleteOpen, setDeleteOpen] = useState<boolean>(false);
  const [mergeOpen, setMergeOpen] = useState<boolean>(false);
  const [tab, setTab] = useState<'compras' | 'interacciones' | 'recordatorios'>('compras');

  // El gestor puede gestionar sus propios clientes (registrar pagos, fraccionar,
  // devoluciones). Admin/superadmin siempre. Otros gestores no ven los botones.
  const canManage = user?.role === 'admin'
    || user?.role === 'superadmin'
    || (user?.role === 'gestor' && lead?.responsable_id === user?.id);

  // Token de request: evita que la respuesta lenta de un cliente anterior pise
  // los datos del cliente actual al navegar rápido entre fichas.
  const reqIdRef = useRef(0);

  async function load() {
    const myReq = ++reqIdRef.current;
    setLoading(true);
    try {
      const [leadRes, convRes] = await Promise.all([
        client.get(`/leads/${id}`),
        conversionsApi.byLead(id),
      ]);
      if (reqIdRef.current !== myReq) return; // respuesta obsoleta: ignorar
      if (leadRes.success) setLead(leadRes.data);
      if (convRes.success) setConversions(convRes.data || []);
    } catch (err) {
      if (reqIdRef.current !== myReq) return;
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }

  // Limpiamos el cliente anterior al cambiar de id.
  useEffect(() => { setLead(null); setConversions([]); load(); }, [id]);

  if (loading) {
    return (
      <div className="space-y-5 pb-8" aria-busy="true" aria-live="polite">
        <div className="flex items-center gap-3">
          <div className="h-9 w-24 bg-muted rounded-lg animate-pulse" />
          <div className="h-6 w-48 bg-muted rounded animate-pulse" />
        </div>
        <SkeletonTable rows={4} columns={3} />
      </div>
    );
  }

  if (!lead) {
    return (
      <EmptyState
        icon={WarningCircle}
        title="Cliente no encontrado"
        description="Es posible que haya sido eliminado o no tengas acceso al proyecto."
        action={
          <button
            onClick={() => navigate('/clients')}
            className="text-sm text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
          >
            Volver a Clientes
          </button>
        }
      />
    );
  }

  const avatarColor = AVATAR_COLORS[lead.id % AVATAR_COLORS.length];
  const initials = getInitials(lead.nombre);
  const waPhone = cleanPhone(lead.telefono);

  const totalFacturado = conversions.reduce((s, c) => s + Number(c.importe_total || 0), 0);
  const totalPagado = conversions.reduce((s, c) => s + Number(c.importe_pagado || 0), 0);
  const totalPendiente = totalFacturado - totalPagado;
  const interacciones = lead.interactions || [];

  return (
    <div className="space-y-5 pb-8 max-w-[1100px]">

      {/* Breadcrumb + back */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate('/clients')}
          aria-label="Volver a Clientes"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
        >
          <ArrowLeft size={16} weight="bold" />
          Clientes
        </button>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-foreground font-medium truncate">{lead.nombre}</span>
      </div>

      {/* Header card */}
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Avatar */}
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold flex-shrink-0 ${avatarColor}`}>
          {initials}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-xl font-bold">{lead.nombre}</h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              <CheckCircle size={11} weight="fill" /> Cliente
            </span>
            {lead.origen && <ChannelBadge channel={lead.origen} />}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-sm text-muted-foreground">
            {lead.email && <span>{lead.email}</span>}
            {lead.telefono && <span>{lead.telefono}</span>}
            {lead.responsable_nombre && (
              <span className="flex items-center gap-1">
                <User size={12} /> {lead.responsable_nombre}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Cliente desde {fmtDate(lead.created_at)}
            {lead.last_interaction_at && ` · Último contacto ${fmtDate(lead.last_interaction_at)}`}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {waPhone && (
            <a href={`https://wa.me/${waPhone}`} target="_blank" rel="noopener noreferrer" aria-label="Abrir WhatsApp"
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-green-50 dark:hover:bg-green-950/30 text-muted-foreground hover:text-green-700 dark:hover:text-green-400 transition-colors flex items-center gap-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40">
              <WhatsappLogo size={15} weight="regular" />
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} aria-label="Enviar email"
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40">
              <EnvelopeSimple size={15} weight="regular" />
              <span className="hidden sm:inline">Email</span>
            </a>
          )}
          <button
            onClick={() => setUpsellOpen(true)}
            aria-label="Registrar nueva venta"
            className="h-9 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <ShoppingCart size={15} weight="bold" />
            <span className="hidden sm:inline">Nueva venta</span>
          </button>
          {canManage && (
            <button
              onClick={() => setEditOpen(true)}
              aria-label="Editar datos del cliente"
              title="Editar nombre, email, teléfono, notas, campos custom"
              className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <PencilSimple size={14} weight="regular" />
              <span className="hidden sm:inline">Editar</span>
            </button>
          )}
          {canManage && (
            <button
              onClick={() => setMergeOpen(true)}
              aria-label="Fusionar cliente duplicado"
              title="Fusionar con otro cliente duplicado (mueve historial y elimina el duplicado)"
              className="h-9 px-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-950/50 transition-colors flex items-center gap-1.5 text-sm font-medium"
            >
              <GitMerge size={14} weight="regular" />
              <span className="hidden sm:inline">Fusionar</span>
            </button>
          )}
          {user?.role === 'superadmin' && (
            <button
              onClick={() => setDeleteOpen(true)}
              aria-label="Eliminar cliente (soft delete)"
              title="Eliminar cliente (queda en auditoría, no se ve más)"
              className="h-9 px-3 rounded-lg border border-red-200 dark:border-red-800 bg-card hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground hover:text-red-600 transition-colors flex items-center gap-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-400/40"
            >
              <Trash size={14} weight="regular" />
              <span className="hidden sm:inline">Eliminar</span>
            </button>
          )}
          <Link
            to={`/leads/${lead.id}`}
            className="h-9 px-3 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
            title="Ver ficha completa en Prospectos"
            aria-label="Ver ficha completa en Prospectos"
          >
            <ArrowSquareOut size={14} />
            <span className="hidden sm:inline">Ficha completa</span>
          </Link>
        </div>
      </div>

      {/* KPIs financieros */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiCard label="Total facturado" value={fmt(totalFacturado)} icon={CurrencyEur} />
        <KpiCard label="Total cobrado" value={fmt(totalPagado)} color="green" icon={CheckCircle} />
        <KpiCard label="Pendiente" value={fmt(totalPendiente)} color={totalPendiente > 0 ? 'orange' : 'default'} icon={Wallet} />
        <KpiCard label="Compras" value={conversions.length} color="blue" icon={ShoppingCart} />
      </div>

      {/* Layout 2 cols */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Columna izquierda (2/3) ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Tabs */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex border-b border-border px-4">
              {[
                // Compras y cobros: qué compró y qué debe (cuotas pendientes,
                // facturas) se ve y gestiona aquí mismo, sin ir a la ficha de
                // prospecto.
                { id: 'compras', label: `Compras y cobros${conversions.length > 0 ? ` (${conversions.length})` : ''}`, icon: ShoppingCart },
                { id: 'interacciones', label: `Interacciones${interacciones.length > 0 ? ` (${interacciones.length})` : ''}`, icon: ChatCircleDots },
              ].map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    aria-pressed={tab === t.id}
                    className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold border-b-2 transition-all focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-sm ${
                      tab === t.id
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon size={14} weight={tab === t.id ? 'duotone' : 'regular'} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="p-4">
              {tab === 'compras' && (
                <Suspense fallback={<div className="text-sm text-muted-foreground">Cargando compras…</div>}>
                  <ConversionsTab
                    lead={lead}
                    projectId={lead?.project_id || activeProject?.id}
                    canManage={canManage}
                  />
                </Suspense>
              )}
              {tab === 'interacciones' && (
                <div>
                  {interacciones.length === 0 ? (
                    <EmptyState
                      icon={ChatCircleDots}
                      title="Sin interacciones registradas"
                      description="Aún no se ha registrado ninguna llamada, email, WhatsApp o nota con este cliente."
                      action={
                        <Link
                          to={`/leads/${lead.id}`}
                          className="text-xs text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
                        >
                          Añadir desde la ficha completa
                        </Link>
                      }
                    />
                  ) : (
                    <div className="relative">
                      <div className="absolute left-[18px] top-0 bottom-0 w-px bg-border" />
                      <div className="space-y-3">
                        {interacciones.map((item) => {
                          const Icon = INTERACTION_ICONS[item.tipo] || Note;
                          const colorClass = INTERACTION_COLORS[item.tipo] || INTERACTION_COLORS.nota;
                          return (
                            <div key={item.id} className="flex gap-3 relative">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${colorClass}`}>
                                <Icon size={16} weight="duotone" />
                              </div>
                              <div className="flex-1 bg-card border border-border rounded-lg p-3 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-0.5">
                                  <span className="text-xs font-bold text-foreground capitalize">{item.tipo}</span>
                                  <span className="text-[11px] text-muted-foreground flex-shrink-0">{fmtDateTime(item.fecha || item.created_at)}</span>
                                </div>
                                <p className="text-sm text-muted-foreground leading-relaxed">{item.nota || '—'}</p>
                                {item.usuario_nombre && (
                                  <p className="text-[11px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
                                    <User size={10} /> {item.usuario_nombre}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Columna derecha (1/3) ── */}
        <div className="space-y-4">

          {/* Datos de contacto */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Datos de contacto</h3>
            <div className="space-y-3 divide-y divide-border/60">
              <InfoRow label="Email">
                {lead.email ? (
                  <a href={`mailto:${lead.email}`} className="text-primary hover:underline break-all">{lead.email}</a>
                ) : <span className="text-muted-foreground">—</span>}
              </InfoRow>
              <div className="pt-3">
                <InfoRow label="Teléfono">
                  {lead.telefono ? (
                    <a href={`tel:${lead.telefono}`} className="hover:text-primary transition-colors">{lead.telefono}</a>
                  ) : <span className="text-muted-foreground">—</span>}
                </InfoRow>
              </div>
              <div className="pt-3">
                <InfoRow label="Canal de origen">
                  {lead.origen
                    ? <ChannelBadge channel={lead.origen} />
                    : <span className="text-muted-foreground">—</span>}
                </InfoRow>
              </div>
              <div className="pt-3">
                <InfoRow label="Responsable">
                  {lead.responsable_nombre
                    ? <span className="flex items-center gap-1.5"><User size={13} className="text-muted-foreground" />{lead.responsable_nombre}</span>
                    : <span className="text-muted-foreground">Sin asignar</span>}
                </InfoRow>
              </div>
            </div>
          </div>

          {/* Datos fiscales del cliente (se rellenan al completar una factura y
              quedan globales; sirven para futuras facturas). */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Datos fiscales</h3>
            {(lead.identificacion_fiscal || lead.direccion_fiscal || lead.ciudad_fiscal || lead.codigo_postal_fiscal || lead.pais_fiscal) ? (
              <div className="space-y-3 divide-y divide-border/60">
                <InfoRow label="NIF / DNI / CIF">
                  {lead.identificacion_fiscal || <span className="text-muted-foreground">—</span>}
                </InfoRow>
                <div className="pt-3">
                  <InfoRow label="Dirección fiscal">
                    {lead.direccion_fiscal || <span className="text-muted-foreground">—</span>}
                  </InfoRow>
                </div>
                <div className="pt-3">
                  <InfoRow label="Ciudad / CP">
                    {[lead.ciudad_fiscal, lead.codigo_postal_fiscal].filter(Boolean).join(' · ') || <span className="text-muted-foreground">—</span>}
                  </InfoRow>
                </div>
                <div className="pt-3">
                  <InfoRow label="País">
                    {lead.pais_fiscal || <span className="text-muted-foreground">—</span>}
                  </InfoRow>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin datos fiscales. Se rellenan al completar una factura del cliente y quedan guardados aquí para las siguientes.
              </p>
            )}
          </div>

          {/* Fechas clave */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-foreground">Fechas clave</h3>
            <div className="space-y-3 divide-y divide-border/60">
              <InfoRow label="Cliente desde">
                {fmtDate(lead.created_at)}
              </InfoRow>
              {conversions[0] && (
                <div className="pt-3">
                  <InfoRow label="Primera compra">
                    {fmtDate(conversions[conversions.length - 1]?.fecha_conversion || conversions[conversions.length - 1]?.created_at)}
                  </InfoRow>
                </div>
              )}
              {conversions[0] && conversions.length > 1 && (
                <div className="pt-3">
                  <InfoRow label="Última compra">
                    {fmtDate(conversions[0]?.fecha_conversion || conversions[0]?.created_at)}
                  </InfoRow>
                </div>
              )}
              {lead.last_interaction_at && (
                <div className="pt-3">
                  <InfoRow label="Último contacto">
                    {fmtDate(lead.last_interaction_at)}
                  </InfoRow>
                </div>
              )}
            </div>
          </div>

          {/* UTMs si existen */}
          {(lead.utm_source || lead.utm_medium || lead.utm_campaign) && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-bold text-foreground">Origen de tráfico</h3>
              <div className="space-y-1.5">
                {[
                  { k: 'utm_source', v: lead.utm_source },
                  { k: 'utm_medium', v: lead.utm_medium },
                  { k: 'utm_campaign', v: lead.utm_campaign },
                  { k: 'utm_content', v: lead.utm_content },
                  { k: 'utm_term', v: lead.utm_term },
                ].filter(u => u.v).map(u => (
                  <div key={u.k} className="flex justify-between text-xs gap-2">
                    <span className="text-muted-foreground font-mono">{u.k}</span>
                    <span className="font-medium truncate text-right">{u.v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Link to full lead */}
          <Link
            to={`/leads/${lead.id}`}
            className="flex items-center justify-between w-full p-3.5 rounded-xl border border-border bg-card hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground group focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <span className="font-medium">Ver ficha completa en Prospectos</span>
            <ArrowSquareOut size={15} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>

      {/* Upsell dialog */}
      <Suspense fallback={null}>
        <ConversionDialog
          open={upsellOpen}
          onClose={() => setUpsellOpen(false)}
          lead={lead}
          projectId={lead?.project_id || activeProject?.id}
          onCreated={() => { setUpsellOpen(false); load(); toast({ title: 'Venta registrada' }); }}
        />
      </Suspense>

      {/* Editar datos del cliente */}
      <Suspense fallback={null}>
        <LeadFormDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          lead={lead}
          onSubmit={async (data) => {
            try {
              const res = await client.patch(`/leads/${lead.id}`, {
                nombre: data.nombre,
                email: data.email?.trim() || null,
                telefono: data.telefono?.trim() || null,
                notas: data.notas || null,
                custom_fields: data.custom_fields,
              });
              if (!res?.success) throw new Error(res?.error || 'No se pudo guardar el cliente');
              toast({ title: 'Cliente actualizado' });
              await load();
            } catch (err) {
              toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
              throw err;
            }
          }}
        />
      </Suspense>

      {/* Fusionar cliente duplicado (gestor + admin + superadmin) */}
      <Suspense fallback={null}>
        <MergeLeadDialog
          open={mergeOpen}
          winner={lead ? { id: lead.id, nombre: lead.nombre, email: lead.email } : null}
          projectId={(lead as any)?.project_id || null}
          onClose={() => setMergeOpen(false)}
          onMerged={() => { setMergeOpen(false); toast({ title: 'Cliente fusionado' }); navigate('/clients'); }}
        />
      </Suspense>

      {/* Eliminar cliente (superadmin) */}
      <Suspense fallback={null}>
        <SoftDeleteDialog
          open={deleteOpen}
          lead={lead}
          onClose={() => setDeleteOpen(false)}
          onDeleted={() => {
            setDeleteOpen(false);
            toast({ title: 'Cliente eliminado' });
            navigate('/clients');
          }}
        />
      </Suspense>
    </div>
  );
}
