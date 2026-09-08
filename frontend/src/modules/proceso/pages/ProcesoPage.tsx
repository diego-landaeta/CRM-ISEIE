import { useState, type DragEvent } from 'react';
import { Plus, PencilSimple, EyeSlash, Eye, DotsSixVertical, Info, ArrowRight, ListChecks } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import Card from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import useProcesoPasos from '../hooks/useProcesoPasos';
import { procesoApi, mensajeDeError, type Paso } from '../api/proceso.api';
import DialogoPaso, { type DatosPaso } from '../components/DialogoPaso';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';

/**
 * El proceso comercial de la casa: cinco pasos que vivían en un PDF.
 *
 * Lo que hay que entender de esta pantalla, y por eso está escrito también
 * DENTRO de ella: los días son días desde que entró el prospecto, no días de
 * la semana. El documento dice «lunes o martes» porque describe a alguien que
 * entró un lunes; lo que ordena el proceso es cuánto lleva esperando.
 */

export function puedeEditar(rol: string | undefined): boolean {
  return rol === 'admin' || rol === 'superadmin';
}

/** «Días 0-1», «Día 4», «—». Lo que se lee de un vistazo en la lista. */
export function textoDeDias(desde: number | null, hasta: number | null): string {
  if (desde === null && hasta === null) return '—';
  if (desde !== null && hasta !== null && desde !== hasta) return `Días ${desde}-${hasta}`;
  const uno = desde ?? hasta;
  return `Día ${uno}`;
}

