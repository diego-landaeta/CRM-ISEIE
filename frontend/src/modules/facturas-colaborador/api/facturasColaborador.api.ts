import client, { API_BASE_URL, getAccessToken } from '@/shared/api/client';

/** El enlace del archivo: el de R2 ya viene entero; el del disco del servidor, relativo a la API. */
export const urlDelArchivo = (url: string) => (url.startsWith('/') ? `${API_BASE_URL}${url}` : url);

/*
  Facturas de colaboradores (#202): la gente de fuera que factura al grupo cada
  mes sube su factura por un enlace personal, una por empresa y mes.
*/

export const AREAS = ['soporte', 'desarrollo', 'wordpress', 'seo', 'contenido', 'otra'] as const;
export type Area = typeof AREAS[number];

export const AREA_ES: Record<Area, string> = {
  soporte: 'Soporte', desarrollo: 'Desarrollo', wordpress: 'WordPress', seo: 'SEO', contenido: 'Contenido', otra: 'Otra',
};

export type EstadoFactura = 'sin_enviar' | 'enviado' | 'abierto' | 'recibida' | 'sin_factura' | 'anulada' | 'no_enviado' | 'caducado';

export interface EmpresaDelGrupo { id: number; razon_social: string; nif: string }

// Cómo cobra de cada empresa (#202, segunda parte, «Añadido 01/10 (tarde)»).
export const MODALIDADES = ['fijo', 'hora', 'proyecto'] as const;
export type Modalidad = typeof MODALIDADES[number];
export const MODALIDAD_ES: Record<Modalidad, string> = { fijo: 'Fijo', hora: 'Por hora', proyecto: 'Por proyecto' };

// Cómo se le paga (segunda parte, «Marcar pagada»): las del CRM que sirven para pagar a una persona.
export const FORMAS_PAGO = ['transferencia', 'bizum', 'paypal', 'efectivo', 'otro'] as const;
export type FormaPago = typeof FORMAS_PAGO[number];
export const FORMA_PAGO_ES: Record<FormaPago, string> = {
  transferencia: 'Transferencia', bizum: 'Bizum', paypal: 'PayPal', efectivo: 'Efectivo', otro: 'Otra',
};
// Las pestañas de la segunda parte: «Del mes · Enviadas · Por pagar · Pagadas · Historial».
export type VistaDeFacturas = 'enviadas' | 'por_pagar' | 'pagadas' | 'historial';

/**
 * El desglose de una factura, para administración. Sin desglose: `lineas` vacías.
 * Y los dos importes que deciden si cuadra (13/10): el escrito y el del PDF;
 * `cuadra` null = no se pudo leer el PDF.
 */
export interface DesgloseDeFactura {
  importe: number | null; base: number | null; iva: number | null; irpf: number | null;
  total: number | null; horas: number | null; cuadra: boolean | null;
  importe_pdf: number | null; es_pdf: boolean;
  lineas: { orden: number; concepto: string; project_id: number | null; campus: string | null; horas: number | null; tarifa: number | null; importe: number }[];
}

/** Coste por campus del mes, por empresa: horas y base de las líneas del desglose. `project_id` null = toda la empresa. */
export interface CosteDeCampus {
  issuer_id: number; empresa: string;
  project_id: number | null; campus: string | null; horas: number | null; importe: number; facturas: number;
}

/** «2026-06-05» → «05/06», como «transferencia del 05/10» en la definición. */
export const diaDelPago = (dia: string | null | undefined) => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '—');

/** Cómo cobra: sin modalidad, las fichas de la primera parte. Los números llegan como texto de la base. */
export interface ComoCobra {
  modalidad: Modalidad | null;
  importe_fijo: number | string | null;
  tarifa_hora: number | string | null;
  iva_pct: number | string | null;
  irpf_pct: number | string | null;
}

export interface EmpresaDelColaborador extends ComoCobra { issuer_id: number; razon_social: string; importe_acordado: number | string | null }

export interface Colaborador {
  id: number;
  nombre: string;
  email: string;
  nif: string | null;
  area: Area;
  notas: string | null;
  user_id: number | null;
  usuario_nombre: string | null;
  activo: boolean;
  alta_desde: string | null; // AAAA-MM
  baja_desde: string | null; // AAAA-MM
  empresas: EmpresaDelColaborador[];
  /** También factura a empresas que quien mira no lleva: sus datos los cambia el super admin. */
  compartido?: boolean;
}

