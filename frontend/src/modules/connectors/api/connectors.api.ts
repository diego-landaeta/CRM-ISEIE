import client, { API_BASE_URL } from '@/shared/api/client';

/**
 * Los conectores de un proyecto (#6).
 *
 * El backend ya estaba entero. Lo unico que no expone por su cuenta es el
 * catalogo de tipos y destinos —vive en constantes del controlador— asi que se
 * repite abajo. Hay una prueba que compara las dos listas leyendo los ficheros:
 * si alguien anade un tipo alli y no aqui, se cae.
 */

/** Lo que el conector puede traer. Espejo de VALID_TYPES del controlador. */
export const TIPOS = [
  { id: 'woocommerce_products', label: 'WooCommerce · productos' },
  { id: 'woocommerce_orders', label: 'WooCommerce · pedidos' },
  { id: 'wp_rest', label: 'WordPress (REST)' },
  { id: 'acf', label: 'WordPress + ACF' },
  { id: 'custom_api', label: 'API propia' },
  { id: 'mcp', label: 'Claude (MCP)' },
] as const;

/** Donde acaba lo que trae. Espejo de VALID_DESTINATIONS. */
export const DESTINOS = [
  { id: 'product', label: 'Productos' },
  { id: 'lead', label: 'Prospectos' },
  { id: 'matricula', label: 'Matrículas' },
  { id: 'category', label: 'Categorías' },
] as const;

export type TipoConector = typeof TIPOS[number]['id'];
export type DestinoConector = typeof DESTINOS[number]['id'];

/**
 * Que campos pide cada tipo, y cuales son secretos.
 *
 * Los marcados `secreto` no vuelven nunca del servidor: se envian al guardar y
 * despues solo se sabe SI hay uno puesto, por `secretos_guardados`. Por eso el
 * formulario los trata como «escribe para cambiarlo», no como un campo normal
 * que se rellena con lo que habia.
 */
export const CAMPOS_POR_TIPO: Record<TipoConector, Array<{
  clave: string; label: string; ayuda?: string; secreto?: boolean; requerido?: boolean;
}>> = {
  woocommerce_products: [
    { clave: 'base_url', label: 'Dirección de la tienda', ayuda: 'https://mitienda.com', requerido: true },
    { clave: 'consumer_key', label: 'Consumer key', ayuda: 'Empieza por ck_', requerido: true },
    { clave: 'consumer_secret', label: 'Consumer secret', ayuda: 'Empieza por cs_', secreto: true, requerido: true },
  ],
  woocommerce_orders: [
    { clave: 'base_url', label: 'Dirección de la tienda', ayuda: 'https://mitienda.com', requerido: true },
    { clave: 'consumer_key', label: 'Consumer key', requerido: true },
    { clave: 'consumer_secret', label: 'Consumer secret', secreto: true, requerido: true },
  ],
  wp_rest: [
    { clave: 'base_url', label: 'Dirección del sitio', ayuda: 'https://misitio.com', requerido: true },
    { clave: 'endpoint', label: 'Ruta', ayuda: 'Por defecto wp/v2/posts' },
    { clave: 'wp_user', label: 'Usuario', ayuda: 'Solo si el contenido es privado' },
    { clave: 'wp_app_password', label: 'Contraseña de aplicación', secreto: true },
  ],
  acf: [
    { clave: 'base_url', label: 'Dirección del sitio', requerido: true },
    { clave: 'endpoint', label: 'Ruta', ayuda: 'Por defecto acf/v3/posts' },
    { clave: 'wp_user', label: 'Usuario' },
    { clave: 'wp_app_password', label: 'Contraseña de aplicación', secreto: true },
  ],
  custom_api: [
    // `url`, no `base_url`: es lo que lee `customRequest` en el adaptador. Los
    // demas tipos si usan `base_url`. Puse `base_url` de memoria y el conector
    // contestaba «config.url requerida» — por eso las claves salen de leer el
    // adaptador y no del ticket.
    { clave: 'url', label: 'Dirección completa', ayuda: 'La URL que devuelve el JSON', requerido: true },
    { clave: 'items_path', label: 'Dónde está la lista', ayuda: 'Por ejemplo data — vacío si el JSON ya es la lista' },
    { clave: 'bearer_token', label: 'Token', ayuda: 'Se manda como Authorization: Bearer', secreto: true },
  ],
  // «Servidor MCP» no se configura: no trae datos, da una URL para Claude
  // (Diego, 29/09: «es para que dé la API y yo meterla en Claude»).
  mcp: [],
};

/** De quién es un conector (migración 183). */
export type AlcanceConector = 'campus' | 'empresa' | 'sistema';

/** Un campus tal como llega del contexto: con su empresa. */
export type Campus = { id: number; nombre: string; sociedad_emisora_id?: number | null; sociedad_nombre?: string | null };

