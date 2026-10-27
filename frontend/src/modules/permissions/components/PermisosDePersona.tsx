import { useCallback, useEffect, useMemo, useState } from 'react';
import { CaretDown, ClockCounterClockwise, MagnifyingGlass, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import * as api from '../api/permissions.api';
import type { Catalogo, FichaDePermisos, Origen } from '../api/permissions.api';
import { clavesDeSeccion, filtrar } from '../lib/permisos';

const NOMBRE_ROL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', gestor: 'Gestora', soporte: 'Soporte',
  project_manager: 'Project manager', tutor: 'Tutor', colaborador: 'Colaborador',
};

/** De dónde le viene un permiso, en una etiqueta corta. */
export function textoDeOrigen(o: Origen | undefined): string {
  if (!o) return '';
  switch (o.tipo) {
    case 'superadmin': return 'Superadmin';
    case 'rol': return `Su rol: ${NOMBRE_ROL[o.rol] || o.rol}`;
    case 'ajuste_rol': return `Su rol (cambiado en Roles): ${NOMBRE_ROL[o.rol] || o.rol}`;
    case 'rol_a_medida': return `Rol a medida: ${o.nombre}`;
    case 'excepcion': return 'Excepción suya';
    case 'nunca': return 'Su rol no puede tenerlo';
    default: return '';
  }
}

type Eleccion = 'rol' | 'si' | 'no';

/**
 * Los permisos de una persona (#423): todo lo que puede hacer, de dónde le
 * viene cada cosa, y —quien puede— sus excepciones y su rol a medida. Abajo,
 * el historial de cambios.
 */
