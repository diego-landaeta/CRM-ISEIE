import client from '@/shared/api/client';

/**
 * Un correo del equipo que Brevo se niega a entregar (migración 290). Caso real
 * (17/11/2026): una gestora tres semanas sin avisos por un rebote duro. Gemela
 * de MultiCRM (`modules/users/lib/brevoBloqueo.ts`).
 */
export interface BrevoBloqueo {
  id: number;
  user_id: number;
  /** El código de Brevo: hardBounce, contactFlaggedAsSpam, unsubscribedViaEmail… */
  codigo: string | null;
  /** Ya en castellano. */
  motivo: string | null;
  bloqueado_desde: string | null;
  detectado_at: string | null;
}

/** «26 de octubre de 2026», o null si Brevo no dio fecha. */
export function fechaDelBloqueo(b: Pick<BrevoBloqueo, 'bloqueado_desde'>): string | null {
  if (!b.bloqueado_desde) return null;
  const d = new Date(b.bloqueado_desde);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** «Brevo bloquea su correo desde el 26 de octubre de 2026, motivo: Rebote duro…». */
export function textoDelBloqueo(b: Pick<BrevoBloqueo, 'bloqueado_desde' | 'motivo'>): string {
  const fecha = fechaDelBloqueo(b);
  const desde = fecha ? `desde el ${fecha}` : 'desde hace un tiempo';
  return `Brevo bloquea su correo ${desde}, motivo: ${b.motivo || 'desconocido'}`;
}

/** Los bloqueos por persona, para la lista y la ficha. */
export function porPersona(bloqueos: BrevoBloqueo[]): Map<number, BrevoBloqueo> {
  const mapa = new Map<number, BrevoBloqueo>();
  for (const b of bloqueos) if (!mapa.has(b.user_id)) mapa.set(b.user_id, b);
  return mapa;
}

/** Los abiertos de la gente que se ve en Usuarios. Apagada la vigilancia, ninguno. */
export async function listBrevoBloqueos(): Promise<{ activo: boolean; bloqueos: BrevoBloqueo[] }> {
  const res: any = await client.get('/users/brevo-bloqueos');
  return { activo: !!res?.data?.activo, bloqueos: (res?.data?.bloqueos || []) as BrevoBloqueo[] };
}

/** «Desbloquear en Brevo». Si el buzón sigue sin existir, Brevo lo vuelve a bloquear. */
export async function desbloquearBrevo(id: number): Promise<void> {
  await client.delete(`/users/${id}/brevo-bloqueo`);
}
