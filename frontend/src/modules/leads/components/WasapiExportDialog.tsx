
import Field from '@/shared/components/ui/Field';import { useEffect, useState } from 'react';
import { X, WhatsappLogo, DownloadSimple, Info } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';

// Modal de exportación con formato Wasapi (plantilla bulk WhatsApp).
// - Filtros opcionales: gestor, fechas, producto, país, sólo con teléfono.
// - Exclusión por estado (checklist): quita del envío a los estados marcados.
// - Si el rol es gestor, el filtro de gestor se fuerza a su userId (backend reconfirma).
// - Genera CSV con columnas A-H (ver wasapiCsv.js en backend).

interface Gestor { id: number; nombre: string; role?: string }
interface Producto { id: number; nombre: string }

const ESTADOS: Array<{ value: string; label: string }> = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'por_contactar', label: 'Por contactar' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'en_seguimiento', label: 'En seguimiento' },
  { value: 'convertido', label: 'Convertido' },
  { value: 'no_interesado', label: 'No interesado' },
  { value: 'proxima_convocatoria', label: 'Próxima convocatoria' },
];

const PAISES = [
  'Ecuador', 'Bolivia', 'Argentina', 'Colombia', 'Perú', 'México', 'Chile',
  'España', 'Panamá', 'Honduras', 'Guatemala', 'Costa Rica', 'Nicaragua',
  'El Salvador', 'Uruguay', 'Paraguay', 'Venezuela', 'EE.UU.',
];

interface Props {
  open: boolean;
  projectId?: number | null;
  onClose: () => void;
  /**
   * De dónde sale el fichero. Por defecto, los prospectos.
   *
   * El repaso de fin de mes usa este MISMO diálogo apuntando a su endpoint:
   * Diego, 23/09, «el descargar para Wasapi debe tener las mismas condiciones
   * como si fueran de prospectos». Un segundo diálogo parecido habría acabado
   * con dos juegos de condiciones distintos y un fichero que sale de una forma
   * u otra según por dónde lo pidas.
   */
  endpoint?: string;
  /** Lo que el que llama ya tiene filtrado y manda siempre (ámbito incluido). */
  paramsBase?: Record<string, string>;
  /** Los bloques que el que llama ya controla en su pantalla. */
  ocultar?: Array<'gestor' | 'producto' | 'fechas' | 'convertidos'>;
  titulo?: string;
  descripcion?: string;
  /** Una línea diciendo qué se lleva ya aplicado de la pantalla de detrás. */
  resumenFiltros?: string | null;
  nombreFichero?: string;
}

