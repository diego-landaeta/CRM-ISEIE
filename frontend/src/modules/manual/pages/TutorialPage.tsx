import { useEffect } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { Compass, LockKey } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import usePermission from '@/shared/hooks/usePermission';
import { RECORRIDOS_COBROS, pedirRecorrido, tienePermiso } from '@/shared/lib/recorridosCobros';
import TextoTutorial from '../tutoriales/TextoTutorial';
import { TEMAS, tutorialPorId, type RecorridoDelTutorial } from '../tutoriales/tutoriales';
import { CAPTURAS_POR_NOMBRE, textoDe } from '../tutoriales/contenido';

/** «Ayuda › Tutoriales › tema», con la vuelta a la lista (la cabecera es la misma en los dos CRM). */
function Migas({ tema }: { tema?: string }) {
  return (
    <span className="text-xs text-muted-foreground">
      Ayuda ›{' '}
      <Link to="/manual/tutoriales" className="font-medium text-primary hover:underline">Tutoriales</Link>
      {tema ? ` › ${tema}` : ''}
    </span>
  );
}

/**
 * Un tutorial de Ayuda › Tutoriales (Diego, 18/11). Sin su permiso no se abre,
 * tampoco escribiendo la dirección. «Ver recorrido» lleva a la pantalla que
 * explica y abre allí su recorrido guiado.
 */
export default function TutorialPage() {
  const { id } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { can } = usePermission();
  const tutorial = tutorialPorId(id);
  const md = tutorial ? textoDe(tutorial.id) : undefined;
  const permitido = !!tutorial && !!md && tienePermiso(tutorial.permiso, can);

  // Un enlace a un apartado (#errores): bajar hasta él cuando ya está pintado.
  useEffect(() => {
    if (!permitido || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [permitido, hash, id]);

  if (!permitido || !tutorial || !md) {
    return (
      <div className="mx-auto max-w-3xl pb-12">
        <PageHeader title="Tutorial" breadcrumbs={<Migas />} />
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm" role="status">
          <LockKey size={28} weight="duotone" className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">Este tutorial no está disponible para tu usuario</p>
          <p className="mt-1 text-sm text-muted-foreground">
            No existe o es de una parte del CRM que no usas.{' '}
            <Link to="/manual/tutoriales" className="font-medium text-primary underline underline-offset-2">Ver tus tutoriales</Link>
          </p>
        </div>
      </div>
    );
  }

  const recorridos = (tutorial.recorridos || []).filter((r) => tienePermiso(RECORRIDOS_COBROS[r.id]?.permiso, can));
  const verRecorrido = (r: RecorridoDelTutorial) => {
    pedirRecorrido(r.id);
    navigate(r.ruta);
  };

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <PageHeader
        title={tutorial.titulo}
        subtitle={tutorial.resumen}
        breadcrumbs={<Migas tema={TEMAS[tutorial.tema].titulo} />}
      />

      <p className="mb-4 inline-flex rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
        Para: {tutorial.para}
      </p>

      {recorridos.length > 0 && (
        <div className="mb-6 rounded-lg border border-border bg-card p-4 shadow-sm" data-recorridos-del-tutorial>
          <p className="text-sm font-semibold text-foreground">Verlo en la pantalla</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Un recorrido guiado te lleva a la pantalla y te señala cada cosa, paso a paso.
          </p>
          <ul className="mt-3 space-y-2">
            {recorridos.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => verRecorrido(r)}
                  data-ver-recorrido-tutorial={r.id}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
                >
                  <Compass size={14} weight="bold" aria-hidden="true" />
                  Ver recorrido{recorridos.length > 1 ? `: ${RECORRIDOS_COBROS[r.id].titulo.toLowerCase()}` : ''}
                </button>
                {r.alLlegar && <span className="text-[12px] text-muted-foreground">{r.alLlegar}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <article className="rounded-lg border border-border bg-card p-5 shadow-sm sm:p-8">
        <TextoTutorial md={md} imagenes={CAPTURAS_POR_NOMBRE} />
      </article>
    </div>
  );
}
