import { Link } from 'react-router-dom';
import { PlugsConnected, Info, ArrowRight } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';

/*
  «CONECTAR STRIPE PARA COBROS AUTOMÁTICOS» (CRM#992; Diego, 21/11/2026).

  «Todos deben tenerlo, y el que no, que salga un anuncio: conectar Stripe para
  cobros automáticos, y al tocarlo que los mande al sitio de edición.»

  Sale cuando un campus no puede cobrar las cuotas solas SOLO por su clave de
  Stripe: no tiene la clave de links (`sin_clave`) o la clave no tiene permiso de
  suscripciones (`clave_sin_permiso`). El motivo concreto lo da el servidor
  (`/links-pago/cuotas-disponibles` y `/links-pago/conectar-stripe`).

    · Quien puede editar la clave (`integrations.edit`, el permiso de
      PUT /api/integrations) tiene el botón: lleva a Integraciones › Links de pago
      de ESE campus (`rutaDeLaClave`), que se abre en el campus y en la tarjeta.
    · Quien no, lee «Pídeselo a un administrador», sin botón.

  Con el interruptor del servidor apagado (`apagado_entorno`) no hay nada que
  editar: `AvisoCobroAutoApagado` solo dice que no está activo en este entorno.
*/

export const CODIGOS_DE_CONECTAR = ['sin_clave', 'clave_sin_permiso'] as const;

/** Qué aviso toca a un motivo: conectar Stripe, el del entorno, o ninguno (el texto de siempre). */
export function tipoDeAviso(codigo: string | null | undefined): 'conectar' | 'entorno' | null {
  if (codigo && (CODIGOS_DE_CONECTAR as readonly string[]).includes(codigo)) return 'conectar';
  if (codigo === 'apagado_entorno') return 'entorno';
  return null;
}

/** Donde se pone o se cambia la clave de links de Stripe de un campus. */
export function rutaDeLaClave(projectId: number) {
  // ISEIE: Integraciones vive en /accounting/integrations y es un solo campus.
  return `/accounting/integrations?campus=${projectId}&seccion=links-pago`;
}

export interface CampusAConectar { project_id: number; nombre?: string | null; codigo: string; motivo: string | null }

const TEXTO_BOTON: Record<string, string> = {
  sin_clave: 'Conectar Stripe',
  clave_sin_permiso: 'Cambiar la clave de Stripe',
};

export default function AvisoConectarStripe({ campus, onIr }: {
  /** Los campus que lo necesitan. Con uno solo y sin nombre (el asistente), no se repite el campus. */
  campus: CampusAConectar[];
  /** Al pulsar el botón, antes de ir (p. ej., cerrar el asistente). */
  onIr?: () => void;
}) {
  const { can } = usePermission();
  const puedeEditar = can('integrations.edit');
  const lista = campus.filter((c) => tipoDeAviso(c.codigo) === 'conectar');
  if (!lista.length) return null;
  const varios = lista.length > 1 || !!lista[0].nombre;
  return (
    <div role="status" data-testid="aviso-conectar-stripe" data-recorrido="links-conectar-stripe"
      className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground space-y-2">
      <p className="font-semibold flex items-center gap-1.5">
        <PlugsConnected size={16} weight="bold" aria-hidden="true" />
        {/* Diego, 23/11: un campus sin clave de Stripe tiene que decirlo claro. */}
        {lista.some((c) => c.codigo === 'sin_clave') ? 'FALTA CONECTAR STRIPE' : 'Conectar Stripe para cobros automáticos'}
      </p>
      <ul className="space-y-2">
        {lista.map((c) => (
          <li key={c.project_id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs min-w-0 flex-1">
              {varios && <strong>{c.nombre || `Campus ${c.project_id}`}: </strong>}
              {c.motivo}
            </span>
            {puedeEditar ? (
              <Link to={rutaDeLaClave(c.project_id)} onClick={onIr}
                className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 flex-shrink-0">
                {TEXTO_BOTON[c.codigo] || 'Conectar Stripe'} <ArrowRight size={12} weight="bold" aria-hidden="true" />
              </Link>
            ) : (
              <span className="text-xs font-medium flex-shrink-0">Pídeselo a un administrador.</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AvisoCobroAutoApagado({ motivo }: { motivo?: string | null }) {
  return (
    <p role="status" data-testid="aviso-cobro-auto-apagado"
      className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
      <Info size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
      {motivo || 'El cobro automático de cuotas no está activo en este entorno.'}
    </p>
  );
}
