import { useEffect, useState, useRef } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { productSchema } from '../validation/product.schema';
import { X, CurrencyEur, Image as ImageIcon, UploadSimple, Trash } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import { uploadProductImage, deleteProductImage, getProductImageUrl } from '../api/products.api';
import { toast } from '@/shared/hooks/useToast';
import { useConfirm } from '@/shared/components/ui/useConfirm';

const inputClass = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground';
const smallInput = 'w-full h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary';

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 block px-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-1 px-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1 px-1">{error}</p>}
    </div>
  );
}

interface ProductFormDialogProps {
  open: boolean;
  onClose: () => void;
  product: any;
  onSubmit: (data: any) => Promise<void>;
}

export default function ProductFormDialog({ open, onClose, product, onSubmit }: ProductFormDialogProps) {
  useEscapeKey(onClose, open);
  const { activeProject } = useProjectContext();
  const productoLabel = (activeProject as any)?.producto_label || 'Producto';
  const isEdit = !!product;
  // Estado de imagen — visible solo en modo edicion (necesita product.id para subir).
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const [regimenes, setRegimenes] = useState<any[]>([]);
  const [regimenSel, setRegimenSel] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: {
      nombre: '', descripcion: '', precio: '', moneda: 'EUR', stripe_link: '', sku: '', duracion: '', url_info: '',
      horas: '', num_modulos: '', modalidad: '', fecha_inicio_texto: '',
      presentacion_texto: '', objetivos_texto: '', beneficios_texto: '', dirigido_a_texto: '',
      para_que_te_prepara_texto: '', por_que_estudiar_texto: '', modulos_texto: '',
      metodologia_texto: '', faqs_texto: '', profesores_texto: '',
    } as any,
  });

  // Cargar régimenes fiscales disponibles (para el selector de régimen por producto).
  useEffect(() => {
    if (!open || !activeProject?.id) return;
    (async () => {
      try {
        const rr = await client.get(`/invoices/regimenes?projectId=${activeProject.id}`);
        if (rr.success) setRegimenes(rr.data || []);
      } catch {}
    })();
  }, [open, activeProject?.id]);

  useEffect(() => {
    if (open) {
      setRegimenSel(product?.regimen_fiscal_id ? String(product.regimen_fiscal_id) : '');
      reset(product ? {
        nombre: product.nombre || '',
        descripcion: product.descripcion || '',
        precio: product.precio || '',
        moneda: product.moneda || 'EUR',
        stripe_link: product.stripe_link || '',
        sku: product.sku || '',
        duracion: product.duracion || '',
        url_info: product.url_info || '',
        horas: product.horas || '',
        num_modulos: product.num_modulos != null ? String(product.num_modulos) : '',
        modalidad: product.modalidad || '',
        fecha_inicio_texto: product.fecha_inicio_texto || '',
        presentacion_texto: product.presentacion_texto || '',
        objetivos_texto: product.objetivos_texto || '',
        beneficios_texto: product.beneficios_texto || '',
        dirigido_a_texto: product.dirigido_a_texto || '',
        para_que_te_prepara_texto: product.para_que_te_prepara_texto || '',
        por_que_estudiar_texto: product.por_que_estudiar_texto || '',
        modulos_texto: product.modulos_texto || '',
        metodologia_texto: product.metodologia_texto || '',
        faqs_texto: product.faqs_texto || '',
        profesores_texto: product.profesores_texto || '',
      } as any : {
        nombre: '', descripcion: '', precio: '', moneda: 'EUR', stripe_link: '', sku: '', duracion: '', url_info: '',
        horas: '', num_modulos: '', modalidad: '', fecha_inicio_texto: '',
        presentacion_texto: '', objetivos_texto: '', beneficios_texto: '', dirigido_a_texto: '',
        para_que_te_prepara_texto: '', por_que_estudiar_texto: '', modulos_texto: '',
        metodologia_texto: '', faqs_texto: '', profesores_texto: '',
      } as any);
    }
  }, [open, product, reset]);

  // Cargar URL firmada de imagen al abrir/cambiar producto.
  useEffect(() => {
    if (!open || !product?.id || !activeProject?.id) {
      setImageUrl(null);
      return;
    }
    if (product.image_url_signed) {
      setImageUrl(product.image_url_signed);
      return;
    }
    if (!product.image_url) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    getProductImageUrl(product.id, activeProject.id)
      .then(url => { if (!cancelled) setImageUrl(url); })
      .catch(() => { if (!cancelled) setImageUrl(null); });
    return () => { cancelled = true; };
  }, [open, product?.id, product?.image_url, product?.image_url_signed, activeProject?.id]);

  async function handleImageUpload(file: File) {
    if (!product?.id || !activeProject?.id) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Imagen demasiado grande', description: 'Máximo 5 MB', variant: 'destructive' });
      return;
    }
    setImageUploading(true);
    try {
      const updated = await uploadProductImage(product.id, activeProject.id, file);
      setImageUrl(updated.image_url_signed || null);
      toast({ title: 'Imagen subida' });
    } catch (e: any) {
      toast({ title: 'Error subiendo imagen', description: e?.data?.error || e.message, variant: 'destructive' });
    } finally {
      setImageUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleImageRemove() {
    if (!product?.id || !activeProject?.id) return;
    if (!(await confirm({ title: 'Eliminar imagen', message: '¿Eliminar la imagen del producto?', tone: 'destructive', confirmLabel: 'Eliminar' }))) return;
    setImageUploading(true);
    try {
      await deleteProductImage(product.id, activeProject.id);
      setImageUrl(null);
      toast({ title: 'Imagen eliminada' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e.message, variant: 'destructive' });
    } finally {
      setImageUploading(false);
    }
  }

  if (!open) return null;

  async function handleFormSubmit(data: any) {
    const payload = {
      ...data,
      precio: data.precio === '' || data.precio === null || Number.isNaN(data.precio) ? null : Number(data.precio),
      regimen_fiscal_id: regimenSel ? Number(regimenSel) : null,
    };
    // Normalizar vacios a null
    ['stripe_link', 'sku', 'duracion', 'url_info'].forEach(k => { if (!payload[k]) payload[k] = null; });
    await onSubmit(payload);
    onClose();
  }

  return (
    <Portal>
    <div role="dialog" aria-label={isEdit ? `Editar ${productoLabel}` : `Nuevo ${productoLabel}`} className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-lg border border-border w-full max-w-2xl mx-4 p-4 sm:p-6 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{isEdit ? `Editar ${productoLabel.toLowerCase()}` : `Nuevo ${productoLabel.toLowerCase()}`}</h2>
            <p className="text-muted-foreground text-sm mt-0.5">{isEdit ? 'Actualiza la información' : 'Registra uno nuevo con precio y detalles'}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted">
            <X size={18} weight="bold" />
          </button>
        </div>

        <form onSubmit={handleSubmit(handleFormSubmit, (errs) => {
          // No fallar en silencio: si la validación bloquea el submit, avisar qué campo.
          const msgs = Object.values(errs).map((e: any) => e?.message).filter(Boolean);
          toast({ title: 'Revisa el formulario', description: msgs.join(' · ') || 'Hay campos inválidos', variant: 'destructive' });
        })} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *" error={(errors as any).nombre?.message as any}>
              <input {...register('nombre')} placeholder={`Nombre del ${productoLabel.toLowerCase()}`} className={inputClass} />
            </Field>
            <Field label="SKU / código" error={(errors as any).sku?.message as any}>
              <input {...register('sku')} placeholder="opcional" className={inputClass} />
            </Field>
          </div>

          <Field label="Descripción" error={(errors as any).descripcion?.message as any}>
            <textarea
              {...register('descripcion')}
              placeholder="Descripción corta..."
              rows={2}
              className="w-full px-4 py-3 rounded-md border border-border bg-muted/50 text-sm outline-none resize-none focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card"
            />
          </Field>

          {/* CRM-149: Imagen del producto */}
          <div className="p-3 bg-muted/20 rounded-md border border-border space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <ImageIcon size={12} /> Imagen
            </div>
            {!isEdit ? (
              <p className="text-[11px] text-muted-foreground italic px-1">
                Crea el {productoLabel.toLowerCase()} primero y luego edítalo para añadir la imagen.
              </p>
            ) : (
              <div className="flex items-start gap-3">
                <div className="w-24 h-24 shrink-0 rounded-md border border-border bg-muted/40 overflow-hidden flex items-center justify-center">
                  {imageUrl ? (
                    <img src={imageUrl} alt={product?.nombre || 'Producto'} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={28} className="text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={imageUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-medium hover:bg-muted disabled:opacity-50"
                    >
                      <UploadSimple size={12} weight="bold" />
                      {imageUploading ? 'Subiendo…' : imageUrl ? 'Reemplazar' : 'Subir imagen'}
                    </button>
                    {imageUrl && (
                      <button
                        type="button"
                        disabled={imageUploading}
                        onClick={handleImageRemove}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                      >
                        <Trash size={12} weight="regular" /> Eliminar
                      </button>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    aria-label="Subir imagen del producto"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleImageUpload(f);
                    }}
                  />
                  <p className="text-[10px] text-muted-foreground">PNG, JPG, WEBP o SVG · máx. 5 MB</p>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-muted/20 rounded-md border border-border space-y-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <CurrencyEur size={12} /> Precio y venta
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Precio" error={(errors as any).precio?.message as any}>
                <input {...register('precio')} type="number" step="0.01" min="0" placeholder="0.00" className={smallInput} />
              </Field>
              <Field label="Moneda">
                <Controller
                  name={'moneda' as any}
                  control={control as any}
                  render={({ field }) => (
                    <Select<string>
                      value={(field.value as any) || 'EUR'}
                      onChange={field.onChange}
                      options={[
                        { value: 'EUR', label: 'EUR €' },
                        { value: 'USD', label: 'USD $' },
                        { value: 'MXN', label: 'MXN $' },
                        { value: 'COP', label: 'COP $' },
                      ]}
                      ariaLabel="Moneda"
                    />
                  )}
                />
              </Field>
              <Field label="Duración" hint="ej: 8 sesiones">
                <input {...register('duracion')} placeholder="opcional" className={smallInput} />
              </Field>
            </div>
            <Field label="URL de información / landing" error={(errors as any).url_info?.message as any}>
              <input {...register('url_info')} placeholder="https://..." className={smallInput} />
            </Field>
            <Field label="Enlace de pago Stripe (opcional)" error={(errors as any).stripe_link?.message as any}>
              <input {...register('stripe_link')} placeholder="https://buy.stripe.com/..." className={smallInput + ' font-mono text-xs'} />
            </Field>
            <Field label="Régimen fiscal (IVA)" hint="Déjalo por defecto salvo que el producto tenga un régimen fijo (p. ej. formación exenta de IVA).">
              <Select<string>
                value={regimenSel}
                onChange={setRegimenSel}
                options={[
                  { value: '', label: 'Por defecto (según ubicación del cliente)' },
                  ...regimenes.map((r: any) => ({ value: String(r.id), label: r.nombre })),
                ]}
                ariaLabel="Régimen fiscal"
              />
            </Field>
          </div>

          {/* === Datos del programa (importados del scraper / WC) === */}
          <div className="p-3 bg-muted/20 rounded-md border border-border space-y-3">
            <div className="text-[11px] font-bold uppercase text-muted-foreground">
              Datos del programa <span className="font-normal normal-case opacity-70">(importados de WP/WC, editables)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Field label="Horas">
                <input {...register('horas')} placeholder="ej: 1500 horas" className={smallInput} />
              </Field>
              <Field label="Nº módulos">
                <input {...register('num_modulos')} type="number" min="0" placeholder="ej: 10" className={smallInput} />
              </Field>
              <Field label="Modalidad">
                <input {...register('modalidad')} placeholder="Online, Presencial..." className={smallInput} />
              </Field>
              <Field label="Fecha de inicio">
                <input {...register('fecha_inicio_texto')} placeholder="DD-MM-YYYY" className={smallInput} />
              </Field>
            </div>
          </div>

          {/* === Secciones extraídas (texto) === */}
          <div className="p-3 bg-muted/20 rounded-md border border-border space-y-3">
            <div className="text-[11px] font-bold uppercase text-muted-foreground">
              Contenido del programa <span className="font-normal normal-case opacity-70">(extraído del HTML público — se usa para diplomados/recibos)</span>
            </div>
            {[
              { name: 'presentacion_texto', label: 'Presentación' },
              { name: 'objetivos_texto', label: 'Objetivos' },
              { name: 'beneficios_texto', label: 'Beneficios' },
              { name: 'dirigido_a_texto', label: 'A quién va dirigido' },
              { name: 'para_que_te_prepara_texto', label: 'Para qué te prepara' },
              { name: 'por_que_estudiar_texto', label: 'Por qué estudiar' },
              { name: 'modulos_texto', label: 'Módulos / Temario' },
              { name: 'metodologia_texto', label: 'Metodología' },
              { name: 'faqs_texto', label: 'Preguntas frecuentes (FAQs)' },
              { name: 'profesores_texto', label: 'Profesorado' },
            ].map((f) => (
              <details key={f.name} className="border border-border rounded-md bg-card">
                <summary className="cursor-pointer px-3 py-2 text-xs font-medium hover:bg-muted/40 flex items-center justify-between">
                  <span>{f.label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {(product?.[f.name]?.length || 0) > 0 ? `${product[f.name].length} chars` : 'vacío'}
                  </span>
                </summary>
                <div className="px-3 pb-3">
                  <textarea
                    {...register(f.name as any)}
                    rows={6}
                    placeholder={`Pegado por el scraper. Si está vacío puedes editarlo.`}
                    className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-xs leading-relaxed resize-y font-sans"
                  />
                </div>
              </details>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 shadow disabled:opacity-50">
              {isSubmitting ? 'Guardando...' : isEdit ? 'Guardar cambios' : `Crear ${productoLabel.toLowerCase()}`}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
