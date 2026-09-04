import { useState } from 'react';
import { X, Warning } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { credencialesApi, type Credencial } from '../api/credenciales.api';

/**
 * Poner o cambiar una clave. Tarea #80.
 *
 * Dos decisiones que no son de estilo:
 *
 *   · **Al cambiar una que ya existe, el campo sale VACÍO**, no relleno con la
 *     actual. Rellenarlo obligaría a traer el valor entero solo por abrir el
 *     diálogo — un secreto en pantalla que nadie pidió ver, y sin quedar
 *     registrado. Si no escribes nada, no se cambia.
 *   · **El valor no se guarda en ningún sitio al cerrar.** Se manda y se
 *     olvida: el estado vive dentro del diálogo y muere con él.
 */

const SERVICIOS = [
  { id: 'brevo', nombre: 'Brevo', pista: 'xkeysib-…' },
  { id: 'stripe', nombre: 'Stripe', pista: 'sk_live_… o sk_test_…' },
  { id: 'meta', nombre: 'Meta Ads', pista: 'EAA…' },
  { id: 'google_ads', nombre: 'Google Ads', pista: 'refresh token' },
  { id: 'gsc', nombre: 'Search Console', pista: '' },
  { id: 'woocommerce', nombre: 'WooCommerce', pista: 'ck_… / cs_…' },
  { id: 'evolution', nombre: 'Evolution (WhatsApp)', pista: '' },
  { id: 'r2', nombre: 'Cloudflare R2', pista: '' },
  { id: 'make', nombre: 'Make', pista: '' },
  { id: 'claude', nombre: 'Claude', pista: 'sk-ant-…' },
];

interface Props {
  /** Si viene, es un cambio; si no, un alta. */
  clave: Credencial | null;
  onCerrar: () => void;
  onGuardada: () => void;
}

export default function DialogoClave({ clave, onCerrar, onGuardada }: Props) {
  const { projects } = useProjectContext();
  const cambio = !!clave;

  const [service, setService] = useState(clave?.service || 'brevo');
  const [projectId, setProjectId] = useState<string>(
    clave?.project_id != null ? String(clave.project_id) : '',
  );
  const [entorno, setEntorno] = useState(clave?.entorno || 'produccion');
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  const elegido = SERVICIOS.find((s) => s.id === service);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (valor.trim().length < 4) {
      toast({ title: 'La clave es demasiado corta', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await credencialesApi.guardar({
        project_id: projectId ? Number(projectId) : null,
        service, entorno, value: valor.trim(),
      });
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo guardar');
      toast({ title: cambio ? 'Clave cambiada' : 'Clave guardada' });
      onGuardada();
      onCerrar();
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: (err as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        onClick={onCerrar}
      >
        <form
          onSubmit={guardar} onClick={(e) => e.stopPropagation()}
          className="bg-card rounded-2xl border border-border shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto"
        >
          <header className="flex items-center justify-between p-5 border-b border-border">
            <h3 className="font-extrabold">{cambio ? 'Cambiar la clave' : 'Añadir una clave'}</h3>
            <button type="button" onClick={onCerrar} aria-label="Cerrar"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <X size={16} weight="bold" />
            </button>
          </header>

          <div className="p-5 space-y-4">
            <label className="block">
              <span className="text-xs font-bold uppercase text-muted-foreground">Servicio *</span>
              <select
                value={service} onChange={(e) => setService(e.target.value)} disabled={cambio}
                className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm
                           focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              >
                {SERVICIOS.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-bold uppercase text-muted-foreground">Proyecto</span>
              <select
                value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={cambio}
                className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm
                           focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
              >
                <option value="">— Global (vale para todos)</option>
                {(projects || []).map((p: { id: number; nombre: string }) => (
                  <option key={p.id} value={p.id}>{p.nombre}</option>
                ))}
              </select>
            </label>

            <div>
              <span className="text-xs font-bold uppercase text-muted-foreground">Entorno *</span>
              <div className="mt-1 inline-flex bg-muted rounded-lg p-0.5 gap-0.5 w-full">
                {(['produccion', 'pruebas'] as const).map((e) => (
                  <button
                    key={e} type="button" onClick={() => !cambio && setEntorno(e)} disabled={cambio}
                    className={`flex-1 h-8 rounded-md text-[13px] font-semibold transition-colors ${
                      entorno === e ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                    } ${cambio ? 'cursor-not-allowed' : ''}`}
                  >
                    {e === 'produccion' ? 'Producción' : 'Pruebas'}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-bold uppercase text-muted-foreground">
                {cambio ? 'Clave nueva *' : 'Clave *'}
              </span>
              <input
                type="password" value={valor} onChange={(e) => setValor(e.target.value)}
                autoComplete="off" autoFocus
                placeholder={elegido?.pista || 'Pega aquí la clave'}
                className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm font-mono
                           focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {cambio && (
                <span className="flex gap-1.5 text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  <Warning size={14} className="flex-shrink-0 mt-0.5" />
                  {/* No se rellena con la actual a propósito: traerla aquí sería
                      enseñar un secreto que nadie ha pedido ver. */}
                  Sale en blanco a propósito: para verla, usa «Ver» en la tabla — eso queda registrado.
                </span>
              )}
            </label>
          </div>

          <footer className="p-4 border-t border-border flex gap-2 justify-end">
            <button type="button" onClick={onCerrar}
              className="h-9 px-4 rounded-lg text-sm font-bold hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={guardando}
              className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold
                         hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {guardando ? 'Guardando…' : cambio ? 'Cambiar' : 'Guardar'}
            </button>
          </footer>
        </form>
      </div>
    </Portal>
  );
}
