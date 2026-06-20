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
  const dataUrl = `${baseUrl}/api/w/data/${pid}.json`;
  // Snippet INLINE (igual que psikoaprende/opynio): el botón es HTML puro pintado
  // directo en la página → aparece SIEMPRE, fijo a la derecha, sin depender de
  // cargar scripts externos (que WP Rocket/LiteSpeed delayán o matan).
  // Un mini-script inline hace fetch al CRM para rotar gestora y armar el href.
  const embedCode = `<!-- WhatsApp CRM360 -->
<style>
#c3w{position:fixed!important;bottom:20px!important;right:16px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;align-items:flex-end!important;gap:8px!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important}
#c3w-tag{display:none!important;background:#fff!important;color:#111!important;border-radius:14px!important;padding:8px 14px!important;box-shadow:0 3px 14px rgba(0,0,0,.15)!important;font-size:14px!important;white-space:nowrap!important;cursor:pointer!important;line-height:1.4!important}
#c3w-tag.s{display:block!important}
#c3w-tag b{color:#25D366!important;font-weight:700!important}
#c3w-btn{width:58px!important;height:58px!important;background:#25D366!important;border:none!important;border-radius:50%!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;box-shadow:0 4px 16px rgba(37,211,102,.5)!important;padding:0!important;margin:0!important;transition:transform .2s!important}
#c3w-btn:hover{transform:scale(1.08)!important}
#c3w-btn svg{width:30px!important;height:30px!important;fill:#fff!important;display:block!important}
</style>
<div id="c3w" role="complementary">
  <div id="c3w-tag"><b id="c3w-name"></b> <span id="c3w-msg"></span></div>
  <button id="c3w-btn" aria-label="WhatsApp" type="button">
    <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>
  </button>
</div>
<script>
(function(){if(window.__c3w)return;window.__c3w=1;
var wa=null,btn=document.getElementById('c3w-btn'),tag=document.getElementById('c3w-tag'),nm=document.getElementById('c3w-name'),mg=document.getElementById('c3w-msg');
function go(){if(wa)window.open(wa,'_blank')}
btn.addEventListener('click',go);tag.addEventListener('click',go);
fetch('${dataUrl}').then(function(r){return r.json()}).then(function(d){
  if(!d.enabled||!d.gestoras||!d.gestoras.length){document.getElementById('c3w').style.display='none';return}
  var p=d.gestoras[Math.floor(Math.random()*d.gestoras.length)];
  var msg=(d.template||'Hola, quiero información: {{url}}').replace(/\\{\\{nombre\\}\\}/g,p[0]).replace(/\\{\\{project\\}\\}/g,d.project||'').replace(/\\{\\{url\\}\\}/g,location.href);
  wa='https://wa.me/'+p[1]+'?text='+encodeURIComponent(msg);
  nm.textContent=p[0];mg.textContent=d.welcome||'¿Hablamos? 👋';
  setTimeout(function(){tag.className='s'},3000);
  setTimeout(function(){tag.className=''},15000);
}).catch(function(){document.getElementById('c3w').style.display='none'});
})();
</script>`;
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
          <strong className="text-amber-900 dark:text-amber-300">Los cambios se reflejan en ~1 minuto</strong>
          <p className="text-amber-800 dark:text-amber-400 mt-0.5">
            Si activas/desactivas una gestora o cambias el mensaje, los visitantes verán el cambio en menos de 1 minuto. El widget carga de forma asíncrona (impacto SEO cero).
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
          Copia este código y pégalo antes del <code className="px-1 bg-muted rounded text-[10px]">&lt;/body&gt;</code> de tu landing
          (en WordPress: Elementor → Configuración del sitio → Código personalizado → "End of body").
        </p>
        <div className="flex gap-2 items-stretch">
          <textarea readOnly value={embedCode} onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            className="flex-1 h-32 px-3 py-2 rounded-md bg-muted text-[10px] font-mono resize-none" />
          <button onClick={copyEmbed}
            className="px-3 rounded-md border border-border hover:bg-muted inline-flex items-center gap-1.5 text-xs self-start">
            {copied ? <><CheckCircle size={14} weight="bold" className="text-emerald-600" /> Copiado</> : <><Copy size={14} weight="bold" /> Copiar</>}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          El botón es HTML inline → aparece <strong>siempre</strong>, fijo abajo-derecha, sin que WP Rocket/LiteSpeed lo bloqueen.
          La rotación de gestoras se actualiza desde el CRM automáticamente.
        </p>
        <a href={dataUrl} target="_blank" rel="noopener" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
          Ver datos del widget <ArrowSquareOut size={11} />
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
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">Gestora (interno)</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">WhatsApp (sin +)</th>
                <th className="px-3 py-2 text-left text-[11px] text-muted-foreground">Nombre visible en el botón ⭐</th>
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
                        placeholder="Ej: Diana"
                        className="h-8 px-2 rounded border border-amber-300 bg-amber-50/50 dark:bg-amber-950/10 text-xs w-32 font-medium" />
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
