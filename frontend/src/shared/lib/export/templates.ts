// Plantillas guardadas en localStorage por contexto (CRM-196).
import type { ExportColumnConfig, ExportFormat, ExportTemplate } from './types';

const KEY = 'crm.exportTemplates.v1';

function readAll(): ExportTemplate[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: ExportTemplate[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // localStorage lleno o deshabilitado — silencioso
  }
}

export function listTemplates(context: string): ExportTemplate[] {
  return readAll().filter((t) => t.context === context);
}

export function saveTemplate(input: {
  name: string;
  context: string;
  format: ExportFormat;
  columns: ExportColumnConfig[];
}): ExportTemplate {
  const all = readAll();
  // Reemplazar si ya existe una plantilla con el mismo nombre en el mismo contexto
  const filtered = all.filter((t) => !(t.context === input.context && t.name === input.name));
  const tpl: ExportTemplate = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    context: input.context,
    format: input.format,
    columns: input.columns,
    createdAt: new Date().toISOString(),
  };
  writeAll([...filtered, tpl]);
  return tpl;
}

export function deleteTemplate(id: string): void {
  writeAll(readAll().filter((t) => t.id !== id));
}
