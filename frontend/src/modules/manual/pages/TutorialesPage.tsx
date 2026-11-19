import { Link } from 'react-router-dom';
import { BookOpen, CaretRight, Compass, GraduationCap } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import usePermission from '@/shared/hooks/usePermission';
import { tienePermiso } from '@/shared/lib/recorridosCobros';
import { TEMAS, TUTORIALES, type Tema } from '../tutoriales/tutoriales';

/**
 * Ayuda › Tutoriales (Diego, 18/11): la lista, por tema. Cada persona ve solo los
 * tutoriales de su permiso: la gestora, los del día a día; los de configuración,
 * quien ve o configura integraciones o los links de pago.
 */
export default function TutorialesPage() {
  const { can } = usePermission();
  const visibles = TUTORIALES.filter((t) => tienePermiso(t.permiso, can));
  const temas = (Object.keys(TEMAS) as Tema[])
    .map((tema) => ({ tema, lista: visibles.filter((t) => t.tema === tema) }))
    .filter((g) => g.lista.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-12">
      <PageHeader
        title="Tutoriales"
        subtitle="Ayuda paso a paso, con capturas. Solo ves los que tocan a tu trabajo."
        breadcrumbs={<span className="text-xs text-muted-foreground">Ayuda › Tutoriales</span>}
        actions={(
          <Link
            to="/manual"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted"
          >
            <BookOpen size={14} weight="bold" aria-hidden="true" /> Manual del CRM
          </Link>
        )}
      />

      {temas.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center shadow-sm">
          <GraduationCap size={28} weight="duotone" className="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">No hay tutoriales para tu usuario</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Los tutoriales salen según tus permisos. El manual de usuario sí lo tienes:{' '}
            <Link to="/manual" className="font-medium text-primary underline underline-offset-2">ábrelo aquí</Link>.
          </p>
        </div>
      )}

      {temas.map(({ tema, lista }) => (
        <section key={tema} aria-labelledby={`tema-${tema}`} data-tema={tema}>
          <h2 id={`tema-${tema}`} className="text-lg font-bold tracking-tight text-foreground">{TEMAS[tema].titulo}</h2>
          <p className="mb-3 mt-0.5 text-sm text-muted-foreground">{TEMAS[tema].resumen}</p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {lista.map((t) => (
              <li key={t.id}>
                <Link
                  to={`/manual/tutoriales/${t.id}`}
                  data-tutorial={t.id}
                  className="group flex h-full items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold tracking-tight text-foreground group-hover:text-primary">{t.titulo}</span>
                    <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">{t.resumen}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">{t.para}</span>
                      {t.recorridos?.length ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                          <Compass size={11} weight="bold" aria-hidden="true" /> Con recorrido guiado
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <CaretRight size={14} className="mt-1 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
