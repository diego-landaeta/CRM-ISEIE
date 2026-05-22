import { useState, lazy, Suspense } from 'react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Select from '@/shared/components/ui/Select';
import { Plus, PencilSimple, Trash, ArrowUp, ArrowDown, ListChecks, Users, Package, UserCheck } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import useFieldDefinitions from '../hooks/useFieldDefinitions';
import * as api from '../api/fields.api';
import type { FieldDefinition, FieldEntity, FieldType, FieldOptions } from '../api/fields.api';
import CustomFieldRenderer from '../components/CustomFieldRenderer';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

interface TabDef {
  key: FieldEntity;
  label: string;
  Icon: PhosphorIcon;
}

const TABS: ReadonlyArray<TabDef> = [
  { key: 'lead',    label: 'Prospectos', Icon: Users },
  { key: 'client',  label: 'Clientes',   Icon: UserCheck },
  { key: 'product', label: 'Productos',  Icon: Package },
];

const TYPES: ReadonlyArray<{ v: FieldType; label: string }> = [
  { v: 'text',     label: 'Texto' },
  { v: 'number',   label: 'Numero' },
  { v: 'date',     label: 'Fecha' },
  { v: 'select',   label: 'Lista (opciones)' },
  { v: 'boolean',  label: 'Si/No' },
  { v: 'textarea', label: 'Texto largo' },
];

interface EditingField {
  id?: number;
  project_id?: number;
  entity: FieldEntity;
  field_key: string;
  label: string;
  type: FieldType;
  options: FieldOptions | null;
  required: boolean;
  orden: number;
}

