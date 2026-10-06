import client from '@/shared/api/client';

/** Si cambiarle el correo a alguien puede dejarle sin prospectos de Make (#248). */
export interface AvisoCambioCorreo {
  email: string;
  campusEnReparto: number;
  prospectosAsignados: number;
  enviosDeMake: number;
  recibeProspectos: boolean;
}

/** Solo super admin: el servidor contesta 403 a cualquier otro. */
export async function avisoCambioCorreo(id: number): Promise<AvisoCambioCorreo> {
  const res = await client.get(`/users/${id}/aviso-correo`);
  if (!res.success) throw new Error(res.error || 'No se pudo comprobar si recibe prospectos');
  return res.data as AvisoCambioCorreo;
}

/**
 * El correo y la contraseña de otro, que solo cambia el super admin (#248). Lo
 * usan Usuarios y Tutores, para que las dos pantallas digan y comprueben lo
 * mismo que el servidor.
 */

/**
 * Las reglas de «Establece tu contraseña», y repetida. null si vale; si no, qué
 * falta. El servidor las vuelve a mirar: esto solo ahorra el viaje.
 */
export function problemaDeContrasena(password: string, repetida: string): string | null {
  if (password.length < 8) return 'Mínimo 8 caracteres.';
  if (!/[A-Z]/.test(password)) return 'Tiene que llevar al menos una mayúscula.';
  if (!/[0-9]/.test(password)) return 'Tiene que llevar al menos un número.';
  if (password !== repetida) return 'Las dos contraseñas no coinciden.';
  return null;
}

/**
 * Lo que se pregunta antes de guardar un correo nuevo. El correo es con lo que
 * se entra, y Make asigna los prospectos por él: si la persona recibe, a partir
 * de ahora le dejan de llegar los que Make mande con el correo viejo.
 */
export function confirmacionCambioCorreo(nombre: string, de: string, a: string, aviso: AvisoCambioCorreo | null): string {
  const lineas = [
    `Vas a cambiar el correo de ${nombre}:`,
    `${de} → ${a}`,
    '',
    'Con el correo viejo ya no podrá entrar, y se cerrarán sus sesiones abiertas.',
  ];
  if (aviso?.recibeProspectos) {
    const porque = [
      aviso.campusEnReparto ? `entra en el reparto de ${aviso.campusEnReparto} campus` : null,
      aviso.prospectosAsignados ? `tiene ${aviso.prospectosAsignados} prospectos asignados` : null,
      aviso.enviosDeMake ? `Make le ha asignado prospectos por su correo ${aviso.enviosDeMake} veces` : null,
    ].filter(Boolean).join(', ');
    lineas.push(
      '',
      `⚠ RECIBE PROSPECTOS (${porque}).`,
      'Make asigna los prospectos por el correo del responsable. Si no cambias también el correo en Make, '
        + 'los que lleguen con el viejo NO le llegarán a esta persona.',
    );
  } else if (!aviso) {
    lineas.push('', 'No se ha podido comprobar si recibe prospectos por Make: revísalo antes.');
  }
  lineas.push('', '¿Seguir?');
  return lineas.join('\n');
}
