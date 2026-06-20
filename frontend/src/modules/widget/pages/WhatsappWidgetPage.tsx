import { useEffect, useState, useCallback } from 'react';
import { WhatsappLogo, FloppyDisk, Copy, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { widgetApi } from '../api/widget.api';
import type { WidgetConfig, CandidateUser } from '../api/widget.api';
import { toast } from '@/shared/hooks/useToast';

export default function WhatsappWidgetPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number; nombre?: string } };
  const pid = activeProject?.id;
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [users, setUsers] = useState<CandidateUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const r = await widgetApi.getConfig(pid);
      if (r.success && r.data) {
        setConfig(r.data.config);
        setUsers(r.data.candidates);
      }
    } finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { load(); }, [load]);

  async function saveConfig() {
    if (!config || !pid) return;
    setSaving(true);
    try {
      const r = await widgetApi.updateConfig({
        projectId: pid,
        enabled: config.enabled,
        welcome_text: config.welcome_text,
        message_template: config.message_template,
        excluded_user_ids: config.excluded_user_ids,
        show_bubble: config.show_bubble,
        bubble_delay_ms: config.bubble_delay_ms,
      });
      if (r.success) toast({ title: '✓ Widget actualizado' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function updateUser(u: CandidateUser, patch: Partial<CandidateUser>) {
    try {
      await widgetApi.updateUserPhone(u.id, {
        whatsapp_phone: patch.whatsapp_phone,
        whatsapp_display_name: patch.whatsapp_display_name,
        whatsapp_widget_active: patch.whatsapp_widget_active,
      });
      setUsers(users.map(x => x.id === u.id ? { ...x, ...patch } : x));
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;
  if (loading || !config) return <div className="p-8 text-muted-foreground">Cargando…</div>;

  const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const embedSrc = `${baseUrl}/api/w/whatsapp/${pid}.js`;
  const embedCode = `<script async src="${embedSrc}"></script>`;
  const activeInWidget = users.filter(u => u.in_project && u.whatsapp_widget_active && u.whatsapp_phone && !config.excluded_user_ids.includes(u.id));

  function copyEmbed() {
    navigator.clipboard.writeText(embedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-5 pb-8 max-w-4xl">
      <PageHeader
        title={(<span className="flex items-center gap-2"><WhatsappLogo size={22} weight="fill" className="text-green-600" /> Widget WhatsApp</span>) as unknown as string}
        subtitle={`Botón flotante rotativo para ${activeProject?.nombre}. Pegá el snippet en tu sitio web.`}
      />

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md p-3 flex items-start gap-2 text-xs">
        <span className="text-amber-600 dark:text-amber-400 text-base leading-none mt-0.5">⏱</span>
        <div>
          <strong className="text-amber-900 dark:text-amber-300">Los cambios realizados se verán reflejados en una hora</strong>
          <p className="text-amber-800 dark:text-amber-400 mt-0.5">
            El widget se cachea 1 hora en CDN para máxima velocidad y mínimo impacto SEO en tu landing. Si activas/desactivas una gestora, o cambias el mensaje, los visitantes verán el cambio dentro de los próximos 60 minutos.
          </p>
        </div>
      </div>

      {/* Embed snippet */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Código para tu sitio web</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            {activeInWidget.length} gestoras activas
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Copia este script y pégalo antes del <code className="px-1 bg-muted rounded text-[10px]">&lt;/body&gt;</code> de tu landing.
          El widget rota entre las gestoras activas en cada visita.
        </p>
        <div className="flex gap-2 items-stretch">
          <code className="flex-1 px-3 py-2 rounded-md bg-muted text-xs break-all font-mono">
            {embedCode}
          </code>
          <button onClick={copyEmbed}
            className="px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5 text-xs">
            {copied ? <><CheckCircle size={14} weight="bold" className="text-emerald-600" /> Copiado</> : <><Copy size={14} weight="bold" /> Copiar</>}
          </button>
        </div>
        <a href={embedSrc} target="_blank" rel="noopener" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
          Ver código generado <ArrowSquareOut size={11} />
        </a>
      </div>

      {/* Config */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="font-semibold text-sm">Configuración del widget</h3>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />
          Widget activo (mostrar el botón en el sitio)
        </label>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Texto de la burbuja</label>
          <input value={config.welcome_text} onChange={e => setConfig({ ...config, welcome_text: e.target.value })}
            placeholder="¡Hablamos? 👋"
            className="w-full h-9 px-3 mt-1 rounded-md border border-border bg-background text-sm" />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground">Plantilla del mensaje</label>
          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-2 mt-1 mb-2 text-[10px]">
            <strong className="text-blue-900 dark:text-blue-300">Variables disponibles:</strong>
            <div className="flex flex-wrap gap-2 mt-1">
              <code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded">{'{{nombre}}'}</code>
              <span className="text-muted-foreground">→ nombre de la gestora que sale en la rotación</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded">{'{{project}}'}</code>
              <span className="text-muted-foreground">→ nombre del proyecto ({config.project_nombre})</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-1">
              <code className="bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded">{'{{url}}'}</code>
              <span className="text-muted-foreground">→ URL de la página donde está embebido el widget</span>
            </div>
          </div>
          <input value={config.message_template} onChange={e => setConfig({ ...config, message_template: e.target.value })}
            placeholder="Hola, soy {{nombre}} de {{project}}. Quiero información sobre: {{url}}"
            className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono" />
          {(() => {
            const firstActive = users.find(u => u.in_project && u.whatsapp_widget_active && u.whatsapp_phone && !config.excluded_user_ids.includes(u.id));
            const preview = (config.message_template || '')
              .replace(/\{\{nombre\}\}/g, firstActive ? (firstActive.whatsapp_display_name || firstActive.nombre) : '(gestora)')
              .replace(/\{\{project\}\}/g, config.project_nombre || '(proyecto)')
              .replace(/\{\{url\}\}/g, 'https://tu-landing.com/curso-xyz');
            return (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 italic">
                Vista previa: «{preview}»
              </p>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={config.show_bubble} onChange={e => setConfig({ ...config, show_bubble: e.target.checked })} />
            Mostrar burbuja con nombre
          </label>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Aparece a los (ms)</label>
            <input type="number" min="0" value={config.bubble_delay_ms}
              onChange={e => setConfig({ ...config, bubble_delay_ms: Number(e.target.value) })}
              className="w-full h-9 px-3 mt-1 rounded-md border border-border bg-background text-sm" />
          </div>
        </div>

        <button onClick={saveConfig} disabled={saving}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
          <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>

      {/* Gestoras */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-sm">Gestoras de {config.project_nombre}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Solo aparecen las gestoras asignadas a este proyecto. Activa/desactiva la rotación con los checkboxes.
          </p>
        </div>
        {users.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Este proyecto no tiene usuarios asignados todavía.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">Gestora</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">WhatsApp (sin +)</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">Nombre alt</th>
                <th className="px-3 py-2 text-center text-[11px] text-muted-foreground">En widget (todos proyectos)</th>
                <th className="px-3 py-2 text-center text-[11px] text-muted-foreground">Excluir solo aquí</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const excluded = config.excluded_user_ids.includes(u.id);
                const inRotation = u.whatsapp_widget_active && !excluded && !!u.whatsapp_phone;
                return (
                  <tr key={u.id} className={`border-b last:border-0 hover:bg-muted/30 ${inRotation ? 'bg-emerald-50/50 dark:bg-emerald-950/10' : ''}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium flex items-center gap-1.5">
                        {u.nombre}
                        {inRotation && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">EN WIDGET</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{u.role}</div>
                    </td>
                    <td className="px-3 py-2">
                      <input value={u.whatsapp_phone || ''}
                        onChange={e => setUsers(users.map(x => x.id === u.id ? { ...x, whatsapp_phone: e.target.value } : x))}
                        onBlur={e => updateUser(u, { whatsapp_phone: e.target.value || null })}
                        placeholder="34612345678"
                        className="h-8 px-2 rounded border border-border bg-background text-xs font-mono w-36" />
                    </td>
                    <td className="px-3 py-2">
                      <input value={u.whatsapp_display_name || ''}
                        onChange={e => setUsers(users.map(x => x.id === u.id ? { ...x, whatsapp_display_name: e.target.value } : x))}
                        onBlur={e => updateUser(u, { whatsapp_display_name: e.target.value || null })}
                        placeholder="(igual al nombre)"
                        className="h-8 px-2 rounded border border-border bg-background text-xs w-32" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={u.whatsapp_widget_active}
                        onChange={e => updateUser(u, { whatsapp_widget_active: e.target.checked })} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={excluded}
                        onChange={e => {
                          const next = e.target.checked
                            ? [...config.excluded_user_ids, u.id]
                            : config.excluded_user_ids.filter(id => id !== u.id);
                          setConfig({ ...config, excluded_user_ids: next });
                        }} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-muted-foreground bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-md p-3">
        <strong>Cómo funciona:</strong>
        <ul className="list-disc list-inside mt-1 space-y-0.5">
          <li>Solo aparecen los usuarios asignados a <strong>{config.project_nombre}</strong>. Si falta alguien, asignalo desde Configuración del proyecto.</li>
          <li><strong>"En widget"</strong> es global del usuario — si lo activás también la incluye en widgets de otros proyectos donde participe.</li>
          <li><strong>"Excluir solo aquí"</strong> la quita SOLO de este widget (sin tocar otros proyectos).</li>
          <li>Cada proyecto = su propio URL/widget independiente.</li>
        </ul>
      </div>
    </div>
  );
}
