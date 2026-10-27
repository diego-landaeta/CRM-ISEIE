import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, Plus, ShieldCheck, UsersThree } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import usePermission, { type PermissionMap } from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { cn } from '@/shared/lib/utils';
import EditorDePermisos from '../components/EditorDePermisos';
import * as api from '../api/permissions.api';
import type { Catalogo, ListaDeRoles } from '../api/permissions.api';
import { accionesDe, cambiadas } from '../lib/permisos';

/**
 * Configuración › Roles (#423). Como en Shopify: a la izquierda los roles —los
 * fijos y los a medida—, a la derecha todo lo que trae el elegido, por
 * secciones del menú, con casillas.
 *
 * Cambiar un rol vale para todas las empresas: quien tiene «Cambiar roles» (de
 * serie, el admin y el superadmin; Diego, 26/10), y sin ponerle lo que él no
 * tiene. El resto lo ve en solo lectura.
 * Lo de una persona suelta se cambia en su ficha (Configuración › Usuarios).
 */

type Elegido = { tipo: 'fijo'; clave: string } | { tipo: 'medida'; id: number };

export default function RolesPage() {
  const { can } = usePermission();
  const puedeCambiar = can('roles.edit');
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [roles, setRoles] = useState<ListaDeRoles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elegido, setElegido] = useState<Elegido>({ tipo: 'fijo', clave: 'admin' });
  const [borrador, setBorrador] = useState<PermissionMap | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [creando, setCreando] = useState<{ nombre: string; base: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([api.getCatalogo(), api.getRoles()]);
      // Si el servidor no manda la forma esperada, la pantalla no se cae (#113).
      setCatalogo(Array.isArray(c?.secciones) ? c : null);
      setRoles({ fijos: Array.isArray(r?.fijos) ? r.fijos : [], aMedida: Array.isArray(r?.aMedida) ? r.aMedida : [] });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los roles');
    }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const fijo = elegido.tipo === 'fijo' ? roles?.fijos.find((r) => r.clave === elegido.clave) : null;
  const medida = elegido.tipo === 'medida' ? roles?.aMedida.find((r) => r.id === elegido.id) : null;
  const original = useMemo(() => (fijo?.permisos || medida?.permisos || {}) as PermissionMap, [fijo, medida]);
  const valores = borrador || original;
  const editable = puedeCambiar && (medida ? true : !!fijo?.editable);
  const sucio = borrador !== null && cambiadas(original, borrador).length > 0;

  // Lo que el catálogo no deja dar a este rol (`nunca`, y `nuncaPrincipal`: quien
  // tiene este rol lo tiene como principal).
  const bloqueadas = useMemo(() => {
    if (!catalogo) return [];
    const rol = fijo?.clave || medida?.base;
    return accionesDe(catalogo)
      .filter((a) => rol && (a.nunca.includes(rol) || (a.nuncaPrincipal || []).includes(rol)))
      .map((a) => a.clave);
  }, [catalogo, fijo, medida]);

  // Lo que quien edita no tiene y el rol tampoco trae: no se lo puede poner
  // (el servidor responde 403 NO_LO_TIENES). Al superadmin, nada.
  const sinTenerlo = useMemo(() => {
    if (!catalogo) return [];
    return accionesDe(catalogo).filter((a) => !can(a.clave) && original[a.clave] !== true).map((a) => a.clave);
  }, [catalogo, can, original]);

  function elegir(e: Elegido) {
    if (sucio && !window.confirm('Hay cambios sin guardar en este rol. ¿Descartarlos?')) return;
    setBorrador(null);
    setElegido(e);
  }

  async function guardar() {
    if (!borrador) return;
    setGuardando(true);
    try {
      if (fijo) await api.guardarRolFijo(fijo.clave, borrador);
      else if (medida) await api.guardarRolAMedida(medida.id, { permisos: borrador });
      toast({ title: 'Permisos guardados', description: 'Queda apuntado en el registro de cambios.' });
      setBorrador(null);
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha guardado', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  }

  async function crear() {
    if (!creando?.nombre.trim()) return;
    try {
      const { id } = await api.crearRolAMedida({ nombre: creando.nombre.trim(), base: creando.base });
      setCreando(null);
      await cargar();
      setBorrador(null);
      setElegido({ tipo: 'medida', id });
      toast({ title: 'Rol creado', description: `Parte de «${creando.base}». Ahora marca lo que cambia.` });
    } catch (e) {
      toast({ title: 'No se ha creado', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  }

  const nombreRol = (k: string) => roles?.fijos.find((r) => r.clave === k)?.nombre || k;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Roles y permisos"
        subtitle="Qué puede hacer cada rol. Lo de una persona suelta, en su ficha de Usuarios."
        actions={puedeCambiar ? (
          <button type="button" onClick={() => setCreando({ nombre: '', base: 'gestor' })}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-normal font-bold text-primary-foreground sm:px-4">
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo rol a medida</span>
          </button>
        ) : null}
      />

      {error && <p className="rounded-lg border border-border bg-destructive-soft p-3 text-normal text-destructive-soft-foreground">{error}</p>}

      {creando && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <h2 className="font-bold">Nuevo rol a medida</h2>
          <p className="text-secundario text-muted-foreground">Parte de un rol fijo y luego cambias solo lo que lo hace distinto.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input autoFocus value={creando.nombre} onChange={(e) => setCreando({ ...creando, nombre: e.target.value })}
              placeholder="Nombre: «Gestora con facturación»" aria-label="Nombre del rol"
              className="h-9 flex-1 rounded-lg border border-border bg-card px-3 text-normal" />
            <select value={creando.base} onChange={(e) => setCreando({ ...creando, base: e.target.value })}
              aria-label="Rol del que parte" className="h-9 rounded-lg border border-border bg-card px-2 text-normal">
              {roles?.fijos.filter((r) => r.editable).map((r) => <option key={r.clave} value={r.clave}>Parte de {r.nombre}</option>)}
            </select>
            <button type="button" onClick={crear} disabled={!creando.nombre.trim()}
              className="h-9 rounded-lg bg-primary px-4 text-normal font-semibold text-primary-foreground disabled:opacity-50">Crear</button>
            <button type="button" onClick={() => setCreando(null)} className="h-9 rounded-lg border border-border px-3 text-normal">Cancelar</button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="space-y-2">
          <h3 className="px-1 text-secundario font-bold uppercase text-muted-foreground">Roles fijos</h3>
          {roles?.fijos.map((r) => (
            <BotonRol key={r.clave} activo={elegido.tipo === 'fijo' && elegido.clave === r.clave}
              onClick={() => elegir({ tipo: 'fijo', clave: r.clave })}
              nombre={r.nombre} detalle={r.descripcion} personas={r.personas} cambiado={r.cambiados.length > 0} fijo />
          ))}
          {roles && roles.aMedida.length > 0 && (
            <>
              <h3 className="px-1 pt-3 text-secundario font-bold uppercase text-muted-foreground">Roles a medida</h3>
              {roles.aMedida.map((r) => (
                <BotonRol key={r.id} activo={elegido.tipo === 'medida' && elegido.id === r.id}
                  onClick={() => elegir({ tipo: 'medida', id: r.id })}
                  nombre={r.nombre} detalle={r.descripcion || `Parte de ${nombreRol(r.base)}`} personas={r.personas}
                  inactivo={!r.activo} />
              ))}
            </>
          )}
        </aside>

        <section className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-4">
          {(fijo || medida) && catalogo ? (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold">{fijo?.nombre || medida?.nombre}</h2>
                  <p className="text-secundario text-muted-foreground">
                    {fijo ? fijo.descripcion : `Rol a medida. Parte de ${nombreRol(medida!.base)}${medida!.activo ? '' : ' · desactivado: no se aplica a nadie'}.`}
                    {' '}{(fijo || medida)!.personas} {(fijo || medida)!.personas === 1 ? 'persona' : 'personas'}.
                  </p>
                </div>
                {!editable && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-secundario font-bold">
                    <Lock size={12} /> {fijo?.clave === 'superadmin' ? 'Lo tiene todo' : 'Solo lectura'}
                  </span>
                )}
                {medida && puedeCambiar && (
                  <button type="button" className="h-8 rounded-lg border border-border px-3 text-secundario font-semibold hover:bg-muted"
                    onClick={async () => { await api.guardarRolAMedida(medida.id, { activo: !medida.activo }); await cargar(); }}>
                    {medida.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </header>

              {/* ISEIE no tiene la pestaña «Vista» del 360 (menú y aterrizaje por rol). */}
                <>
                  <EditorDePermisos
                    catalogo={catalogo}
                    valores={valores}
                    soloLectura={!editable}
                    bloqueadas={bloqueadas}
                    sinTenerlo={sinTenerlo}
                    onCambiar={setBorrador}
                    marca={(k) => ((fijo?.cambiados || medida?.cambiados || []).includes(k)
                      ? <span className="rounded bg-info-soft px-1.5 text-secundario text-info-soft-foreground" title="Distinto de lo que trae de serie">cambiado</span>
                      : null)}
                  />
                  {editable && (
                    <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-border bg-card pt-3">
                      <button type="button" onClick={guardar} disabled={!sucio || guardando}
                        className="h-9 rounded-lg bg-primary px-4 text-normal font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                        {guardando ? 'Guardando…' : 'Guardar'}
                      </button>
                      <button type="button" onClick={() => setBorrador(null)} disabled={!sucio || guardando}
                        className="h-9 rounded-lg border border-border bg-card px-3 text-normal font-medium hover:bg-muted disabled:opacity-50">
                        Descartar
                      </button>
                      {sucio && <span className="text-secundario text-muted-foreground">{cambiadas(original, valores).length} cambios sin guardar</span>}
                    </div>
                  )}
                </>
            </>
          ) : (
            <p className="text-normal text-muted-foreground">{error ? '' : 'Cargando…'}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function BotonRol({ activo, onClick, nombre, detalle, personas, fijo = false, cambiado = false, inactivo = false }: {
  activo: boolean; onClick: () => void; nombre: string; detalle: string; personas: number;
  fijo?: boolean; cambiado?: boolean; inactivo?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-current={activo ? 'true' : undefined}
      className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
        activo ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50', inactivo && 'opacity-60')}>
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <ShieldCheck size={16} weight="bold" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-normal font-semibold">{nombre}</span>
          {fijo && <Lock size={10} className="text-muted-foreground" aria-label="Rol fijo" />}
          {cambiado && <span className="rounded bg-info-soft px-1 text-secundario text-info-soft-foreground">cambiado</span>}
        </span>
        <span className="line-clamp-2 block text-secundario text-muted-foreground">{detalle}</span>
        <span className="mt-0.5 flex items-center gap-1 text-secundario text-muted-foreground">
          <UsersThree size={12} /> {personas}
        </span>
      </span>
    </button>
  );
}
