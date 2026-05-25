import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users, Calendar, ShieldCheck, TextT, TreeStructure,
  Megaphone, FileText, PlugsConnected, Envelope, EnvelopeOpen, Lightning,
  ListNumbers, Key, Lock, ArrowSquareOut, Plus, WarningCircle,
  Wrench, X,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

// Cada item de la nav interna. Si tiene `external: true` se muestra con el
// icono de "abrir en otra página" y al hacer click navega a esa ruta.
// Si `to` no está definido es una sección embebida controlada por `tab`.
const NAV = [
  { id: 'users',        label: 'Usuarios',          icon: Users,       embedded: true },
  { id: 'availability', label: 'Disponibilidad',    icon: Calendar,    embedded: true },
  { label: 'Roles y permisos',     icon: ShieldCheck,    to: '/roles' },
  { label: 'Campos custom',        icon: TextT,          to: '/configuracion/campos' },
  { label: 'Árbol de categorías',  icon: TreeStructure,  to: '/configuracion/categorias-arbol' },
  { label: 'Canales',              icon: Megaphone,      to: '/configuracion/canales' },
  { label: 'Formularios',          icon: FileText,       to: '/forms' },
  { label: 'Webhooks',             icon: PlugsConnected, to: '/make-webhooks' },
  { label: 'Email seguimiento',    icon: Envelope,       to: '/email-sequences' },
  { label: 'Plantillas email',     icon: EnvelopeOpen,   to: '/email-templates' },
  { label: 'Atajos rápidos',       icon: Lightning,      to: '/configuracion/atajos' },
  { label: 'Numeración docs',      icon: ListNumbers,    to: '/documentos/config' },
  { id: 'integrations', label: 'APIs globales', icon: Key, embedded: true },
  { id: 'security',     label: 'Seguridad',     icon: Lock, embedded: true },
];