/**
 * Las opciones de «Para quién» (Diego, 29/09: «también poder elegir empresas y,
 * si soy super admin, todo el sistema»). Un conector de empresa o de sistema es
 * UNO solo para todos sus campus, no una copia en cada uno. Las usan los dos
 * formularios de la sección Conexión: el de Claude y el de traer datos.
 */
export function opcionesDeAlcance(proyectos: Campus[], esSuperadmin: boolean) {
  const empresas = new Map<number, { nombre: string; n: number }>();
  for (const p of proyectos) {
    if (!p.sociedad_emisora_id) continue;
    const e = empresas.get(Number(p.sociedad_emisora_id));
    empresas.set(Number(p.sociedad_emisora_id), { nombre: p.sociedad_nombre || 'Empresa', n: (e?.n || 0) + 1 });
  }
  return [
    ...(esSuperadmin ? [{ value: 'sistema', label: `Todo el sistema · ${proyectos.length} campus` }] : []),
    ...[...empresas.entries()]
      .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre))
      .map(([id, e]) => ({ value: `e:${id}`, label: `Toda la empresa · ${e.nombre} (${e.n} campus)` })),
    ...[...proyectos]
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((p) => ({ value: `c:${p.id}`, label: `Campus · ${p.nombre}` })),
  ];
}

/**
 * La URL para pegar en Claude («Agregar conector personalizado»). La URL
 * personal del MCP de Diana, con el token de este conector.
 */
export const urlParaClaude = (token: string) => `${window.location.origin}${API_BASE_URL}/mcp/u/${token}`;

export interface Conector {
  id: number;
  project_id: number;
  /** El nombre de su campus (en uno de empresa o de sistema, el campus por defecto). */
  proyecto?: string | null;
  alcance?: AlcanceConector;
  issuer_id?: number | null;
  /** Nombre de su empresa, si es de empresa. */
  empresa?: string | null;
  /** «Servidor MCP»: la URL de esta persona, si ya tiene (solo el inicio del token). */
  mcp_mio?: { prefijo: string; created_at: string; last_used_at: string | null } | null;
  type: TipoConector;
  label: string;
  destination: DestinoConector;
  config: Record<string, string>;
  /** Que secretos hay puestos. El valor nunca viaja. */
  secretos_guardados?: Record<string, boolean>;
  field_mapping: Record<string, unknown>;
  active: boolean;
  last_sync_at: string | null;
  last_sync_status: 'success' | 'error' | 'partial' | null;
  last_sync_count: number | null;
  sample_received_at: string | null;
  created_at?: string;
  /** Quién lo creó (migración 185). Los de antes de esa fecha pueden no tenerlo. */
  created_by?: number | null;
  creado_por?: string | null;
  /** Si esta persona puede cambiarlo y borrarlo (lo decide el servidor). */
  puede_tocar?: boolean;
  /** En los de Claude: cuánta gente tiene URL, quién, y cuándo la usó Claude. */
  personas_con_url?: number;
  con_url?: string[] | null;
  ultimo_uso_claude?: string | null;
}

/** Un campo del JSON externo, tal y como lo describe el servidor. */
export interface CampoDelOrigen { path: string; type: string; sample?: unknown }

/** Un campo del CRM al que se puede apuntar. */
export interface CampoDestino {
  key: string; label: string; type: string; required?: boolean; group?: string;
}

export interface VistaPrevia {
  type: string;
  destination: string;
  items_count_total: number;
  samples: Array<Record<string, unknown>>;
  schema: CampoDelOrigen[];
  targets: CampoDestino[];
  transforms: Array<{ id: string; label: string }>;
  field_mapping_actual: Record<string, unknown>;
  sugeridos: Record<string, string>;
  mapped_preview: Record<string, unknown> | null;
}

export const conectoresApi = {
  /**
   * `projectId`, `issuerId` (una empresa: los de todos sus campus) o nada
   * («Todos los proyectos»: todo lo que la persona puede ver), de `ponerAmbito`.
   * `tipo`: 'mcp' las conexiones de Claude, 'datos' los que traen datos.
   */
  listar: (ambito: URLSearchParams, tipo?: 'mcp' | 'datos') => {
    if (tipo) ambito.set('tipo', tipo);
    return client.get(`/connectors?${ambito.toString()}`);
  },
  uno: (id: number) => client.get(`/connectors/${id}`),
  crear: (datos: Partial<Conector>) => client.post('/connectors', datos),
  cambiar: (id: number, datos: Partial<Conector>) => client.patch(`/connectors/${id}`, datos),
  borrar: (id: number) => client.delete(`/connectors/${id}`),
  /** Trae hasta 3 elementos de verdad del origen, con el catálogo de campos. */
  vistaPrevia: (id: number) => client.post(`/connectors/${id}/preview`, {}),
  /** Lanza la importación. Contesta en seguida; el estado se mira releyendo. */
  importar: (id: number) => client.post(`/connectors/${id}/import`, {}),
  /** «Servidor MCP»: una URL nueva para Claude. La anterior deja de valer. */
  mcpUrl: (id: number) => client.post(`/connectors/${id}/mcp-url`, {}),
};
