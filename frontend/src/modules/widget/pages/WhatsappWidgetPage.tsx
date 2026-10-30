import { useEffect, useState, useCallback } from 'react';
import { WhatsappLogo, FloppyDisk, Copy, ArrowSquareOut, CheckCircle } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { widgetApi } from '../api/widget.api';
import type { WidgetConfig, CandidateUser } from '../api/widget.api';
import { toast } from '@/shared/hooks/useToast';
import { construirSnippet, IDIOMAS_WIDGET, type IdiomaWidget } from '../lib/snippet';
import { POR_DEFECTO_WIDGET } from '../lib/porDefecto';
import PulsacionesDelBoton from '../components/PulsacionesDelBoton';

type OtroIdioma = Exclude<IdiomaWidget, 'es'>;

export default function WhatsappWidgetPage() {
  const { activeProject, activeIssuerId, activeIssuer } = useProjectContext() as {
    activeProject: { id?: number; nombre?: string } | null;
    activeIssuerId?: number | null;
    activeIssuer?: { nombre?: string } | null;
  };
  // Con una empresa o «Todos» arriba no hay un campus que configurar: se ven las
  // cifras sumadas (Diego, 30/10: «sigue sin tener la vista de empresa»).
  const pid = !activeIssuerId && activeProject?.id && Number(activeProject.id) > 0 ? Number(activeProject.id) : undefined;
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [users, setUsers] = useState<CandidateUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  // Idiomas (12/10): la pestaña de textos que se edita y el idioma del código para la web.
  const [idiomaTab, setIdiomaTab] = useState<IdiomaWidget>('es');
  const [idiomaCodigo, setIdiomaCodigo] = useState<IdiomaWidget | ''>('');

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
        traducciones: config.traducciones || {},
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

  if (!pid) {
    return (
      <div className="space-y-5 pb-8 max-w-4xl">
        <PageHeader
          title={(<span className="flex items-center gap-2"><WhatsappLogo size={22} weight="fill" className="text-green-600" /> Widget WhatsApp</span>) as unknown as string}
          subtitle={activeIssuerId ? `Los campus de ${activeIssuer?.nombre || 'la empresa'}, sumados.` : 'Todos los campus, sumados.'}
        />
        <PulsacionesDelBoton
          ambito={{ issuerId: activeIssuerId ? Number(activeIssuerId) : null }}
          titulo={activeIssuerId ? activeIssuer?.nombre || 'la empresa' : 'todos los campus'}
        />
        <p className="text-xs text-muted-foreground">
          El botón (gestoras, textos y el código para la web) se configura en cada campus: elígelo en la cabecera.
        </p>
      </div>
    );
  }
  if (loading || !config) return <div className="p-8 text-muted-foreground">Cargando…</div>;

  const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const dataUrl = `${baseUrl}/api/w/data/${pid}.json`;
  // El código para la web, con el idioma elegido (vacío = el de cada página). Ver lib/snippet.ts.
  const embedCode = construirSnippet({ dataUrl, idioma: idiomaCodigo });
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

      {/* Cuántos pulsan y cuántos pasan a la conversación (29/10). */}
      <PulsacionesDelBoton ambito={{ projectId: pid }} />

      {/* Embed snippet */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Código para tu sitio web</h3>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
            {activeInWidget.length} gestoras activas
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label htmlFor="idioma-codigo" className="font-semibold text-muted-foreground">Idioma del botón</label>
          <select id="idioma-codigo" value={idiomaCodigo} onChange={(e) => setIdiomaCodigo(e.target.value as IdiomaWidget | '')}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs">
            <option value="">Automático (el de cada página)</option>
            {IDIOMAS_WIDGET.map((i) => <option key={i.codigo} value={i.codigo}>Siempre en {i.nombre}</option>)}
          </select>
          <span className="text-muted-foreground">
            {idiomaCodigo ? 'Para webs de un solo idioma.' : 'Una web con varios idiomas usa el mismo código: cada página sale en el suyo.'}
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
          Si en Conexión › Asignación de leads está encendida para este campus, el botón lleva a la gestora activa a la que le toca;
          si no hay ninguna activa, sigue al azar. Pulsar no asigna nada: cuenta cuando la persona escribe o cuando se registra el lead.
        </p>
        <a href={dataUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
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

        {/* Los textos, por idioma (12/10). El español es el de siempre; en los demás, vacío = el de por defecto. */}
        <div>
          <div role="tablist" aria-label="Idioma de los textos" className="inline-flex flex-wrap gap-1 rounded-md bg-muted p-0.5 text-xs">
            {IDIOMAS_WIDGET.map((i) => {
              const escrito = i.codigo !== 'es' && !!(config.traducciones?.[i.codigo as OtroIdioma]?.welcome || config.traducciones?.[i.codigo as OtroIdioma]?.template);
              return (
                <button key={i.codigo} type="button" role="tab" aria-selected={idiomaTab === i.codigo} onClick={() => setIdiomaTab(i.codigo)}
                  className={`rounded px-3 py-1 font-medium ${idiomaTab === i.codigo ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {i.nombre}{i.codigo === 'es' ? ' (base)' : escrito ? ' ✓' : ''}
                </button>
              );
            })}
          </div>
          {idiomaTab !== 'es' && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Lo ven las páginas de la web en {IDIOMAS_WIDGET.find((i) => i.codigo === idiomaTab)?.nombre}. Si lo dejas vacío, sale el texto por defecto (el que ves en gris).
            </p>
          )}
        </div>

        {(() => {
          const esBase = idiomaTab === 'es';
          const otro = idiomaTab as OtroIdioma;
          const trad = esBase ? {} : (config.traducciones?.[otro] || {});
          const defecto = esBase ? null : POR_DEFECTO_WIDGET[otro];
          const welcome = esBase ? config.welcome_text : (trad.welcome || '');
          const template = esBase ? config.message_template : (trad.template || '');
          const poner = (campo: 'welcome' | 'template', valor: string) => {
            if (esBase) {
              setConfig({ ...config, ...(campo === 'welcome' ? { welcome_text: valor } : { message_template: valor }) });
              return;
            }
            const actual = config.traducciones || {};
            setConfig({ ...config, traducciones: { ...actual, [otro]: { ...(actual[otro] || {}), [campo]: valor } } });
          };
          const firstActive = users.find(u => u.in_project && u.whatsapp_widget_active && u.whatsapp_phone && !config.excluded_user_ids.includes(u.id));
          const nombreG = firstActive ? (firstActive.whatsapp_display_name || firstActive.nombre) : '(gestora)';
          const preview = (template || defecto?.template || '')
            .replace(/\{\{nombre\}\}/g, nombreG)
            .replace(/\{\{project\}\}/g, config.project_nombre || '(proyecto)')
            .replace(/\{\{url\}\}/g, 'https://tu-landing.com/curso-xyz');
          return (
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Texto de la burbuja</label>
                <input value={welcome} onChange={e => poner('welcome', e.target.value)}
                  placeholder={defecto?.welcome || '¿Hablamos? 👋'} maxLength={500}
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
                <input value={template} onChange={e => poner('template', e.target.value)}
                  placeholder={defecto?.template || 'Hola {{nombre}} de {{project}}. Quiero información sobre: {{url}}'} maxLength={1000}
                  className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-mono" />
                <div className="mt-2 rounded-md border border-border bg-muted/30 p-2 text-[11px]">
                  <div className="text-muted-foreground">Vista previa · {IDIOMAS_WIDGET.find((i) => i.codigo === idiomaTab)?.nombre}</div>
                  <div className="mt-1"><b className="text-emerald-700 dark:text-emerald-400">{nombreG}</b> {welcome || defecto?.welcome}</div>
                  <div className="mt-0.5 italic text-emerald-700 dark:text-emerald-400">«{preview}»</div>
                </div>
              </div>
            </>
          );
        })()}

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
            Solo aparecen las gestoras y los admin de este proyecto. Activa/desactiva la rotación con los checkboxes.
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