// id = `service` válido en el backend (api_credentials.service enum).
const INTEGRATIONS = [
  { id: 'brevo',      name: 'Brevo',          desc: 'Email transaccional (welcome, set-password, recordatorios)', label: 'API Key' },
  { id: 'meta',       name: 'Meta Ads',       desc: 'Audiencias custom y tracking Facebook / Instagram',           label: 'Access Token' },
  { id: 'google_ads', name: 'Google Ads',     desc: 'Campañas Google. Token OAuth refresh',                       label: 'Refresh Token' },
  { id: 'gsc',        name: 'Search Console', desc: 'Tráfico orgánico y posiciones',                              label: 'Refresh Token' },
  { id: 'stripe',     name: 'Stripe',         desc: 'Pagos online, MRR y churn',                                  label: 'Secret Key (sk_live_…)' },
  { id: 'claude',     name: 'Anthropic Claude', desc: 'Reportes generados con IA',                                label: 'API Key (sk-ant-…)' },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('users');

  const isAdmin = user?.role === 'superadmin' || user?.role === 'admin';

  const activeNav = NAV.find((n) => n.id === tab) || NAV[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Configuración</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ajustes del sistema y gestión de usuarios
          </p>
        </div>
        {!isAdmin && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
            <WarningCircle size={11} weight="bold" />
            Solo lectura — necesitas rol admin
          </span>
        )}
      </header>

      {/* Layout: vertical nav (lateral) + content. En mobile la nav se vuelve horizontal arriba. */}
      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 lg:gap-6">
        {/* Nav interna */}
        <nav
          aria-label="Configuración"
          className="rounded-2xl border border-border bg-card p-2 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
        >
          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === tab;

              if (item.to) {
                return (
                  <Link
                    key={item.label}
                    to={item.to}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors whitespace-nowrap"
                  >
                    <Icon size={16} weight="duotone" className="flex-shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <ArrowSquareOut size={12} weight="bold" className="opacity-60 flex-shrink-0" />
                  </Link>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-primary/10 text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                  }`}
                >
                  <Icon size={16} weight="duotone" className="flex-shrink-0" />
                  <span className="flex-1 truncate text-left">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="min-w-0 space-y-4">
          {tab === 'users' && (
            <UsersSection isAdmin={isAdmin} />
          )}
          {tab === 'availability' && (
            <AvailabilitySection />
          )}
          {tab === 'integrations' && (
            <IntegrationsSection isAdmin={isAdmin} />
          )}
          {tab === 'security' && (
            <SecuritySection />
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function UsersSection({ isAdmin }) {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Usuarios"
        subtitle="Invita gestores, admins y soporte. Cada uno con roles y proyectos asignados."
        action={
          <button
            disabled={!isAdmin}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={14} weight="bold" />
            Invitar usuario
          </button>
        }
      />

      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
          <Users size={22} weight="duotone" className="text-muted-foreground" />
        </div>
        <h3 className="font-semibold mb-1">Sin usuarios todavía</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
          Cuando invites usuarios aparecerán aquí con su rol y los proyectos a los que tienen acceso.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 text-[11px]">
          {['superadmin', 'admin', 'gestor', 'soporte'].map((r) => (
            <span key={r} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-muted-foreground border border-border">
              <ShieldCheck size={10} weight="bold" />
              {r}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function AvailabilitySection() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null); // userId con bloques abiertos
  const [blocks, setBlocks] = useState({}); // {userId: [block...]}
  const [newBlock, setNewBlock] = useState({ fecha_inicio: '', fecha_fin: '', motivo: '' });
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    try {
      const res = await client.get('/users/availability');
      setUsers(res?.data || []);
    } catch (err) {
      if (err?.status !== 403) toast({ title: 'Error cargando disponibilidad', description: err?.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function toggle(user, value) {
    let motivo = null;
    if (!value) {
      motivo = window.prompt('¿Motivo? (opcional)', user.unavailable_reason || '');
      if (motivo === null) return; // cancelado
    }
    try {
      await client.patch(`/users/${user.id}/availability`, { is_available: value, motivo: motivo || null });
      toast({ title: value ? 'Gestor disponible' : 'Gestor pausado', description: user.nombre });
      await load();
    } catch (err) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  }

  async function loadBlocks(userId) {
    try {
      const res = await client.get(`/users/${userId}/availability-blocks`);
      setBlocks((b) => ({ ...b, [userId]: res?.data || [] }));
    } catch { /* */ }
  }

  function toggleExpand(userId) {
    if (expanded === userId) { setExpanded(null); return; }
    setExpanded(userId);
    if (!blocks[userId]) loadBlocks(userId);
    setNewBlock({ fecha_inicio: '', fecha_fin: '', motivo: '' });
  }

  async function addBlock(userId) {
    if (!newBlock.fecha_inicio || !newBlock.fecha_fin) {
      toast({ title: 'Faltan fechas', variant: 'destructive' });
      return;
    }
    try {
      await client.post(`/users/${userId}/availability-blocks`, newBlock);
      toast({ title: 'Bloque añadido' });
      setNewBlock({ fecha_inicio: '', fecha_fin: '', motivo: '' });
      await loadBlocks(userId);
      await load();
    } catch (err) {
      toast({ title: 'No se pudo añadir', description: err?.message, variant: 'destructive' });
    }
  }

  async function deleteBlock(userId, blockId) {
    if (!(await confirm({ title: 'Eliminar bloque', message: '¿Eliminar este bloque?', tone: 'destructive', confirmLabel: 'Eliminar' }))) return;
    try {
      await client.delete(`/users/availability-blocks/${blockId}`);
      toast({ title: 'Bloque eliminado' });
      await loadBlocks(userId);
      await load();
    } catch (err) {
      toast({ title: 'No se pudo eliminar', description: err?.message, variant: 'destructive' });
    }
  }

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Disponibilidad"
        subtitle="Gestores que reciben leads vía round-robin. Pausa a un gestor o programa bloques de baja."
      />
      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <Calendar size={22} weight="duotone" className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Sin usuarios para mostrar.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {users.map((u) => {
            const isOpen = expanded === u.id;
            const userBlocks = blocks[u.id] || [];
            return (
              <div key={u.id}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className={`w-9 h-9 rounded-full text-white text-xs font-bold flex items-center justify-center flex-shrink-0 ${u.is_available && !u.bloque_activo ? 'bg-emerald-500' : 'bg-amber-500'}`}>
                    {u.nombre?.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate flex items-center gap-2">
                      {u.nombre}
                      {!u.active && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">inactivo</span>}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {u.bloque_activo
                        ? <span className="text-amber-700 dark:text-amber-300">En baja hasta {fmtDate(u.bloque_activo.fecha_fin)}{u.bloque_activo.motivo ? ` · ${u.bloque_activo.motivo}` : ''}</span>
                        : u.is_available
                          ? <span className="text-emerald-700 dark:text-emerald-300">Disponible · recibe leads</span>
                          : <span className="text-rose-700 dark:text-rose-300">Pausado{u.unavailable_reason ? ` · ${u.unavailable_reason}` : ''}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.bloques_futuros > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">{u.bloques_futuros} bloque{u.bloques_futuros === 1 ? '' : 's'}</span>
                    )}
                    <label className="inline-flex items-center cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        checked={u.is_available}
                        onChange={(e) => toggle(u, e.target.checked)}
                        className="w-4 h-4"
                      />
                      <span className="text-xs">{u.is_available ? 'Activo' : 'Pausado'}</span>
                    </label>
                    <button
                      onClick={() => toggleExpand(u.id)}
                      className="h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      {isOpen ? 'Cerrar' : 'Bloques'}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div className="bg-muted/30 px-4 py-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-end">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Desde</label>
                        <input type="date" value={newBlock.fecha_inicio} onChange={(e) => setNewBlock({ ...newBlock, fecha_inicio: e.target.value })} className="w-full h-8 px-2 rounded-md border border-border bg-card text-xs" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Hasta</label>
                        <input type="date" value={newBlock.fecha_fin} onChange={(e) => setNewBlock({ ...newBlock, fecha_fin: e.target.value })} className="w-full h-8 px-2 rounded-md border border-border bg-card text-xs" />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">Motivo</label>
                        <input type="text" value={newBlock.motivo} onChange={(e) => setNewBlock({ ...newBlock, motivo: e.target.value })} placeholder="Vacaciones, baja, formación…" className="w-full h-8 px-2 rounded-md border border-border bg-card text-xs" />
                      </div>
                      <button onClick={() => addBlock(u.id)} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90">+ Añadir</button>
                    </div>
                    {userBlocks.length > 0 && (
                      <div className="space-y-1">
                        {userBlocks.map((b) => (
                          <div key={b.id} className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs ${b.activo ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' : 'bg-card border border-border'}`}>
                            <span className="font-medium tabular-nums">{fmtDate(b.fecha_inicio)} → {fmtDate(b.fecha_fin)}</span>
                            {b.activo && <span className="text-[10px] uppercase font-bold">activo</span>}
                            <span className="flex-1 truncate text-muted-foreground">{b.motivo || 'Sin motivo'}</span>
                            <button onClick={() => deleteBlock(u.id, b.id)} className="text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 p-1 rounded transition-colors" aria-label="Eliminar bloque">
                              <X size={11} weight="bold" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IntegrationsSection({ isAdmin }) {
  const [creds, setCreds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // {id, service, name, label} | null
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const confirm = useConfirm();

  async function loadCreds() {
    setLoading(true);
    try {
      const res = await client.get('/credentials');
      setCreds(res?.data || []);
    } catch (err) {
      // 403 si no eres admin — silencioso
      if (err?.status !== 403) {
        toast({ title: 'Error cargando credenciales', description: err?.message || 'Error', variant: 'destructive' });
      }
    } finally { setLoading(false); }
  }

  useEffect(() => { if (isAdmin) loadCreds(); else setLoading(false); }, [isAdmin]);

  const credByService = creds.reduce((acc, c) => { acc[c.service] = c; return acc; }, {});

  async function handleSave() {
    if (!editing || !value.trim()) return;
    setSaving(true);
    try {
      await client.post('/credentials', {
        service: editing.service,
        value: value.trim(),
        project_id: null,
      });
      toast({ title: 'Credencial guardada', description: `${editing.name} configurada y cifrada en DB.` });
      setEditing(null);
      setValue('');
      await loadCreds();
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: err?.message || 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function handleTest(cred) {
    setTesting(cred.id);
    try {
      const res = await client.post(`/credentials/${cred.id}/test`, {});
      const r = res?.data?.result;
      toast({
        title: r === 'ok' ? 'Test OK' : 'Test fallido',
        description: res?.data?.message || '',
        variant: r === 'ok' ? undefined : 'destructive',
      });
      await loadCreds();
    } catch (err) {
      toast({ title: 'Test fallido', description: err?.message || 'Error', variant: 'destructive' });
    } finally { setTesting(null); }
  }

  async function handleRemove(cred, name) {
    if (!(await confirm({ title: 'Eliminar credencial', message: `¿Eliminar credencial de ${name}? Las funciones que la usen dejarán de operar.`, tone: 'destructive', confirmLabel: 'Eliminar' }))) return;
    try {
      await client.delete(`/credentials/${cred.id}`);
      toast({ title: 'Credencial eliminada', description: name });
      await loadCreds();
    } catch (err) {
      toast({ title: 'No se pudo eliminar', description: err?.message || 'Error', variant: 'destructive' });
    }
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="APIs globales"
        subtitle="Credenciales cifradas con AES-256-GCM en la base de datos."
      />

      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">Cargando credenciales…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {INTEGRATIONS.map((i) => {
            const c = credByService[i.id];
            const status = !c ? 'missing' : c.last_test_result || 'configured';
            const statusLabel = {
              missing:    { text: 'Sin configurar',   cls: 'bg-muted text-muted-foreground' },
              configured: { text: 'Configurada',      cls: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
              ok:         { text: 'OK',               cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
              failed:     { text: 'Test fallido',     cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
              expired:    { text: 'Token expirado',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
            }[status] || statusLabel?.configured;
            return (
              <div key={i.id} className="rounded-2xl border border-border bg-card p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <PlugsConnected size={18} weight="duotone" className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-semibold text-foreground">{i.name}</h4>
                      <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusLabel.cls}`}>
                        {statusLabel.text}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{i.desc}</p>
                    {c?.last_tested_at && (
                      <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                        Último test: {new Date(c.last_tested_at).toLocaleString('es-ES')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    disabled={!isAdmin}
                    onClick={() => { setEditing(i); setValue(''); }}
                    className="flex-1 h-8 rounded-md bg-muted hover:bg-muted/70 text-xs font-medium text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
                  >
                    <Wrench size={12} />
                    {c ? 'Actualizar' : 'Configurar'}
                  </button>
                  {c && isAdmin && (
                    <>
                      <button
                        onClick={() => handleTest(c)}
                        disabled={testing === c.id}
                        className="h-8 px-3 rounded-md border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                        title="Probar credencial"
                      >
                        {testing === c.id ? '…' : 'Test'}
                      </button>
                      <button
                        onClick={() => handleRemove(c, i.name)}
                        className="h-8 w-8 rounded-md border border-border text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors inline-flex items-center justify-center"
                        title="Eliminar credencial"
                      >
                        <X size={12} weight="bold" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !saving && setEditing(null)}>
          <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg">Configurar {editing.name}</h3>
                <p className="text-xs text-muted-foreground mt-1">{editing.desc}</p>
              </div>
              <button onClick={() => !saving && setEditing(null)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                <X size={16} weight="bold" />
              </button>
            </div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              {editing.label}
            </label>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Pega tu credencial aquí…"
              autoFocus
              autoComplete="off"
              className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[11px] text-muted-foreground mt-2 flex items-start gap-1.5">
              <Lock size={11} weight="duotone" className="flex-shrink-0 mt-0.5" />
              Se cifra con AES-256-GCM antes de guardar. Sólo se puede sobrescribir, nunca leer en claro desde la UI.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => !saving && setEditing(null)}
                className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
              >Cancelar</button>
              <button
                onClick={handleSave}
                disabled={saving || !value.trim()}
                className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar y cifrar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SecuritySection() {
  const items = [
    {
      label: 'JWT Access Token',
      value: '15 minutos',
      desc: 'Caduca a los 15 minutos. Se renueva automáticamente desde el refresh token sin que el usuario perciba nada.',
    },
    {
      label: 'JWT Refresh Token',
      value: '30 días',
      desc: 'Cookie HttpOnly + Secure + SameSite=Lax. No accesible desde JavaScript. Rotación silenciosa al renovar.',
    },
    {
      label: 'Hash de contraseñas',
      value: 'bcrypt cost 12',
      desc: '≈ 250 ms por hash en hardware moderno. Resistente a fuerza bruta offline.',
    },
    {
      label: 'Credenciales API externas',
      value: 'AES-256-GCM',
      desc: 'Cifradas en la columna `api_credentials.encrypted_value` con IV + auth_tag por fila. La clave maestra vive sólo en variable de entorno.',
    },
    {
      label: 'Auditoría',
      value: 'user_activity_log',
      desc: 'Cada acción sensible (login, eliminación, cambio de rol, pago) queda registrada con IP, usuario, timestamp.',
    },
    {
      label: 'Rate limiting',
      value: 'express-rate-limit',
      desc: 'Endpoints públicos protegidos por IP. Login: 5 intentos / 15 min. Documentos: 30 generaciones / minuto por usuario.',
    },
    {
      label: 'CORS',
      value: 'allow-list',
      desc: 'Sólo dominios configurados en CORS_ORIGINS. Credentials: true para que el refresh cookie viaje.',
    },
    {
      label: 'Helmet headers',
      value: 'activos',
      desc: 'CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy. Reduce superficie XSS / clickjacking.',
    },
  ];

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Seguridad"
        subtitle="Política de sesiones, cifrado y auditoría del CRM."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Lock size={14} weight="duotone" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h4 className="font-semibold text-sm text-foreground truncate">{it.label}</h4>
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 flex-shrink-0">
                    {it.value}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{it.desc}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4">
        <h4 className="font-semibold text-sm mb-1.5 flex items-center gap-2">
          <ShieldCheck size={16} weight="duotone" className="text-primary" /> Recomendaciones
        </h4>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
          <li>Rota la API key de Brevo / Stripe / Meta cada 6 meses desde Configuración → APIs globales.</li>
          <li>Cierra sesión en dispositivos compartidos. El refresh token se invalida al hacer logout explícito.</li>
          <li>Si sospechas que tu contraseña se filtró, cámbiala desde Mi cuenta → Cambiar contraseña.</li>
        </ul>
      </div>
    </section>
  );
}
