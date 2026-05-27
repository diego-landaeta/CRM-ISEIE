import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useProjectContext as useProject } from '@/contexts/ProjectContext';
import { getProduct } from '../api/products.api';
import DossierPanel from '../components/DossierPanel';
import { Button } from '@/shared/components/ui/button';
import {
  ArrowLeft, Clock, Hash, MapPin, Calendar, Link as LinkIcon,
  Image as ImageIcon, GraduationCap,
} from '@phosphor-icons/react';

interface Product {
  id: number;
  nombre: string;
  sku?: string | null;
  precio?: number | null;
  moneda?: string | null;
  descripcion?: string | null;
  image_url?: string | null;
  url_info?: string | null;
  duracion?: string | null;
  horas?: string | null;
  num_modulos?: number | null;
  modalidad?: string | null;
  fecha_inicio_texto?: string | null;
  categoria_nombre?: string | null;
  subcategoria_nombre?: string | null;
  presentacion_texto?: string | null;
  objetivos_texto?: string | null;
  beneficios_texto?: string | null;
  dirigido_a_texto?: string | null;
  para_que_te_prepara_texto?: string | null;
  por_que_estudiar_texto?: string | null;
  modulos_texto?: string | null;
  metodologia_texto?: string | null;
  faqs_texto?: string | null;
  profesores_texto?: string | null;
  otras_secciones?: Record<string, string> | null;
  source_type?: string | null;
  wc_product_id?: number | null;
}

const SECTION_LABELS: Array<{ key: keyof Product; label: string }> = [
  { key: 'presentacion_texto', label: 'Presentación' },
  { key: 'objetivos_texto', label: 'Objetivos' },
  { key: 'beneficios_texto', label: 'Beneficios' },
  { key: 'dirigido_a_texto', label: 'A quién va dirigido' },
  { key: 'para_que_te_prepara_texto', label: 'Para qué te prepara' },
  { key: 'por_que_estudiar_texto', label: 'Por qué estudiar' },
  { key: 'modulos_texto', label: 'Módulos / Temario' },
  { key: 'metodologia_texto', label: 'Metodología' },
  { key: 'faqs_texto', label: 'Preguntas frecuentes' },
  { key: 'profesores_texto', label: 'Profesorado' },
];

function MetaPill({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-muted/50 border border-border text-xs">
      <Icon size={13} weight="bold" className="text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-semibold">{String(value)}</span>
    </div>
  );
}

function SectionBlock({ label, content }: { label: string; content: string }) {
  const [expanded, setExpanded] = useState(content.length < 800);
  if (!content) return null;
  const text = String(content);
  const isLong = text.length > 600;
  const shown = expanded || !isLong ? text : text.slice(0, 600);
  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-2">
      <h3 className="font-semibold text-sm">{label}</h3>
      <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
        {shown}
        {!expanded && isLong && '…'}
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary hover:underline font-medium"
        >
          {expanded ? 'Mostrar menos' : `Mostrar todo (${text.length} chars)`}
        </button>
      )}
    </section>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const { activeProject } = useProject();
  const projectId = activeProject?.id;
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId || !id) return;
    setLoading(true);
    getProduct(Number(id), projectId)
      .then((p: any) => setProduct(p))
      .finally(() => setLoading(false));
  }, [id, projectId]);

  if (!projectId) return <div className="p-8 text-center text-muted-foreground">Selecciona un proyecto.</div>;
  if (loading) return <div className="p-8 text-muted-foreground">Cargando producto...</div>;
  if (!product) return <div className="p-8 text-destructive">Producto no encontrado.</div>;

  const hasMeta = !!(product.duracion || product.horas || product.num_modulos || product.modalidad || product.fecha_inicio_texto);
  const sectionsWithContent = SECTION_LABELS.filter((s) => product[s.key]);
  const otrasSecciones = product.otras_secciones && typeof product.otras_secciones === 'object'
    ? Object.entries(product.otras_secciones).filter(([, v]) => v)
    : [];

  return (
    <div className="p-5 max-w-4xl space-y-5 pb-12">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/products" aria-label="Volver a productos"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-1">
            {product.categoria_nombre && <span className="px-2 py-0.5 bg-muted rounded">{product.categoria_nombre}</span>}
            {product.subcategoria_nombre && <span className="px-2 py-0.5 bg-muted rounded">{product.subcategoria_nombre}</span>}
            {product.source_type && <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded">{product.source_type}</span>}
            {product.sku && <span className="font-mono">SKU: {product.sku}</span>}
          </div>
          <h1 className="text-xl sm:text-2xl font-semibold">{product.nombre}</h1>
          {product.descripcion && (
            <p
              className="text-muted-foreground text-sm mt-2 whitespace-pre-wrap leading-relaxed"
              dangerouslySetInnerHTML={{ __html: product.descripcion }}
            />
          )}
        </div>
        {product.image_url && (
          <img src={product.image_url} alt={product.nombre} className="w-32 h-32 object-cover rounded-lg border border-border" />
        )}
      </div>

      {/* META PILLS */}
      {hasMeta && (
        <div className="flex flex-wrap gap-2">
          {product.precio != null && (
            <MetaPill icon={Hash} label="Precio" value={`${product.precio} ${product.moneda || ''}`} />
          )}
          <MetaPill icon={Clock} label="Duración" value={product.duracion} />
          <MetaPill icon={Clock} label="Horas" value={product.horas} />
          <MetaPill icon={GraduationCap} label="Nº Módulos" value={product.num_modulos} />
          <MetaPill icon={MapPin} label="Modalidad" value={product.modalidad} />
          <MetaPill icon={Calendar} label="Fecha inicio" value={product.fecha_inicio_texto} />
        </div>
      )}

      {/* URL info */}
      {product.url_info && (
        <div className="bg-card border border-border rounded-lg p-3 text-xs flex items-center gap-2">
          <LinkIcon size={13} weight="bold" className="text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">Landing pública:</span>
          <a href={product.url_info} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate flex-1">
            {product.url_info}
          </a>
        </div>
      )}

      {/* SECCIONES extraídas por scraper / ACF */}
      {sectionsWithContent.length === 0 && otrasSecciones.length === 0 ? (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4 text-sm">
          <p className="text-amber-800 dark:text-amber-300">
            Este producto no tiene secciones extraídas (Módulos, FAQs, Profesores, etc.).
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
            Configura el scraper y el mapeo en <Link to="/woocommerce" className="underline font-semibold">WooCommerce → Mapeo</Link> y vuelve a importar.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sectionsWithContent.map((s) => (
            <SectionBlock key={s.key as string} label={s.label} content={product[s.key] as string} />
          ))}
          {otrasSecciones.map(([k, v]) => (
            <SectionBlock key={`otra-${k}`} label={`Otra sección: ${k}`} content={String(v)} />
          ))}
        </div>
      )}

      <hr />
      <DossierPanel productId={product.id} projectId={projectId} />
    </div>
  );
}
