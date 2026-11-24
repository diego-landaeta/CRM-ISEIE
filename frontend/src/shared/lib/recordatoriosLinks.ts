import { useAuth } from '@/contexts/AuthContext';

/**
 * ¿Se le recuerda al alumno un link sin pagar (CRM#984)? Lo dice el servidor en
 * `/auth/me` (`funciones.recordatorios_links`, que sale de
 * LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION). Si no lo manda (servidor anterior), no:
 * mejor no prometer un recordatorio que no sale. Lo usa el aviso «cómo se cobra»
 * de las cuotas (24/11), en «Crear link de pago» y en la venta.
 */
export function recordatoriosLinksEncendidos(user: unknown): boolean {
  return (user as { funciones?: { recordatorios_links?: unknown } } | null | undefined)?.funciones?.recordatorios_links === true;
}

/** Igual, desde la sesión. Fuera de la sesión (una prueba suelta), no. */
export function useRecordatoriosLinks(): boolean {
  let user: unknown = null;
  try {
    // Se llama siempre, una vez y en el mismo orden: el try solo recoge el error
    // de useAuth fuera de AuthProvider (pruebas sueltas de la venta).
    // eslint-disable-next-line react-hooks/rules-of-hooks
    user = useAuth()?.user ?? null;
  } catch {
    user = null;
  }
  return recordatoriosLinksEncendidos(user);
}
