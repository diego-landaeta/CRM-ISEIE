// Tipos compartidos para el export universal (CRM-196).

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

export interface ExportTemplate {
  id: string;
  name: string;
  context: string;
  format: ExportFormat;
  columns: ExportColumnConfig[];
  createdAt: string;
}

export interface ExportRequest<T = unknown> {
  context: string;
  filename: string;
  format: ExportFormat;
  columns: ExportColumn<T>[];
  config: ExportColumnConfig[];
  rows: T[];
}
