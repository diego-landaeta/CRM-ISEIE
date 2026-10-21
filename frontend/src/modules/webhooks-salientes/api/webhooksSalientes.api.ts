import client from '@/shared/api/client';

/**
 * Conexión → «Webhook de transferencias» (Diego, 15/10; migración 206).
 *
 * «Enviar esos datos ÚNICAMENTE CUANDO SE PONGA DATOS POR TRANSFERENCIA
 * BANCARIA / DEPÓSITO BANCARIO». Solo esas dos formas de cobro se pueden
 * elegir: el servidor rechaza cualquier otra.
 */

export type AmbitoWebhook = 'todas' | 'empresa' | 'campus';
export type MetodoWebhook = 'transferencia' | 'deposito';
export type EstadoEnvio = 'pendiente' | 'enviando' | 'enviado' | 'fallido';

/** Espejo de METODOS_QUE_DISPARAN del servidor. */
export const METODOS_WEBHOOK: ReadonlyArray<{ id: MetodoWebhook; label: string; evento: string }> = [
  { id: 'transferencia', label: 'Transferencia bancaria', evento: 'cobro.transferencia' },
  { id: 'deposito', label: 'Depósito bancario', evento: 'cobro.deposito' },
];

export interface WebhookSaliente {
  id: number;
  nombre: string;
  url: string;
  activo: boolean;
  ambito: AmbitoWebhook;
  issuer_id: number | null;
  empresa: string | null;
  project_id: number | null;
  proyecto: string | null;
  metodos: MetodoWebhook[];
  /** Los cuatro últimos caracteres del secreto. El secreto entero no vuelve nunca. */
  secreto_cola: string | null;
  creado_por: number | null;
  creado_por_nombre: string | null;
  created_at: string;
  updated_at: string;
  ultimo_envio_at: string | null;
  fallidos_30_dias: number;
  /** Solo en la respuesta de crear o de regenerar: la única vez que se ve. */
  secreto?: string;
}

export interface EnvioWebhook {
  id: number;
  webhook_id: number;
  webhook_nombre?: string;
  payment_id: number | null;
  evento: string;
  idempotency_key: string;
  prueba: boolean;
  payload: Record<string, unknown>;
  estado: EstadoEnvio;
  http_status: number | null;
  respuesta: string | null;
  intentos: number;
  error: string | null;
  proximo_intento_at: string | null;
  ultimo_intento_at: string | null;
  enviado_at: string | null;
  reenviado_at?: string | null;
  reenviado_por_nombre?: string | null;
  created_at: string;
}

export interface EjemploWebhook {
  metodos: MetodoWebhook[];
  eventos: Record<MetodoWebhook, string>;
  cabeceras: Array<{ nombre: string; valor: string }>;
  payload: Record<string, unknown>;
}

export interface DatosWebhook {
  nombre?: string;
  url?: string;
  ambito?: AmbitoWebhook;
  issuer_id?: number | null;
  project_id?: number | null;
  metodos?: MetodoWebhook[];
  activo?: boolean;
  /** Pegado a mano. Sin él, al crear se genera uno. */
  secreto?: string;
  regenerar_secreto?: boolean;
}

export const webhooksSalientesApi = {
  /** `projectId` o `issuerId` (de `ponerAmbito`): los que se disparan con un cobro de ahí. */
  listar: (ambito: URLSearchParams) => client.get(`/webhooks-salientes?${ambito.toString()}`),
  ejemplo: () => client.get('/webhooks-salientes/ejemplo'),
  crear: (datos: DatosWebhook) => client.post('/webhooks-salientes', datos),
  cambiar: (id: number, datos: DatosWebhook) => client.patch(`/webhooks-salientes/${id}`, datos),
  borrar: (id: number) => client.delete(`/webhooks-salientes/${id}`),
  /** «Enviar prueba»: el payload de ejemplo con `"prueba": true`. Contesta con el envío. */
  probar: (id: number) => client.post(`/webhooks-salientes/${id}/prueba`, {}),
  envios: (filtro: { webhookId?: number | null; estado?: EstadoEnvio | ''; limit?: number; projectId?: number | null; issuerId?: number | null } = {}) => {
    const q = new URLSearchParams();
    if (filtro.webhookId) q.set('webhookId', String(filtro.webhookId));
    // El ámbito de arriba: los envíos de una empresa no se ven desde otra (21/10).
    if (filtro.projectId) q.set('projectId', String(filtro.projectId));
    else if (filtro.issuerId) q.set('issuerId', String(filtro.issuerId));
    if (filtro.estado) q.set('estado', filtro.estado);
    q.set('limit', String(filtro.limit || 50));
    return client.get(`/webhooks-salientes/envios?${q.toString()}`);
  },
  /** Solo uno fallido: vuelve a mandarse con su misma clave de idempotencia. */
  reenviar: (envioId: number) => client.post(`/webhooks-salientes/envios/${envioId}/reenviar`, {}),
};

/** Un campus tal como llega del contexto: con su empresa. */
export type CampusConEmpresa = { id: number; nombre: string; sociedad_emisora_id?: number | null; sociedad_nombre?: string | null };

/**
 * Las opciones de «Para quién»: `todas`, `e:<empresa>` o `c:<campus>`. La de
 * todas las empresas solo se ofrece al super admin, que es el único que puede.
 */
export function opcionesDeAmbito(proyectos: CampusConEmpresa[], esSuperadmin: boolean) {
  const empresas = new Map<number, { nombre: string; n: number }>();
  for (const p of proyectos) {
    if (!p.sociedad_emisora_id) continue;
    const e = empresas.get(Number(p.sociedad_emisora_id));
    empresas.set(Number(p.sociedad_emisora_id), { nombre: p.sociedad_nombre || 'Empresa', n: (e?.n || 0) + 1 });
  }
  return [
    ...(esSuperadmin ? [{ value: 'todas', label: 'Todas las empresas' }] : []),
    ...[...empresas.entries()]
      .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
      .map(([id, e]) => ({ value: `e:${id}`, label: `Toda la empresa · ${e.nombre} (${e.n} campus)` })),
    ...[...proyectos]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ value: `c:${p.id}`, label: `Campus · ${p.nombre}` })),
  ];
}

/** «todas», «e:8» o «c:3» → lo que espera el servidor. */
export function ambitoDesdeOpcion(para: string): Pick<DatosWebhook, 'ambito' | 'issuer_id' | 'project_id'> {
  if (para === 'todas') return { ambito: 'todas', issuer_id: null, project_id: null };
  if (para.startsWith('e:')) return { ambito: 'empresa', issuer_id: Number(para.slice(2)), project_id: null };
  return { ambito: 'campus', issuer_id: null, project_id: para ? Number(para.slice(2)) : null };
}

export function opcionDesdeWebhook(w: Pick<WebhookSaliente, 'ambito' | 'issuer_id' | 'project_id'>): string {
  if (w.ambito === 'todas') return 'todas';
  if (w.ambito === 'empresa') return `e:${w.issuer_id}`;
  return `c:${w.project_id}`;
}