function toSnake(label: string): string {
  return (label || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

export default function FieldDefinitionsPage() {
  const { activeProject } = useProjectContext();
  const [entity, setEntity] = useState<FieldEntity>('lead');
  const [editing, setEditing] = useState<EditingField | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FieldDefinition | null>(null);

  const { fields, loading, refetch } = useFieldDefinitions(activeProject?.id, entity);

  function startCreate(): void {
    setEditing({
      project_id: activeProject?.id,
      entity,
      field_key: '',
      label: '',
      type: 'text',
      options: null,
      required: false,
      orden: fields.length,
    });
  }

  function startEdit(f: FieldDefinition): void {
    setEditing({ ...f, options: f.options || null });
  }

  async function save(): Promise<void> {
    if (!editing) return;
    if (!editing.label.trim()) {
      toast({ title: 'Falta etiqueta', variant: 'destructive' }); return;
    }
    const fieldKey = editing.field_key || toSnake(editing.label);
    if (!/^[a-z][a-z0-9_]*$/.test(fieldKey)) {
      toast({ title: 'Clave invalida', description: 'Debe empezar con letra minuscula y solo a-z, 0-9, _.', variant: 'destructive' });
      return;
    }
    try {
      if (editing.id) {
        await api.updateField(editing.id, {
          label: editing.label,
          type: editing.type,
          options: editing.options,
          required: editing.required,
          orden: editing.orden,
        });
        toast({ title: 'Campo actualizado' });
      } else if (activeProject?.id) {
        await api.createField({
          project_id: activeProject.id,
          entity,
          field_key: fieldKey,
          label: editing.label,
          type: editing.type,
          options: editing.options,
          required: editing.required,
          orden: editing.orden,
        });
        toast({ title: 'Campo creado' });
      }
      setEditing(null);
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await api.deleteField(deleteTarget.id);
      toast({ title: 'Campo eliminado' });
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function move(field: FieldDefinition, direction: 'up' | 'down'): Promise<void> {
    if (!activeProject?.id) return;
    const idx = fields.findIndex((f) => f.id === field.id);
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= fields.length) return;
    const newOrder = fields.map((f, i) => ({
      id: f.id,
      orden: i === idx ? fields[swapWith].orden : i === swapWith ? fields[idx].orden : f.orden,
    }));
    try {
      await api.reorderFields(activeProject.id, newOrder);
      refetch();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    }
  }

  const tabMeta = TABS.find((t) => t.key === entity);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Campos personalizados"
        subtitle={`Configura campos extra para ${tabMeta?.label.toLowerCase() || ''} de ${activeProject?.nombre || 'este proyecto'}`}
        actions={
          <button
            onClick={startCreate}
            disabled={!activeProject?.id}
            aria-label="Nuevo campo"
            className="flex items-center gap-1.5 h-9 px-3 sm:px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo campo</span>
          </button>
        }
      />

      <nav className="flex border-b border-border" role="tablist" aria-label="Entidad">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={entity === t.key}
            onClick={() => { setEntity(t.key); setEditing(null); }}
            className={`flex items-center gap-2 px-3 h-9 text-sm font-bold border-b-2 transition-colors ${
              entity === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <t.Icon size={14} weight="bold" /> {t.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <p className="text-sm text-muted-foreground py-6">Cargando campos...</p>
      ) : fields.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={`Sin campos custom para ${tabMeta?.label.toLowerCase()}`}
          description="Crea campos extra para capturar datos especificos del proyecto."
          action={
            <button onClick={startCreate} className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold">
              <Plus size={14} weight="bold" /> Crear primer campo
            </button>
          }
        />
      ) : (
        <ul className="grid gap-2">
          {fields.map((f, i) => (
            <li
              key={f.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card"
            >
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => move(f, 'up')}
                  disabled={i === 0}
                  aria-label="Subir"
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp size={12} weight="bold" />
                </button>
                <button
                  onClick={() => move(f, 'down')}
                  disabled={i === fields.length - 1}
                  aria-label="Bajar"
                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown size={12} weight="bold" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{f.label}</span>
                  {f.required && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-bold">Requerido</span>}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">{f.type}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  <code>{f.field_key}</code>
                  {f.type === 'select' && f.options?.choices && f.options.choices.length > 0 && (
                    <> {'·'} {f.options.choices.length} opciones</>
                  )}
                </p>
              </div>
              <button
                onClick={() => startEdit(f)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Editar campo"
              >
                <PencilSimple size={14} />
              </button>
              <button
                onClick={() => setDeleteTarget(f)}
                className="h-9 w-9 inline-flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 transition-colors"
                aria-label="Eliminar campo"
              >
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Preview de los campos en un formulario */}
      {fields.length > 0 && (
        <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-bold uppercase text-muted-foreground">Preview</h3>
          <p className="text-xs text-muted-foreground">Asi se veran al editar un {tabMeta?.label.toLowerCase().replace(/s$/, '') || 'registro'}.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <CustomFieldRenderer key={f.id} field={f} value="" onChange={() => {}} />
            ))}
          </div>
        </section>
      )}

      {editing && (
        <FieldEditorDialog
          field={editing}
          onChange={setEditing}
          onSave={save}
          onClose={() => setEditing(null)}
          isEdit={!!editing.id}
        />
      )}

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteTarget}
          title="Eliminar campo"
          message={`Eliminar el campo "${deleteTarget?.label}"? Los valores existentes en los registros NO se borraran, pero el campo dejara de aparecer en formularios.`}
          confirmLabel="Eliminar"
          tone="destructive"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </Suspense>
    </div>
  );
}

interface FieldEditorDialogProps {
  field: EditingField;
  onChange: (next: EditingField) => void;
  onSave: () => void | Promise<void>;
  onClose: () => void;
  isEdit: boolean;
}

function FieldEditorDialog({ field, onChange, onSave, onClose, isEdit }: FieldEditorDialogProps) {
  function patch(diff: Partial<EditingField>): void {
    onChange({ ...field, ...diff });
  }

  function setOptionsFromText(text: string): void {
    const choices = text.split('\n').map((s) => s.trim()).filter(Boolean);
    onChange({ ...field, options: choices.length ? { choices } : null });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl border border-border shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="font-extrabold">{isEdit ? 'Editar campo' : 'Nuevo campo'}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted" aria-label="Cerrar">x</button>
        </header>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">Etiqueta visible *</span>
            <input
              autoFocus
              value={field.label}
              onChange={(e) => patch({ label: e.target.value })}
              placeholder="Ej: Edad del prospecto"
              className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm"
            />
          </label>

          {!isEdit && (
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground">Clave interna (snake_case)</span>
              <input
                value={field.field_key}
                onChange={(e) => patch({ field_key: e.target.value })}
                onBlur={() => { if (!field.field_key && field.label) patch({ field_key: toSnake(field.label) }); }}
                placeholder={field.label ? toSnake(field.label) : 'edad_prospecto'}
                className="mt-1 w-full h-10 px-3 rounded-md border border-border bg-muted/30 text-sm font-mono"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Si lo dejas vacio se genera de la etiqueta. NO se puede cambiar despues.</p>
            </label>
          )}

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">Tipo</span>
            <div className="mt-1">
              <Select<FieldType>
                value={field.type}
                onChange={(v) => patch({ type: v, options: v === 'select' ? (field.options || { choices: [] }) : null })}
                options={TYPES.map((t) => ({ value: t.v, label: t.label }))}
                ariaLabel="Tipo de campo"
              />
            </div>
          </label>

          {field.type === 'select' && (
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground">Opciones (una por linea)</span>
              <textarea
                value={(field.options?.choices || []).join('\n')}
                onChange={(e) => setOptionsFromText(e.target.value)}
                rows={4}
                placeholder="Opcion 1&#10;Opcion 2"
                className="mt-1 w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm font-mono"
              />
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => patch({ required: e.target.checked })}
            />
            Campo requerido
          </label>
        </div>
        <footer className="p-4 border-t border-border flex gap-2 justify-end">
          <button onClick={onClose} className="h-9 px-4 rounded-lg text-sm font-bold">Cancelar</button>
          <button onClick={onSave} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold">
            {isEdit ? 'Guardar' : 'Crear'}
          </button>
        </footer>
      </div>
    </div>
  );
}
