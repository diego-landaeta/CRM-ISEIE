/**
 * Los estados de una matrícula y cómo se pintan, en un solo sitio: la lista,
 * los filtros y la ficha (#199) dicen lo mismo.
 */

export const ESTADO_LABEL: Record<string, string> = {
  solicitud_admision: 'Solicitud admisión',
  datos_validados: 'Datos validados',
  pendiente: 'Pendiente',
  validada: 'Validada',
  rechazada: 'Rechazada',
};

// CINCO ESTADOS, CINCO ASPECTOS, con los colores del tema (#32: nada de
// colores sueltos). Diego, ideas del #199 (01/10): Solicitud azul, Datos
// validados índigo, Pendiente ámbar, Validada verde, Rechazada roja. El índigo
// se añadió al tema para esto (index.css, tailwind.config.js).
export const ESTADO_COLOR: Record<string, string> = {
  solicitud_admision: 'bg-info-soft text-info-soft-foreground border-info/30',
  datos_validados: 'bg-indigo-soft text-indigo-soft-foreground border-indigo/30',
  pendiente: 'bg-warning-soft text-warning-soft-foreground border-warning/30',
  validada: 'bg-success-soft text-success-soft-foreground border-success/30',
  rechazada: 'bg-destructive-soft text-destructive-soft-foreground border-destructive/30',
};

/**
 * Una fecha en HORA DE MADRID (Diana, 15/10): el filtro «Recibida» cuenta el
 * día en Madrid, y si la pantalla enseñara la hora de quien mira, desde fuera
 * de España una matrícula de «11 oct» entraría en «desde el 12».
 */
export function enHoraDeMadrid(fecha: string | null | undefined): string {
  if (!fecha) return '—';
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
