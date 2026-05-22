import type { FieldDefinition } from '../api/fields.api';
import Select from '@/shared/components/ui/Select';

const inputClass = 'w-full h-10 px-3 rounded-md border border-border bg-muted/30 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

export type CustomFieldValue = string | number | boolean | null | undefined;

interface CustomFieldRendererProps {
  field: FieldDefinition;
  value: CustomFieldValue;
  onChange?: (key: string, next: CustomFieldValue) => void;
  disabled?: boolean;
}

export default function CustomFieldRenderer({ field, value, onChange, disabled = false }: CustomFieldRendererProps) {
  const id = `cf-${field.field_key}`;
  const v: CustomFieldValue = value ?? '';

  function set(next: CustomFieldValue): void {
    onChange?.(field.field_key, next);
  }

  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground mb-1 block">
        {field.label}{field.required && <span className="text-red-500"> *</span>}
      </label>
      {renderInput()}
    </div>
  );

  function renderInput() {
    const stringValue = v === null || v === undefined ? '' : String(v);
    switch (field.type) {
      case 'number':
        return (
          <input
            id={id}
            type="number"
            disabled={disabled}
            required={field.required}
            value={stringValue}
            onChange={(e) => set(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputClass}
          />
        );
      case 'date':
        return (
          <input
            id={id}
            type="date"
            disabled={disabled}
            required={field.required}
            value={stringValue}
            onChange={(e) => set(e.target.value)}
            className={inputClass}
          />
        );
      case 'select': {
        const choices = field.options?.choices || [];
        return (
          <Select<string>
            value={stringValue}
            onChange={set}
            options={[
              { value: '', label: '— Seleccionar —' },
              ...choices.map((c) => ({ value: c, label: c })),
            ]}
            ariaLabel={field.label}
            disabled={disabled}
          />
        );
      }
      case 'boolean':
        return (
          <label className="flex items-center gap-2 text-sm">
            <input
              id={id}
              type="checkbox"
              disabled={disabled}
              checked={!!v}
              onChange={(e) => set(e.target.checked)}
              className="rounded border-border"
            />
            {v ? 'Si' : 'No'}
          </label>
        );
      case 'textarea':
        return (
          <textarea
            id={id}
            disabled={disabled}
            required={field.required}
            value={stringValue}
            onChange={(e) => set(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm outline-none resize-y focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
          />
        );
      case 'text':
      default:
        return (
          <input
            id={id}
            type="text"
            disabled={disabled}
            required={field.required}
            value={stringValue}
            onChange={(e) => set(e.target.value)}
            className={inputClass}
          />
        );
    }
  }
}
