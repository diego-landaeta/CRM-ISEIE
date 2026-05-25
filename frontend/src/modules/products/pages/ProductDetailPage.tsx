import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Package, CurrencyEur, Clock, Hash, Tag, Link as LinkIcon,
  PencilSimple, Trash, FilePdf, Image as ImageIcon, GraduationCap,
} from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import DossierPanel from '../components/DossierPanel';

const TABS = [
  { id: 'overview',  label: 'Resumen' },
  { id: 'dossier',   label: 'Dossier' },
  { id: 'leads',     label: 'Prospectos interesados' },
  { id: 'sales',     label: 'Ventas' },
];

function MetaPill({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 min-w-0">
      <Icon size={14} weight="duotone" className="text-muted-foreground flex-shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{label}</div>
        <div className="text-xs font-medium truncate">{value}</div>
      </div>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null } };
  const [tab, setTab] = useState('overview');
  const productIdNum = Number(id);

  // Placeholder data — se conectará al backend GET /api/products/:id
  const product = {
    id: id || '?',
    nombre: '—',
    sku: null,
    precio: null,
    moneda: 'EUR',
    duracion: null,
    modalidad: null,
    descripcion: null,
    url_info: null,
    image_url: null,
  };

  return (
    <div className="space-y-5">
      <Link to="/products" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft size={12} weight="bold" />
        Volver al catálogo
      </Link>

      {/* Header */}
      <header className="crm-card p-5 lg:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-5">
          {/* Imagen */}
          <div className="w-full sm:w-32 h-32 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
            {product.image_url ? (
              <img src={product.image_url} alt={product.nombre} className="w-full h-full object-cover" />
            ) : (
              <ImageIcon size={32} weight="duotone" className="text-muted-foreground/40" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{product.nombre}</h1>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Hash size={11} />#{product.id}</span>
                  {product.sku && <span className="flex items-center gap-1"><Tag size={11} />{product.sku}</span>}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-xs font-medium hover:bg-muted transition-colors">
                  <PencilSimple size={13} weight="duotone" /> Editar
                </button>
                <button className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-card border border-border text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors" title="Eliminar">
                  <Trash size={14} />
                </button>
              </div>
            </div>

            {/* Meta pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <MetaPill icon={CurrencyEur}    label="Precio"    value={product.precio ? `${product.precio} ${product.moneda}` : 'Sin precio'} />
              <MetaPill icon={Clock}          label="Duración"  value={product.duracion || 'Sin definir'} />
              <MetaPill icon={GraduationCap}  label="Modalidad" value={product.modalidad || 'Sin definir'} />
              <MetaPill icon={LinkIcon}       label="URL info"  value={product.url_info ? 'Disponible' : 'Sin URL'} />
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px flex-shrink-0 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="crm-card p-6">
          <h3 className="font-semibold tracking-tight mb-3">Descripción</h3>
          <p className="text-sm text-muted-foreground italic">
            {product.descripcion || 'Sin descripción. Edita el producto para añadir presentación, objetivos, metodología, etc.'}
          </p>
        </div>
      )}

      {tab === 'dossier' && Number.isFinite(productIdNum) && activeProject?.id && (
        <DossierPanel productId={productIdNum} projectId={activeProject.id} />
      )}

      {tab === 'leads' && (
        <div className="crm-card p-12 text-center text-sm text-muted-foreground">
          Ningún prospecto tiene este producto como interés todavía.
        </div>
      )}

      {tab === 'sales' && (
        <div className="crm-card p-12 text-center text-sm text-muted-foreground">
          Sin ventas registradas de este producto.
        </div>
      )}
    </div>
  );
}
