import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLeads } from '../hooks/useLeads';
import { useWhatsappTemplates } from '../hooks/useWhatsappTemplates';
import LeadFormDialog from '../components/LeadFormDialog';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useProducts } from '@/modules/products/hooks/useProducts';
import client from '@/shared/api/client';
import {
  MagnifyingGlass,
  Plus,
  Export,
  CaretLeft,
  CaretRight,
  Users,
  WarningCircle,
  Notepad,
  PlugsConnected,
  CaretDown,
  Phone,
  EnvelopeSimple,
  WhatsappLogo,
  CheckCircle,
  CalendarPlus,
  DotsThreeVertical,
  Lightning,
  UploadSimple,
  ChatCircleText,
  PencilSimple,
  X,
  DownloadSimple,
  ArrowsClockwise,
  Trash,
  Flag,
} from '@phosphor-icons/react';

const ProjectSettingsDialog = lazy(() => import('@/modules/settings/components/ProjectSettingsDialog'));
const ConversionDialog = lazy(() => import('@/modules/conversions/components/ConversionDialog'));
const CsvImportDialog = lazy(() => import('../components/CsvImportDialog'));
const LeadDrawer = lazy(() => import('../components/LeadDrawer'));
const EnrollSequenceModal = lazy(() => import('../components/EnrollSequenceModal'));
const ContactedDialog = lazy(() => import('../components/ContactedDialog'));
const SoftDeleteDialog = lazy(() => import('../components/SoftDeleteDialog'));
const SpamReportDialog = lazy(() => import('../components/SpamReportDialog'));
const ExportDialog = lazy(() => import('@/shared/components/export/ExportDialog'));
const WasapiExportDialog = lazy(() => import('../components/WasapiExportDialog'));
import StatusBadge, { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';
import ChannelBadge from '@/shared/components/ui/ChannelBadge';
import SearchableSelect from '@/shared/components/ui/SearchableSelect';
import MultiProjectPicker from '@/shared/components/ui/MultiProjectPicker';
import DateRangeFilter from '../components/DateRangeFilter';
import LeadFlagBadge from '../components/LeadFlagBadge';
import EmptyState from '@/shared/components/ui/EmptyState';
import LeadsViewToggle from '../components/LeadsViewToggle';
import QuickActions from '../components/QuickActions';
import ReminderQuickDialog from '../components/ReminderQuickDialog';
import BulkActionBar from '../components/BulkActionBar';
import WhatsappTemplatesDialog from '../components/WhatsappTemplatesDialog';
import usePermission from '@/shared/hooks/usePermission';
import { getLeadPriority, getPriorityStyle } from '../lib/leadPriority';
import { getLeadExportColumns } from '../lib/leadFormat';
import {
  getInitials,
  getAvatarColor,
  formatDate,
  formatRelative,
  cleanPhone,
} from '../lib/leadFormat';


function StatPill({ label, value, dot }: { label: string; value: number; dot?: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-muted/40 flex-shrink-0">
      {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />}
      <span className="text-[11px] text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

type ChipTone = 'default' | 'danger' | 'warning';

function QuickChip({ active, onClick, label, count, tone = 'default' }: { active: boolean; onClick: () => void; label: string; count?: number; tone?: ChipTone }) {
  const toneActive: string = {
    default: 'bg-primary text-white',
    danger: 'bg-red-600 text-white',
    warning: 'bg-amber-600 text-white',
  }[tone];
  const toneIdleCount: string = {
    default: 'bg-primary/15 text-primary',
    danger: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  }[tone];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap inline-flex items-center gap-1.5 ${
        active ? toneActive : 'bg-muted text-muted-foreground hover:bg-muted/80'
      }`}
    >
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[10px] font-bold rounded-full px-1.5 ${active ? 'bg-white/20' : toneIdleCount}`}>{count}</span>
      )}
    </button>
  );
}

function SkeletonRow() {
  return (
    <tr className="border-b animate-pulse">
      <td className="px-5 py-3.5"><div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-full bg-muted" /><div className="w-24 h-4 bg-muted rounded" /></div></td>
      <td className="px-5 py-3.5"><div className="w-32 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-24 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-24 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-16 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-20 h-5 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-16 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-16 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="w-20 h-4 bg-muted rounded" /></td>
      <td className="px-5 py-3.5"><div className="ml-auto w-24 h-6 bg-muted rounded" /></td>
    </tr>
  );
}

