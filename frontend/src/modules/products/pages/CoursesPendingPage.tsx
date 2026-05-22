import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { SkeletonCard } from '@/shared/components/ui/SkeletonTable';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/hooks/useToast';
import {
  Package, CheckCircle, Clock, User, ArrowSquareOut, Sparkle,
} from '@phosphor-icons/react';

const ROLES_CREADOR = ['creador', 'admin', 'superadmin'];

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relativeFromNow(d) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;
  if (days < 365) return `hace ${Math.floor(days / 30)} meses`;
  return `hace ${Math.floor(days / 365)} años`;
}

export default function CoursesPendingPage() {
  const { user } = useAuth();
  const { activeProject } = useProjectContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [marking, setMarking] = useState(null);

  const canManage = ROLES_CREADOR.includes(user?.role);
  const productoLabel = activeProject?.producto_label || 'Producto';
  const productoLabelPlural = activeProject?.producto_label_plural || 'Productos';

  const load = useCallback(async () => {
    if (!activeProject?.id || !canManage) return;
    setLoading(true);
    setError(null);
    try {
      // Endpoint dedicado (CRM-141 backend) cuando exista
      let res;
      try {
        res = await client.get(`/products/${activeProject.id}?estado_creacion=pendiente_crear`);
      } catch {
        // Fallback: traer todos y filtrar en cliente
        res = await client.get(`/products/${activeProject.id}`);
      }
      if (res.success) {
        const all = res.data || [];
        // Si el backend no devuelve estado_creacion, hacemos fallback heurístico:
        // productos sin precio o con flag custom (placeholder).
        const pending = all.filter(
          (p) => p.estado_creacion === 'pendiente_crear' || (!p.estado_creacion && p.is_pending_creation === true),
        );
        setItems(pending);
      }
    } catch (err) {
      setError(err?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [activeProject?.id, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleMarkCreated(item) {
    setMarking(null);
    try {
      // Endpoint backend pendiente; si no existe → graceful degradation
      await client.patch(`/products/${item.id}`, { estado_creacion: 'creado' });
      toast({
        title: `${productoLabel} marcado como creado`,
        description: `${item.nombre} está disponible para los gestores.`,
      });
      load();
    } catch (err) {
      if (err?.status === 404 || err?.status === 400) {
        toast({
          title: 'Backend pendiente',
          description: 'El endpoint para marcar como creado aún no está implementado (CRM-141).',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
      }
    }
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={`${productoLabelPlural} pendientes`}
          subtitle="Solo accesible para administradores y rol creador"
        />
        <EmptyState
          icon={Sparkle}
          title="Sin permisos"
          description={`Esta vista es para el equipo de creación de ${productoLabelPlural.toLowerCase()}. Pídele a un superadmin que te asigne el rol "creador" si necesitas acceso.`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={`${productoLabelPlural} pendientes`}
        subtitle={
          activeProject
            ? `Solicitudes de creación pendientes en ${activeProject.nombre}`
            : 'Selecciona un proyecto para ver las solicitudes'
        }
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      ) : error ? (
        <EmptyState
          icon={Package}
          title="No se pudo cargar la lista"
          description={error}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title={`Sin ${productoLabelPlural.toLowerCase()} pendientes`}
          description={`Todos los ${productoLabelPlural.toLowerCase()} solicitados están creados. Cuando un gestor solicite uno nuevo desde un lead, aparecerá aquí.`}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 flex items-center justify-center flex-shrink-0">
                  <Clock size={18} weight="duotone" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm leading-tight truncate">{item.nombre}</h3>
                  {item.descripcion && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.descripcion}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1 text-[11px] text-muted-foreground">
                {item.solicitado_por_nombre && (
                  <div className="flex items-center gap-1.5">
                    <User size={11} weight="regular" />
                    <span>Solicitado por <span className="text-foreground font-medium">{item.solicitado_por_nombre}</span></span>
                  </div>
                )}
                {item.solicitado_at && (
                  <div className="flex items-center gap-1.5">
                    <Clock size={11} weight="regular" />
                    <span>{fmtDate(item.solicitado_at)} <span className="text-muted-foreground/70">· {relativeFromNow(item.solicitado_at)}</span></span>
                  </div>
                )}
                {item.lead_id && (
                  <Link
                    to={`/leads/${item.lead_id}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <ArrowSquareOut size={11} weight="bold" /> Ver lead origen
                  </Link>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300 font-bold">
                  Pendiente
                </span>
                <button
                  onClick={() => setMarking(item)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                >
                  <CheckCircle size={12} weight="bold" /> Marcar creado
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!marking}
        title={`¿Marcar "${marking?.nombre}" como creado?`}
        message={`Se notificará a ${marking?.solicitado_por_nombre || 'la persona que lo solicitó'} de que el ${productoLabel.toLowerCase()} ya está disponible para vender.`}
        tone="success"
        confirmLabel="Sí, marcar como creado"
        onConfirm={() => marking && handleMarkCreated(marking)}
        onCancel={() => setMarking(null)}
      />
    </div>
  );
}
