import { useEffect, useMemo, useState } from 'react';
import { UsersThree } from '@phosphor-icons/react';
import Casilla from '@/shared/components/ui/Casilla';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { guardarEquipoComercial, leerEquipoComercial, type EquipoComercial as Equipo } from '../api/equipoComercial.api';

/**
 * «Equipo comercial a su cargo», en la ficha de una persona (Carlos, 09/11/2026).
 *
 * Las gestoras que marques aquí son las que esta persona ve además de lo suyo:
 * sus prospectos, sus ventas y su gestión. Sin ninguna, ve como siempre (una
 * administradora, todo su campus).
 *
 * Se ve si ya lleva a alguien o si quien mira puede cambiarlo
 * (`equipos.gestionar`); sin ese permiso, solo se lee. Va aparte de la ficha a
 * propósito: así engancharla es una línea.
 */
export default function EquipoComercial({ userId }: { userId: number }) {
  const { can } = usePermission();
  const puedeCambiar = can('equipos.gestionar');
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [marcadas, setMarcadas] = useState<number[]>([]);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    leerEquipoComercial(userId)
      .then((e) => {
        if (!vivo || !e || !Array.isArray(e.gestoraIds)) return;
        setEquipo(e);
        setMarcadas(e.gestoraIds);
      })
      .catch(() => { /* sin permiso para verlo o sin la migración: no se pinta */ });
    return () => { vivo = false; };
  }, [userId]);

  // Las que ya lleva y ya no podrían entrar (desactivada, otro campus…) se
  // siguen enseñando, marcadas, para poder quitarlas.
  const opciones = useMemo(() => {
    if (!equipo) return [];
    const candidatas = equipo.candidatas || [];
    const ids = new Set(candidatas.map((c) => c.id));
    const sueltas = (equipo.gestoras || []).filter((g) => !ids.has(g.id))
      .map((g) => ({ id: g.id, nombre: g.nombre, role: g.role || '', campus: [] as string[], fuera: true }));
    return [...candidatas.map((c) => ({ ...c, fuera: false })), ...sueltas];
  }, [equipo]);

  if (!equipo) return null;
  if (!puedeCambiar && equipo.gestoraIds.length === 0) return null;

  const cambiado = [...marcadas].sort().join(',') !== [...equipo.gestoraIds].sort().join(',');

  function alternar(id: number, marcar: boolean) {
    setMarcadas((prev) => (marcar ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  async function guardar() {
    setGuardando(true);
    try {
      const nuevo = await guardarEquipoComercial(userId, marcadas);
      if (nuevo) { setEquipo(nuevo); setMarcadas(nuevo.gestoraIds); }
      toast({
        title: 'Equipo guardado',
        description: marcadas.length
          ? `Desde ahora ve lo de ${marcadas.length === 1 ? 'esa gestora' : `esas ${marcadas.length} gestoras`}, además de lo suyo.`
          : 'Ya no lleva a nadie: ve como siempre.',
      });
    } catch (err) {
      toast({ title: 'No se ha guardado', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section aria-labelledby={`equipo-comercial-${userId}`} className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <UsersThree size={16} weight="bold" className="mt-0.5 flex-shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h3 id={`equipo-comercial-${userId}`} className="text-sm">Equipo comercial a su cargo</h3>
          <p className="text-xs text-muted-foreground">
            Ve los prospectos, las ventas y la gestión de las gestoras marcadas, además de lo suyo.
            Sin ninguna, ve como siempre.
          </p>
        </div>
      </div>

      {!puedeCambiar ? (
        <ul className="text-sm space-y-0.5 pl-6">
          {(equipo.gestoras || []).map((g) => (
            <li key={g.id}>{g.nombre}{g.active === false ? ' (desactivada)' : ''}</li>
          ))}
        </ul>
      ) : opciones.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-6">
          No hay gestoras en sus campus. Primero, dale los campus en «Proyectos asignados».
        </p>
      ) : (
        <>
          <div className="max-h-56 overflow-y-auto space-y-1.5 pl-6 pr-1">
            {opciones.map((o) => (
              <Casilla
                key={o.id}
                id={`equipo-${userId}-${o.id}`}
                marcada={marcadas.includes(o.id)}
                onCambiar={(v) => alternar(o.id, v)}
                deshabilitada={guardando}
                etiqueta={o.nombre}
                descripcion={o.fuera ? 'Ya no puede estar en su equipo: desmárcala y guarda.' : o.campus.join(', ')}
              />
            ))}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !cambiado}
              className="h-8 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar equipo'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
