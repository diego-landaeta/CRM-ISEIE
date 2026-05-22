import { useProjectContext } from '@/contexts/ProjectContext';
import { usePreferences } from '../hooks/usePreferences';
import PageHeader from '@/shared/components/ui/PageHeader';
import { Eye, Sliders } from '@phosphor-icons/react';

export default function PreferencesPage() {
  const { activeProject } = useProjectContext();
  const { preferences, update, loading } = usePreferences(activeProject?.id);

  return (
    <div className="space-y-6 pb-8 max-w-3xl">
      <PageHeader
        title="Mis preferencias"
        subtitle="Personaliza como ves el CRM. Solo afecta a tu cuenta."
      />

      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sliders size={18} weight="duotone" className="text-primary" />
          <h3 className="font-bold">Densidad de tablas</h3>
        </div>
        <div className="flex gap-2">
          {['comfortable', 'compact'].map(d => (
            <button key={d} onClick={() => update({ table_density: d })}
              className={`px-4 py-2 rounded-lg text-sm font-bold border ${preferences.table_density === d ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30'}`}>
              {d === 'comfortable' ? 'Comodo' : 'Compacto'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Eye size={18} weight="duotone" className="text-primary" />
          <h3 className="font-bold">Tema preferido</h3>
        </div>
        <div className="flex gap-2">
          {[
            { v: null, label: 'Auto (sistema)' },
            { v: 'light', label: 'Claro' },
            { v: 'dark', label: 'Oscuro' },
          ].map(t => (
            <button key={t.label} onClick={() => update({ theme_preference: t.v })}
              className={`px-4 py-2 rounded-lg text-sm font-bold border ${preferences.theme_preference === t.v ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-muted/30'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold mb-2">Items de sidebar ocultos</h3>
        <p className="text-xs text-muted-foreground mb-3">Marca los items que NO quieres ver en tu menu lateral.</p>
        <p className="text-sm text-muted-foreground italic">Pendiente UI drag&drop. {preferences.hidden_sidebar_items.length} ocultos.</p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-5">
        <h3 className="font-bold mb-2">Filtros guardados</h3>
        <p className="text-xs text-muted-foreground mb-3">Filtros personalizados de listados.</p>
        {preferences.saved_filters.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No tienes filtros guardados aun. Aparecen aqui cuando guardas un filtro desde Leads.</p>
        ) : (
          <ul className="space-y-1">
            {preferences.saved_filters.map(f => (
              <li key={f.id} className="text-sm">{f.name} · {f.scope}</li>
            ))}
          </ul>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Cargando...</p>}
    </div>
  );
}
