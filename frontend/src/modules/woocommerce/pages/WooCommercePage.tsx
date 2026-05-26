import { useEffect, useState, useCallback, useRef } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { ShoppingBag, FloppyDisk, ArrowsClockwise, Eye } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';

type SourceStrategy = 'wc_only' | 'wc_plus_cpt';
type ScrapeStrategy = 'plain_text' | 'preserve_html';

interface WooCredentials {
  store_url: string;
  consumer_key: string;
  consumer_secret?: string;
  auto_sync_enabled?: boolean;
  sync_interval_minutes?: number;
  default_currency?: string;
  wp_user?: string | null;
  wp_app_password?: string | null;
  source_strategy?: SourceStrategy;
  cpt_endpoints?: string[];
  scraper_enabled?: boolean;
  scrape_strategy?: ScrapeStrategy;
  section_keywords?: Record<string, string[]>;
}

interface WooForm {
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  auto_sync_enabled: boolean;
  sync_interval_minutes: number;
  default_currency: string;
  wp_user: string;
  wp_app_password: string;
  source_strategy: SourceStrategy;
  cpt_endpoints: string[];
  scraper_enabled: boolean;
  scrape_strategy: ScrapeStrategy;
  section_keywords: Record<string, string[]>;
}

// Defaults expandidos: cubre muchos disenos WP/Elementor habituales en
// LATAM y Espana. Match case+accent insensitive contra el texto de <h2>.
const DEFAULT_SECTION_KEYWORDS: Record<string, string[]> = {
  presentacion: ['presentaci', 'introducci', 'sobre el curso', 'sobre el programa', 'acerca del', 'descripci'],
  objetivos: ['objetivo', 'metas', 'lograras', 'aprenderas', 'que vas a aprender', 'que aprenderas'],
  beneficios: ['beneficio', 'ventajas', 'que obtienes', 'que ofrece', 'lo que conseguiras'],
  dirigido_a: ['dirigido', 'para quien', 'a quien va', 'destinatarios', 'perfil del alumno', 'requisitos'],
  para_que_te_prepara: ['te prepara', 'salidas profesionales', 'oportunidades laborales', 'salida laboral', 'campo laboral', 'donde trabajar'],
  por_que_estudiar: ['por que estudiar', 'por que elegir', 'por que cursar', 'razones para', 'que diferencia'],
  modulos: ['modulo', 'modulos', 'unidad', 'unidades', 'tema', 'temario', 'temas', 'contenido del curso', 'contenido', 'syllabus', 'plan de estudios', 'programa del curso', 'estructura del curso', 'leccion', 'lecciones', 'capitulo', 'capitulos', 'bloque'],
  metodologia: ['metodologi', 'como se imparte', 'modalidad de estudio', 'forma de estudio', 'sistema de estudio'],
  faqs: ['pregunta frecuente', 'preguntas frecuente', 'faq', 'dudas', 'preguntas comunes', 'consultas', 'preguntas mas'],
  profesores: ['profesor', 'profesora', 'docente', 'instructor', 'instructora', 'claustro', 'profesorado', 'equipo docente', 'tutor', 'tutora', 'equipo academico'],
  certificacion: ['certificado', 'certificaci', 'titulaci', 'acreditaci', 'diploma'],
};

