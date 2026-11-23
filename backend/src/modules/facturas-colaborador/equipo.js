/*
  El equipo de quien factura (Diego, 23/11/2026; CRM-ISEIE#687): «que el admin pueda
  filtrar por los dos equipos, sus facturas…». Se calcula, no se guarda:

    · 'vendedoras': las fichas de tipo vendedora (CRM#710);
    · 'redactoras': la tutora redactora (su usuario tiene el rol, principal o
      añadido) o la ficha con el área «Redacción de cursos» (migración 325), por
      si aún no tiene usuario;
    · 'desarrollo': el resto de colaboradores (desarrollo, SEO, WordPress…).

  Aquí el rol solo dice en qué lista sale la ficha, no quién entra (#423).
*/
export const EQUIPOS = ['desarrollo', 'redactoras'];

/** SQL: la ficha `c` (alias de colaboradores) es de una tutora redactora. */
export const sqlEsRedactora = (c) => `(${c}.area = 'redaccion' OR EXISTS (
  SELECT 1 FROM users u_eq WHERE u_eq.id = ${c}.user_id
     AND (u_eq.role::text = 'tutor_redactor' OR 'tutor_redactor' = ANY(COALESCE(u_eq.roles_extra, '{}')::text[]))))`;

/** SQL: el equipo de la ficha `c`. */
export const sqlEquipo = (c) => `(CASE WHEN ${c}.tipo = 'vendedora' THEN 'vendedoras'
  WHEN ${sqlEsRedactora(c)} THEN 'redactoras' ELSE 'desarrollo' END)`;