export interface ColaboradorEnvio {
  nombre: string;
  email: string;
  nif?: string | null;
  area: Area;
  notas?: string | null;
  alta_desde?: string | null;
  empresas: {
    issuer_id: number; importe_acordado: number | null;
    modalidad: Modalidad | null; importe_fijo: number | null; tarifa_hora: number | null;
    iva_pct: number | null; irpf_pct: number | null;
  }[];
}

export interface FacturaDelMes {
  id: number;
  colaborador_id: number;
  issuer_id: number;
  periodo: string;
  colaborador_nombre: string;
  email: string;
  area: Area;
  empresa: string;
  importe_esperado: string | null;
  importe: string | null;
  diferencia: string | null;
  numero_factura: string | null;
  numero_recepcion: string | null;
  subida_at: string | null;
  enviado_at: string | null;
  abierto_at: string | null;
  caduca_at: string | null;
  anulada_at: string | null;
  motivo_anulacion: string | null;
  nombre_original: string | null;
  tamano: number | null;
  /** El desglose (segunda parte). */
  base: string | null;
  total: string | null;
  horas: string | null;
  /** Si el total del PDF es lo escrito (13/10); null = no se pudo leer el PDF (o es una foto). */
  cuadra: boolean | null;
  importe_pdf: string | null;
  mime: string | null;
  /** El pago, que no se mezcla con el estado de la factura. */
  pagada_at: string | null; // AAAA-MM-DD
  forma_pago: FormaPago | null;
  referencia_pago: string | null;
  con_justificante: boolean;
  estado: EstadoFactura;
}

export interface Mes {
  periodo: string;
  mes: string;
  resumen: { total: number; recibidas: number; importe_recibido: number; importe_acordado: number };
  facturas: FacturaDelMes[];
}

export interface LineaRegistro {
  id: number;
  evento: string;
  creado_at: string;
  ip: string | null;
  detalle: Record<string, unknown>;
  usuario_nombre: string | null;
  factura_id?: number | null;
}

/** Lo que ve el colaborador en su enlace o en «Mi factura». */
export interface FacturaDelColaborador {
  id?: number;
  estado: EstadoFactura;
  periodo: string;
  mes: string;
  colaborador: string;
  empresa: {
    razon_social: string; nif: string | null; direccion: string | null;
    cp: string | null; ciudad: string | null; pais: string | null; logo_url: string | null;
  };
  importe_acordado: number | null;
  caduca_at: string | null;
  /** Cómo cobra de esta empresa (segunda parte). null: se sube sin desglose. */
  cobro: null | {
    modalidad: Modalidad; importe_fijo: number | null; tarifa_hora: number | null;
    iva_pct: number; irpf_pct: number; concepto: string;
  };
  /** Los campus de la empresa de la factura, para el proyecto de cada línea (solo si cobra por proyecto). */
  campus?: { id: number; nombre: string }[];
  recibida: null | {
    subida_at: string; numero_recepcion: string; importe: number | null; numero_factura: string | null; archivo: string | null;
    /** Lo que calculó el CRM con el desglose (null sin él). */
    total: number | null;
    /** Lo que pone el PDF y si cuadra con lo escrito (13/10); `cuadra` null = no se pudo leer. */
    importe_pdf?: number | null; cuadra: boolean | null; es_pdf?: boolean;
  };
  /** El estado del pago (segunda parte): la fecha y la forma. */
  pago: null | { pagada_at: string; forma_pago: FormaPago | null };
  enlace?: string | null;
}

/** El desglose tal como lo manda el formulario: las horas o las líneas (JSON). */
export interface DesgloseEnvio { horas?: string; lineas?: string }

/** Una línea del desglose por proyecto, tal como se escribe. */
export interface LineaForm { concepto: string; project_id: string; horas: string }

/**
 * El desglose calculado en la pantalla, solo para enseñarlo: el que cuenta es
 * el del servidor (desglose.js), con las mismas reglas.
 */
