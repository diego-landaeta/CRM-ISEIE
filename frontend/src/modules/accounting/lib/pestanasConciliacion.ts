import { ArrowsLeftRight, CreditCard, type Icon } from '@phosphor-icons/react';

/*
  Las pestañas de Finanzas › Conciliación (CRM#905 y CRM#906). Viven aquí y no
  en ConciliacionLayout.tsx: un archivo de componentes que exporta también datos
  rompe la recarga en caliente de Vite.

  Cada pestaña es una ruta hija de `/accounting/conciliacion` (App.jsx) y su
  permiso está en `SIN_ENTRADA` del Sidebar: la pestaña que no se puede abrir no
  sale, y la entrada «Conciliación» del menú lleva a la primera que sí.

  Para añadir una (los cargos de Stripe, CRM#906): una línea aquí, su ruta hija
  en App.jsx y su permiso en `SIN_ENTRADA`.
*/
export type PestanaConciliacion = { label: string; to: string; icon: Icon };

export const PESTANAS_CONCILIACION: PestanaConciliacion[] = [
  { label: 'Facturas y cobros', to: '/accounting/conciliacion/facturas', icon: ArrowsLeftRight },
  // Cargos de Stripe cobrados que no están en ningún cobro del CRM (CRM#906).
  { label: 'Cargos de Stripe', to: '/accounting/conciliacion/cargos-stripe', icon: CreditCard },
];