export default function ProcesoPage() {
  const { user } = useAuth() as { user: { role?: string } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id?: number; nombre?: string } | null };
  const admin = puedeEditar(user?.role);

  const [verInactivos, setVerInactivos] = useState(false);
  const { pasos, setPasos, cargando, error, recargar } = useProcesoPasos(activeProject?.id, verInactivos);

  const [editando, setEditando] = useState<Paso | null>(null);
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState<number | null>(null);

  const dialogoAbierto = creando || editando !== null;

  async function guardar(datos: DatosPaso) {
    setGuardando(true);
    setErrorDialogo(null);
    const cuerpo = {
      nombre: datos.nombre.trim(),
      cuando: datos.cuando.trim() || null,
      dia_desde: datos.dia_desde === '' ? null : Number(datos.dia_desde),
      dia_hasta: datos.dia_hasta === '' ? null : Number(datos.dia_hasta),
      canales: datos.canales,
      es_seguimiento: datos.es_seguimiento,
      nota: datos.nota.trim() || null,
    };
    try {
      if (creando) {
        await procesoApi.crear({ ...cuerpo, clave: datos.clave.trim(), projectId: activeProject?.id });
        toast({ title: 'Paso creado' });
      } else if (editando) {
        await procesoApi.editar(editando.id, cuerpo);
        toast({ title: 'Paso guardado' });
      }
      setCreando(false);
      setEditando(null);
      recargar();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setErrorDialogo(mensajeDeError(err?.status, err?.message || 'No se ha podido guardar.', creando ? 'crear' : 'editar'));
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarActivo(paso: Paso) {
    try {
      if (paso.activo) await procesoApi.desactivar(paso.id);
      else await procesoApi.editar(paso.id, { activo: true });
      toast({ title: paso.activo ? 'Paso desactivado' : 'Paso reactivado' });
      recargar();
    } catch (e) {
      const err = e as { status?: number; message?: string };
      toast({
        title: 'No se ha podido cambiar',
        description: mensajeDeError(err?.status, err?.message || '', 'activar'),
        variant: 'destructive',
      });
    }
  }

  async function soltarEn(destino: number) {
    if (arrastrando === null || arrastrando === destino) { setArrastrando(null); return; }
    const antes = pasos;
    const copia = [...pasos];
    const [movido] = copia.splice(arrastrando, 1);
    copia.splice(destino, 0, movido);
    // Se pinta ya y se avisa despues: arrastrar y ver la fila volver a su sitio
    // medio segundo se siente roto aunque acabe bien.
    setPasos(copia);
    setArrastrando(null);
    try {
      // La lista ENTERA de ids, en su nuevo orden, como pide la API.
      await procesoApi.reordenar(copia.map((p) => p.id));
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setPasos(antes);
      toast({
        title: 'No se ha podido reordenar',
        description: mensajeDeError(err?.status, err?.message || '', 'reordenar'),
        variant: 'destructive',
      });
    }
  }

  return (
    <div className="space-y-bloque">
      <PageHeader
        title="Proceso comercial"
        subtitle="Los pasos por los que pasa cada prospecto, en orden."
        backTo="/leads"
        backLabel="Prospectos"
        actions={admin ? (
          <button
            type="button"
            onClick={() => { setErrorDialogo(null); setCreando(true); }}
            className="h-9 inline-flex items-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
          >
            <Plus size={14} weight="bold" />
            <span className="hidden sm:inline">Nuevo paso</span>
            <span className="sm:hidden">Nuevo</span>
          </button>
        ) : null}
      />

      {/* Lo que hay que saber antes de tocar nada. Va en la pantalla y no solo
          en la tarea: quien la abre no ha leido la tarea. */}
      <Card className="flex items-start gap-2.5">
        <Info size={17} weight="regular" className="mt-0.5 shrink-0 text-info" />
        <p className="text-normal text-muted-foreground">
          Los días son <strong className="text-foreground">días desde que entra el prospecto</strong>, no días de la
          semana. Quien entra un jueves hace su primer paso el jueves o el viernes; no espera al lunes. El documento
          comercial los cuenta por día de la semana porque describe a alguien que entró un lunes.
        </p>
      </Card>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-secundario text-muted-foreground">
          {activeProject?.nombre ? `Proceso de ${activeProject.nombre}` : 'Elige un proyecto'}
        </p>
        <label className="inline-flex items-center gap-2 text-normal">
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={(e) => setVerInactivos(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-2 focus:ring-ring/40"
          />
          Ver también los inactivos
        </label>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-normal text-destructive-soft-foreground">
          {error}
        </p>
      )}

      {cargando ? (
        <ul className="space-y-fila" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="h-24 animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </ul>
      ) : pasos.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Todavía no hay pasos"
          description={admin ? 'Crea el primero para empezar a ordenar el proceso.' : 'Cuando un administrador los cree, aparecerán aquí.'}
        />
      ) : (
        <ol aria-label="Pasos del proceso" className="space-y-fila">
          {pasos.map((paso, i) => {
            return (
              <li
                key={paso.id}
                draggable={admin}
                onDragStart={(e: DragEvent<HTMLLIElement>) => {
                  setArrastrando(i);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e: DragEvent<HTMLLIElement>) => { if (admin) e.preventDefault(); }}
                onDrop={(e: DragEvent<HTMLLIElement>) => { e.preventDefault(); soltarEn(i); }}
                onDragEnd={() => setArrastrando(null)}
                className={cn(
                  'rounded-lg border border-border bg-card p-tarjeta shadow-sm transition-colors',
                  admin && 'cursor-grab active:cursor-grabbing',
                  arrastrando === i && 'opacity-50',
                  !paso.activo && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-3">
                  {admin && (
                    <DotsSixVertical
                      size={18}
                      weight="regular"
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-muted-foreground/50"
                    />
                  )}
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-secundario font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <h2 className="text-normal font-semibold">{paso.nombre}</h2>
                      {/* La clave, apagada: hace falta para entenderse con
                          quien toca el codigo, y no se edita. */}
                      <code className="rounded bg-muted px-1 py-0.5 text-secundario text-muted-foreground">
                        {paso.clave}
                      </code>
                      {paso.es_seguimiento && (
                        <span className="rounded bg-info-soft px-1.5 py-0.5 text-secundario font-semibold text-info-soft-foreground">
                          Seguimiento
                        </span>
                      )}
                      {!paso.activo && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-secundario font-semibold text-muted-foreground">
                          Inactivo
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-secundario text-muted-foreground">
                      <span className="tabular-nums">{textoDeDias(paso.dia_desde, paso.dia_hasta)}</span>
                      {paso.cuando && <span>· {paso.cuando}</span>}
                    </div>

                    {paso.canales?.length > 0 && (
                      <ol aria-label={`Canales de ${paso.nombre}, en orden`} className="flex flex-wrap items-center gap-1">
                        {paso.canales.map((canal, j) => {
                          const IconoCanal = iconoDeCanal(canal);
                          return (
                            <li key={canal} className="flex items-center gap-1">
                              {j > 0 && <ArrowRight size={10} weight="bold" className="text-muted-foreground/50" />}
                              <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-secundario">
                                {IconoCanal && <IconoCanal size={12} weight="regular" className="text-muted-foreground" />}
                                {nombreDeCanal(canal)}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}

                    {paso.nota && <p className="text-secundario text-muted-foreground">{paso.nota}</p>}
                  </div>

                  {admin && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => { setErrorDialogo(null); setEditando(paso); }}
                        aria-label={`Editar ${paso.nombre}`}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                      >
                        <PencilSimple size={15} weight="regular" />
                      </button>
                      <button
                        type="button"
                        onClick={() => cambiarActivo(paso)}
                        aria-label={paso.activo ? `Desactivar ${paso.nombre}` : `Reactivar ${paso.nombre}`}
                        title={paso.activo ? 'Desactivar — no se borra, deja de verse' : 'Reactivar'}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                      >
                        {paso.activo ? <EyeSlash size={15} weight="regular" /> : <Eye size={15} weight="regular" />}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <DialogoPaso
        abierto={dialogoAbierto}
        paso={editando}
        guardando={guardando}
        errorServidor={errorDialogo}
        onGuardar={guardar}
        onCerrar={() => { setCreando(false); setEditando(null); setErrorDialogo(null); }}
      />
    </div>
  );
}
