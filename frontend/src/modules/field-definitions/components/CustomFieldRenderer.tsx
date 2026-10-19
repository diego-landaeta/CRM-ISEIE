import type { FieldDefinition } from '../api/fields.api';
import Select from '@/shared/components/ui/Select';
import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';

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

  // El Field común (#106): el obligatorio con su nombre para el lector de
  // pantalla, y no un asterisco rojo suelto. La etiqueta enfoca su campo,
  // también el desplegable (el `id` va a su botón).
  return (
    <Field label={field.label} required={field.required} disabled={disabled} htmlFor={id}>
      {renderInput()}
    </Field>
  );

  function renderInput() {
    const stringValue = v === null || v === undefined ? '' : String(v);
    switch (field.type) {
      case 'number':
        return (
          <input autoComplete="off"
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
            id={id}
            value={stringValue}
            onChange={set}
            options={[
              { value: '', label: 'Elige una opción…' },
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
            {v ? 'Sí' : 'No'}
          </label>
        );
      case 'textarea':
        return (
          <textarea autoComplete="off"
            id={id}
            disabled={disabled}
            required={field.required}
            value={stringValue}
            onChange={(e) => set(e.target.value)}
            rows={3}
            className={`${inputClass} h-auto py-2 resize-y`}
          />
        );
      case 'text':
      default:
        return (
          <input autoComplete="off"
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
