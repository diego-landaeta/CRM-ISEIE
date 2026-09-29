import { useState } from 'react';
import { CheckCircle, Users, Export, CaretDown, Phone, EnvelopeSimple } from '@phosphor-icons/react';
import { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';

interface Gestor {
  id: number;
  nombre: string;
}

interface Props {
  count: number;
  onClear: () => void;
  // Opcionales a proposito: sin el permiso correspondiente la pagina no pasa
  // el manejador, y aqui la accion entera desaparece de la barra.
  onChangeStatus?: (status: string) => void;
  onReassign?: (gestorId: number) => void;
  onExport?: () => void;
  /**
   * Apuntar el contacto a TODOS los seleccionados.
   *
   * El repaso de fin de mes se manda en bloque --Diego, 23/09: «suele ser
   * masivo»-- y apuntarlo uno a uno despues de mandar cuarenta mensajes no lo
   * hace nadie: la lista se queda mintiendo y al mes siguiente vuelven a salir
   * los mismos.
   */
  onMarcarContactado?: () => void;
  /**
   * Los telefonos o los correos de los seleccionados, al portapapeles.
   *
   * Para pegarlos en la difusion de WhatsApp o en el correo masivo, que es como
   * se manda de verdad un seguimiento a cien personas.
   */
  onCopiarContactos?: (que: 'telefono' | 'email') => void;
  gestores: Gestor[];
  isAdmin: boolean;
  loading?: boolean;
}

/**
 * Barra flotante de acciones bulk (cambio de estado, reasignación, export)
 * que aparece cuando hay leads seleccionados.
 */
export default function BulkActionBar({
  count, onClear, onChangeStatus, onReassign, onExport,
  onMarcarContactado, onCopiarContactos, gestores, isAdmin, loading,
}: Props) {
  const [openMenu, setOpenMenu] = useState<'status' | 'reassign' | null>(null);

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 bg-card border border-border rounded-lg px-4 py-2.5 flex items-center gap-3 max-w-[95vw]" style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">
        {count} seleccionado{count === 1 ? '' : 's'}
      </span>

      <div className="h-5 w-px bg-border" />

      <div className="flex items-center gap-1 flex-wrap">
        {/* Cambiar estado */}
        {onChangeStatus && (
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')}
            disabled={loading}
            className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <CheckCircle size={14} weight="regular" /> Cambiar estado <CaretDown size={10} weight="bold" />
          </button>
          {openMenu === 'status' && (
            <div className="absolute bottom-full mb-1 left-0 bg-card border border-border rounded-md py-1 min-w-44 z-10" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <button key={k} onClick={() => { onChangeStatus(k); setOpenMenu(null); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted">
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
        )}

        {/* Reasignar: hace falta el permiso `leads.assign` */}
        {onReassign && isAdmin && gestores.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'reassign' ? null : 'reassign')}
              disabled={loading}
              className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <Users size={14} weight="regular" /> Reasignar <CaretDown size={10} weight="bold" />
            </button>
            {openMenu === 'reassign' && (
              <div className="absolute bottom-full mb-1 left-0 bg-card border border-border rounded-md py-1 min-w-48 max-h-60 overflow-y-auto z-10" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                {gestores.map((g) => (
                  <button key={g.id} onClick={() => { onReassign(g.id); setOpenMenu(null); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted">
                    {g.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Exportar CSV */}
        {onMarcarContactado && (
          <button
            onClick={onMarcarContactado}
            disabled={loading}
            className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <CheckCircle size={13} weight="bold" /> Marcar contactados
          </button>
        )}

        {onCopiarContactos && (
          <>
            <button
              onClick={() => onCopiarContactos('telefono')}
              disabled={loading}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Phone size={13} weight="bold" /> Copiar teléfonos
            </button>
            <button
              onClick={() => onCopiarContactos('email')}
              disabled={loading}
              className="h-8 inline-flex items-center gap-1.5 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <EnvelopeSimple size={13} weight="bold" /> Copiar correos
            </button>
          </>
        )}

        {onExport && (
        <button
          onClick={onExport}
          disabled={loading}
          className="px-3 py-1.5 rounded-md text-xs font-medium hover:bg-muted disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <Export size={14} weight="regular" /> Exportar CSV
        </button>
        )}
      </div>

      <div className="h-5 w-px bg-border" />

      <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground p-1 rounded">
        Cancelar
      </button>
    </div>
  );
}
