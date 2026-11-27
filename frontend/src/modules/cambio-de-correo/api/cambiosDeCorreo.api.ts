import client from '@/shared/api/client';

/**
 * Un cambio de correo con código (#833, gemela de CRM#1199), tal como lo ve
 * administración en la ficha. Nunca trae el código ni su hash. Una dirección
 * que ya era de otra persona se ve igual que una libre: el servidor no lo
 * distingue aquí.
 */
export interface CambioDeCorreo {
  id: number;
  estado: 'pendiente' | 'confirmado' | 'anulado' | 'caducado';
  /** El correo que tenía al pedirlo (`null` si el registro no lo tiene). */
  de: string | null;
  a: string;
  pedido_at: string;
  expira_at: string;
  intentos: number;
  /** Cuándo se confirmó, se anuló o caducó. */
  cuando: string;
}

export interface CambiosDeCorreo {
  pendiente: CambioDeCorreo | null;
  historial: CambioDeCorreo[];
  intentos_max: number;
}

export async function getCambiosDeCorreo(userId: number): Promise<CambiosDeCorreo> {
  const res = await client.get<CambiosDeCorreo>(`/users/${userId}/cambios-de-correo`);
  if (!res?.data) throw new Error('No se pudo cargar el cambio de correo');
  return res.data;
}

export async function anularCambioDeCorreo(userId: number): Promise<CambiosDeCorreo> {
  const res = await client.post<CambiosDeCorreo>(`/users/${userId}/cambios-de-correo/anular`);
  if (!res?.data) throw new Error('No se pudo anular el cambio de correo');
  return res.data;
}