const CURRENCIES = ['EUR', 'USD', 'GBP', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BOB', 'VES', 'BRL', 'JPY', 'CHF'];

type RunStatus = 'success' | 'error' | 'running' | string;

interface WooRun {
  id: number;
  started_at: string;
  status: RunStatus;
  total_fetched: number;
  total_created: number;
  total_updated: number;
  total_skipped: number;
  error_message?: string | null;
}

interface SchemaItem { path: string; type: string; sample?: any }
interface TargetField { key: string; label: string; type: string; required?: boolean; group: string }

interface ScrapedData {
  titulo?: string;
  url_used?: string;
  meta_box?: Record<string, { text?: string; value?: number; unit?: string; iso_date?: string; type?: string }>;
  sections?: Record<string, string>;
  sections_meta?: Record<string, Array<{ heading: string; length: number }>>;
  imagen_og?: string;
  meta_description?: string;
  html_size?: number;
  error?: string;
}

interface CptSchema {
  slug?: string | null;
  id?: number | null;
  title?: string | null;
  acf_fields: Array<{ path: string; label: string; type: string; sample: string | null }>;
}

// Una fuente de mapping puede ser un string (path unico) o array de strings.
type MappingSource = string | string[];

interface WooPreview {
  count: number;
  sample: any[];
  schema?: SchemaItem[];
  scraped?: ScrapedData | null;
  targets?: TargetField[];
  sugeridos?: Record<string, MappingSource>;
  current_mapping?: Record<string, MappingSource>;
  mapped_preview?: Record<string, any>;
  cpt?: CptSchema | null;
}

export default function WooCommercePage() {
  const { activeProject } = useProjectContext() as any;
  const [creds, setCreds] = useState<WooCredentials | null>(null);
  const [form, setForm] = useState<WooForm>({
    store_url: '', consumer_key: '', consumer_secret: '',
    auto_sync_enabled: false, sync_interval_minutes: 30, default_currency: 'EUR',
    wp_user: '', wp_app_password: '',
    source_strategy: 'wc_only', cpt_endpoints: [],
    scraper_enabled: false, scrape_strategy: 'plain_text',
    section_keywords: DEFAULT_SECTION_KEYWORDS,
  });
  const [testUrl, setTestUrl] = useState('');
  const [scrapePreview, setScrapePreview] = useState<any | null>(null);
  const [scrapingPreview, setScrapingPreview] = useState(false);
  const [runs, setRuns] = useState<WooRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [previewData, setPreviewData] = useState<WooPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, MappingSource>>({});
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<any>(null);
  const [savingMapping, setSavingMapping] = useState(false);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleAutoDiscover() {
    if (!activeProject?.id) return;
    setDiscovering(true);
    try {
      // project_id va en el body, no solo en query (el schema Zod lo exige)
      await client.put('/woocommerce/credentials', { project_id: activeProject.id, ...form });
      const res = await client.post(`/woocommerce/auto-discover-cpts?projectId=${activeProject.id}`, { apply: true });
      if (res.success) {
        setDiscoverResult(res.data);
        if (res.data.applied) {
          setForm((f) => ({
            ...f,
            source_strategy: 'wc_plus_cpt',
            cpt_endpoints: res.data.recommended_slugs,
          }));
          toast({ title: 'CPTs detectados y aplicados', description: `${res.data.recommended_slugs.length} endpoints configurados` });
        } else if (res.data.detected.length === 0) {
          toast({ title: 'Sin CPTs con ACF', description: 'Esta tienda parece no usar CPTs custom. Quedas con WC solo.' });
        }
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setDiscovering(false);
    }
  }

  useEffect(() => () => {
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
  }, []);

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const [c, r] = await Promise.all([
        client.get(`/woocommerce/credentials?projectId=${activeProject.id}`),
        client.get(`/woocommerce/runs?projectId=${activeProject.id}`),
      ]);
      if (c.success) {
        const data = c.data as WooCredentials | null;
        setCreds(data);
        if (data) setForm({
          store_url: data.store_url,
          consumer_key: data.consumer_key,
          consumer_secret: '',
          auto_sync_enabled: data.auto_sync_enabled || false,
          sync_interval_minutes: data.sync_interval_minutes || 30,
          default_currency: data.default_currency || 'EUR',
          wp_user: data.wp_user || '',
          wp_app_password: '',
          source_strategy: data.source_strategy || 'wc_only',
          cpt_endpoints: Array.isArray(data.cpt_endpoints) ? data.cpt_endpoints : [],
          scraper_enabled: !!data.scraper_enabled,
          scrape_strategy: data.scrape_strategy || 'plain_text',
          section_keywords: data.section_keywords || DEFAULT_SECTION_KEYWORDS,
        });
      }
      if (r.success) setRuns(Array.isArray(r.data) ? (r.data as WooRun[]) : []);
    } finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  async function saveCreds(): Promise<void> {
    if (!activeProject?.id) return;
    try {
      await client.put('/woocommerce/credentials', { project_id: activeProject.id, ...form });
      toast({ title: 'Credenciales guardadas' });
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  async function importNow(): Promise<void> {
    if (!activeProject?.id) return;
    setImporting(true);
    try {
      await client.post(`/woocommerce/runs/start?projectId=${activeProject.id}`);
      toast({ title: 'Import iniciado en background' });
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = setTimeout(load, 3000);
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setImporting(false); }
  }
  const [previewUrl, setPreviewUrl] = useState('');
  async function preview(customUrl?: string): Promise<void> {
    if (!activeProject?.id) return;
    try {
      const qsUrl = customUrl ? `&url=${encodeURIComponent(customUrl)}` : '';
      const res = await client.get(`/woocommerce/preview?projectId=${activeProject.id}${qsUrl}`);
      if (res.success && res.data) {
        const data = res.data as WooPreview;
        setPreviewData(data);
        const initial = (data.current_mapping && Object.keys(data.current_mapping).length > 0)
          ? data.current_mapping
          : (data.sugeridos || {});
        setMapping(initial);
        const desc = customUrl
          ? `Previsualizando producto de: ${customUrl}`
          : `${data.count} productos en la tienda. Configura el mapeo abajo y guardalo antes de importar.`;
        toast({ title: 'Preview cargado', description: desc });
      }
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  async function saveMapping(): Promise<void> {
    if (!activeProject?.id) return;
    setSavingMapping(true);
    try {
      await client.put(`/woocommerce/mapping?projectId=${activeProject.id}`, { field_mapping: mapping });
      toast({ title: 'Mapeo guardado', description: 'Se aplicara en la proxima importacion' });
      // Refrescar preview para ver mapped_preview con los cambios
      await preview();
    } catch (err: any) {
      toast({ title: 'Error guardando mapeo', description: err?.message || 'Error desconocido', variant: 'destructive' });
    } finally {
      setSavingMapping(false);
    }
  }

  // Reemplaza la lista entera de fuentes para un campo (compat).
  function updateMapping(crmField: string, sourcePath: string) {
    setMapping((prev) => {
      const next = { ...prev };
      if (sourcePath) next[crmField] = sourcePath;
      else delete next[crmField];
      return next;
    });
  }
  // Anade una fuente extra a un campo (resultado: array, se concatena con \n\n).
  function addMappingSource(crmField: string, sourcePath: string) {
    if (!sourcePath) return;
    setMapping((prev) => {
      const cur = prev[crmField];
      const arr = Array.isArray(cur) ? [...cur] : (cur ? [cur] : []);
      if (arr.includes(sourcePath)) return prev;
      arr.push(sourcePath);
      return { ...prev, [crmField]: arr };
    });
  }
  // Quita una fuente concreta de un campo (si queda 1, se vuelve string).
  function removeMappingSource(crmField: string, sourcePath: string) {
    setMapping((prev) => {
      const cur = prev[crmField];
      const arr = Array.isArray(cur) ? cur.filter((s) => s !== sourcePath) : (cur === sourcePath ? [] : (cur ? [cur] : []));
      const next = { ...prev };
      if (arr.length === 0) delete next[crmField];
      else if (arr.length === 1) next[crmField] = arr[0];
      else next[crmField] = arr;
      return next;
    });
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="WooCommerce" subtitle="Importar productos desde tu tienda" />

      <div className="bg-card border border-border rounded-2xl p-5 w-full space-y-3">
        <h3 className="font-bold">Credenciales</h3>
        <input value={form.store_url} onChange={e => setForm({ ...form, store_url: e.target.value })} placeholder="https://tu-tienda.com" className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
        <input value={form.consumer_key} onChange={e => setForm({ ...form, consumer_key: e.target.value })} placeholder="Consumer key (ck_...)" className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm font-mono text-xs" />
        <input value={form.consumer_secret} onChange={e => setForm({ ...form, consumer_secret: e.target.value })} type="password" placeholder={creds ? '(sin cambios - dejar vacio para mantener)' : 'Consumer secret (cs_...)'} className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm font-mono text-xs" />

        <label className="block text-xs">
          <span className="font-bold uppercase text-muted-foreground">Divisa por defecto</span>
          <select
            value={form.default_currency}
            onChange={e => setForm({ ...form, default_currency: e.target.value })}
            className="mt-1 w-40 h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm"
          >
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-1">
            Se aplicara a TODOS los productos importados de esta tienda. WooCommerce no expone la moneda por producto en su API estandar.
          </p>
        </label>

        <div className="pt-3 border-t border-border space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.auto_sync_enabled} onChange={e => setForm({ ...form, auto_sync_enabled: e.target.checked })} />
            <strong>Sincronizacion automatica</strong>
          </label>
          {form.auto_sync_enabled && (
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">Cada cuantos minutos</span>
              <input type="number" min="5" max="1440" value={form.sync_interval_minutes} onChange={e => setForm({ ...form, sync_interval_minutes: Number(e.target.value) })} className="mt-1 w-32 h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
            </label>
          )}
          <p className="text-xs text-muted-foreground">{form.auto_sync_enabled ? `El servidor revisa cada ${form.sync_interval_minutes} min y solo importa si cambia la cantidad de productos en WC.` : 'Sin auto-sync: deberas pulsar "Importar ahora" manualmente.'}</p>
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <h4 className="text-xs font-bold uppercase text-muted-foreground">WordPress REST API (para ACF / CPTs)</h4>
          <input
            value={form.wp_user}
            onChange={e => setForm({ ...form, wp_user: e.target.value })}
            placeholder="Usuario WP admin"
            className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm"
          />
          <input
            value={form.wp_app_password}
            onChange={e => setForm({ ...form, wp_app_password: e.target.value })}
            type="password"
            placeholder={creds?.wp_user ? '(sin cambios - dejar vacio para mantener)' : 'Application Password de WP'}
            className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm font-mono text-xs"
          />

          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">Estrategia de origen</span>
            <select
              value={form.source_strategy}
              onChange={e => setForm({ ...form, source_strategy: e.target.value as SourceStrategy })}
              className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm"
            >
              <option value="wc_only">Solo WooCommerce ( /wc/v3/products )</option>
              <option value="wc_plus_cpt">WC + Custom Post Types (cursos, masters, diplomados...)</option>
            </select>
          </label>

          <div className="pt-1">
            <button
              type="button"
              onClick={handleAutoDiscover}
              disabled={discovering}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary text-xs font-semibold disabled:opacity-50"
            >
              {discovering ? 'Detectando...' : 'Auto-detectar CPTs'}
            </button>
            <p className="text-[10px] text-muted-foreground mt-1">
              Llama a <code>/wp-json/wp/v2/types</code> con las credenciales WP de arriba, descubre los CPTs custom con ACF (cursos, masters...) y los configura solo.
              Requiere wp_user + wp_app_password.
            </p>
            {discoverResult && (
              <div className={`mt-2 p-2.5 rounded-md text-xs ${discoverResult.applied ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800' : 'bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800'}`}>
                <p className="font-semibold mb-1">
                  {discoverResult.applied ? 'Aplicado' : 'Detectados'}: {discoverResult.recommended_slugs.length} CPT(s)
                </p>
                <ul className="space-y-0.5 ml-3">
                  {discoverResult.detected.map((d: any) => (
                    <li key={d.slug}>
                      <code className="font-mono">{d.slug}</code> - {d.acf_fields_count} campos ACF - ej. <em>{d.sample_title?.slice(0,50)}</em>
                    </li>
                  ))}
                </ul>
                {discoverResult.cpt_sync_enabled && (
                  <p className="mt-1.5 text-[10px] italic">Detectado: el WC vincula productos a CPT via <code>_cpt_sync_source_id</code>.</p>
                )}
              </div>
            )}
          </div>

          {form.source_strategy === 'wc_plus_cpt' && (
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">CPT endpoints (uno por linea - sin /wp/v2/)</span>
              <textarea
                value={form.cpt_endpoints.join('\n')}
                onChange={e => setForm({ ...form, cpt_endpoints: e.target.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean) })}
                placeholder={'cursos\nmasters\ndiplomados'}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Se llamara a {`{store_url}`}/wp-json/wp/v2/{`{slug}`} con el WP user/App Password.</p>
            </label>
          )}
        </div>

        <div className="pt-3 border-t border-border space-y-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={form.scraper_enabled}
              onChange={e => setForm({ ...form, scraper_enabled: e.target.checked })}
            />
            <strong>Scraper HTML del permalink</strong>
            <span className="text-[10px] text-muted-foreground">- extrae presentacion, modulos, FAQs, etc. de cada producto</span>
          </label>

          {form.scraper_enabled && (
            <>
              <label className="block text-xs">
                <span className="font-bold uppercase text-muted-foreground">Formato extraido</span>
                <select
                  value={form.scrape_strategy}
                  onChange={e => setForm({ ...form, scrape_strategy: e.target.value as ScrapeStrategy })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm"
                >
                  <option value="plain_text">Texto plano (recomendado)</option>
                  <option value="preserve_html">Conservar HTML (formato rico)</option>
                </select>
              </label>

              <details className="text-xs">
                <summary className="cursor-pointer font-semibold">Keywords por seccion (clic para editar)</summary>
                <div className="mt-2 space-y-2 max-h-80 overflow-auto p-2 bg-muted/30 rounded">
                  {Object.keys(form.section_keywords).map((key) => (
                    <div key={key} className="grid grid-cols-[140px_1fr] gap-2 items-start">
                      <label className="text-[11px] font-mono">{key}</label>
                      <input
                        value={form.section_keywords[key].join(', ')}
                        onChange={(e) => {
                          const arr = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                          setForm({ ...form, section_keywords: { ...form.section_keywords, [key]: arr } });
                        }}
                        className="h-8 px-2 rounded border border-border bg-card text-[11px] font-mono"
                      />
                    </div>
                  ))}
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Los keywords se buscan en los &lt;h2&gt; del HTML publico del producto (case + acento insensitive). Orden = prioridad.
                  </p>
                </div>
              </details>

              {/* Test URL */}
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200">
                <p className="text-[11px] font-bold text-amber-900 dark:text-amber-300 uppercase mb-1">Probar scraper en una URL</p>
                <div className="flex gap-2">
                  <input
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder="https://tu-tienda.com/curso/..."
                    className="flex-1 h-9 px-2 rounded border border-border bg-card text-xs font-mono"
                  />
                  <button
                    onClick={async () => {
                      if (!activeProject?.id || !testUrl) return;
                      setScrapingPreview(true);
                      try {
                        // Primero guarda creds para que el endpoint lea los keywords actuales
                        await client.put('/woocommerce/credentials', { project_id: activeProject.id, ...form });
                        const res = await client.post(`/woocommerce/scrape-preview?projectId=${activeProject.id}`, { url: testUrl });
                        if (res.success) setScrapePreview(res.data);
                      } catch (err: any) {
                        toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
                      } finally { setScrapingPreview(false); }
                    }}
                    disabled={scrapingPreview}
                    className="h-9 px-3 rounded bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
                  >
                    {scrapingPreview ? '...' : 'Probar'}
                  </button>
                </div>
                {scrapePreview && (
                  <div className="mt-2 text-[11px] space-y-1 max-h-96 overflow-auto">
                    <div><strong>Titulo:</strong> {scrapePreview.titulo || <em>-</em>}</div>
                    {scrapePreview.meta_box && Object.keys(scrapePreview.meta_box).length > 0 && (
                      <div>
                        <strong>Meta box:</strong>
                        <ul className="ml-3 list-disc">
                          {Object.entries(scrapePreview.meta_box).map(([k, v]: [string, any]) => (
                            <li key={k}><code className="text-[10px]">{k}</code>: {v.text}{v.value != null && <> - valor=<code>{v.value}</code></>}{v.unit && <> - unidad=<code>{v.unit}</code></>}{v.iso_date && <> - ISO=<code>{v.iso_date}</code></>}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {scrapePreview.sections && Object.keys(scrapePreview.sections).length > 0 && (
                      <div>
                        <strong>Secciones extraidas:</strong>
                        <ul className="ml-3 list-disc">
                          {Object.entries(scrapePreview.sections).map(([k, v]: [string, any]) => (
                            <li key={k}>
                              <code className="text-[10px]">{k}</code> - {String(v).length} chars
                              <div className="text-muted-foreground italic text-[10px] line-clamp-2">{String(v).slice(0, 200)}...</div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {scrapePreview.error && <div className="text-red-600">Error: {scrapePreview.error}</div>}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-3 border-t border-border">
          <button onClick={saveCreds} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold"><FloppyDisk size={14} weight="bold" /> Guardar</button>
        </div>
      </div>

      {creds && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold">Importar productos</h3>
            <div className="flex gap-2">
              <button onClick={() => preview()} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted text-xs font-bold"><Eye size={14} /> Preview primer producto</button>
              <button onClick={importNow} disabled={importing} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-50"><ArrowsClockwise size={14} weight="bold" /> {importing ? 'Iniciando...' : 'Importar ahora'}</button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Pulsa <strong>Preview</strong> para ver como viene un producto desde WC + lo extraido por el scraper, y elegir que va a cada campo del CRM.
          </p>

          {/* Input URL para previsualizar un producto especifico */}
          <div className="flex gap-2 items-center pt-2 border-t border-border">
            <input
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              placeholder="O pega la URL de un producto/master concreto para previsualizar ese..."
              className="flex-1 h-9 px-3 rounded-md border border-border bg-muted/30 text-xs"
            />
            <button
              onClick={() => preview(previewUrl)}
              disabled={!previewUrl}
              className="h-9 px-4 rounded-md bg-amber-600 text-white text-xs font-bold disabled:opacity-50"
            >
              Previsualizar esa URL
            </button>
          </div>
        </div>
      )}

      {/* === MAPEO CONFIGURABLE === */}
      {previewData && previewData.targets && previewData.schema && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-bold">Mapeo de campos WC - CRM</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {previewData.count} productos detectados - Configura que campo de WC va a cada campo del CRM y guarda antes de importar.
              </p>
            </div>
            <button
              onClick={saveMapping}
              disabled={savingMapping}
              className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold disabled:opacity-50"
            >
              <FloppyDisk size={14} weight="bold" /> {savingMapping ? 'Guardando...' : 'Guardar mapeo'}
            </button>
          </div>

          {previewData.scraped && previewData.scraped.url_used && (
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 text-xs">
              <div className="font-bold text-blue-900 dark:text-blue-300 uppercase mb-1">SEO page detectada (recomendada para url_info)</div>
              <code className="text-blue-700 dark:text-blue-300 break-all">{previewData.scraped.url_used}</code>
              <p className="mt-1 text-blue-700/80 dark:text-blue-300/80">
                Para que el CRM use ESTE link en vez del de WC (que tiene sufijo numerico tipo <code>-2105-2</code>),
                mapea <strong>URL de la landing</strong> a <code className="bg-blue-100 dark:bg-blue-900/40 px-1 rounded">scraper.url_used</code>.
              </p>
            </div>
          )}

          {/* Tabla de mapping agrupada */}
          <div className="space-y-4">
            {Array.from(new Set(previewData.targets.filter(t => t.type !== 'array_subfield' && t.type !== 'wildcard_object').map(t => t.group))).map((group) => (
              <div key={group}>
                <h4 className="text-[11px] font-bold uppercase text-muted-foreground mb-2">{group}</h4>
                <div className="space-y-1.5">
                  {previewData.targets!.filter(t => t.group === group && t.type !== 'array_subfield' && t.type !== 'wildcard_object').map((target) => {
                    const cur = mapping[target.key];
                    const sourcesArr: string[] = Array.isArray(cur) ? cur : (cur ? [cur] : []);
                    const isMulti = sourcesArr.length > 1;
                    const previewVal = previewData.mapped_preview?.[target.key];
                    return (
                      <div key={target.key} className="grid grid-cols-1 md:grid-cols-[180px_1fr_200px] gap-2 items-start text-xs">
                        <label className="font-medium flex items-center gap-1 pt-2">
                          {target.label}
                          {target.required && <span className="text-red-500">*</span>}
                          <span className="text-muted-foreground font-mono ml-1">({target.key})</span>
                        </label>
                        <div className="space-y-1.5">
                          {isMulti && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {sourcesArr.map((s) => (
                                <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-mono border border-primary/20">
                                  {s.replace(/^cpt\.acf\./, 'acf.').replace(/^scraper\./, 'scr.')}
                                  <button type="button" onClick={() => removeMappingSource(target.key, s)}
                                    className="hover:bg-primary/20 rounded p-0.5" title="Quitar esta fuente">x</button>
                                </span>
                              ))}
                              <span className="text-[10px] text-muted-foreground italic self-center">se concatenan con doble salto de linea</span>
                            </div>
                          )}
                        <select
                          value={isMulti ? '' : (sourcesArr[0] || '')}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (isMulti) { addMappingSource(target.key, v); }
                            else { updateMapping(target.key, v); }
                          }}
                          className="h-9 px-2 rounded-md border border-border bg-muted/30 text-xs"
                        >
                          <option value="">- No mapear -</option>
                          <optgroup label="Producto WC (JSON)">
                            {previewData.schema!.filter(s => s.type !== 'object' && s.type !== 'array').map((s) => (
                              <option key={s.path} value={s.path}>{s.path} ({s.type})</option>
                            ))}
                          </optgroup>
                          {previewData.scraped && (
                            <optgroup label="Scraper - meta global (URL SEO, titulo, imagen)">
                              {previewData.scraped.url_used && (
                                <option value="scraper.url_used">
                                  scraper.url_used - {previewData.scraped.url_used.slice(0, 70)}
                                </option>
                              )}
                              {previewData.scraped.titulo && (
                                <option value="scraper.titulo">
                                  scraper.titulo - {previewData.scraped.titulo.slice(0, 60)}
                                </option>
                              )}
                              {previewData.scraped.imagen_og && (
                                <option value="scraper.imagen_og">
                                  scraper.imagen_og - {previewData.scraped.imagen_og.slice(0, 70)}
                                </option>
                              )}
                              {previewData.scraped.meta_description && (
                                <option value="scraper.meta_description">
                                  scraper.meta_description (SEO description)
                                </option>
                              )}
                            </optgroup>
                          )}
                          {previewData.scraped && previewData.scraped.sections && Object.keys(previewData.scraped.sections).length > 0 && (
                            <optgroup label="Scraper - secciones (texto)">
                              {Object.entries(previewData.scraped.sections).map(([k, v]) => {
                                const isAll = k.endsWith('__all');
                                const variantMatch = k.match(/^(.+)_(\d+)$/);
                                const baseKey = isAll ? k.slice(0, -5) : variantMatch ? variantMatch[1] : k;
                                const variantIdx = variantMatch ? parseInt(variantMatch[2]) : 1;
                                const meta = previewData.scraped?.sections_meta?.[baseKey];
                                let label = `scraper.sections.${k} (${String(v || '').length}c)`;
                                if (isAll) {
                                  label = `${k} - todos ${meta?.length || ''} unidos (${String(v || '').length}c)`;
                                } else if (meta && meta.length > 1) {
                                  const variantInfo = meta[variantIdx - 1];
                                  label = `scraper.sections.${k} - "${variantInfo?.heading?.slice(0, 50) || ''}" (${String(v || '').length}c)`;
                                }
                                return <option key={`scraper.sections.${k}`} value={`scraper.sections.${k}`}>{label}</option>;
                              })}
                            </optgroup>
                          )}
                          {previewData.scraped && previewData.scraped.meta_box && Object.keys(previewData.scraped.meta_box).length > 0 && (
                            <optgroup label="Scraper - meta_box (Duracion/Horas/etc)">
                              {Object.entries(previewData.scraped.meta_box).map(([k, v]: [string, any]) => (
                                <option key={`scraper.meta_box.${k}.text`} value={`scraper.meta_box.${k}.text`}>
                                  scraper.meta_box.{k} = {v.text || ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {previewData.cpt && previewData.cpt.acf_fields.length > 0 && (
                            <optgroup label={`CPT - ${previewData.cpt.slug || 'wp'} (ACF rica - horas, modulos, secciones...)`}>
                              {previewData.cpt.acf_fields.map((f) => (
                                <option key={f.path} value={f.path}>
                                  {f.path} {f.sample ? `= ${f.sample.slice(0, 60)}` : `(${f.type})`}
                                </option>
                              ))}
                              <option value="cpt.title">cpt.title (titulo del CPT)</option>
                              <option value="cpt.link">cpt.link (URL del CPT)</option>
                            </optgroup>
                          )}
                        </select>
                        {sourcesArr.length > 0 && (
                          <p className="text-[10px] text-muted-foreground leading-tight">
                            {isMulti ? 'Elige otra para anadir y se concatenara al final' : 'Tip: para concatenar varios campos, vuelve a elegir otro y se anadira como segunda fuente.'}
                            {!isMulti && (
                              <button type="button" onClick={() => addMappingSource(target.key, sourcesArr[0])}
                                className="ml-2 underline hover:text-foreground">
                                + anadir 2a fuente
                              </button>
                            )}
                          </p>
                        )}
                        </div>
                        <div className="text-muted-foreground truncate font-mono text-[11px] pt-2" title={String(previewVal ?? '')}>
                          {previewVal !== undefined && previewVal !== null
                            ? `-> ${String(previewVal).slice(0, 60)}${isMulti ? ` (concat ${sourcesArr.length})` : ''}`
                            : <span className="italic">sin valor</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <details className="text-xs border-t pt-3">
            <summary className="cursor-pointer font-bold">Ver JSON crudo del primer producto</summary>
            <pre className="mt-2 p-3 bg-muted/40 rounded text-[10px] overflow-x-auto max-h-80">{JSON.stringify(previewData.sample[0], null, 2)}</pre>
          </details>
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border"><h3 className="font-bold text-sm">Historial de imports</h3></div>
        {loading ? <SkeletonTable rows={4} columns={6} className="border-0" /> : runs.length === 0 ? (
          <EmptyState icon={ShoppingBag} title="Sin imports aun" description="Configura credenciales y dispara el primero" />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground"><tr>
                  <th className="text-left px-4 py-2.5 font-bold">Inicio</th>
                  <th className="text-center px-4 py-2.5 font-bold">Estado</th>
                  <th className="text-right px-4 py-2.5 font-bold">Fetched</th>
                  <th className="text-right px-4 py-2.5 font-bold">Created</th>
                  <th className="text-right px-4 py-2.5 font-bold">Updated</th>
                  <th className="text-right px-4 py-2.5 font-bold">Skipped</th>
                  <th className="text-left px-4 py-2.5 font-bold">Error</th>
                </tr></thead>
                <tbody>
                  {runs.map(r => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-4 py-3 text-xs">{new Date(r.started_at).toLocaleString('es-ES')}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : r.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{r.total_fetched}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600">{r.total_created}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-blue-600">{r.total_updated}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.total_skipped}</td>
                      <td className="px-4 py-3 text-xs text-red-500 truncate max-w-[200px]">{r.error_message || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {runs.map(r => (
                <div key={r.id} className="p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString('es-ES')}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${r.status === 'success' ? 'bg-emerald-100 text-emerald-700' : r.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div><div className="text-muted-foreground">Fetched</div><div className="tabular-nums">{r.total_fetched}</div></div>
                    <div><div className="text-muted-foreground">Created</div><div className="tabular-nums text-emerald-600">{r.total_created}</div></div>
                    <div><div className="text-muted-foreground">Updated</div><div className="tabular-nums text-blue-600">{r.total_updated}</div></div>
                    <div><div className="text-muted-foreground">Skipped</div><div className="tabular-nums text-muted-foreground">{r.total_skipped}</div></div>
                  </div>
                  {r.error_message && <p className="text-[11px] text-red-500 break-words">{r.error_message}</p>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