export default function PermisosDePersona({ userId, onClose }: { userId: number; onClose: () => void }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [ficha, setFicha] = useState<FichaDePermisos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [soloLoQuePuede, setSoloLoQuePuede] = useState(true);
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([api.getCatalogo(), api.getFicha(userId)]);
      setCatalogo(c);
      setFicha(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    }
  }, [userId]);
  useEffect(() => { cargar(); }, [cargar]);

  const secciones = useMemo(() => {
    if (!catalogo || !ficha) return [];
    const base = filtrar(catalogo, texto);
    if (!soloLoQuePuede) return base;
    return base
      .map((s) => ({ ...s, recursos: s.recursos.map((r) => ({ ...r, acciones: r.acciones.filter((a) => ficha.mapa[a.clave] || a.clave in ficha.excepciones) })).filter((r) => r.acciones.length) }))
      .filter((s) => s.recursos.length);
  }, [catalogo, ficha, texto, soloLoQuePuede]);

  async function elegir(clave: string, e: Eleccion) {
    setOcupado(true);
    try {
      await api.guardarExcepciones(userId, { [clave]: e === 'rol' ? null : e === 'si' });
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha guardado', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  }

  async function cambiarRol(id: number | null) {
    setOcupado(true);
    try {
      await api.cambiarRolAMedida(userId, id);
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha guardado', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setOcupado(false);
    }
  }

  const buscando = texto.trim().length > 0;
  const total = catalogo ? catalogo.secciones.flatMap(clavesDeSeccion) : [];

  return (
    <Portal>
      {/* Encima de la ficha del usuario (z-70), por eso z-80. */}
      <div className="fixed inset-0 !m-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="permisos-titulo">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-4 shadow-xl sm:p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="permisos-titulo" className="text-lg font-bold">Permisos{ficha ? ` de ${ficha.persona.nombre}` : ''}</h2>
              {ficha && (
                <p className="text-secundario text-muted-foreground">
                  {[ficha.persona.role, ...ficha.persona.roles_extra].map((r) => NOMBRE_ROL[r] || r).join(' + ')}
                  {ficha.rolAMedida && ` · rol a medida «${ficha.rolAMedida.nombre}»${ficha.rolAMedida.activo ? '' : ' (desactivado, no se aplica)'}`}
                  {' · '}puede {total.filter((k) => ficha.mapa[k]).length} de {total.length}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 hover:bg-muted"><X size={18} /></button>
          </header>

          {error && <p className="rounded-lg bg-destructive-soft p-3 text-normal text-destructive-soft-foreground">{error}</p>}
          {!ficha && !error && <p className="text-normal text-muted-foreground">Cargando…</p>}

          {ficha && catalogo && (
            <>
              {ficha.puedeEditar && (
                <div className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
                  <label htmlFor="rol-a-medida" className="text-normal font-semibold">Rol a medida</label>
                  <select id="rol-a-medida" disabled={ocupado} value={ficha.rolAMedida?.id ?? ''}
                    onChange={(e) => cambiarRol(e.target.value ? Number(e.target.value) : null)}
                    className="h-9 flex-1 rounded-lg border border-border bg-card px-2 text-normal">
                    <option value="">Ninguno: lo de su rol</option>
                    {ficha.rolesAMedida.map((r) => <option key={r.id} value={r.id}>{r.nombre} (parte de {NOMBRE_ROL[r.base] || r.base})</option>)}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar un permiso" aria-label="Buscar un permiso"
                    className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-normal" />
                </div>
                <label className="flex items-center gap-2 text-secundario">
                  <input type="checkbox" checked={soloLoQuePuede} onChange={(e) => setSoloLoQuePuede(e.target.checked)} className="h-4 w-4 accent-primary" />
                  Solo lo que puede
                </label>
              </div>

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
                          {clavesDeSeccion(s).filter((k) => ficha.mapa[k]).length} de {clavesDeSeccion(s).length}
                        </span>
                      </button>
                      {abierta && (
                        <ul className="divide-y divide-border border-t border-border">
                          {s.recursos.flatMap((r) => r.acciones.map((a) => {
                            const puede = ficha.mapa[a.clave] === true;
                            const eleccion: Eleccion = a.clave in ficha.excepciones ? (ficha.excepciones[a.clave] ? 'si' : 'no') : 'rol';
                            return (
                              <li key={a.clave} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                                <div className="min-w-0 flex-1">
                                  <p className="text-normal">
                                    <span className={cn('mr-1.5 inline-block w-4 text-center font-bold', puede ? 'text-success' : 'text-muted-foreground')} aria-label={puede ? 'Puede' : 'No puede'}>
                                      {puede ? '✓' : '–'}
                                    </span>
                                    <span className="text-muted-foreground">{r.nombre} · </span>{a.nombre}
                                  </p>
                                  <p className="pl-5 text-secundario text-muted-foreground">{textoDeOrigen(ficha.origenes[a.clave]) || a.descripcion}</p>
                                </div>
                                {ficha.puedeEditar && (
                                  <div role="radiogroup" aria-label={`Excepción para ${a.nombre}`} className="flex overflow-hidden rounded-lg border border-border text-secundario">
                                    {([['rol', 'Como su rol'], ['si', 'Sí'], ['no', 'No']] as const).map(([v, t]) => (
                                      <button key={v} type="button" role="radio" aria-checked={eleccion === v} disabled={ocupado}
                                        onClick={() => eleccion !== v && elegir(a.clave, v)}
                                        className={cn('px-2.5 py-1 font-semibold', eleccion === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                                        {t}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </li>
                            );
                          }))}
                        </ul>
                      )}
                    </section>
                  );
                })}
                {secciones.length === 0 && <p className="py-4 text-center text-normal text-muted-foreground">Nada que enseñar con este filtro.</p>}
              </div>

              <section className="space-y-2">
                <h3 className="flex items-center gap-1.5 text-normal font-semibold"><ClockCounterClockwise size={16} /> Cambios de permisos</h3>
                {ficha.registro.length === 0 ? (
                  <p className="text-secundario text-muted-foreground">Ninguno todavía.</p>
                ) : (
                  <ul className="space-y-1 text-secundario">
                    {ficha.registro.map((r) => (
                      <li key={r.id} className="text-muted-foreground">
                        <span className="text-foreground">{new Date(r.cuando).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        {' · '}{r.quien_nombre || 'el sistema'} · {r.clave}: {r.antes ?? '—'} → {r.despues ?? '—'}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </Portal>
  );
}