export function calcularDesglose(cobro: NonNullable<FacturaDelColaborador['cobro']>, horas: string, lineas: LineaForm[]) {
  // En céntimos enteros y con las horas a dos decimales, igual que desglose.js:
  // con decimales, 16,275 € salía 16,27 y la pantalla y el servidor no coincidían.
  const aC = (n: number) => Math.round(n * 100);
  // Las horas, sin separador de miles y con dos decimales como mucho (si no, el servidor las rechaza).
  const horasC = (t: string) => {
    const s = t.trim();
    if (!/^\d+([.,]\d{1,2})?$/.test(s)) return 0;
    const n = Number(s.replace(',', '.'));
    return n > 0 ? aC(n) : 0;
  };
  const tarifaC = aC(cobro.tarifa_hora ?? 0);
  const por = (hC: number) => Math.round((hC * tarifaC) / 100);
  const baseC = cobro.modalidad === 'fijo' ? aC(cobro.importe_fijo ?? 0)
    : cobro.modalidad === 'hora' ? por(horasC(horas))
      : lineas.reduce((s, l) => s + por(horasC(l.horas)), 0);
  const ivaC = Math.round((baseC * aC(cobro.iva_pct)) / 10000);
  const irpfC = Math.round((baseC * aC(cobro.irpf_pct)) / 10000);
  return { base: baseC / 100, iva: ivaC / 100, irpf: irpfC / 100, total: (baseC + ivaC - irpfC) / 100 };
}

type R<T> = Promise<{ success: boolean; data: T; error?: string; message?: string }>;

const BASE = '/facturas-colaborador';