export default function LeadsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { can } = usePermission();
  const {
    leads, stats, total, page, totalPages,
    setPage, search, setSearch,
    filterEstado, setFilterEstado,
    filterOrigen, setFilterOrigen,
    filterResponsable, setFilterResponsable,
    filterProducto, setFilterProducto,
    selectedProjectIds, setSelectedProjectIds,
    dateFrom, dateTo, setDateRange,
    sortMode, setSortMode,
    filterDup, setFilterDup,
    filterReincidente, setFilterReincidente,
    loading, error, refetch,
  } = useLeads();

  const { activeProject, projects } = useProjectContext();
  // Columna "Proyecto" visible siempre que el usuario tenga >1 proyecto asignado
  // (no solo en modo multi). Util para saber a qué proyecto pertenece cada lead.
  const showProjectColumn = (projects?.length || 0) > 1;
  const { products } = useProducts(activeProject?.id);
  const { templates: waTemplates, save: saveWaTemplates, reset: resetWaTemplates } = useWhatsappTemplates(activeProject?.id);

  // Auto-polling de leads nuevos cada 30s + detección de nuevos por id
  const lastSeenIdsRef = useRef<Set<number>>(new Set());
  const [newCount, setNewCount] = useState(0);
  useEffect(() => {
    // Inicializar set en primera carga
    if (leads.length > 0 && lastSeenIdsRef.current.size === 0) {
      lastSeenIdsRef.current = new Set(leads.map((l) => l.id));
    }
  }, [leads]);
  useEffect(() => {
    if (!activeProject?.id) return;
    const id = setInterval(() => { refetch(); }, 30000);
    return () => clearInterval(id);
  }, [activeProject?.id, refetch]);
  // Detectar nuevos tras cada refetch
  useEffect(() => {
    if (!leads.length || lastSeenIdsRef.current.size === 0) return;
    const seen = lastSeenIdsRef.current;
    const fresh = leads.filter((l) => !seen.has(l.id));
    if (fresh.length > 0) {
      setNewCount((c) => c + fresh.length);
      toast({ title: `${fresh.length} prospecto${fresh.length > 1 ? 's' : ''} nuevo${fresh.length > 1 ? 's' : ''}`, description: fresh[0].nombre });
      fresh.forEach((l) => seen.add(l.id));
    }
  }, [leads]);

  const [formOpen, setFormOpen] = useState(false);
  const [configTab, setConfigTab] = useState(null); // 'campos' | 'webhook' | null
  const [moreOpen, setMoreOpen] = useState(false);
  const [gestores, setGestores] = useState([]);
  const [convertingLead, setConvertingLead] = useState(null);
  const [confirmingContact, setConfirmingContact] = useState(null);
  const [reminderLead, setReminderLead] = useState(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [waTemplatesOpen, setWaTemplatesOpen] = useState(false);
  const [drawerLeadId, setDrawerLeadId] = useState(null);
  const [enrollLeadId, setEnrollLeadId] = useState(null);
  const [deletingLead, setDeletingLead] = useState<any>(null);
  const [reportingSpamLead, setReportingSpamLead] = useState<any>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [wasapiOpen, setWasapiOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]); // bulk actions
  const [bulkAction, setBulkAction] = useState(null); // null | 'reassign' | 'status' | 'export'
  const [bulkLoading, setBulkLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [quickFilter, setQuickFilterState] = useState(searchParams.get('qf') || ''); // '' | 'urgent' | 'overdue' | 'today' | 'no-contact'

  // Sincronizar filtro con URL para deep-linking desde el Dashboard
  function setQuickFilter(v) {
    setQuickFilterState(v);
    setSelectedIds([]);
    if (v) setSearchParams({ qf: v }, { replace: true });
    else setSearchParams({}, { replace: true });
  }

  // CRM-147: quick-add via ?new=1 (lo dispara el FAB de atajos).
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setFormOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Filtros rapidos client-side (sobre los leads ya cargados)
  const filteredLeads = useMemo(() => {
    if (!quickFilter) return leads;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    return leads.filter(l => {
      const next = l.next_reminder_at ? new Date(l.next_reminder_at) : null;
      const last = l.last_interaction_at ? new Date(l.last_interaction_at) : null;
      if (quickFilter === 'overdue') return next && next < now;
      if (quickFilter === 'today') return next && next >= today && next < tomorrow;
      if (quickFilter === 'no-contact') return !last && ['nuevo', 'por_contactar'].includes(l.estado);
      if (quickFilter === 'urgent') {
        // Vencidos + hoy + sin contacto en estado nuevo/por_contactar
        if (next && next < tomorrow) return true;
        if (!last && ['nuevo', 'por_contactar'].includes(l.estado)) return true;
        return false;
      }
      return true;
    });
  }, [leads, quickFilter]);

  const quickCounts = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    let overdue = 0, todayCount = 0, noContact = 0;
    leads.forEach(l => {
      const next = l.next_reminder_at ? new Date(l.next_reminder_at) : null;
      const last = l.last_interaction_at ? new Date(l.last_interaction_at) : null;
      if (next && next < now) overdue++;
      if (next && next >= today && next < tomorrow) todayCount++;
      if (!last && ['nuevo', 'por_contactar'].includes(l.estado)) noContact++;
    });
    return { overdue, today: todayCount, noContact, urgent: overdue + todayCount + noContact };
  }, [leads]);

  // Cargar lista de responsables para el filtro (solo admin/superadmin)
  useEffect(() => {
    if (user?.role !== 'superadmin' && user?.role !== 'admin') return;
    client.get('/users?limit=100')
      .then((res) => {
        if (res.success) setGestores(res.data || []);
      })
      .catch(() => {});
  }, [user?.role]);

  function handleMarkContacted(lead) {
    setConfirmingContact(lead);
  }

  function handleConvert(lead) {
    setConvertingLead(lead);
  }

  function handleCreateReminder(lead) {
    setReminderLead(lead);
  }

  // Bulk actions ----------------------------------------------
  function toggleSelected(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleSelectAll() {
    if (selectedIds.length === filteredLeads.length && filteredLeads.length > 0) setSelectedIds([]);
    else setSelectedIds(filteredLeads.map(l => l.id));
  }
  function clearSelection() {
    setSelectedIds([]);
    setBulkAction(null);
  }

  async function handleBulkStatusChange(newStatus) {
    setBulkLoading(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        await client.patch(`/leads/${id}/status`, { status: newStatus, motivo: `Cambio masivo desde tabla` });
        ok++;
      } catch { fail++; }
    }
    setBulkLoading(false);
    setBulkAction(null);
    setSelectedIds([]);
    toast({ title: `${ok} actualizados`, description: fail > 0 ? `${fail} con error` : null });
    refetch();
  }

  async function handleBulkReassign(gestorId) {
    setBulkLoading(true);
    let ok = 0, fail = 0;
    for (const id of selectedIds) {
      try {
        await client.patch(`/leads/${id}/reassign`, { responsable_id: gestorId });
        ok++;
      } catch { fail++; }
    }
    setBulkLoading(false);
    setBulkAction(null);
    setSelectedIds([]);
    const gestor = gestores.find(g => g.id === gestorId);
    toast({ title: `${ok} reasignados a ${gestor?.nombre || ''}`, description: fail > 0 ? `${fail} con error` : null });
    refetch();
  }

  function handleBulkExportCsv() {
    const selected = filteredLeads.filter(l => selectedIds.includes(l.id));
    const headers = ['nombre', 'email', 'telefono', 'estado', 'origen', 'gestor', 'fecha'];
    const rows = selected.map(l => [
      l.nombre, l.email, l.telefono || '', l.estado || '',
      l.origen || l.canal_detectado || '', l.responsable_nombre || '',
      (l.created_at || '').slice(0, 10),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prospectos_${activeProject?.slug || 'proyecto'}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
    toast({ title: `${selected.length} prospectos exportados` });
  }

  // Auto-log de interaccion al usar acciones rapidas (WhatsApp/Email)
  async function handleLogInteraction(lead, tipo) {
    try {
      await client.post(`/leads/${lead.id}/interactions`, {
        tipo,
        nota: tipo === 'whatsapp' ? 'Contacto por WhatsApp (acceso rápido)' : 'Email enviado (acceso rápido)',
        fecha: new Date().toISOString(),
      });
      toast({ title: 'Interacción registrada', description: `${tipo === 'whatsapp' ? 'WhatsApp' : 'Email'} con ${lead.nombre}` });
      refetch();
    } catch (err) {
      // Silent fail — el link igual abre, no queremos bloquear al usuario
    }
  }

  async function handleConversionCreated() {
    const lead = convertingLead;
    if (!lead) return;
    // Cambiar status a convertido si no lo esta ya
    if (lead.estado !== 'convertido') {
      try {
        await client.patch(`/leads/${lead.id}/status`, { status: 'convertido', motivo: 'Conversion registrada desde lista' });
      } catch {}
    }
    setConvertingLead(null);
    toast({ title: 'Conversión registrada', description: lead.nombre });
    await refetch();
  }

  async function handleCreateLead(data) {
    // En modo ALL el dialog pasa _project_id explicitamente. En modo
    // proyecto activo, usamos activeProject.id.
    const projectId = data._project_id || activeProject?.id;
    if (!projectId || projectId === -1) {
      toast({ title: 'Error', description: 'Selecciona un proyecto primero', variant: 'destructive' });
      return;
    }

    // Resolver producto_interes_id a partir del nombre
    let productoInteresId = null;
    if (data.producto_interes) {
      const prod = products.find(p => p.nombre === data.producto_interes);
      productoInteresId = prod?.id || null;
    }

    // DEBUG: ver qué origen llega del form. Quitar después de validar.
    // eslint-disable-next-line no-console
    console.log('[handleCreateLead] data.origen recibido:', data.origen, 'tipo:', typeof data.origen);
    try {
      const res = await client.post('/leads', {
        project_id: projectId,
        nombre: data.nombre,
        email: data.email,
        telefono: data.telefono || '',
        producto_interes_id: productoInteresId,
        canal: data.origen || 'directo',
        notas: data.notas || '',
        custom_fields: data.custom_fields || undefined,
      });

      if (res.success) {
        const { reincidente, duplicado } = res.data;
        let desc = 'Lead creado y asignado por round-robin';
        if (reincidente) desc = 'Prospecto REINCIDENTE detectado (mismo producto)';
        else if (duplicado) desc = 'Prospecto duplicado detectado en este proyecto';

        toast({ title: 'Lead creado', description: desc });
        await refetch();
      }
    } catch (err) {
      toast({
        title: 'Error al crear lead',
        description: err?.data?.error || err?.message || 'Error desconocido',
        variant: 'destructive',
      });
      throw err;
    }
  }

  // Generar array de paginas visibles (max 5 en torno a la actual)
  function getVisiblePages() {
    const pages = [];
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  }

  return (
    <div className="space-y-6">
      <LeadFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateLead} lead={null} />
      {configTab && activeProject && (
        <Suspense fallback={null}>
          <ProjectSettingsDialog
            project={activeProject}
            initialTab={configTab}
            onClose={() => setConfigTab(null)}
            onSaved={() => { /* refrescado por contexto */ }}
          />
        </Suspense>
      )}

      {/* Header compacto: titulo + acciones en la misma fila, todo h-9 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold leading-tight">Prospectos</h1>
          <p className="text-muted-foreground text-xs">Explora y gestiona tus clientes potenciales</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => { setNewCount(0); refetch(); }}
            title="Refrescar lista de prospectos"
            aria-label="Refrescar"
            className={`relative h-9 inline-flex items-center gap-1.5 px-2.5 sm:px-3 rounded-md border text-xs sm:text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 ${
              newCount > 0
                ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 animate-pulse'
                : 'border-border bg-card hover:bg-muted'
            }`}
          >
            <ArrowsClockwise size={14} weight="bold" className={loading ? 'animate-spin' : undefined} />
            <span className="hidden md:inline">Refrescar</span>
            {newCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center">
                {newCount > 9 ? '9+' : newCount}
              </span>
            )}
          </button>
          <LeadsViewToggle active="list" />
          <button
            onClick={() => navigate('/leads/audiences')}
            title="Audiencias para Meta/Google"
            aria-label="Audiencias"
            className="h-9 inline-flex items-center gap-1.5 px-2.5 sm:px-3 rounded-md border border-border bg-card text-xs sm:text-sm font-medium hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Export size={14} weight="bold" />
            <span className="hidden md:inline">Audiencias</span>
          </button>
          {filteredLeads.length > 0 && can('leads.export') && (
            <button
              onClick={() => setExportOpen(true)}
              title="Exportar (Excel/CSV/JSON)"
              aria-label="Exportar"
              className="h-9 inline-flex items-center gap-1.5 px-2.5 sm:px-3 rounded-md border border-border bg-card text-xs sm:text-sm font-medium hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <DownloadSimple size={14} weight="bold" />
              <span className="hidden md:inline">Exportar</span>
            </button>
          )}
          <button
            onClick={() => setWasapiOpen(true)}
            title="Descargar plantilla Wasapi (CSV bulk WhatsApp)"
            aria-label="Wasapi"
            className="h-9 inline-flex items-center gap-1.5 px-2.5 sm:px-3 rounded-md border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs sm:text-sm font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/50 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
          >
            <WhatsappLogo size={14} weight="bold" />
            <span className="hidden md:inline">Wasapi</span>
          </button>
          {(user?.role === 'admin' || user?.role === 'superadmin') && (
            <div className="relative">
              <button
                onClick={() => setMoreOpen(!moreOpen)}
                className="h-9 inline-flex items-center gap-1.5 px-2.5 sm:px-3 rounded-md border border-border bg-card text-xs sm:text-sm font-medium hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                aria-expanded={moreOpen}
              >
                <span className="hidden md:inline">Configurar</span>
                <span className="md:hidden">Más</span>
                <CaretDown size={11} weight="bold" />
              </button>
              {moreOpen && (
                <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-30 w-max py-1">
                  <button
                    onClick={() => { setCsvImportOpen(true); setMoreOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 whitespace-nowrap"
                  >
                    <UploadSimple size={13} weight="regular" className="flex-shrink-0" /> Importar desde CSV
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={() => { setConfigTab('campos'); setMoreOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 whitespace-nowrap"
                  >
                    <Notepad size={13} weight="regular" className="flex-shrink-0" /> Campos custom de prospectos
                  </button>
                  <button
                    onClick={() => { setConfigTab('webhook'); setMoreOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 whitespace-nowrap"
                  >
                    <PlugsConnected size={13} weight="regular" className="flex-shrink-0" /> Webhook de captura
                  </button>
                  <button
                    onClick={() => { setWaTemplatesOpen(true); setMoreOpen(false); }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted flex items-center gap-2 whitespace-nowrap"
                  >
                    <ChatCircleText size={13} weight="regular" className="flex-shrink-0" /> Plantillas de WhatsApp
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setFormOpen(true)}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
          >
            <Plus size={14} weight="bold" />
            <span className="hidden sm:inline">Nuevo prospecto</span>
            <span className="sm:hidden">Nuevo</span>
          </button>
        </div>
      </div>

      {/* Filters + Stats compactos */}
      <div className="flex flex-col gap-2">
        {/* Fila 1: search + filtros */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email..."
              aria-label="Buscar prospectos"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-muted/40 text-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 focus:bg-card placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={filterEstado}
            onChange={(e) => { setFilterEstado(e.target.value); }}
            aria-label="Filtrar por estado"
            className="h-9 px-3 pr-8 rounded-md border border-border bg-muted/40 text-sm outline-none appearance-none cursor-pointer focus:border-primary focus:ring-2 focus:ring-primary/20"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <SearchableSelect
            value={filterOrigen}
            onChange={(v) => { setFilterOrigen(v); }}
            options={[
              { value: 'meta_ads', label: 'Meta Ads' },
              { value: 'google_ads', label: 'Google Ads' },
              { value: 'tiktok_ads', label: 'TikTok Ads' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'organico', label: 'Orgánico' },
              { value: 'chatgpt_ia', label: 'ChatGPT IA' },
              { value: 'referido', label: 'Referido' },
              { value: 'directo', label: 'Directo' },
            ]}
            placeholder="Buscar canal..."
            allLabel="Todos los canales"
            ariaLabel="Filtrar por canal"
            maxWidth="180px"
          />
          {(user?.role === 'superadmin' || user?.role === 'admin') && (
            <SearchableSelect
              value={filterResponsable}
              onChange={(v) => { setFilterResponsable(v); }}
              options={[
                { value: 'unassigned', label: '— Sin asignar —' },
                ...gestores.map((g: any) => ({ value: String(g.id), label: g.nombre })),
              ]}
              placeholder="Buscar gestor..."
              allLabel="Todos los gestores"
              ariaLabel="Filtrar por gestor"
              maxWidth="200px"
            />
          )}
          <SearchableSelect
            value={filterProducto}
            onChange={(v) => { setFilterProducto(v); }}
            options={(products || []).map((p: any) => ({ value: String(p.id), label: p.nombre }))}
            placeholder="Buscar programa..."
            allLabel="Todos los programas"
            ariaLabel="Filtrar por programa"
            maxWidth="220px"
          />
          {projects && projects.length > 1 && (
            <MultiProjectPicker
              projects={projects}
              selected={selectedProjectIds}
              onChange={(ids) => { setSelectedProjectIds(ids); }}
              activeProjectId={activeProject?.id}
            />
          )}
          <DateRangeFilter
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => setDateRange(f, t)}
          />
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as 'value' | 'recent' | 'urgency' | 'recent_value')}
            aria-label="Ordenar leads"
            title="Orden de los leads en la tabla"
            className="h-9 px-3 pr-8 rounded-md border border-border bg-muted/40 text-sm outline-none appearance-none cursor-pointer focus:border-primary focus:ring-2 focus:ring-primary/20"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%23a1a1aa' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            <option value="recent_value">📅 Día reciente · más valor (default)</option>
            <option value="urgency">⚡ Urgencia (valor × frescura)</option>
            <option value="value">💰 Más valor primero</option>
            <option value="recent">🕒 Más recientes primero</option>
          </select>
          {(user?.role === 'superadmin' || user?.role === 'admin') && (stats?.sin_asignar > 0 || filterResponsable === 'unassigned') && activeProject?.id && activeProject.id > 0 && (
            <button
              onClick={async () => {
                if (!activeProject?.id || activeProject.id < 0) return;
                try {
                  const res = await client.post(`/leads/reassign-pending?projectId=${activeProject.id}`);
                  if (res.success) {
                    const d = res.data as { reassigned: number; reason?: string };
                    if (d.reason === 'NO_ACTIVE_GESTORES') {
                      toast({ title: 'No hay gestores activos en este proyecto', description: 'Crea usuarios con rol "gestor" o "admin" y asígnalos al proyecto.', variant: 'destructive' });
                    } else {
                      toast({ title: `${d.reassigned} prospecto${d.reassigned !== 1 ? 's' : ''} asignado${d.reassigned !== 1 ? 's' : ''} equitativamente` });
                      refetch?.();
                    }
                  }
                } catch (err: any) {
                  toast({ title: 'Error', description: err?.message, variant: 'destructive' });
                }
              }}
              className="h-9 px-3 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold whitespace-nowrap inline-flex items-center gap-1.5"
              title="Aplica round-robin a todos los prospectos sin responsable"
            >
              Asignar pendientes
              {stats?.sin_asignar > 0 && (
                <span className="bg-white text-amber-700 text-[10px] font-black px-1.5 py-0.5 rounded">
                  {stats.sin_asignar}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Stats compactos en una sola tira horizontal */}
        {stats && (
          <div className="flex flex-wrap items-stretch gap-1.5 bg-card border border-border rounded-md p-1.5 overflow-x-auto">
            <StatPill label="Total" value={stats.total || 0} />
            <StatPill label="Nuevos" value={stats.nuevo || 0} dot="#3b82f6" />
            <StatPill label="Por contactar" value={stats.por_contactar || 0} dot="#f59e0b" />
            <StatPill label="Contactados" value={stats.contactado || 0} dot="#10b981" />
            <StatPill label="En seguimiento" value={stats.en_seguimiento || 0} dot="#eab308" />
            <StatPill label="Convertidos" value={stats.convertido || 0} dot="#8b5cf6" />
            <StatPill label="No interesado" value={stats.no_interesado || 0} dot="#ef4444" />
          </div>
        )}
      </div>

      {/* Filtros rapidos por accion (client-side) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs text-muted-foreground flex-shrink-0">Mostrar</span>
        <QuickChip active={!quickFilter} onClick={() => setQuickFilter('')} label="Todos" />
        <QuickChip active={quickFilter === 'urgent'} onClick={() => setQuickFilter('urgent')}
          label="Necesitan acción hoy" count={quickCounts.urgent} tone="danger" />
        <QuickChip active={quickFilter === 'overdue'} onClick={() => setQuickFilter('overdue')}
          label="Vencidos" count={quickCounts.overdue} tone="danger" />
        <QuickChip active={quickFilter === 'today'} onClick={() => setQuickFilter('today')}
          label="Hoy" count={quickCounts.today} tone="warning" />
        <QuickChip active={quickFilter === 'no-contact'} onClick={() => setQuickFilter('no-contact')}
          label="Sin contacto" count={quickCounts.noContact} tone="default" />
        {(user?.role === 'admin' || user?.role === 'superadmin') && (
          <>
            <QuickChip active={filterDup} onClick={() => setFilterDup(!filterDup)}
              label="Duplicados" tone="warning" />
            <QuickChip active={filterReincidente} onClick={() => setFilterReincidente(!filterReincidente)}
              label="Reincidentes" tone="danger" />
          </>
        )}
      </div>

      {/* Leyenda de iconos de acción + badges */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground bg-muted/30 border border-border rounded-md px-3 py-1.5">
        <span className="font-semibold text-foreground">Etiquetas:</span>
        <LeadFlagBadge kind="reincidente" />
        <LeadFlagBadge kind="duplicado" />
        <LeadFlagBadge kind="propuesto" />
        {user?.role === 'superadmin' && <LeadFlagBadge kind="spam_pending" pulse={false} />}
        <span className="text-[10px] italic">(pasa el ratón sobre cada etiqueta para ver qué significa)</span>
        <span className="border-l border-border h-3 mx-1" />
        <span className="font-semibold text-foreground">Acciones rápidas:</span>
        <span className="inline-flex items-center gap-1"><WhatsappLogo size={13} weight="regular" className="text-green-600" /> WhatsApp</span>
        <span className="inline-flex items-center gap-1"><EnvelopeSimple size={13} weight="regular" /> Email + secuencia</span>
        <span className="inline-flex items-center gap-1"><CalendarPlus size={13} weight="regular" /> Programar próximo contacto</span>
        <span className="inline-flex items-center gap-1"><CheckCircle size={13} weight="regular" className="text-emerald-600" /> Marcar contactado</span>
        <span className="inline-flex items-center gap-1"><Lightning size={13} weight="regular" className="text-amber-500" /> Convertir a cliente</span>
        {(user?.role === 'admin' || user?.role === 'superadmin') && (
          <>
            <span className="inline-flex items-center gap-1"><Trash size={13} weight="regular" className="text-red-600" /> Eliminar (admin/superadmin)</span>
            <span className="inline-flex items-center gap-1"><Flag size={13} weight="regular" className="text-orange-600" /> Reportar spam (admin/superadmin)</span>
          </>
        )}
        {user?.role === 'superadmin' && (
          <span className="inline-flex items-center gap-1"><Flag size={13} weight="fill" className="text-orange-600" /> Marcado para revisión = pendiente de spam-report</span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-6 text-center">
          <WarningCircle size={32} className="text-red-500 mx-auto mb-2" weight="regular" />
          <p className="text-sm text-red-600 dark:text-red-400 font-medium">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-lg border border-border">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/60 border-b sticky top-0 z-10">
              <tr>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Nombre</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Email</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Teléfono</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Programa</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Valor</th>
                {showProjectColumn && (
                  <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Proyecto</th>
                )}
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Origen</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Estado</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Recibido</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Último contacto</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Próximo</th>
                <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Gestor</th>
                <th className="px-5 py-2.5 text-right text-xs text-muted-foreground pr-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && leads.length === 0 && (
                <>
                  {[1, 2, 3, 4, 5].map((i) => <SkeletonRow key={i} />)}
                </>
              )}
              {filteredLeads.map((lead) => {
                const priority = getLeadPriority(lead);
                const pStyle = getPriorityStyle(priority);
                // Resaltado para leads pendientes de primer contacto (default tras webhook
                // o cuando un seguimiento se vence sin contactar). Hace que la fila
                // "salte a la vista" en la tabla sin tapar el color de prioridad.
                const isPorContactar = lead.estado === 'por_contactar' || lead.status === 'por_contactar';
                return (
                <tr
                  key={lead.id}
                  onClick={() => setDrawerLeadId(lead.id)}
                  title={isPorContactar ? 'Por contactar — pendiente de primer contacto' : `Prioridad: ${pStyle.label}`}
                  className={`border-b last:border-0 border-l-4 ${pStyle.borderClass} ${pStyle.rowBgClass} hover:bg-muted/50 transition-colors cursor-pointer ${isPorContactar ? 'bg-orange-50/60 dark:bg-orange-950/20 ring-1 ring-orange-300/60 dark:ring-orange-800/60' : ''}`}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold ${getAvatarColor(lead.id)}`}>
                        {getInitials(lead.nombre)}
                      </div>
                      <span className="font-semibold">{lead.nombre}</span>
                      {lead.reincidente && <LeadFlagBadge kind="reincidente" />}
                      {lead.es_propuesto && <LeadFlagBadge kind="propuesto" />}
                      {lead.has_pending_spam_report && user?.role === 'superadmin' && <LeadFlagBadge kind="spam_pending" />}
                      {!lead.reincidente && lead.lead_duplicado_de && <LeadFlagBadge kind="duplicado" />}
                      {lead.estado === 'contactado' && !lead.last_interaction_at && <LeadFlagBadge kind="sin_interaccion" />}
                      {lead.dias_inactivo != null &&
                       lead.dias_alerta_inactividad != null &&
                       lead.dias_inactivo > lead.dias_alerta_inactividad &&
                       !['convertido', 'no_interesado'].includes(lead.estado) && (
                        <LeadFlagBadge kind="inactivo" daysInactive={lead.dias_inactivo} />
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">{lead.email}</td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground font-mono">{lead.telefono || '—'}</td>
                  <td className="px-5 py-3.5 text-xs">
                    {lead.producto_interes ? (
                      <span className="inline-block px-2 py-0.5 bg-primary/10 text-primary rounded font-medium" title={lead.producto_interes}>
                        {lead.producto_interes.length > 40 ? lead.producto_interes.slice(0, 38) + '…' : lead.producto_interes}
                      </span>
                    ) : lead.landing_url ? (
                      (() => {
                        // Mostrar el último segmento legible de la URL como "origen"
                        // ej: https://psikoaprende.com/contacto/ → "página de contacto"
                        let label = 'origen web';
                        try {
                          const path = new URL(lead.landing_url).pathname.replace(/\/$/, '').split('/').filter(Boolean);
                          const last = path[path.length - 1] || 'home';
                          // Limpiar: convertir guiones a espacios + capitalizar primera letra
                          label = `Desde: ${last.replace(/-/g, ' ').replace(/^(.)/, (c) => c.toUpperCase())}`;
                        } catch { /* mantener fallback */ }
                        return (
                          <span className="inline-block px-2 py-0.5 bg-muted text-muted-foreground rounded font-medium italic" title={lead.landing_url}>
                            {label.length > 40 ? label.slice(0, 38) + '…' : label}
                          </span>
                        );
                      })()
                    ) : (
                      <span className="text-muted-foreground italic">Por definir</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    {lead.valor_oportunidad === 'alto' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" title="Producto de valor alto">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Alto
                      </span>
                    )}
                    {lead.valor_oportunidad === 'medio' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" title="Producto de valor medio">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Medio
                      </span>
                    )}
                    {lead.valor_oportunidad === 'bajo' && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground bg-muted" title="Producto de valor bajo">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />Bajo
                      </span>
                    )}
                    {!lead.valor_oportunidad && <span className="text-muted-foreground/60">—</span>}
                  </td>
                  {showProjectColumn && (
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{lead.proyecto_nombre || '—'}</td>
                  )}
                  <td className="px-5 py-3.5">
                    <ChannelBadge channel={lead.origen} />
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={lead.estado} />
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    {lead.created_at ? (
                      <div className="flex flex-col leading-tight">
                        <span className="text-foreground">{new Date(lead.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                        <span className="text-muted-foreground text-[11px]">{new Date(lead.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground text-xs">
                    {lead.last_interaction_at ? formatRelative(lead.last_interaction_at) : <span className="text-muted-foreground/60">Sin contacto</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs">
                    {lead.next_reminder_at ? (
                      <span className={(new Date(lead.next_reminder_at) < new Date()) ? 'text-red-600 font-medium' : 'text-foreground'}>
                        {formatRelative(lead.next_reminder_at, { future: true })}
                      </span>
                    ) : <span className="text-muted-foreground/60">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground">{lead.responsable_nombre || lead.gestor || 'Sin asignar'}</td>
                  <td className="px-5 py-3.5 text-right pr-3">
                    <QuickActions lead={lead} onMarkContacted={handleMarkContacted} onConvert={handleConvert} onLogInteraction={handleLogInteraction} onCreateReminder={handleCreateReminder} onEnrollSequence={(l) => setEnrollLeadId(l.id)} onSoftDelete={(user?.role === 'superadmin' || user?.role === 'admin') ? (l) => setDeletingLead(l) : undefined} onReportSpam={(user?.role === 'superadmin' || user?.role === 'admin') ? (l) => setReportingSpamLead(l) : undefined} templates={waTemplates} projectName={activeProject?.nombre} onEditTemplates={() => setWaTemplatesOpen(true)} />
                  </td>
                </tr>
                );
              })}
              {!loading && leads.length === 0 && filteredLeads.length === 0 && !error && (
                <tr>
                  <td colSpan={showProjectColumn ? 13 : 12} className="px-5">
                    <EmptyState
                      icon={Users}
                      title="No se encontraron prospectos"
                      description="Ajusta los filtros o crea un nuevo prospecto manualmente."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y">
          {loading && leads.length === 0 && (
            <div className="p-8 text-center">
              <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
            </div>
          )}
          {filteredLeads.map((lead) => (
            <div
              key={lead.id}
              onClick={() => setDrawerLeadId(lead.id)}
              className="p-4 space-y-2.5 cursor-pointer active:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold flex-shrink-0 ${getAvatarColor(lead.id)}`}>
                    {getInitials(lead.nombre)}
                  </div>
                  <span className="text-[13px] font-semibold truncate">{lead.nombre}</span>
                </div>
                <StatusBadge status={lead.estado} />
              </div>
              <p className="text-[13px] text-muted-foreground truncate">{lead.email}</p>
              <div className="flex items-center gap-2 flex-wrap text-[11px]">
                <ChannelBadge channel={lead.origen} />
                {lead.last_interaction_at && (
                  <span className="text-muted-foreground">Último: <span className="text-foreground">{formatRelative(lead.last_interaction_at)}</span></span>
                )}
                {lead.next_reminder_at && (
                  <span className={(new Date(lead.next_reminder_at) < new Date()) ? 'text-red-600 font-semibold' : 'text-muted-foreground'}>
                    Próximo: <span className="font-medium">{formatRelative(lead.next_reminder_at, { future: true })}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/60">
                <span className="text-[11px] text-muted-foreground">{lead.responsable_nombre || 'Sin asignar'}</span>
                <QuickActions lead={lead} onMarkContacted={handleMarkContacted} onConvert={handleConvert} onLogInteraction={handleLogInteraction} onCreateReminder={handleCreateReminder} onEnrollSequence={(l) => setEnrollLeadId(l.id)} onSoftDelete={(user?.role === 'superadmin' || user?.role === 'admin') ? (l) => setDeletingLead(l) : undefined} onReportSpam={(user?.role === 'superadmin' || user?.role === 'admin') ? (l) => setReportingSpamLead(l) : undefined} templates={waTemplates} projectName={activeProject?.nombre} onEditTemplates={() => setWaTemplatesOpen(true)} />
              </div>
            </div>
          ))}
          {!loading && leads.length === 0 && filteredLeads.length === 0 && !error && (
            <EmptyState
              icon={Users}
              title="No se encontraron prospectos"
              description="Ajusta los filtros o crea un nuevo prospecto manualmente."
            />
          )}
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="px-5 py-3 border-t flex items-center justify-between text-[13px] text-muted-foreground">
            <span>
              Mostrando <strong className="text-foreground">{Math.min((page - 1) * 20 + 1, total)}&ndash;{Math.min(page * 20, total)}</strong> de {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <CaretLeft size={12} weight="bold" /> Anterior
              </button>
              {getVisiblePages().map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    p === page
                      ? 'bg-primary text-white shadow-sm'
                      : 'border border-border bg-card hover:bg-muted'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                Siguiente <CaretRight size={12} weight="bold" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Convertir prospecto — dialog inline.
          Importante: en modo "Todos los proyectos" activeProject.id es -1 (sentinel),
          asi que tomamos el project_id del propio lead para no enviar -1 al backend. */}
      <Suspense fallback={null}>
        <ConversionDialog
          open={!!convertingLead}
          onClose={() => setConvertingLead(null)}
          lead={convertingLead}
          projectId={convertingLead?.project_id || activeProject?.id}
          onCreated={handleConversionCreated}
        />
      </Suspense>

      {/* Marcar contactado — registra nota + opcional próximo contacto */}
      <Suspense fallback={null}>
        <ContactedDialog
          open={!!confirmingContact}
          lead={confirmingContact}
          onClose={() => setConfirmingContact(null)}
          onSaved={() => { setConfirmingContact(null); refetch(); }}
        />
      </Suspense>

      {/* Bulk action bar — sticky abajo cuando hay seleccion */}
      {selectedIds.length > 0 && (
        <BulkActionBar
          count={selectedIds.length}
          onClear={clearSelection}
          onChangeStatus={status => handleBulkStatusChange(status)}
          onReassign={gestorId => handleBulkReassign(gestorId)}
          onExport={handleBulkExportCsv}
          gestores={gestores}
          isAdmin={user?.role === 'superadmin' || user?.role === 'admin'}
          loading={bulkLoading}
        />
      )}

      {/* Crear recordatorio inline */}
      <ReminderQuickDialog
        open={!!reminderLead}
        lead={reminderLead}
        onClose={() => setReminderLead(null)}
        onSaved={() => { setReminderLead(null); refetch(); }}
      />

      {/* Import CSV */}
      <Suspense fallback={null}>
        <CsvImportDialog
          open={csvImportOpen}
          onClose={() => setCsvImportOpen(false)}
          projectId={activeProject?.id}
          onImported={({ ok }) => { if (ok > 0) refetch(); }}
        />
      </Suspense>

      {/* Drawer detalle rapido */}
      <Suspense fallback={null}>
        <LeadDrawer
          leadId={drawerLeadId}
          open={drawerLeadId !== null}
          onClose={() => setDrawerLeadId(null)}
        />
      </Suspense>

      {/* Soft delete (superadmin) */}
      <Suspense fallback={null}>
        <SoftDeleteDialog
          open={!!deletingLead}
          lead={deletingLead}
          onClose={() => setDeletingLead(null)}
          onDeleted={() => { setDeletingLead(null); refetch(); }}
        />
      </Suspense>

      {/* Reportar como spam (gestor/admin) */}
      <Suspense fallback={null}>
        <SpamReportDialog
          open={!!reportingSpamLead}
          lead={reportingSpamLead}
          onClose={() => setReportingSpamLead(null)}
          onReported={() => setReportingSpamLead(null)}
        />
      </Suspense>

      {/* Enrolar en secuencia */}
      <Suspense fallback={null}>
        <EnrollSequenceModal
          leadId={enrollLeadId}
          open={enrollLeadId !== null}
          onClose={() => setEnrollLeadId(null)}
          onEnrolled={() => setEnrollLeadId(null)}
        />
      </Suspense>

      {/* Plantillas WhatsApp por proyecto */}
      <WhatsappTemplatesDialog
        open={waTemplatesOpen}
        onClose={() => setWaTemplatesOpen(false)}
        templates={waTemplates}
        onSave={saveWaTemplates}
        onReset={resetWaTemplates}
        projectName={activeProject?.nombre}
      />

      {/* Export universal (CRM-196) */}
      <Suspense fallback={null}>
        <ExportDialog
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          context="leads"
          title="Exportar prospectos"
          filename={`prospectos-${activeProject?.slug || activeProject?.nombre || 'crm'}-${new Date().toISOString().slice(0, 10)}`}
          columns={getLeadExportColumns()}
          rows={filteredLeads}
        />
      </Suspense>

      <Suspense fallback={null}>
        {wasapiOpen && activeProject?.id && (
          <WasapiExportDialog
            open={wasapiOpen}
            projectId={activeProject.id}
            onClose={() => setWasapiOpen(false)}
          />
        )}
      </Suspense>
    </div>
  );
}

