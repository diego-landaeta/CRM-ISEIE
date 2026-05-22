import { useState, useEffect } from 'react';
import { X, Gear, FloppyDisk } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';

export interface ProjectSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  projectId?: number | null;
}

const PRESET_COLORS = [
  '#002776', '#1e40af', '#0891b2', '#059669', '#65a30d',
  '#ca8a04', '#dc2626', '#9333ea', '#db2777', '#475569',
];

const EMOJI_OPTIONS = ['📁', '🇪🇸', '🇲🇽', '🇨🇴', '🇨🇱', '🇪🇨', '🇵🇪', '🇵🇦', '🇨🇷', '🇦🇷', '🇧🇷', '🇨🇳', '🎓', '📚', '🚀', '⭐'];

export default function ProjectSettingsDialog({ open, onClose, projectId }: ProjectSettingsDialogProps) {
  const { user, refreshUser } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [form, setForm] = useState({
    nombre: '',
    emoji: '',
    theme_color: '',
    dias_alerta_inactividad: 14,
    active: true,
  });

  useEffect(() => {
    if (!open || !projectId) return;
    setLoading(true);
    client.get(`/projects/${projectId}`)
      .then((res: any) => {
        const p = res?.data || res;
        setProject(p);
        setForm({
          nombre: p?.nombre || '',
          emoji: p?.emoji || '',
          theme_color: p?.theme_color || '',
          dias_alerta_inactividad: p?.dias_alerta_inactividad || 14,
          active: p?.active !== false,
        });
      })
      .catch((err) => toast({ title: 'No se pudo cargar el proyecto', description: err?.message || 'Error', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  if (!open) return null;

  async function handleSave() {
    if (!projectId) return;
    setSaving(true);
    try {
      const payload: any = {
        nombre: form.nombre.trim() || undefined,
        emoji: form.emoji || null,
        theme_color: form.theme_color || null,
        dias_alerta_inactividad: form.dias_alerta_inactividad,
        active: form.active,
      };
      await client.patch(`/projects/${projectId}`, payload);
      toast({ title: 'Proyecto actualizado', description: form.nombre });
      if (refreshUser) await refreshUser();
      onClose();
    } catch (err: any) {
      toast({ title: 'No se pudo guardar', description: err?.message || 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Gear size={18} weight="duotone" className="text-primary" />
              Ajustes del proyecto
            </h2>
            {project && <p className="text-xs text-muted-foreground mt-1">{project.slug} · #{project.id}</p>}
          </div>
          <button onClick={() => !saving && onClose()} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading ? (
            <div className="text-center text-sm text-muted-foreground py-8">Cargando…</div>
          ) : !project ? (
            <div className="text-center text-sm text-muted-foreground py-8">Proyecto no encontrado.</div>
          ) : (
            <>
              {!isSuperadmin && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  Sólo un superadmin puede guardar cambios. Puedes ver la configuración actual.
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Nombre del proyecto</label>
                <input
                  type="text"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  disabled={!isSuperadmin}
                  className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Emoji / Icono</label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOJI_OPTIONS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      disabled={!isSuperadmin}
                      onClick={() => setForm({ ...form, emoji: e })}
                      className={`w-9 h-9 rounded-md text-lg flex items-center justify-center transition-colors ${
                        form.emoji === e ? 'bg-primary/15 ring-2 ring-primary' : 'bg-muted hover:bg-muted/70'
                      } disabled:opacity-60`}
                    >
                      {e}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!isSuperadmin}
                    onClick={() => setForm({ ...form, emoji: '' })}
                    className={`px-3 h-9 rounded-md text-[11px] text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 transition-colors disabled:opacity-60 ${!form.emoji ? 'ring-2 ring-primary text-primary' : ''}`}
                  >
                    Sin emoji
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Color primario</label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={!isSuperadmin}
                      onClick={() => setForm({ ...form, theme_color: c })}
                      title={c}
                      className={`w-8 h-8 rounded-md transition-transform ${form.theme_color === c ? 'ring-2 ring-offset-2 ring-foreground' : ''} disabled:opacity-60 hover:scale-110`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={form.theme_color}
                    onChange={(e) => setForm({ ...form, theme_color: e.target.value })}
                    placeholder="#002776"
                    disabled={!isSuperadmin}
                    className="flex-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-mono outline-none focus:border-primary disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, theme_color: '' })}
                    disabled={!isSuperadmin || !form.theme_color}
                    className="h-9 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                  >Reset</button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Días para marcar lead como inactivo</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={form.dias_alerta_inactividad}
                  onChange={(e) => setForm({ ...form, dias_alerta_inactividad: Number(e.target.value) })}
                  disabled={!isSuperadmin}
                  className="w-32 h-9 px-3 rounded-md border border-border bg-card text-sm outline-none focus:border-primary disabled:opacity-60"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Un lead sin interacciones después de N días aparece como "inactivo" en notificaciones.
                </p>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  disabled={!isSuperadmin}
                  className="w-4 h-4"
                />
                <span className="text-sm">
                  Proyecto activo
                  <span className="block text-xs text-muted-foreground">Si lo desactivas, deja de aparecer en el selector de país.</span>
                </span>
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          >{isSuperadmin ? 'Cancelar' : 'Cerrar'}</button>
          {isSuperadmin && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <FloppyDisk size={13} weight="bold" />
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
