// TODO: stub minimo del modulo export. El CRM hermano expone aqui un sistema
// completo de exportacion (xlsx/csv/json + templates persistentes). En v1 del
// CRM-ISEIE no portamos el sistema, pero leadFormat.ts importa el tipo
// ExportColumn — lo reexportamos como any tipado para que TS no se queje.

export type ExportFormat = 'xlsx' | 'csv' | 'json';
export type ExportCellType = 'string' | 'number' | 'date' | 'boolean';

export interface ExportColumn<T = unknown> {
  key: string;
  label: string;
  type?: ExportCellType;
  value: (row: T) => unknown;
  width?: number;
}

export interface ExportColumnConfig {
  key: string;
  label: string;
  included: boolean;
}
