import type { TipoEquipo } from '../types';

/*
 * LOS EQUIPOS DE TRABAJO (Diego, 23/11/2026; CRM-ISEIE#687): «que el admin pueda
 * filtrar por los dos equipos». Cada empresa tiene su equipo de desarrollo y
 * su equipo de tutoras redactoras; el filtro junta los de un mismo tipo de
 * todas las empresas que se ven. El servidor lo acota igual a lo que cada uno
 * puede ver: el filtro nunca abre más.
 */

export const TIPOS_DE_EQUIPO: readonly TipoEquipo[] = ['colaboradores', 'redactoras', 'tutores'];

/** Cómo se llama cada tipo en los filtros. */
export const TIPO_EQUIPO_ES: Record<TipoEquipo, string> = {
  colaboradores: 'Equipo de desarrollo',
  redactoras: 'Tutoras redactoras',
  tutores: 'Tutores',
};

/** Al crear un equipo (Configurar tablero › Equipos). */
export const OPCIONES_TIPO_NUEVO: ReadonlyArray<{ value: TipoEquipo; label: string }> = [
  { value: 'colaboradores', label: 'Colaboradores' },
  { value: 'redactoras', label: 'Tutoras redactoras' },
  { value: 'tutores', label: 'Tutores' },
];

/** La etiqueta pequeña de la lista de equipos (los de desarrollo no llevan). */
export function etiquetaDeTipo(tipo: TipoEquipo | null | undefined): string | null {
  if (tipo === 'redactoras') return 'Redactoras';
  if (tipo === 'tutores') return 'Tutores';
  return null;
}

export const TODOS_LOS_TIPOS = 'Todos los equipos de trabajo';

/**
 * Las opciones del filtro «Equipo de trabajo»: solo si entre los equipos activos
 * que se ven hay más de un tipo (con uno solo, el filtro no cambia nada).
 */
export function opcionesDeTipo(
  equipos: ReadonlyArray<{ tipo?: TipoEquipo | null; is_active?: boolean }>,
): Array<{ value: '' | TipoEquipo; label: string }> {
  const hay = new Set(equipos.filter((e) => e.is_active !== false).map((e) => e.tipo ?? 'colaboradores'));
  if (hay.size < 2) return [];
  return [
    { value: '', label: TODOS_LOS_TIPOS },
    ...TIPOS_DE_EQUIPO.filter((t) => hay.has(t)).map((t) => ({ value: t, label: TIPO_EQUIPO_ES[t] })),
  ];
}

/** Lo que llega de la dirección o de un filtro, a un tipo válido o '' (todos). */
export function tipoValido(v: string | null | undefined): '' | TipoEquipo {
  return (TIPOS_DE_EQUIPO as readonly string[]).includes(v ?? '') ? v as TipoEquipo : '';
}
