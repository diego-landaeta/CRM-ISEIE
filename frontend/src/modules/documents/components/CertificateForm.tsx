import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash, Download, Eye, Certificate as CertificateIcon, CaretDown } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { documentsApi, type CrmDocument } from '../api/documents.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import { getAccessToken } from '@/shared/api/client';
import PreviewModal from './PreviewModal';
import { downloadDoc } from '../lib/downloadDoc';
import NaturalDatePicker from './NaturalDatePicker';

const inp = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

interface ModuloField {
  nombre: string;
}

interface CertificateFormValues {
  alumno_nombre: string;
  alumno_dni: string;
  alumno_email: string;
  curso_nombre: string;
  horas_total: string;
  modalidad: string;
  fecha_inicio: string;
  fecha_fin: string;
  fecha_expedicion: string;
  ciudad: string;
  pais: string;
  director_nombre: string;
  resp_nombre: string;
  modulos: ModuloField[];
}

interface CertificateFormProps {
  onGenerated?: (doc: CrmDocument) => void;
}

export default function CertificateForm({ onGenerated }: CertificateFormProps) {
  const { activeProject } = useProjectContext();
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [fixedDataOpen, setFixedDataOpen] = useState(false);

  const { register, control, handleSubmit, watch, setValue } = useForm<CertificateFormValues>({
    defaultValues: {
      alumno_nombre: '',
      alumno_dni: '',
      alumno_email: '',
      curso_nombre: '',
      horas_total: '',
      modalidad: 'Online',
      fecha_inicio: '',
      fecha_fin: '',
      fecha_expedicion: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
      ciudad: 'Valencia',
      pais: 'España',
      director_nombre: '',
      resp_nombre: '',
      modulos: [{ nombre: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'modulos' });

  const [touched, setTouched] = useState(false);

  function getMissingFields(values: CertificateFormValues): string[] {
    const missing: string[] = [];
    if (!values.alumno_nombre?.trim()) missing.push('Nombre del alumno');
    if (!values.alumno_dni?.trim()) missing.push('DNI/NIE');
    if (!values.curso_nombre?.trim()) missing.push('Nombre del curso');
    if (!values.fecha_expedicion?.trim()) missing.push('Fecha de expedición');
    return missing;
  }

  function reportMissing(values: CertificateFormValues): boolean {
    const missing = getMissingFields(values);
    if (missing.length === 0) return false;
    setTouched(true);
    toast({ title: 'Faltan campos obligatorios', description: missing.join(' · '), variant: 'destructive' });
    return true;
  }

  const invalidFields = touched ? new Set(getMissingFields(watch())) : new Set<string>();

  async function handlePreview(): Promise<void> {
    const data = watch();
    if (reportMissing(data)) return;
    setPreviewing(true);
    try {
      const payload = {
        ...data,
        modulos: data.modulos.map(m => m.nombre).filter(Boolean),
      };
      const baseUrl = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '');
      const token = getAccessToken() || '';
      const res = await fetch(`${baseUrl}/api/documents/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'certificate', data: payload }),
      });
      if (!res.ok) {
        toast({ title: 'Error generando preview', variant: 'destructive' });
        return;
      }
      const html = await res.text();
      setPreviewHtml(html);
    } catch {
      toast({ title: 'Error generando preview', variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  }

  async function onSubmit(data: CertificateFormValues): Promise<void> {
    if (!activeProject?.id) return;
    if (reportMissing(data)) return;
    setLoading(true);
    try {
      const payload = {
        ...data,
        modulos: data.modulos.map(m => m.nombre).filter(Boolean),
      };
      const res = await documentsApi.generate(activeProject.id, 'certificate', payload);
      if (res.success && res.data) {
        toast({ title: 'Certificado generado', description: `Nº ${res.data.number} — descargando PDF…` });
        onGenerated?.(res.data);
        // Auto-descarga del PDF recien generado
        if (activeProject?.id) {
          downloadDoc(res.data, activeProject.id).catch(() => {/* silencioso */});
        }
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Alumno */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="font-semibold text-sm mb-4">Datos del alumno</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Nombre completo <span className="text-red-500">*</span></label>
            <input
              {...register('alumno_nombre', { required: true })}
              className={inp + (invalidFields.has('Nombre del alumno') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              placeholder="Nombre Apellido Apellido"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">DNI/NIE <span className="text-red-500">*</span></label>
            <input
              {...register('alumno_dni', { required: true })}
              className={inp + (invalidFields.has('DNI/NIE') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              placeholder="12345678A"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input
              type="email"
              {...register('alumno_email')}
              className={inp}
              placeholder="alumno@ejemplo.com"
            />
          </div>
        </div>
      </div>

      {/* Curso */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="font-semibold text-sm mb-4">Datos del curso</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">Nombre del diplomado/curso <span className="text-red-500">*</span></label>
            <input
              {...register('curso_nombre', { required: true })}
              className={inp + (invalidFields.has('Nombre del curso') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              placeholder="Diplomado en Psicoterapia Integrativa"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Horas totales</label>
            <input {...register('horas_total')} className={inp} placeholder="750"/>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Fecha expedición <span className="text-red-500">*</span></label>
            <NaturalDatePicker
              value={watch('fecha_expedicion')}
              onChange={(text) => setValue('fecha_expedicion', text, { shouldDirty: true })}
              required
              invalid={invalidFields.has('Fecha de expedición')}
              placeholder="7 de mayo de 2026 *"
              ariaLabel="Fecha de expedición"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Fecha inicio</label>
            <NaturalDatePicker
              value={watch('fecha_inicio')}
              onChange={(text) => setValue('fecha_inicio', text, { shouldDirty: true })}
              placeholder="23 de noviembre de 2025"
              ariaLabel="Fecha de inicio del curso"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Fecha fin</label>
            <NaturalDatePicker
              value={watch('fecha_fin')}
              onChange={(text) => setValue('fecha_fin', text, { shouldDirty: true })}
              placeholder="20 de abril de 2026"
              ariaLabel="Fecha de fin del curso"
            />
          </div>
        </div>
      </div>

      {/* Módulos */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h3 className="font-semibold text-sm mb-4">Plan de estudios — Módulos</h3>
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={f.id} className="flex gap-2 items-center">
              <span className="text-xs text-muted-foreground w-16 shrink-0">Módulo {i + 1}</span>
              <input {...register(`modulos.${i}.nombre`)} className={inp} placeholder={`Nombre del módulo ${i + 1}`}/>
              <button type="button" onClick={() => remove(i)} aria-label={`Eliminar módulo ${i + 1}`} title={`Eliminar módulo ${i + 1}`} className="text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                <Trash size={14}/>
              </button>
            </div>
          ))}
          <button type="button" onClick={() => append({ nombre: '' })}
            className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors mt-1">
            <Plus size={13}/> Añadir módulo
          </button>
        </div>
      </div>

      {/* Datos fijos ISEIE (colapsable) */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setFixedDataOpen(o => !o)}
          aria-expanded={fixedDataOpen}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <div>
            <h3 className="font-semibold text-sm">Datos fijos · ISEIE</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Modalidad, ciudad y firmantes — se aplican por defecto</p>
          </div>
          <CaretDown size={14} className={`text-muted-foreground transition-transform ${fixedDataOpen ? 'rotate-180' : ''}`} />
        </button>
        {fixedDataOpen && (
          <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-1 border-t border-border">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Modalidad</label>
              <input {...register('modalidad')} className={inp}/>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Ciudad</label>
              <input {...register('ciudad')} className={inp}/>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Director</label>
              <input {...register('director_nombre')} className={inp}/>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Responsable de Formación</label>
              <input {...register('resp_nombre')} className={inp}/>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row justify-end gap-2 sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 bg-background sm:bg-transparent border-t border-border sm:border-0">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewing || loading}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Eye size={16} />
          {previewing ? 'Generando…' : 'Vista previa'}
        </button>
        <button
          type="submit"
          disabled={loading || previewing}
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Download size={16} />
          {loading ? 'Generando PDF…' : 'Generar Certificado PDF'}
        </button>
      </div>
    </form>

    {previewHtml && (
      <PreviewModal
        html={previewHtml}
        title="Vista previa del certificado"
        TitleIcon={CertificateIcon}
        onClose={() => setPreviewHtml(null)}
      />
    )}
    </>
  );
}
