import { useEffect, useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { leadSchema, ORIGEN_OPTIONS, PAIS_OPTIONS, type LeadFormData } from '../validation/lead.schema';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProducts } from '@/modules/products/hooks/useProducts';
import { X, Warning, Link as LinkIcon } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import ProductCombobox from './ProductCombobox';
import client from '@/shared/api/client';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import type { Lead } from '@/shared/types';

interface CustomFieldDef {
  id: number;
  field_key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'boolean';
  required?: boolean;
  options?: string[];
}

interface DuplicateLead {
  id: number;
  nombre: string;
  email: string;
  status?: string;
  estado?: string;
  created_at: string;
  responsable_id?: number | null;
  responsable_nombre?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  lead: Lead | null;
  onSubmit: (data: LeadFormData & { custom_fields: Record<string, unknown> }) => Promise<void> | void;
}

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground text-muted-foreground mb-1.5 block px-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1 px-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1 px-1">{error}</p>}
    </div>
  );
}

const inputClass = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground';

export default function LeadFormDialog({ open, onClose, lead, onSubmit }: Props) {
  useEscapeKey(onClose, open);
  const { activeProject, projects, isAllProjects } = useProjectContext() as {
    activeProject: any;
    projects: Array<{ id: number; nombre?: string }>;
    isAllProjects: boolean;
  };
  // En modo "Todos los proyectos" el activeProject es el sentinel (-1).
  // El form NECESITA un proyecto concreto, asi que mostramos un selector
  // al inicio para que el usuario elija a cual asignar el lead.
  const [pickedProjectId, setPickedProjectId] = useState<number | null>(null);
  const effectiveProjectId = isAllProjects ? pickedProjectId : (activeProject?.id ?? null);
  const effectiveProject = isAllProjects
    ? (projects || []).find((p) => p.id === pickedProjectId) || null
    : activeProject;

  useEffect(() => {
    if (!open) setPickedProjectId(null);
  }, [open]);

  const { user } = useAuth() as any;
  const isGestor = user?.role === 'gestor';
  const { products, refetch: refetchProducts } = useProducts(effectiveProjectId);
  const isEdit = !!lead;
  const productoLabel = (effectiveProject as any)?.producto_label || 'Producto';

  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [duplicates, setDuplicates] = useState<DuplicateLead[]>([]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormData>({
    resolver: zodResolver(leadSchema),
    defaultValues: {
      nombre: '', email: '', telefono: '',
      origen: 'directo', producto_interes: '', pais: '', notas: '',
    },
  });

  const watchedEmail = watch('email');

  // Cargar custom fields al abrir dialog
  useEffect(() => {
    if (!open || !effectiveProjectId) return;
    (async () => {
      try {
        const res = await client.get(`/field-definitions/project/${effectiveProjectId}?entity=lead`);
        if (res.success) setCustomFields(res.data || []);
      } catch {}
    })();
  }, [open, effectiveProjectId]);

  useEffect(() => {
    if (open) {
      setDuplicates([]);
      reset(lead ? {
        nombre: lead.nombre || '',
        email: lead.email || '',
        telefono: lead.telefono || '',
        origen: ((lead.origen as string)?.toLowerCase().replace(' ', '_') || 'directo') as LeadFormData['origen'],
        pais: lead.pais || '',
        producto_interes: lead.producto_interes || '',
        notas: '',
      } : {
        nombre: '', email: '', telefono: '', origen: 'directo', producto_interes: '', notas: '',
      });
      setCustomValues((lead?.custom_fields as Record<string, unknown>) || {});
    }
  }, [open, lead, reset]);

  // Deteccion de duplicado debounce.
  // Usa /leads/lookup-by-email que IGNORA el filtro RBAC de gestor para
  // que pueda detectar duplicados aunque el lead pertenezca a otra asesora.
  const checkDuplicates = useCallback(async (email: string | undefined): Promise<void> => {
    if (!email || !email.includes('@') || !effectiveProjectId || isEdit) { setDuplicates([]); return; }
    try {
      const res = await client.get(`/leads/lookup-by-email?email=${encodeURIComponent(email)}&projectId=${effectiveProjectId}`);
      if (res.success) {
        setDuplicates((res.data as DuplicateLead[]) || []);
      }
    } catch { setDuplicates([]); }
  }, [effectiveProjectId, isEdit]);

  useEffect(() => {
    const t = setTimeout(() => checkDuplicates(watchedEmail), 600);
    return () => clearTimeout(t);
  }, [watchedEmail, checkDuplicates]);

  if (!open) return null;

  async function handleFormSubmit(data: LeadFormData): Promise<void> {
    if (!effectiveProjectId) {
      // Modo ALL sin proyecto elegido — el banner pide elegirlo
      return;
    }
    await onSubmit({ ...data, custom_fields: customValues, _project_id: effectiveProjectId } as any);
    onClose();
  }

  return (
    <Portal>
      <div role="dialog" aria-label={isEdit ? 'Editar Lead' : 'Nuevo Prospecto'} className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        <div className="relative bg-card rounded-lg border border-border shadow-[0_20px_25px_-5px_rgb(0_0_0/0.1)] w-full max-w-2xl mx-4 p-4 sm:p-6 overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{isEdit ? 'Editar Lead' : 'Nuevo Prospecto'}</h2>
              <p className="text-muted-foreground text-sm mt-0.5">{isEdit ? 'Actualiza la información del lead' : 'Registra un nuevo lead manualmente'}</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted">
              <X size={18} weight="bold" />
            </button>
          </div>

          <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-3">
            {/* En modo "Todos los proyectos": pedimos al usuario que elija
                a qué proyecto pertenece el lead antes de poder rellenar nada. */}
            {isAllProjects && !isEdit && (
              <div className="rounded-md border border-violet-200 dark:border-violet-900 bg-violet-50 dark:bg-violet-950/30 p-3">
                <label className="text-xs font-semibold text-violet-800 dark:text-violet-300 block mb-1.5">
                  Proyecto al que pertenece este prospecto *
                </label>
                <select
                  value={pickedProjectId ?? ''}
                  onChange={(e) => setPickedProjectId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-card text-sm"
                  required
                >
                  <option value="">— Elige proyecto —</option>
                  {(projects || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
                <p className="text-[11px] text-violet-700 dark:text-violet-400 mt-1.5">
                  Estás en la vista global. El lead se creará en el proyecto elegido y aplicará su round-robin.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre *" error={errors.nombre?.message}>
                <input {...register('nombre')} placeholder="Nombre completo" className={inputClass} />
              </Field>
              <Field label="Email" error={errors.email?.message} hint="Opcional si pones teléfono">
                <input {...register('email')} type="email" placeholder="correo@ejemplo.com (opcional)" className={inputClass} />
              </Field>
            </div>

            {duplicates.length > 0 && (
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-md p-3 flex gap-3 items-start">
                <Warning size={16} weight="fill" className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                    Ya existe {duplicates.length} lead{duplicates.length > 1 ? 's' : ''} con ese email
                  </p>
                  {duplicates.slice(0, 3).map(d => {
                    // Gestor solo puede abrir leads asignados a él/ella.
                    // Si es de otra gestora, mostramos info pero sin link clicable.
                    const isMine = !isGestor || d.responsable_id === user?.id;
                    const responsableLabel = d.responsable_nombre || 'Sin asignar';
                    const inner = (
                      <>
                        <LinkIcon size={10} /> {d.nombre} — {d.status || d.estado} — Asignado a <strong>{responsableLabel}</strong> — {new Date(d.created_at).toLocaleDateString('es-ES')}
                      </>
                    );
                    return isMine ? (
                      <a key={d.id} href={`/crm/leads/${d.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1 mt-0.5"
                      >{inner}</a>
                    ) : (
                      <div key={d.id} className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1 mt-0.5"
                        title="Este lead pertenece a otra asesora — contacta con ella para coordinar"
                      >{inner}</div>
                    );
                  })}
                  {isGestor && duplicates.some(d => d.responsable_id !== user?.id) && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5 italic">
                      Hay duplicados asignados a otras asesoras. Coordina con ellas antes de crear un registro nuevo.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Field label="Teléfono" error={errors.telefono?.message} hint="Opcional si pones email">
                <input {...register('telefono')} placeholder="+34 600 000 000 (opcional)" className={inputClass} />
              </Field>
              <Field label="Origen *" error={errors.origen?.message}>
                <Controller
                  name="origen"
                  control={control}
                  render={({ field }) => (
                    <Select<LeadFormData['origen']>
                      value={field.value}
                      onChange={field.onChange}
                      options={ORIGEN_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                      ariaLabel="Origen"
                    />
                  )}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label={`${productoLabel} de interes`}>
                <Controller
                  name="producto_interes"
                  control={control}
                  render={({ field }) => (
                    <ProductCombobox
                      value={field.value}
                      onChange={field.onChange}
                      products={products}
                      projectId={effectiveProjectId}
                      projectLabel={productoLabel}
                      onProductCreated={() => refetchProducts?.()}
                    />
                  )}
                />
              </Field>
              <Field label="Pais">
                <Controller
                  name="pais"
                  control={control}
                  render={({ field }) => (
                    <Select<string>
                      value={field.value || ''}
                      onChange={field.onChange}
                      options={[
                        { value: '', label: 'Sin especificar' },
                        ...PAIS_OPTIONS.map((p) => ({ value: p, label: p })),
                      ]}
                      ariaLabel="País"
                    />
                  )}
                />
              </Field>
            </div>

            {customFields.length > 0 && (
              <div className="border-t border-border pt-3 mt-3 space-y-3">
                <p className="text-xs text-muted-foreground text-muted-foreground">Campos personalizados</p>
                <div className="grid grid-cols-2 gap-3">
                  {customFields.map(f => (
                    <div key={f.id} className={f.type === 'textarea' ? 'col-span-2' : ''}>
                      <label className="text-xs text-muted-foreground text-muted-foreground mb-1.5 block px-1">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      {f.type === 'textarea' ? (
                        <textarea
                          value={(customValues[f.field_key] as string) || ''}
                          onChange={e => setCustomValues({ ...customValues, [f.field_key]: e.target.value })}
                          required={f.required}
                          className={inputClass + ' h-20 py-2 resize-none'}
                        />
                      ) : f.type === 'select' ? (
                        <Select<string>
                          value={(customValues[f.field_key] as string) || ''}
                          onChange={(v) => setCustomValues({ ...customValues, [f.field_key]: v })}
                          options={[
                            { value: '', label: 'Seleccionar...' },
                            ...(f.options || []).map(o => ({ value: o, label: o })),
                          ]}
                          ariaLabel={f.label}
                        />
                      ) : f.type === 'boolean' ? (
                        <label className="flex items-center gap-2 h-9">
                          <input type="checkbox"
                            checked={!!customValues[f.field_key]}
                            onChange={e => setCustomValues({ ...customValues, [f.field_key]: e.target.checked })}
                          />
                          <span className="text-sm">Si</span>
                        </label>
                      ) : (
                        <input
                          type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                          value={(customValues[f.field_key] as string) || ''}
                          onChange={e => setCustomValues({ ...customValues, [f.field_key]: e.target.value })}
                          required={f.required}
                          className={inputClass}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Field label="Notas">
              <textarea
                {...register('notas')}
                placeholder="Notas adicionales sobre el lead..."
                rows={3}
                className="w-full px-4 py-3 rounded-md border border-border bg-muted/50 text-sm outline-none resize-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground"
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose}
                className="h-9 px-4 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
              >Cancelar</button>
              <button type="submit" disabled={isSubmitting}
                className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >{isSubmitting ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Crear lead'}</button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
