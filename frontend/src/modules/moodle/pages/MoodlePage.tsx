import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, Books, GraduationCap, Info, PlugsConnected } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import KpiCard from '@/shared/components/ui/KpiCard';
import Card from '@/shared/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';
import { toast } from '@/shared/hooks/useToast';
import { moodleApi, type CampusMoodle, type RespuestaCampus } from '../api/moodle.api';
import ListaDeCampus from '../components/ListaDeCampus';
import CampusPendientes from '../components/CampusPendientes';
import { CursosDelCampus } from './MoodleCampusPage';

/**
 * Moodle › Cursos y alumnos (#335; antes «Conexión › Moodle»).
 *
 * Sigue al selector de campus de arriba (Diego, 25/11: «entro y no me sale nada en el
 * Moodle»; la pantalla no lo miraba):
 *   · con UN campus elegido, sus cursos directamente (o «Este campus no tiene Moodle
 *     conectado», con el enlace a Integraciones › Moodle);
 *   · con «Todos» o una empresa, la lista de campus, con un aviso de que se elija uno.
 */
export default function MoodlePage() {
  const { activeProject, isAllProjects, activeIssuerId } = useProjectContext() as {
    activeProject?: { id?: number | null; nombre?: string; type?: string } | null;
    isAllProjects?: boolean;
    activeIssuerId?: number | null;
  };
  const id = Number(activeProject?.id);
  const unCampus = !isAllProjects && !activeIssuerId && Number.isInteger(id) && id > 0 && id !== TODOS_LOS_PROYECTOS;
  if (unCampus && activeProject?.type === 'ia') {
    return (
      <div className="space-y-6">
        <PageHeader title="Cursos y alumnos" subtitle="El Moodle de cada campus · solo lectura" />
        <Card>
          <EmptyState icon={GraduationCap} title={`${activeProject?.nombre ?? 'Este proyecto'} no es un campus`} description="Las plataformas de IA no tienen Moodle. Elige un campus arriba, o «Todos» para ver la lista." />
        </Card>
      </div>
    );
  }
  // `key`: al cambiar de campus arriba, la pantalla empieza de cero.
  if (unCampus) return <CursosDelCampus key={id} id={id} conVolver={false} />;
  return <TodosLosCampus />;
}

/**
 * Con «Todos» (o una empresa): los campus. Dos bloques, lo que funciona y lo que falta:
 *   · Campus conectados: su estado y sus cursos; cada fila entra al campus.
 *   · Pendientes de conectar: una lista corta, cada uno con su botón «Conectar», que lleva
 *     a la pantalla del campus, donde está el formulario.
 */
function TodosLosCampus() {
  const { user } = useAuth() as { user: { role?: string } | null };
  const [campus, setCampus] = useState<CampusMoodle[] | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const puedeConectar = user?.role === 'superadmin';

  const cargar = useCallback(async (refrescar = false) => {
    setActualizando(true);
    try {
      const r = await moodleApi.campus({ refrescar });
      setCampus((r.data as RespuestaCampus).campus);
    } catch (e) {
      setCampus([]);
      toast({ title: 'No se pudo cargar Moodle', description: (e as Error).message, variant: 'destructive' });
    } finally { setActualizando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const { conectados, pendientes, cifras } = useMemo(() => {
    const con = (campus ?? []).filter((c) => c.configurado);
    return {
      conectados: con,
      pendientes: (campus ?? []).filter((c) => !c.configurado),
      cifras: {
        campus: campus?.length ?? 0,
        activos: con.reduce((n, c) => n + (c.cursos?.activos ?? 0), 0),
        total: con.reduce((n, c) => n + (c.cursos?.total ?? 0), 0),
      },
    };
  }, [campus]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cursos y alumnos"
        subtitle="El Moodle de cada campus · solo lectura"
        actions={(
          <button
            type="button"
            onClick={() => cargar(true)}
            disabled={actualizando}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            <ArrowsClockwise size={15} weight="bold" className={actualizando ? 'animate-spin' : undefined} /> Actualizar
          </button>
        )}
      />

      <p role="note" className="flex items-start gap-2 rounded-lg border border-info/30 bg-info-soft px-4 py-3 text-sm text-info-soft-foreground" data-testid="moodle-elige-campus">
        <Info size={18} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>Estás viendo todos los campus. Elige uno arriba (o pulsa uno de la lista) para ver sus cursos y sus alumnos.</span>
      </p>

      {campus === null ? (
        <SkeletonTable rows={5} columns={4} />
      ) : campus.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No tienes campus asignados" description="Cuando tengas un campus, aquí verás su Moodle." />
      ) : (
        <>
          {/* En el móvil, las tres cifras en una sola fila; las tarjetas grandes, en pantallas más anchas. */}
          <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border bg-card py-3 text-center sm:hidden" data-testid="cifras-movil">
            {[
              ['Conectados', `${conectados.length}/${cifras.campus}`],
              ['Activos', String(cifras.activos)],
              ['En total', String(cifras.total)],
            ].map(([etiqueta, valor]) => (
              <div key={etiqueta} className="px-2">
                <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                <dd className="mt-0.5 text-xl font-bold tabular-nums">{valor}</dd>
              </div>
            ))}
          </dl>
          <div className="hidden gap-4 sm:grid sm:grid-cols-3">
            <KpiCard icon={PlugsConnected} label="Campus con Moodle conectado" value={`${conectados.length} de ${cifras.campus}`} />
            <KpiCard icon={GraduationCap} label="Cursos activos" value={String(cifras.activos)} />
            <KpiCard icon={Books} label="Cursos en total" value={String(cifras.total)} />
          </div>

          <section aria-labelledby="titulo-conectados" className="space-y-3">
            <h2 id="titulo-conectados" className="text-sm font-semibold">Campus conectados</h2>
            <Card padding="none" overflowHidden>
              {conectados.length > 0 ? (
                <ListaDeCampus campus={conectados} />
              ) : (
                <EmptyState
                  icon={PlugsConnected}
                  title="Ningún campus tiene Moodle conectado todavía"
                  description="El Moodle de cada campus se conecta en Integraciones › Moodle (elige el campus arriba) con la dirección del campus y su token."
                />
              )}
            </Card>
          </section>

          {pendientes.length > 0 && (
            <section aria-labelledby="titulo-pendientes" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="titulo-pendientes" className="text-sm font-semibold">Pendientes de conectar <span className="font-normal text-muted-foreground">· {pendientes.length}</span></h2>
                {!puedeConectar && <p className="text-xs text-muted-foreground">Solo un super admin puede conectar un Moodle.</p>}
              </div>
              <Card padding="none" overflowHidden>
                <CampusPendientes campus={pendientes} puedeConectar={puedeConectar} />
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  );
}
