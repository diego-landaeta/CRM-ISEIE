import { useEffect, useState } from 'react';
import { X, Eye, Plus, PencilSimple, Trash, Flask } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import EmptyState from '@/shared/components/ui/EmptyState';
import { credencialesApi, type LineaRegistro } from '../api/credenciales.api';

/**
 * Quién ha tocado qué credencial. Tarea #80.
 *
 * Lee de `user_activity_log`, filtrado por las acciones que empiezan por
 * `credencial.` — la tabla la comparten los inicios de sesión y lo de WhatsApp.
 *
 * Aquí no hay ningún valor y no lo habrá: el servidor no los guarda. Lo que se
 * ve es quién, qué credencial y cuándo. Que «ver una clave» deje huella es la
 * mitad del valor del panel: sin eso, consultarla seguiría siendo gratis y
 * anónimo, que es como acabaron dos claves de producción en un chat.
 */

const ACCION: Record<string, { texto: string; Icon: typeof Eye; color: string }> = {
  'credencial.ver':     { texto: 'miró',      Icon: Eye,           color: 'bg-primary/10 text-primary' },
  'credencial.crear':   { texto: 'puso',      Icon: Plus,          color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400' },
  'credencial.cambiar': { texto: 'cambió',    Icon: PencilSimple,  color: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400' },
  'credencial.borrar':  { texto: 'borró',     Icon: Trash,         color: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400' },
  'credencial.probar':  { texto: 'probó',     Icon: Flask,         color: 'bg-muted text-muted-foreground' },
};

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

export default function RegistroClaves({ onCerrar }: { onCerrar: () => void }) {
  const [lineas, setLineas] = useState<LineaRegistro[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await credencialesApi.registro(200);
        if (r.success) setLineas(r.data as LineaRegistro[]);
      } finally { setCargando(false); }
    })();
  }, []);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onCerrar}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="bg-card rounded-2xl border border-border shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col"
        >
          <header className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
            <div>
              <h3 className="font-extrabold">Quién ha tocado qué</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Aquí no hay ningún valor, y no lo habrá: solo quién, qué y cuándo.
              </p>
            </div>
            <button onClick={onCerrar} aria-label="Cerrar"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <X size={16} weight="bold" />
            </button>
          </header>

          <div className="overflow-y-auto p-5">
            {cargando ? (
              <p className="text-center text-sm text-muted-foreground py-8">Cargando…</p>
            ) : !lineas.length ? (
              <EmptyState icon={Eye} title="Todavía no ha tocado nadie nada"
                description="Cada vez que alguien mire o cambie una clave, aparecerá aquí." />
            ) : (
              <ul className="divide-y divide-border">
                {lineas.map((l) => {
                  const a = ACCION[l.action] || { texto: l.action, Icon: Eye, color: 'bg-muted text-muted-foreground' };
                  return (
                    <li key={l.id} className="flex items-center gap-3 py-3">
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${a.color}`}>
                        <a.Icon size={15} weight="regular" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <strong className="font-semibold">{l.usuario || 'Alguien'}</strong>
                          {' '}{a.texto}{' '}
                          <strong className="font-semibold">{l.details?.servicio || '—'}</strong>
                          {l.details?.entorno && (
                            <span className="text-muted-foreground"> en {l.details.entorno}</span>
                          )}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                        {cuando(l.created_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
