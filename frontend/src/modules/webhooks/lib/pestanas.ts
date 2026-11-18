import { Bank, Lightning, ListBullets, UserPlus } from '@phosphor-icons/react';

/*
  Las pestañas de Conexión › Webhooks (gemela de CRM#755). Viven aquí y no en
  WebhooksLayout.tsx: un archivo de componentes que exporta también datos o
  funciones rompe la recarga en caliente de Vite («Fast Refresh»).

  `module`: el módulo del campus que tenían sus entradas del menú en el 360.
  Con él apagado en el campus de arriba, la pestaña no sale. ISEIE no tiene
  proyectos IA: el `salvoTipo` del 360 no hace falta.
*/
type Pestana = {
  label: string; to: string; icon: typeof ListBullets; end?: boolean; module?: string;
};
export const TABS: Pestana[] = [
  { label: 'Resumen', to: '/conexion/webhooks', icon: ListBullets },
  { label: 'Prospectos', to: '/conexion/webhooks/prospectos', icon: UserPlus, end: false, module: 'webhooks' },
  { label: 'Make', to: '/conexion/webhooks/make', icon: Lightning, end: false, module: 'make' },
  { label: 'Transferencias', to: '/conexion/webhooks/transferencias', icon: Bank },
];

/** Las pestañas que salen con los módulos de este campus (`false`: apagado). */
export function pestanasDe(modules?: Record<string, boolean> | null) {
  return TABS.filter((t) => !t.module || modules?.[t.module] !== false);
}
