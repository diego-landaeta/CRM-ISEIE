// Storage local de tickets de soporte. Cuando exista /api/tickets, este modulo
// se reemplaza por el cliente API. La forma de los datos esta diseñada para
// migrar sin tocar la UI.

export type TicketStatus = 'open' | 'in_review' | 'resolved' | 'closed';
export type TicketSeverity = 'low' | 'medium' | 'high' | 'critical';
export type TicketKind = 'bug' | 'feature' | 'question';

export interface TicketAttachment {
  name: string;
  dataUrl: string;
  size?: number;
}

export interface TicketComment {
  id: number;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  kind: TicketKind;
  severity: TicketSeverity;
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  whyItMatters: string;
  url: string;
  attachments: TicketAttachment[];
  status: TicketStatus;
  projectId: number | null;
  projectName: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
}

const STORAGE_KEY = 'crm.support-tickets';

export const TICKET_STATUS: Record<TicketStatus, { label: string; tone: string }> = {
  open:        { label: 'Abierto',        tone: 'amber' },
  in_review:   { label: 'En revisión',    tone: 'blue' },
  resolved:    { label: 'Resuelto',       tone: 'emerald' },
  closed:      { label: 'Cerrado',        tone: 'zinc' },
};

export const TICKET_SEVERITY: Record<TicketSeverity, { label: string; tone: string }> = {
  low:      { label: 'Baja',     tone: 'zinc' },
  medium:   { label: 'Media',    tone: 'amber' },
  high:     { label: 'Alta',     tone: 'red' },
  critical: { label: 'Crítica',  tone: 'red' },
};

export const TICKET_KIND: Record<TicketKind, { label: string; icon: string }> = {
  bug:     { label: 'Bug',      icon: 'Bug' },
  feature: { label: 'Mejora',   icon: 'Lightning' },
  question:{ label: 'Pregunta', icon: 'Question' },
};

function readAll(): Ticket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function writeAll(list: Ticket[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  window.dispatchEvent(new Event('crm:tickets-changed'));
}

export function listTickets(): Ticket[] {
  return readAll().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export interface CreateTicketInput {
  kind?: TicketKind;
  severity?: TicketSeverity;
  title?: string;
  description?: string;
  steps?: string;
  expected?: string;
  actual?: string;
  whyItMatters?: string;
  url?: string;
  attachments?: TicketAttachment[];
  projectId?: number | null;
  projectName?: string | null;
}

export function createTicket(input: CreateTicketInput): Ticket {
  const {
    kind, severity, title, description,
    steps, expected, actual,
    whyItMatters,
    url, attachments,
    projectId, projectName,
  } = input;
  const id = 'tkt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id,
    kind: kind || 'question',
    severity: severity || 'low',
    title: title?.trim() || '(sin titulo)',
    description: description?.trim() || '',
    steps: steps?.trim() || '',
    expected: expected?.trim() || '',
    actual: actual?.trim() || '',
    whyItMatters: whyItMatters?.trim() || '',
    url: url?.trim() || '',
    attachments: Array.isArray(attachments) ? attachments : [],
    status: 'open',
    projectId: projectId ?? null,
    projectName: projectName ?? null,
    createdAt: now,
    updatedAt: now,
    comments: [],
  };
  const next = [ticket, ...readAll()];
  writeAll(next);
  return ticket;
}

export function updateTicketStatus(id: string, status: TicketStatus): Ticket | null {
  const list = readAll();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], status, updatedAt: new Date().toISOString() };
  writeAll(list);
  return list[idx];
}

export function addComment(id: string, body: string): Ticket | null {
  const list = readAll();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const comment: TicketComment = { id: Date.now(), body: body.trim(), createdAt: new Date().toISOString() };
  list[idx] = {
    ...list[idx],
    comments: [...(list[idx].comments || []), comment],
    updatedAt: new Date().toISOString(),
  };
  writeAll(list);
  return list[idx];
}

export function deleteTicket(id: string): void {
  const next = readAll().filter((t) => t.id !== id);
  writeAll(next);
}
