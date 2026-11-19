import type {
  TipoIncidencia, Gravedad, EstadoIncidencia, EntidadTipo,
} from '../api/incidencias.api';

// Cómo se leen los valores de una incidencia (#253).
//
// Gravedad y estado, con las mismas palabras que Soporte
// (`soporte/lib/tickets.ts`): Diego pidió que fuera «como la sección de
// soporte». Los colores van con tokens (#32), no con la paleta suelta.

export const TIPOS: Record<TipoIncidencia, { label: string; detalle: string }> = {
  capa8: { label: 'Capa 8', detalle: 'Error de uso' },
  fallo_crm: { label: 'Fallo del CRM', detalle: 'El CRM hizo algo mal o lo dejó pasar' },
  dato_mal: { label: 'Dato mal cargado', detalle: 'Un dato que se metió mal' },
  externo: { label: 'Externo', detalle: 'Make, la web, WhatsApp…' },
};

export const ORDEN_TIPOS: TipoIncidencia[] = ['capa8', 'fallo_crm', 'dato_mal', 'externo'];

export const ESTADOS: Record<EstadoIncidencia, { label: string; clase: string }> = {
  open: { label: 'Abierta', clase: 'bg-warning-soft text-warning-soft-foreground' },
  in_review: { label: 'En revisión', clase: 'bg-info-soft text-info-soft-foreground' },
  resolved: { label: 'Resuelta', clase: 'bg-success-soft text-success-soft-foreground' },
  closed: { label: 'Cerrada', clase: 'bg-muted text-muted-foreground' },
};

export const GRAVEDADES: Record<Gravedad, { label: string; clase: string }> = {
  low: { label: 'Baja', clase: 'bg-muted text-muted-foreground' },
  medium: { label: 'Media', clase: 'bg-warning-soft text-warning-soft-foreground' },
  high: { label: 'Alta', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
  critical: { label: 'Crítica', clase: 'bg-destructive text-destructive-foreground' },
};

export const ENTIDADES: Record<EntidadTipo, string> = {
  lead: 'Prospecto',
  venta: 'Venta',
  factura: 'Factura',
  usuario: 'Usuario',
  otro: 'Otra cosa',
};

/**
 * A dónde lleva «sobre qué».
 *
 * Prospectos y ventas tienen ficha con su dirección. Facturas y usuarios no,
 * y se hace como el buscador (Ctrl K, #591): la factura abre SU VENTA, y el
 * usuario, Configuración, que en ISEIE abre en Usuarios. Los dos datos los da
 * el servidor solo si son de los campus de quien mira; sin ellos, su pantalla.
 * `null` cuando no hay a dónde ir.
 */
export function enlaceDe(
  tipo: EntidadTipo | null,
  id: number | null,
  destino: { ventaId?: number | null; nombre?: string | null } = {},
): string | null {
  if (!tipo) return null;
  // En ISEIE las direcciones son otras que en el 360: /leads, /ventas y /accounting.
  if (tipo === 'lead') return id ? `/leads/${id}` : null;
  if (tipo === 'venta') return id ? `/ventas/${id}` : null;
  if (tipo === 'factura') return destino.ventaId ? `/ventas/${destino.ventaId}` : '/accounting/facturas';
  // Configuración de ISEIE abre en Usuarios y no tiene buscador por dirección
  // (el `?buscar=` de la #591 del 360 no está aquí): se abre sin más.
  if (tipo === 'usuario') return '/configuracion';
  return null;
}

/** «06/10/2026 15:10», en hora de Madrid: es la hora que vio quien estaba allí. */
export function fechaHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Para un `<input type="datetime-local">`: la hora de Madrid, sin zona. */
export function comoHoraLocal(iso: string | null): string {
  if (!iso) return '';
  const partes = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)); // «2026-10-06 15:10»
  return partes.replace(' ', 'T');
}

/** Cuánto va Madrid por delante de UTC en ese instante, en ms (+1 h o +2 h). */
function desfaseDeMadrid(instante: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * De `<input type="datetime-local">` (hora de Madrid) a una fecha con zona.
 *
 * El navegador puede estar en otra zona: se busca el desfase que tenía Madrid
 * ESE día (+01:00 en invierno, +02:00 en verano) en vez de fijarlo. Y se mira
 * dos veces: el desfase de la hora «como si fuera UTC» puede no ser el del
 * instante de verdad la noche del cambio de hora (29/03, 25/10).
 */
export function desdeHoraLocal(local: string): string {
  const comoUtc = new Date(`${local}:00Z`).getTime();
  const primero = comoUtc - desfaseDeMadrid(new Date(comoUtc));
  const segundo = comoUtc - desfaseDeMadrid(new Date(primero));
  return new Date(segundo).toISOString();
}

/** «2026-10» → «oct 2026». */
export function nombreDelMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('es-ES', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
