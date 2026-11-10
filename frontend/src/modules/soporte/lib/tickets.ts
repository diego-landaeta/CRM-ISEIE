// Los tickets de soporte, contra el servidor (#38).
//
// Esto ERA storage local, con esta nota: «cuando exista /api/tickets, este
// modulo se reemplaza por el cliente API. La forma de los datos esta diseñada
// para migrar sin tocar la UI». Ya existe, y la forma se ha respetado: los
// tipos `Ticket`, `TicketStatus` y `CreateTicketInput` son los mismos, asi que
// los componentes no cambian de aspecto.
//
// LO UNICO QUE CAMBIA ES QUE AHORA SON ASINCRONAS. Una llamada al servidor no
// puede no serlo, y fingir lo contrario con una cache local devolveria datos
// viejos sin avisar.
//
// LOS QUE HUBIERA EN EL NAVEGADOR NO SE TRAEN. Estan en el `localStorage` de
// cada maquina y desde aqui no se alcanzan los de nadie mas. `ticketsViejos()`
// los devuelve para que la pantalla pueda decirlo en vez de hacerlos
// desaparecer en silencio.

import client from '@/shared/api/client';

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

/** Avisa a las pantallas abiertas de que la lista ha cambiado. Lo escuchaba
 *  ya el lanzador, asi que se mantiene y no hay que tocarlo. */
function avisar() {
  window.dispatchEvent(new Event('crm:tickets-changed'));
}

/**
 * Los tickets que quedaron en el navegador de esta maquina.
 *
 * No se migran: estan en `localStorage` y desde el servidor no se alcanzan.
 * Se devuelven para que la pantalla pueda decir que estan ahi en vez de que
 * desaparezcan sin explicacion.
 */
export function ticketsViejos(): Ticket[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function listTickets(): Promise<Ticket[]> {
  const r = await client.get<Ticket[]>('/soporte', { params: { limit: 200 } })
    .catch(() => ({ success: false, data: [] as Ticket[] }));
  return r.success && Array.isArray(r.data) ? r.data : [];
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const r = await client.get<Ticket>(`/soporte/${id}`).catch(() => ({ success: false, data: null }));
  return r.success ? (r.data as Ticket) : null;
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

export async function createTicket(input: CreateTicketInput): Promise<Ticket | null> {
  const r = await client.post<Ticket>('/soporte', {
    kind: input.kind || 'question',
    severity: input.severity || 'low',
    title: input.title?.trim() || '(sin titulo)',
    description: input.description,
    steps: input.steps,
    expected: input.expected,
    actual: input.actual,
    whyItMatters: input.whyItMatters,
    url: input.url,
    projectId: input.projectId ?? null,
  }).catch(() => ({ success: false, data: null }));

  if (!r.success || !r.data) return null;
  const ticket = r.data as Ticket;

  // Los adjuntos van DESPUES y de uno en uno: el ticket tiene que existir
  // antes de poder colgarle nada. Si alguno falla, el ticket ya esta guardado
  // — que es lo que de verdad importaba.
  for (const a of input.attachments || []) {
    try {
      const fd = new FormData();
      fd.append('file', await comoFichero(a));
      await client.post(`/soporte/${ticket.id}/adjuntos`, fd);
    } catch { /* el ticket sigue en pie */ }
  }

  avisar();
  return ticket;
}

/** El formulario los trae como `dataUrl`; el servidor los quiere como fichero. */
async function comoFichero(a: TicketAttachment): Promise<File> {
  const blob = await (await fetch(a.dataUrl)).blob();
  return new File([blob], a.name, { type: blob.type });
}

export async function updateTicketStatus(id: string, status: TicketStatus): Promise<Ticket | null> {
  const r = await client.patch<Ticket>(`/soporte/${id}/estado`, { status })
    .catch(() => ({ success: false, data: null }));
  avisar();
  return r.success ? (r.data as Ticket) : null;
}

export async function addComment(id: string, body: string): Promise<Ticket | null> {
  const r = await client.post<Ticket>(`/soporte/${id}/mensajes`, { body: body.trim() })
    .catch(() => ({ success: false, data: null }));
  avisar();
  return r.success ? (r.data as Ticket) : null;
}

export async function deleteTicket(id: string): Promise<void> {
  await client.delete(`/soporte/${id}`).catch(() => {});
  avisar();
}
