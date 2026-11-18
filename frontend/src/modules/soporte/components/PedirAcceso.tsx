import { useEffect, useId, useRef, useState } from 'react';
import { Key, X, PaperPlaneRight } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import {
  TIPOS_DE_ACCESO, EVENTO_PEDIR_ACCESO, formularioVacio, erroresDe, cuerpoDePeticion, pedirAcceso,
  type FormularioDeAcceso, type PeticionInicial, type TipoDeAcceso,
} from '../lib/accesos';

/**
 * «Pedir acceso o permiso» (CRM#820).
 *
 * Va montado una vez en el marco y se abre con `abrirPedirAcceso()` desde el
 * menú de usuario o desde la pantalla de «No tienes acceso», que le pasa la
 * clave del permiso que falta. Al enviarlo queda un ticket de Soporte del tipo
 * «acceso»: no crea a nadie ni da nada.
 */
export default function PedirAcceso() {
  const [abierto, setAbierto] = useState<PeticionInicial | null>(null);

  useEffect(() => {
    function onAbrir(e: Event) {
      setAbierto((e as CustomEvent<PeticionInicial>).detail || {});
    }
    window.addEventListener(EVENTO_PEDIR_ACCESO, onAbrir);
    return () => window.removeEventListener(EVENTO_PEDIR_ACCESO, onAbrir);
  }, []);

  if (!abierto) return null;
  return <Formulario inicial={abierto} onCerrar={() => setAbierto(null)} />;
}

const OTRO_CAMPUS = '__otro__';

function Formulario({ inicial, onCerrar }: { inicial: PeticionInicial; onCerrar: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const { projects } = useProjectContext() as { projects: Array<{ id: number; nombre: string }> };
  const [f, setF] = useState<FormularioDeAcceso>(() => formularioVacio(inicial));
  const [otroCampus, setOtroCampus] = useState(false);
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  useModalAccesible(ref, { open: true, onClose: onCerrar, bloqueado: enviando });

  const errores = intentado ? erroresDe(f) : {};
  const cambiar = (diff: Partial<FormularioDeAcceso>) => setF((x) => ({ ...x, ...diff }));
  // El permiso lo rellena la pantalla de «No tienes acceso»; desde el menú no hay ninguno.
  const vieneConPermiso = Boolean(inicial.permiso);

  const opcionesDeCampus = [
    { value: '', label: 'Sin campus concreto' },
    ...(projects || []).map((p) => ({ value: String(p.id), label: p.nombre })),
    { value: OTRO_CAMPUS, label: 'Otro campus (escríbelo)' },
  ];

  async function enviar() {
    setIntentado(true);
    if (Object.keys(erroresDe(f)).length) return;
    setEnviando(true);
    try {
      await pedirAcceso(cuerpoDePeticion(f, window.location.href));
      toast({
        title: 'Petición enviada a soporte',
        description: 'Soporte la prepara y te avisa por la campana cuando la mueva.',
      });
      onCerrar();
    } catch (err) {
      toast({
        title: 'No se pudo enviar la petición',
        description: (err as Error)?.message || 'Inténtalo de nuevo en un momento.',
        variant: 'destructive',
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={() => !enviando && onCerrar()} />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={tituloId}
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-lg max-h-[100dvh] sm:max-h-[90vh] flex flex-col"
        >
          <header className="flex items-start gap-3 px-5 pt-5 pb-3">
            <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
              <Key size={20} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={tituloId} className="text-base font-semibold">Pedir acceso o permiso</h2>
              <p className="text-sm text-muted-foreground">
                Le llega a soporte como un ticket. Lo preparan y lo confirma quien pueda darlo.
              </p>
            </div>
            <button
              type="button"
              onClick={onCerrar}
              disabled={enviando}
              aria-label="Cerrar"
              className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X size={14} weight="bold" />
            </button>
          </header>

          <div className="px-5 pb-4 space-y-3 overflow-y-auto">
            <Field label="¿Qué necesitas?" required error={errores.tipo}
              hint={TIPOS_DE_ACCESO.find((t) => t.value === f.tipo)?.ayuda}>
              <Select<TipoDeAcceso | ''>
                value={f.tipo}
                onChange={(v) => cambiar({ tipo: v })}
                placeholder="Elige qué necesitas"
                ariaLabel="Qué necesitas"
                options={TIPOS_DE_ACCESO.map((t) => ({ value: t.value, label: t.label }))}
              />
            </Field>

            {(f.tipo === 'permiso' || vieneConPermiso) && (
              <Field label="Permiso que falta" error={errores.permiso}
                hint={vieneConPermiso ? 'Lo ha rellenado el CRM: es el que te falta en esta pantalla.' : 'Si no sabes cómo se llama, déjalo vacío y explícalo abajo.'}>
                <input
                  value={f.permiso}
                  onChange={(e) => cambiar({ permiso: e.target.value })}
                  readOnly={vieneConPermiso}
                  placeholder="leads.view"
                  autoComplete="off"
                  className={`${inputClass} font-mono`}
                />
              </Field>
            )}

            {f.tipo === 'alta' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Nombre de la persona" required error={errores.nombre}>
                  <input value={f.nombre} onChange={(e) => cambiar({ nombre: e.target.value })}
                    autoComplete="off" className={inputClass} />
                </Field>
                <Field label="Su correo" required error={errores.correo}>
                  <input type="email" value={f.correo} onChange={(e) => cambiar({ correo: e.target.value })}
                    autoComplete="off" className={inputClass} />
                </Field>
              </div>
            )}

            <Field label="Campus" hint="El campus para el que lo necesitas, si es uno concreto.">
              <Select<string>
                value={otroCampus ? OTRO_CAMPUS : f.projectId}
                onChange={(v) => {
                  setOtroCampus(v === OTRO_CAMPUS);
                  cambiar({ projectId: v === OTRO_CAMPUS ? '' : v, campus: v === OTRO_CAMPUS ? f.campus : '' });
                }}
                ariaLabel="Campus"
                options={opcionesDeCampus}
              />
            </Field>
            {otroCampus && (
              <Field label="¿Qué campus?">
                <input value={f.campus} onChange={(e) => cambiar({ campus: e.target.value })}
                  placeholder="El nombre del campus o de la empresa" autoComplete="off" className={inputClass} />
              </Field>
            )}

            <Field label="Explicación" required error={errores.explicacion}
              hint="Para qué lo necesitas y desde cuándo. Cuanto más claro, antes se prepara.">
              <textarea
                value={f.explicacion}
                onChange={(e) => cambiar({ explicacion: e.target.value })}
                rows={4}
                autoComplete="off"
                data-autofocus
                className={`${inputClass} h-auto py-2 resize-y`}
              />
            </Field>
          </div>

          <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
            <button type="button" onClick={onCerrar} disabled={enviando}
              className="h-9 px-3 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted">
              Cancelar
            </button>
            <button type="button" onClick={enviar} disabled={enviando}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60">
              <PaperPlaneRight size={14} weight="bold" /> {enviando ? 'Enviando…' : 'Enviar a soporte'}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
}
