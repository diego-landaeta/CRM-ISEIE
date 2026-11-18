// Factura automática (CRM#764) · la etiqueta de la cola de facturación.
//
// CRM#764, 18/11: la cola decía «Datos del alumno: sale sola» de un cobro que
// la emisión automática había parado por posible duplicada, y quien miraba la
// fila no sabía por qué seguía ahí. Ahora solo dice «sale sola» si de verdad va
// a salir; si no, dice el motivo que manda el servidor.

export type DatosFiscalesEnCola = {
  estado: 'pendiente' | 'respondido' | 'ficha' | 'revision';
  caduca_at: string;
  /** La emisión automática lo saca sin que nadie haga nada (ahora o cuando le toque). */
  sale_sola?: boolean;
  /** Por qué no salió sola: POSIBLE_DUPLICADA, FACTURACION_PAUSADA, HAY_ANTERIORES… */
  motivo_codigo?: string | null;
  motivo: string | null;
  /** El texto entero del error, para el título. */
  detalle?: string | null;
};

export function textoDatosFiscales(d: DatosFiscalesEnCola): string | null {
  const de = d.estado === 'ficha' ? 'Con los datos de la ficha' : 'Datos del alumno';
  switch (d.estado) {
    case 'pendiente':
      return `Esperando datos del alumno (hasta el ${new Date(d.caduca_at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })})`;
    case 'revision':
      return 'Revisar datos: no sale sola';
    case 'respondido':
    case 'ficha':
      // Esperar su turno no necesita a nadie: sale cuando salgan las anteriores.
      if (d.motivo_codigo === 'HAY_ANTERIORES') return `${de}: sale sola cuando le toque`;
      if (d.sale_sola === false || d.motivo_codigo) return `${de}: no sale sola · ${d.motivo || 'no se pudo emitir'}`;
      return `${de}: sale sola`;
    default:
      return null;
  }
}

/** ¿Necesita a una persona? Entonces la etiqueta va en tono de aviso. */
export function necesitaPersona(d: DatosFiscalesEnCola): boolean {
  if (d.estado === 'revision') return true;
  if (d.estado === 'pendiente') return false;
  return d.motivo_codigo !== 'HAY_ANTERIORES' && (d.sale_sola === false || !!d.motivo_codigo);
}