export default function WasapiExportDialog({
  open, projectId, onClose,
  endpoint = '/leads/export/wasapi',
  paramsBase,
  ocultar = [],
  titulo = 'Exportar plantilla Wasapi',
  descripcion,
  resumenFiltros = null,
  nombreFichero = 'wasapi-leads',
}: Props) {
  const { user } = useAuth() as { user: { userId: number; role: string } | null };
  const isGestor = user?.role === 'gestor';
  const seVe = (b: 'gestor' | 'producto' | 'fechas' | 'convertidos') => !ocultar.includes(b);

  const [gestores, setGestores] = useState<Gestor[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(false);

  // Filtros (todos opcionales; gestor solo puede tocar los suyos)
  const [responsableId, setResponsableId] = useState<string>('');
  // Estados a EXCLUIR del envío (p.ej. no interesados). Sustituye al antiguo
  // filtro "Estado del prospecto": aquí marcas a quién NO enviar.
  const [excludeStatus, setExcludeStatus] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [productId, setProductId] = useState<string>('');
  const [pais, setPais] = useState<string>('');
  const [onlyWithPhone, setOnlyWithPhone] = useState(true);
  const [includeConverted, setIncludeConverted] = useState(false);
  const [format, setFormat] = useState<'csv' | 'xlsx'>('xlsx');

  useEffect(() => {
    if (!open) return;
    // Solo admin/superadmin necesitan la lista de gestores; gestor solo ve sus leads.
    if (!isGestor && seVe('gestor')) {
      client.get('/users', { params: { limit: 100 } })
        .then((res: any) => setGestores(Array.isArray(res?.data) ? res.data : []))
        .catch(() => setGestores([]));
    }
    if (projectId && seVe('producto')) {
      client.get('/products', { params: { projectId, limit: 500 } })
        .then((res: any) => setProductos(Array.isArray(res?.data) ? res.data : []))
        .catch(() => setProductos([]));
    }
    // `seVe` se recalcula en cada pintada; lo que importa es `ocultar`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId, isGestor, ocultar]);

  async function handleDownload() {
    setLoading(true);
    try {
      // Construyo URL con filtros — el client.get(blob) no es estándar, así que uso fetch directo.
      // Primero lo que manda quien llama --su ámbito y lo que ya tiene
      // filtrado en pantalla--, y encima lo que se elija aquí.
      const params = new URLSearchParams(paramsBase || {});
      if (projectId) params.set('projectId', String(projectId));
      if (responsableId) params.set('responsableId', responsableId);
      if (excludeStatus.length) params.set('excludeStatus', excludeStatus.join(','));
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (productId) params.set('productId', productId);
      if (pais) params.set('pais', pais);
      params.set('onlyWithPhone', onlyWithPhone ? 'true' : 'false');
      if (includeConverted) params.set('includeConverted', 'true');
      params.set('format', format);

      // Fetch directo porque client.get parsea como JSON y queremos un blob CSV.
      // Reusamos accessToken y baseURL del wrapper para mantener auth/refresh.
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}${endpoint}?${params.toString()}`, {
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nombreFichero}-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: 'CSV descargado', description: 'Listo para subir a Wasapi.' });
      onClose();
    } catch (err: any) {
      toast({ title: 'Error al descargar', description: err?.message || 'No se pudo generar el CSV', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div role="dialog" aria-modal="true" className="relative bg-card rounded-lg border border-border w-full max-w-2xl flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-success-soft text-success flex items-center justify-center flex-shrink-0">
              <WhatsappLogo size={18} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base">{titulo}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {descripcion
                  || <>Exporta los prospectos para enviarles WhatsApp desde Wasapi.io. Elige <strong>de qué fechas</strong> y marca <strong>a quién excluir</strong>. Todo es opcional: sin filtros se descargan todos los prospectos del proyecto.</>}
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Lo que ya trae puesto la pantalla de detrás. Se dice, no se
                esconde: si no, se descarga creyendo que van todos. */}
            {resumenFiltros && (
              <div className="bg-muted/40 border border-border rounded p-2.5 text-xs flex gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" weight="duotone" />
                <span>Se descargará <strong>lo que tienes filtrado</strong>: {resumenFiltros}</span>
              </div>
            )}

            {isGestor && (
              <div className="bg-info-soft border border-info/30 rounded p-2.5 text-xs text-info flex gap-2">
                <Info size={14} className="flex-shrink-0 mt-0.5" weight="duotone" />
                Como gestor, solo descargarás los prospectos asignados a ti.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {!isGestor && seVe('gestor') && (
                <Field label="Gestor (responsable)">
                  <select value={responsableId} onChange={(e) => setResponsableId(e.target.value)}
                    className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm">
                    <option value="">Todos los gestores</option>
                    {gestores.map((g) => (<option key={g.id} value={g.id}>{g.nombre}</option>))}
                  </select>
                </Field>
              )}

              {seVe('producto') && (
              <Field label="Producto de interés">
                <select value={productId} onChange={(e) => setProductId(e.target.value)}
                  className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm">
                  <option value="">Todos los productos</option>
                  {productos.map((p) => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
                </select>
              </Field>
              )}

              <Field label="País (derivado del teléfono)">
                <select value={pais} onChange={(e) => setPais(e.target.value)}
                  className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm">
                  <option value="">Todos los países</option>
                  {PAISES.map((p) => (<option key={p} value={p}>{p}</option>))}
                </select>
              </Field>

              {seVe('fechas') && (<>
              <Field label="Desde">
                <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm" />
              </Field>

              <Field label="Hasta">
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)}
                  className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm" />
              </Field>
              </>)}
            </div>

            <div className="pt-3 border-t border-border">
              <label className="text-[11px] font-semibold text-muted-foreground mb-1.5 block">Formato del archivo</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setFormat('xlsx')}
                  className={`p-2.5 rounded-md border-2 text-left transition ${format === 'xlsx' ? 'border-success/30 bg-success-soft' : 'border-border hover:border-muted-foreground/40'}`}>
                  <p className="text-sm font-semibold">Excel (.xlsx)</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Recomendado. Teléfonos preservados, acentos OK.</p>
                </button>
                <button type="button" onClick={() => setFormat('csv')}
                  className={`p-2.5 rounded-md border-2 text-left transition ${format === 'csv' ? 'border-success/30 bg-success-soft' : 'border-border hover:border-muted-foreground/40'}`}>
                  <p className="text-sm font-semibold">CSV (.csv)</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Más liviano. Cuidado al abrirlo en Excel (puede romper teléfonos).</p>
                </button>
              </div>
            </div>

            {/* EXCLUIR estados: checklist. Quita del envio los leads en esos
                estados (p.ej. no interesados). */}
            <div className="pt-2 border-t border-border">
              <p className="text-sm font-semibold mb-0.5">Excluir estos prospectos del envío</p>
              <p className="text-[11px] text-muted-foreground mb-2">
                Marca los estados que <strong>NO</strong> quieres que reciban el WhatsApp. Si no marcas nada, se exportan todos.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {ESTADOS.map((e) => (
                  <label key={e.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeStatus.includes(e.value)}
                      onChange={() => setExcludeStatus((prev) =>
                        prev.includes(e.value) ? prev.filter((x) => x !== e.value) : [...prev, e.value])}
                      className="w-4 h-4 rounded border-border"
                    />
                    <span className={excludeStatus.includes(e.value) ? 'text-destructive font-medium' : ''}>
                      {e.label}
                    </span>
                  </label>
                ))}
              </div>
              {excludeStatus.length > 0 && (
                <p className="text-[11px] text-destructive mt-2">
                  Se excluiran {excludeStatus.length} estado{excludeStatus.length !== 1 ? 's' : ''} del envio.{' '}
                  <button type="button" onClick={() => setExcludeStatus([])} className="underline hover:no-underline">Quitar exclusiones</button>
                </p>
              )}
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={onlyWithPhone} onChange={(e) => setOnlyWithPhone(e.target.checked)}
                  className="w-4 h-4 rounded border-border" />
                Solo prospectos con teléfono válido <span className="text-muted-foreground">(recomendado — sin teléfono Wasapi no puede enviar)</span>
              </label>
              {seVe('convertidos') && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={includeConverted} onChange={(e) => setIncludeConverted(e.target.checked)}
                  className="w-4 h-4 rounded border-border" />
                Incluir prospectos ya convertidos <span className="text-muted-foreground">(normalmente excluidos)</span>
              </label>
              )}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                ¿Qué columnas tiene el CSV?
              </summary>
              <div className="mt-2 p-2 bg-muted/40 rounded text-xs leading-relaxed">
                <code className="font-mono">Nombre · Email · Teléfono · Tipo · Producto · Estado · Tipo+Producto · País</code>
                <p className="mt-1.5">Tipo se deduce del prefijo del producto (Máster / Curso / Diplomado / Doctorado). País se deduce del prefijo del teléfono. UTF-8 con BOM para Excel.</p>
              </div>
            </details>
          </div>

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button onClick={onClose} disabled={loading}
              className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleDownload} disabled={loading}
              className="h-9 px-4 rounded-md bg-success text-success-foreground text-sm font-semibold hover:bg-success/90 disabled:opacity-50 inline-flex items-center gap-1.5">
              <DownloadSimple size={14} weight="bold" />
              {loading ? 'Generando…' : `Descargar ${format.toUpperCase()}`}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
