import { useMemo, useState } from 'react';
import { CaretDown, Info, LockSimple, MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import type { Catalogo, Origen } from '../api/permissions.api';
import { clavesDeSeccion, filtrar } from '../lib/permisos';
import { formaDe, MARCAS, ORIGENES, type FormaDeOrigen } from '../lib/formas';

export { textoDeOrigen, nombreDeRol } from '../lib/formas';

export type Eleccion = 'rol' | 'si' | 'no';

/** Cada origen, con su color: así se distingue de un vistazo de dónde le viene. */
const ESTILO_DE_ORIGEN: Record<FormaDeOrigen, string> = {
  superadmin: 'bg-success-soft text-success-soft-foreground',
  rol: 'bg-success-soft text-success-soft-foreground',
  rol_extra: 'bg-indigo-soft text-indigo-soft-foreground',
  ajuste_rol: 'bg-info-soft text-info-soft-foreground',
  rol_a_medida: 'border border-dashed border-info-soft-foreground/50 text-info-soft-foreground',
  dado: 'bg-warning-soft text-warning-soft-foreground',
  quitado: 'bg-destructive-soft text-destructive-soft-foreground',
  nunca: 'bg-muted text-muted-foreground',
  ninguno: 'text-muted-foreground',
};

/**
 * La lista de permisos de una persona, agrupada como en Roles (#423, #694).
 * TODO el catálogo, sin nada escrito a mano: un permiso nuevo sale solo. Por
 * cada uno, si lo tiene y de qué forma (su rol, un rol de más, su rol a
 * medida, una excepción suya, o bloqueado para su rol con el motivo), lo que
 * es el permiso (solo lo suyo, independiente, requiere otro, solo con el rol
 * principal) y —quien puede— su excepción («Como su rol · Sí · No»). La usan
 * la ficha de una persona, el alta de un usuario y el diálogo de permisos.
 *
 * `role`: su rol principal, para el motivo de lo bloqueado.
 * `puedeDar(clave)`: si quien edita puede dar ese «Sí». Nadie da lo que no
 * tiene; el servidor lo vuelve a comprobar.
 */
export default function ListaDePermisos({
  catalogo, mapa, origenes, excepciones, puedeEditar, ocupado = false, onElegir, puedeDar = () => true, role,
}: {
  catalogo: Catalogo;
  mapa: Record<string, boolean>;
  origenes: Record<string, Origen>;
  excepciones: Record<string, boolean>;
  puedeEditar: boolean;
  ocupado?: boolean;
  onElegir?: (clave: string, e: Eleccion) => void;
  puedeDar?: (clave: string) => boolean;
  role?: string;
}) {
  const [texto, setTexto] = useState('');
  // Diego, 11/11 (#694): todos los permisos, también los que no tiene. El filtro, a petición.
  const [soloLoQuePuede, setSoloLoQuePuede] = useState(false);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

  const secciones = useMemo(() => {
    const base = filtrar(catalogo, texto);
    if (!soloLoQuePuede) return base;
    return base
      .map((s) => ({ ...s, recursos: s.recursos.map((r) => ({ ...r, acciones: r.acciones.filter((a) => mapa[a.clave] || a.clave in excepciones) })).filter((r) => r.acciones.length) }))
      .filter((s) => s.recursos.length);
  }, [catalogo, mapa, excepciones, texto, soloLoQuePuede]);

  const buscando = texto.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          {/* Dentro del formulario de la ficha: Intro no tiene que guardarla. */}
          <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar un permiso" aria-label="Buscar un permiso"
            onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-normal" />
        </div>
        <label className="flex items-center gap-2 text-secundario">
          <input type="checkbox" checked={soloLoQuePuede} onChange={(e) => setSoloLoQuePuede(e.target.checked)} className="h-4 w-4 accent-primary" />
          Solo lo que puede
        </label>
      </div>

      {/* La leyenda: cada forma de tenerlo, con su color. */}
      <ul aria-label="Formas de tener un permiso" className="flex flex-wrap gap-1.5 text-secundario">
        {(Object.keys(ORIGENES) as (keyof typeof ORIGENES)[]).map((o) => (
          <li key={o} className={cn('rounded-md px-1.5 py-0.5', ESTILO_DE_ORIGEN[o])}>{ORIGENES[o]}</li>
        ))}
        {(Object.keys(MARCAS) as (keyof typeof MARCAS)[]).map((m) => (
          <li key={m} title={MARCAS[m].ayuda} className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground">{MARCAS[m].etiqueta}</li>
        ))}
      </ul>

      <div className="space-y-2">
        {secciones.map((s) => {
          const abierta = buscando || abiertas[s.clave] === true;
          return (
            <section key={s.clave} className="rounded-xl border border-border">
              <button type="button" aria-expanded={abierta} onClick={() => setAbiertas((a) => ({ ...a, [s.clave]: !abierta }))}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
                <CaretDown size={14} weight="bold" className={cn('transition-transform', !abierta && '-rotate-90')} />
                <span className="font-semibold">{s.nombre}</span>
                <span className="text-secundario text-muted-foreground">
                  {clavesDeSeccion(s).filter((k) => mapa[k]).length} de {clavesDeSeccion(s).length}
                </span>
              </button>
              {abierta && (
                <ul className="divide-y divide-border border-t border-border">
                  {s.recursos.flatMap((r) => [
                    ...(r.nota ? [(
                      <li key={`${r.clave}·nota`} data-nota={r.clave} className="flex gap-2 bg-muted/40 px-3 py-2 text-secundario">
                        <Info size={16} className="mt-0.5 shrink-0 text-info-soft-foreground" aria-hidden="true" />
                        <p><span className="font-semibold">{r.nombre}: </span>{r.nota}</p>
                      </li>
                    )] : []),
                    ...r.acciones.map((a) => {
                      const f = formaDe(catalogo, a, { mapa, origenes, role });
                      const eleccion: Eleccion = a.clave in excepciones ? (excepciones[a.clave] ? 'si' : 'no') : 'rol';
                      const faltan = f.requiere.filter((x) => !x.tiene);
                      return (
                        <li key={a.clave} data-clave={a.clave} data-origen={f.origen} data-marcas={f.marcas.join(' ')}
                          className={cn('flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center', f.bloqueo && 'bg-muted/30')}>
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-normal">
                              {f.bloqueo ? (
                                <LockSimple size={14} weight="bold" className="mr-1.5 inline-block align-[-2px] text-muted-foreground" aria-label="Bloqueado" />
                              ) : (
                                <span className={cn('mr-1.5 inline-block w-4 text-center font-bold', f.tiene ? 'text-success' : 'text-muted-foreground')} aria-label={f.tiene ? 'Puede' : 'No puede'}>
                                  {f.tiene ? '✓' : '–'}
                                </span>
                              )}
                              <span className="text-muted-foreground">{r.nombre} · </span>{a.nombre}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 pl-5 text-secundario">
                              <span data-forma="origen" className={cn('rounded-md px-1.5 py-0.5', ESTILO_DE_ORIGEN[f.origen])}>{f.texto}</span>
                              {f.marcas.map((m) => (
                                <span key={m} data-forma={m} title={MARCAS[m].ayuda} className="rounded-md border border-border px-1.5 py-0.5 text-muted-foreground">
                                  {m === 'requiere' ? `Requiere: ${f.requiere.map((x) => x.nombre).join(', ')}` : MARCAS[m].etiqueta}
                                </span>
                              ))}
                            </div>
                            <p className="pl-5 text-secundario text-muted-foreground">{a.descripcion}</p>
                          </div>
                          {puedeEditar && onElegir && (
                            <div role="radiogroup" aria-label={`Excepción para ${a.nombre}`} className="flex overflow-hidden rounded-lg border border-border text-secundario">
                              {([['rol', 'Como su rol'], ['si', 'Sí'], ['no', 'No']] as const).map(([v, t]) => {
                                // «Sí» no se ofrece si su rol no puede tenerlo, si le falta lo que
                                // necesita o si quien edita no lo tiene. Y se dice por qué.
                                const motivo = v !== 'si' || eleccion === 'si' ? null
                                  : f.bloqueo ? f.bloqueo
                                    : faltan.length ? `Antes necesita: ${faltan.map((x) => x.nombre).join(', ')}`
                                      : !puedeDar(a.clave) ? 'No lo puedes dar: tú no lo tienes' : null;
                                return (
                                  <button key={v} type="button" role="radio" aria-checked={eleccion === v} disabled={ocupado || Boolean(motivo)}
                                    title={motivo || undefined}
                                    onClick={() => eleccion !== v && onElegir(a.clave, v)}
                                    className={cn('px-2.5 py-1 font-semibold disabled:opacity-40', eleccion === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                                    {t}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      );
                    }),
                  ])}
                </ul>
              )}
            </section>
          );
        })}
        {secciones.length === 0 && <p className="py-4 text-center text-normal text-muted-foreground">Nada que enseñar con este filtro.</p>}
      </div>
    </div>
  );
}