const query = (f: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** El formulario de subida: archivo, importe y número de factura. */
const subida = (archivo: File, importe: string, numeroFactura: string, desglose: DesgloseEnvio = {}) => {
  const fd = new FormData();
  fd.append('archivo', archivo);
  fd.append('importe', importe);
  fd.append('numero_factura', numeroFactura);
  if (desglose.horas !== undefined) fd.append('horas', desglose.horas);
  if (desglose.lineas !== undefined) fd.append('lineas', desglose.lineas);
  return fd;
};

export const facturasColaboradorApi = {
  // ── Administración: la lista de colaboradores ──
  empresas: () => client.get(`${BASE}/empresas`) as R<EmpresaDelGrupo[]>,
  colaboradores: (f: { estado?: 'activos' | 'de_baja' | 'todos'; issuerId?: number; q?: string } = {}) =>
    client.get(`${BASE}/colaboradores${query(f)}`) as R<Colaborador[]>,
  crear: (b: ColaboradorEnvio) => client.post(`${BASE}/colaboradores`, b) as R<Colaborador>,
  editar: (id: number, b: Partial<ColaboradorEnvio>) => client.patch(`${BASE}/colaboradores/${id}`, b) as R<Colaborador>,
  darDeBaja: (id: number, desde: string) => client.post(`${BASE}/colaboradores/${id}/baja`, { desde }) as R<Colaborador>,
  volverDeAlta: (id: number, desde: string) => client.post(`${BASE}/colaboradores/${id}/alta`, { desde }) as R<Colaborador>,
  registroDelColaborador: (id: number) => client.get(`${BASE}/colaboradores/${id}/registro`) as R<LineaRegistro[]>,

  // ── Administración: las facturas del mes ──
  mes: (f: { periodo: string; issuerId?: number; estado?: EstadoFactura; area?: Area }) =>
    client.get(`${BASE}/mes${query(f)}`) as R<Mes>,
  archivo: (id: number) => client.get(`${BASE}/facturas/${id}/archivo`) as R<{ url: string; nombre: string | null }>,
  registroDeLaFactura: (id: number) => client.get(`${BASE}/facturas/${id}/registro`) as R<LineaRegistro[]>,
  desgloseDeLaFactura: (id: number) => client.get(`${BASE}/facturas/${id}/desglose`) as R<DesgloseDeFactura>,
  anular: (id: number, motivo: string) => client.post(`${BASE}/facturas/${id}/anular`, { motivo }) as R<{ anulada: number; nueva: number }>,
  reenviar: (id: number) => client.post(`${BASE}/facturas/${id}/reenviar`, {}) as R<{ id: number }>,

  // ── El pago (segunda parte): una o varias, con el justificante si se quiere ──
  pagar: (ids: number[], datos: { fecha: string; forma_pago: FormaPago; referencia_pago?: string }, justificante?: File | null) => {
    const fd = new FormData();
    fd.append('ids', ids.join(','));
    fd.append('fecha', datos.fecha);
    fd.append('forma_pago', datos.forma_pago);
    if (datos.referencia_pago) fd.append('referencia_pago', datos.referencia_pago);
    if (justificante) fd.append('justificante', justificante);
    return client.post(`${BASE}/facturas/pagar`, fd) as R<{ pagadas: number[] }>;
  },
  deshacerPago: (id: number, motivo: string) =>
    client.post(`${BASE}/facturas/${id}/deshacer-pago`, { motivo }) as R<{ id: number }>,
  justificante: (id: number) => client.get(`${BASE}/facturas/${id}/justificante`) as R<{ url: string }>,

  // ── Enviadas, Por pagar, Pagadas e Historial, y el coste por campus (segunda parte) ──
  vista: (f: { vista: VistaDeFacturas; issuerId?: string; colaboradorId?: string; periodo?: string; estado?: string }) =>
    client.get(`${BASE}/facturas${query(f)}`) as R<{ vista: VistaDeFacturas; resumen: { total: number; importe: number; pendiente: number }; facturas: FacturaDelMes[] }>,
  /**
   * El ZIP del mes de una empresa, como descarga. Con su propio fetch, como el
   * diploma de Certifex: `client` lee como texto lo que no es JSON y el ZIP se rompía.
   */
  bajarZip: async (periodo: string, issuerId: number, razonSocial: string) => {
    const t = getAccessToken();
    const r = await fetch(`${API_BASE_URL}${BASE}/zip${query({ periodo, issuerId })}`, {
      credentials: 'include',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d?.error || 'No se pudo preparar la descarga. Inténtalo de nuevo.');
    }
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `facturas-colaboradores_${periodo}_${empresaCorta(razonSocial)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revocar en el mismo turno deja a algún navegador sin llegar a leer el blob (como en Certifex).
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
  costePorCampus: (periodo: string, issuerId?: string) =>
    client.get(`${BASE}/coste-por-campus${query({ periodo, issuerId })}`) as R<{ periodo: string; mes: string; campus: CosteDeCampus[] }>,

  // ── El enlace del colaborador (sin usuario) ──
  verEnlace: (token: string) => client.get(`${BASE}/enlace/${token}`) as R<FacturaDelColaborador>,
  subirPorEnlace: (token: string, archivo: File, importe: string, numeroFactura: string, desglose?: DesgloseEnvio) =>
    client.post(`${BASE}/enlace/${token}`, subida(archivo, importe, numeroFactura, desglose)) as R<FacturaDelColaborador>,

  /** «Este mes no facturo a esta empresa», o deshacerlo (31/10). */
  sinFacturaPorEnlace: (token: string, motivo?: string) =>
    client.post(`${BASE}/enlace/${token}/sin-factura`, { motivo: motivo || null }) as R<FacturaDelColaborador>,
  quitarSinFacturaPorEnlace: (token: string) =>
    client.delete(`${BASE}/enlace/${token}/sin-factura`) as R<FacturaDelColaborador>,

  // ── «Mi factura» (colaborador con usuario) ──
  mias: () => client.get(`${BASE}/mias`) as R<FacturaDelColaborador[]>,
  subirMia: (id: number, archivo: File, importe: string, numeroFactura: string, desglose?: DesgloseEnvio) =>
    client.post(`${BASE}/mias/${id}`, subida(archivo, importe, numeroFactura, desglose)) as R<FacturaDelColaborador>,
  archivoMio: (id: number) => client.get(`${BASE}/mias/${id}/archivo`) as R<{ url: string; nombre: string | null }>,
};

// ── Formato compartido por las pantallas ──

/**
 * «CEDIA Investigación y Desarrollo SL» → «CEDIA», para las tablas (como la
 * maqueta de Diego: «CEDIA · ICTESS»). El nombre entero va en el `title`.
 */
export const empresaCorta = (razonSocial: string) => String(razonSocial || '').trim().split(/[\s,]+/)[0] || razonSocial;

/** Solo la primera letra en mayúscula: «Septiembre de 2026», no «Septiembre De 2026» (lo que hace `capitalize`). */
export const primeraMayuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** «2026-09» o «2026-09-01» → «septiembre de 2026»: para que no se vea «2026-09» en los textos. */
export const mesEscrito = (v: string | null | undefined) => {
  if (!v) return '—';
  const [a, m] = String(v).split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};

/**
 * El importe tal como lo escribe la persona, a número (texto con punto decimal).
 *   «1.234,56», «1,234.56» → con los dos, el decimal es el que va último.
 *   «600,50», «12,500»     → solo coma: es el decimal (12,5).
 *   «1.200», «12.500»      → solo punto y separa grupos de tres: miles.
 *   «600.50», «600»        → si no, el punto es el decimal.
 * Aquí sirve para avisar en pantalla; al servidor se le manda lo escrito tal cual.
 */
export function normalizarImporte(texto: string): string {
  const t = texto.trim().replace(/\s|€/g, '');
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  // Con los dos, el decimal es el que va último: «1.234,56» y «1,234.56».
  if (coma >= 0 && punto >= 0) {
    return coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  }
  if (coma >= 0) return t.replace(',', '.');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return t.replace(/\./g, '');
  return t;
}

// `useGrouping: 'always'`: sin él, «1150,00» (en español el punto de miles solo
// sale desde cinco cifras) y la maqueta dice «3.600,00 €». Los tipos de
// TypeScript del proyecto aún no lo conocen; los navegadores, sí.
const FORMATO_EUROS = {
  minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions;

export const euros = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '—' : `${Number(n).toLocaleString('es-ES', FORMATO_EUROS)} €`;

/*
  Lo que dice el PDF frente a lo escrito (corrección de Diego del 13/10: «el
  monto es que coincida el PDF y lo que se escribió de factura ahí»).
*/

/** «PDF: 650,00 € · escrito: 636,00 €». */
export const pdfFrenteAEscrito = (importePdf: number | string | null | undefined, escrito: number | string | null | undefined) =>
  `PDF: ${euros(importePdf)} · escrito: ${euros(escrito)}`;

/**
 * El aviso al colaborador una vez subida: si no cuadra, qué dice el PDF y qué
 * escribió; si no se pudo leer, que lo revisará administración; si cuadra, nada.
 */
export function avisoDelPdf(r: { importe: number | null; importe_pdf?: number | null; cuadra: boolean | null; es_pdf?: boolean }): string | null {
  if (r.cuadra === true) return null;
  if (r.cuadra === false) {
    // Sin importe del PDF es una subida de antes del 13/10 (se comparaba con el desglose): ya no se dice nada.
    if (r.importe_pdf === null || r.importe_pdf === undefined) return null;
    return `El PDF dice ${euros(r.importe_pdf)} y has escrito ${euros(r.importe)}. La hemos recibido igual; si te equivocaste, avisa a administración.`;
  }
  return r.es_pdf === false
    ? 'No hemos podido leer el importe de la foto; lo revisará administración.'
    : 'No hemos podido leer el importe del PDF; lo revisará administración.';
}

export const fechaHora = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`;
};

export const diaMes = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Estado de la factura: texto y tono, con los tokens del CRM (#32). */
export const ESTADO: Record<EstadoFactura, { rotulo: string; clase: string }> = {
  sin_enviar: { rotulo: 'Sin enviar', clase: 'bg-muted text-muted-foreground' },
  enviado: { rotulo: 'Enviado', clase: 'bg-info-soft text-info-soft-foreground' },
  abierto: { rotulo: 'Abierto', clase: 'bg-info-soft text-info-soft-foreground' },
  recibida: { rotulo: 'Recibida', clase: 'bg-success-soft text-success-soft-foreground' },
  sin_factura: { rotulo: 'No factura este mes', clase: 'bg-muted text-muted-foreground' },
  anulada: { rotulo: 'Anulada', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
  no_enviado: { rotulo: 'No enviado (error)', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
  caducado: { rotulo: 'Caducado', clase: 'bg-warning-soft text-warning-soft-foreground' },
};
