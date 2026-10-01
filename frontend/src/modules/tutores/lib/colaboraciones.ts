/**
 * El alta de un tutor, en cuentas y no en pintura: vive aparte de la pantalla
 * para poder probarlo sin levantar el router ni las llamadas. Es lo mismo que
 * en MultiCRM (`modules/tutores/lib/colaboraciones.ts`).
 */

// ── El alta de un tutor (#206) ──────────────────────────────────────────────

/** Un curso tal como se asigna en el alta: cada uno con SU fecha. */
export interface CursoDelAlta { productId: number; pct: number; desde: string }

/**
 * Los cursos del alta MAS el que esta elegido en el buscador y sin «Añadir».
 *
 * Carlos, 01/10: «cuando se crea un tutor y se selecciona formación, NO SE
 * GUARDA». Elegir el curso no lo añadia: habia que pulsar «Añadir» despues, y
 * quien elige uno solo y da a «Dar de alta» lo perdia sin aviso. Marina Areny
 * se dio de alta asi y su curso hubo que ponerlo a mano desde su ficha.
 */
export function cursosParaElAlta(
  cursosAlta: CursoDelAlta[],
  elegido: string | number | null | undefined,
  pctTexto: string,
  desde: string,
  pctPorDefecto = 10,
): CursoDelAlta[] {
  const id = Number(elegido);
  if (!id || cursosAlta.some((c) => c.productId === id)) return cursosAlta;
  const pct = pctTexto === '' ? NaN : Number(pctTexto);
  return [...cursosAlta, {
    productId: id,
    pct: pct >= 0 && pct <= 100 ? pct : pctPorDefecto,
    desde,
  }];
}

export interface CursoQueFallo { nombre: string; motivo: string }

/**
 * El UNICO aviso al terminar el alta.
 *
 * Antes salian dos: el rojo de «Algún curso no se ha podido asignar» y, justo
 * detras, el verde de «Tutor dado de alta», que lo tapaba. Si algo fallo, el
 * aviso es rojo, dice cual y por que, y no se va solo: el tutor ya existe y hay
 * que ponerle ese curso desde su ficha.
 */
export function avisoDelAlta(entraYa: boolean, asignados: number, fallidos: CursoQueFallo[]) {
  const acceso = entraYa
    ? 'Ya puede entrar con el correo y la contraseña que le has puesto.'
    : 'Le llega un correo con el enlace para poner su contraseña. Caduca en 24 horas.';
  if (!fallidos.length) {
    return {
      title: 'Tutor dado de alta',
      description: [acceso, asignados > 0 ? `Con ${asignados} ${asignados === 1 ? 'curso asignado' : 'cursos asignados'}.` : '']
        .filter(Boolean).join(' '),
      variant: 'default' as const,
      duration: 4000,
    };
  }
  const n = fallidos.length;
  return {
    title: `Tutor dado de alta, pero sin ${n === 1 ? 'un curso' : `${n} cursos`}`,
    description: [
      fallidos.map((f) => `«${f.nombre}»: ${f.motivo}`).join(' · '),
      `Pónselo desde su ficha.${asignados > 0 ? ` ${asignados === 1 ? 'El otro sí se asignó' : `Los otros ${asignados} sí se asignaron`}.` : ''}`,
      acceso,
    ].join(' '),
    variant: 'destructive' as const,
    duration: 0,
  };
}
