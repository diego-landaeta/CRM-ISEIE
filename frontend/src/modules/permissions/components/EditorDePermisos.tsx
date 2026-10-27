import { useMemo, useState, type ReactNode } from 'react';
import { CaretDown, MagnifyingGlass, Warning, X } from '@phosphor-icons/react';
import Casilla from '@/shared/components/ui/Casilla';
import { cn } from '@/shared/lib/utils';
import type { PermissionMap } from '@/shared/hooks/usePermission';
import type { Catalogo } from '../api/permissions.api';
import { avisosDeDependencias, clavesDeSeccion, estadoDe, filtrar, marcarTodas } from '../lib/permisos';

/**
 * Los permisos de un rol, como en Shopify (#423): una sección por apartado del
 * menú, que se pliega, con sus casillas, «Seleccionar todo» y un buscador. Si
 * algo marcado necesita otra cosa que no lo está —editar sin ver—, avisa y
 * deja marcarla con un clic; no lo hace solo, que lo decida quien edita.
 */
export default function EditorDePermisos({
  catalogo, valores, onCambiar, soloLectura = false, bloqueadas = [], sinTenerlo = [], marca,
}: {
  catalogo: Catalogo;
  valores: PermissionMap;
  onCambiar?: (valores: PermissionMap) => void;
  soloLectura?: boolean;
  /** Las que este rol no puede tener (`nunca`): se ven, pero no se marcan. */
  bloqueadas?: string[];
  /**
   * Las que quien edita no tiene y el rol tampoco (Diego, 26/10: nadie le pone
   * a un rol lo que él no tiene): se ven, pero no se marcan.
   */
  sinTenerlo?: string[];
  /** Algo al lado del nombre de un permiso (p. ej. «cambiado»). */
  marca?: (clave: string) => ReactNode;
}) {
  const [texto, setTexto] = useState('');
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const secciones = useMemo(() => filtrar(catalogo, texto), [catalogo, texto]);
  const avisos = useMemo(() => avisosDeDependencias(catalogo, valores), [catalogo, valores]);
  const buscando = texto.trim().length > 0;
  const cambiar = (v: PermissionMap) => { if (!soloLectura) onCambiar?.(v); };
  const noSeMarcan = useMemo(() => [...bloqueadas, ...sinTenerlo], [bloqueadas, sinTenerlo]);
  const total = useMemo(() => catalogo.secciones.flatMap(clavesDeSeccion), [catalogo]);
  const marcadas = total.filter((k) => valores[k] === true).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar un permiso: «facturas», «borrar», «WhatsApp»…"
            aria-label="Buscar un permiso"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-normal focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {texto && (
            <button type="button" onClick={() => setTexto('')} aria-label="Borrar la búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 text-secundario text-muted-foreground">
          <span>{marcadas} de {total.length} permisos</span>
          <button type="button" className="rounded px-2 py-1 hover:bg-muted"
            onClick={() => setAbiertas(Object.fromEntries(catalogo.secciones.map((s) => [s.clave, true])))}>Desplegar todo</button>
          <button type="button" className="rounded px-2 py-1 hover:bg-muted" onClick={() => setAbiertas({})}>Plegar todo</button>
        </div>
      </div>

      {avisos.length > 0 && !soloLectura && (
        <div role="status" className="rounded-lg border border-border bg-warning-soft p-3 text-normal text-warning-soft-foreground">
          <p className="mb-1.5 flex items-center gap-1.5 font-semibold"><Warning size={16} weight="bold" /> Hay permisos que necesitan otro</p>
          <ul className="space-y-1">
            {avisos.map((a) => (
              <li key={a.clave} className="flex flex-wrap items-center gap-x-2">
                <span>«{a.nombre}» necesita {a.faltan.map((f) => `«${f.nombre}»`).join(' y ')}.</span>
                <button type="button" className="font-semibold underline underline-offset-2"
                  onClick={() => cambiar(marcarTodas(valores, a.faltan.map((f) => f.clave), true, noSeMarcan))}>
                  Marcarlo
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {secciones.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-normal text-muted-foreground">
          Ningún permiso con «{texto}». Prueba con una palabra suelta.
        </p>
      )}

      {secciones.map((s) => {
        const claves = clavesDeSeccion(s);
        const estado = estadoDe(claves, valores);
        const abierta = buscando || abiertas[s.clave] === true;
        const idCuerpo = `permisos-${s.clave}`;
        return (
          <section key={s.clave} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <button type="button" aria-expanded={abierta} aria-controls={idCuerpo}
                onClick={() => setAbiertas((a) => ({ ...a, [s.clave]: !abierta }))}
                className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <CaretDown size={14} weight="bold" className={cn('flex-shrink-0 transition-transform', !abierta && '-rotate-90')} />
                <span className="truncate font-semibold">{s.nombre}</span>
                <span className="text-secundario text-muted-foreground">
                  {claves.filter((k) => valores[k] === true).length} de {claves.length}
                </span>
              </button>
              {!soloLectura && (
                <Casilla
                  marcada={estado === 'todas'}
                  parcial={estado === 'parcial'}
                  onCambiar={(m) => cambiar(marcarTodas(valores, claves, m, noSeMarcan))}
                  etiqueta={<span className="text-secundario">Seleccionar todo</span>}
                />
              )}
            </div>
            {abierta && (
              <div id={idCuerpo} className="space-y-4 border-t border-border px-3 py-3">
                {s.recursos.map((r) => (
                  <div key={r.clave}>
                    <h4 className="mb-2 text-secundario font-semibold uppercase tracking-wide text-muted-foreground">{r.nombre}</h4>
                    <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 md:grid-cols-2">
                      {r.acciones.map((a) => {
                        const bloqueada = bloqueadas.includes(a.clave);
                        const noLaTienes = !bloqueada && sinTenerlo.includes(a.clave);
                        return (
                          <Casilla
                            key={a.clave}
                            marcada={valores[a.clave] === true}
                            deshabilitada={soloLectura || bloqueada || noLaTienes}
                            onCambiar={(m) => cambiar({ ...valores, [a.clave]: m })}
                            etiqueta={(
                              <span className="flex flex-wrap items-center gap-1.5">
                                {a.nombre}
                                {a.soloPantalla && <span className="rounded bg-muted px-1.5 text-secundario text-muted-foreground">solo pantalla</span>}
                                {marca?.(a.clave)}
                              </span>
                            )}
                            descripcion={bloqueada ? `${a.descripcion} No se le puede dar a este rol.`
                              : noLaTienes ? `${a.descripcion} Tú no lo tienes: no se lo puedes poner a un rol.` : a.descripcion}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
