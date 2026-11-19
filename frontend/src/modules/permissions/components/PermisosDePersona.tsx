import { useCallback, useEffect, useState } from 'react';
import { ClockCounterClockwise, ShieldCheck, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import * as api from '../api/permissions.api';
import type { Catalogo, FichaDePermisos } from '../api/permissions.api';
import { clavesDeSeccion } from '../lib/permisos';
import ListaDePermisos, { nombreDeRol, type Eleccion } from './ListaDePermisos';

export { textoDeOrigen } from './ListaDePermisos';

/**
 * Los permisos de una persona (#423): todo lo que puede hacer, de dónde le
 * viene cada cosa, y —quien puede— sus excepciones y su rol a medida. Abajo,
 * el historial de cambios.
 *
 * `enLinea` (#694): dentro de la ficha del usuario, sin abrir otro diálogo.
 * Cada cambio se guarda al momento, sin salir de la ficha. Quien no tiene
 * «Permisos de cada persona» (o se mira a sí mismo) la ve en solo lectura.
 */
export default function PermisosDePersona({ userId, onClose, enLinea = false }: { userId: number; onClose?: () => void; enLinea?: boolean }) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [ficha, setFicha] = useState<FichaDePermisos | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const total = catalogo ? catalogo.secciones.flatMap(clavesDeSeccion) : [];
  const rol = (r: string) => (catalogo ? nombreDeRol(catalogo, r) : r);
  const resumen = ficha && (
    <p className="text-secundario text-muted-foreground">
      {[ficha.persona.role, ...ficha.persona.roles_extra].map(rol).join(' + ')}
      {ficha.rolAMedida && ` · rol a medida «${ficha.rolAMedida.nombre}»${ficha.rolAMedida.activo ? '' : ' (desactivado, no se aplica)'}`}
      {' · '}puede {total.filter((k) => ficha.mapa[k]).length} de {total.length}
      {!ficha.puedeEditar && ' · solo lectura'}
    </p>
  );

  const cuerpo = (
    <>
      {error && <p className="rounded-lg bg-destructive-soft p-3 text-normal text-destructive-soft-foreground">{error}</p>}
      {!ficha && !error && <p className="text-normal text-muted-foreground">Cargando…</p>}

      {ficha && catalogo && (
        <>
          {ficha.puedeEditar && (
            <div className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
              <label htmlFor={`rol-a-medida-${userId}`} className="text-normal font-semibold">Rol a medida</label>
              <select id={`rol-a-medida-${userId}`} disabled={ocupado} value={ficha.rolAMedida?.id ?? ''}
                onChange={(e) => cambiarRol(e.target.value ? Number(e.target.value) : null)}
                className="h-9 flex-1 rounded-lg border border-border bg-card px-2 text-normal">
                <option value="">Ninguno: lo de su rol</option>
                {ficha.rolesAMedida.map((r) => <option key={r.id} value={r.id}>{r.nombre} (parte de {rol(r.base)})</option>)}
              </select>
            </div>
          )}

          <ListaDePermisos catalogo={catalogo} mapa={ficha.mapa} origenes={ficha.origenes} excepciones={ficha.excepciones}
            puedeEditar={ficha.puedeEditar} ocupado={ocupado} onElegir={elegir} role={ficha.persona.role} />

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
    </>
  );

  if (enLinea) {
    return (
      <section aria-labelledby={`permisos-titulo-${userId}`} className="space-y-3">
        <div>
          <h3 id={`permisos-titulo-${userId}`} className="flex items-center gap-1.5 text-normal font-semibold">
            <ShieldCheck size={16} weight="bold" /> Permisos
          </h3>
          {resumen}
        </div>
        {cuerpo}
      </section>
    );
  }

  return (
    <Portal>
      {/* Encima de la ficha del usuario (z-70), por eso z-80. */}
      <div className="fixed inset-0 !m-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="permisos-titulo">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-4 shadow-xl sm:p-5">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="permisos-titulo" className="text-lg font-bold">Permisos{ficha ? ` de ${ficha.persona.nombre}` : ''}</h2>
              {resumen}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 hover:bg-muted"><X size={18} /></button>
          </header>
          {cuerpo}
        </div>
      </div>
    </Portal>
  );
}
