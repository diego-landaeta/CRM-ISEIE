// Formaciones que ya venden y no tienen tutor.
//
// La pidió Carlos: «dentro del catálogo de formaciones, tiene que existir al
// menos 1 pago / 1 alumno y que no tenga relacionado un tutor».
//
// El filtro de «al menos un pago» es lo que la hace útil. El catálogo tiene
// miles de formaciones y casi ninguna se ha vendido nunca; sin ese corte, esta
// pantalla sería el catálogo entero. Así salen solo las que están generando
// dinero sin que nadie cobre por ellas.
//
// Se cuenta por PAGOS y no por ventas: una venta a plazos con seis cobros lleva
// seis comisiones sin dueño, y eso es lo que mide el agujero de verdad.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, Warning, ArrowRight, MagnifyingGlass, PencilSimple } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { tutoresApi, type AnuncioMeta, type FormacionSinTutor } from '../api/tutores.api';
import DialogoBusquedaTutor from '../components/DialogoBusquedaTutor';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';

const euros = (n: unknown) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

const fecha = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/**
 * La columna META: si se está buscando tutor para esta formación y con qué
 * anuncio.
 *
 * Diego: «necesito la columna de META para saber qué tiene publicidad — eso es
 * publicidad para buscar tutores de los que falten».
 *
 * Cinco respuestas distintas, y ninguna es «vacío»: un hueco en blanco no
 * distingue «no se busca» de «nadie lo ha mirado todavía», que es justo lo que
 * esta columna viene a resolver.
 */
function Meta({ f }: { f: FormacionSinTutor }) {
  const base = 'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap';

  // El anuncio se apuntó y en Meta ya no está: archivado o borrado allí. Se
  // avisa, porque para el CRM «tiene anuncio» y la realidad es que no gasta.
  if (f.anuncio_desaparecido) {
    return (
      <span className={`${base} bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300`}
        title="Se apuntó un anuncio y ya no está en Meta: archivado o borrado allí">
        ya no está en Meta
      </span>
    );
  }

  if (f.anuncio_estado) {
    const activo = f.anuncio_estado === 'ACTIVE';
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`${base} ${activo
          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'}`}
          title={f.anuncio_nombre || ''}>
          {activo ? 'anuncio activo' : 'anuncio pausado'}
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {euros(f.anuncio_gasto)}{f.anuncio_leads ? ` · ${f.anuncio_leads} leads` : ''}
        </span>
      </span>
    );
  }

  if (f.buscando) {
    // «buscando» a secas y no «buscando, sin anuncio».
    //
    // Diego: «no únicamente sin anuncios, luego lo estaremos vinculando por
    // anuncio». Que todavía no haya anuncio enganchado no es un defecto de la
    // búsqueda, es el estado normal al empezar. En el titular parecía que
    // faltaba algo por arreglar cuando lo que falta es tiempo.
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <span className={`${base} bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300`}>
          buscando
        </span>
        <span className="text-[11px] text-muted-foreground">sin anuncio aún</span>
      </span>
    );
  }

  return <span className="text-xs text-muted-foreground">no se busca</span>;
}

export default function FormacionesSinTutorPage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [filas, setFilas] = useState<FormacionSinTutor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busca, setBusca] = useState('');

  // La búsqueda de tutor: qué formación se está editando y los anuncios de Meta
  // para elegir. Los anuncios se piden al abrir el diálogo y no al cargar la
  // pantalla: son cientos y casi nadie los mira.
  const [editando, setEditando] = useState<FormacionSinTutor | null>(null);
  const [anuncios, setAnuncios] = useState<AnuncioMeta[]>([]);
  const [cargandoAnuncios, setCargandoAnuncios] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await tutoresApi.formacionesSinTutor(projectId);
      setFilas(r.success ? (r.data || []) : []);
      if (!r.success) toast({ title: 'No se pudo cargar', description: r.error || '', variant: 'destructive' });
    } catch (e) {
      toast({ title: 'No se pudo cargar', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirBusqueda = useCallback(async (f: FormacionSinTutor) => {
    setEditando(f);
    // Una vez por sesión: la lista de Meta no cambia mientras se decide.
    if (anuncios.length) return;
    setCargandoAnuncios(true);
    try {
      const r = await tutoresApi.anunciosDeTutores(projectId);
      setAnuncios(r.success ? (r.data || []) : []);
    } catch {
      // Que no haya anuncios NO impide marcar que se busca tutor: el diálogo lo
      // dice y sigue funcionando.
      setAnuncios([]);
    } finally { setCargandoAnuncios(false); }
  }, [anuncios.length, projectId]);

  const guardarBusqueda = useCallback(async (
    d: { buscando: boolean; adsetId: string | null; nota: string | null }
  ) => {
    if (!editando) return;
    setGuardando(true);
    try {
      const r = await tutoresApi.marcarBusquedaTutor(editando.id, d);
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
      setEditando(null);
      await cargar();
      toast({
        title: d.buscando ? 'Se busca tutor' : 'Ya no se busca tutor',
        description: editando.nombre,
      });
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }, [editando, cargar]);

  const vistas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? filas.filter((f) => f.nombre.toLowerCase().includes(q)) : filas;
  }, [filas, busca]);

  const total = useMemo(() => ({
    cobrado: filas.reduce((s, f) => s + Number(f.cobrado), 0),
    pagos: filas.reduce((s, f) => s + f.pagos, 0),
    alumnos: filas.reduce((s, f) => s + f.alumnos, 0),
  }), [filas]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Formaciones sin tutor"
        subtitle="Ya han vendido desde que las comisiones aplican, y no tienen a quien pagarle"
      />

      {/* El titular, antes de la lista: es la cifra que decide si esto urge. */}
      {!cargando && filas.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
          <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 text-sm">
            <Warning size={16} weight="fill" />
            {euros(total.cobrado)} cobrados en {filas.length}{' '}
            {filas.length === 1 ? 'formación' : 'formaciones'} sin tutor
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
            {total.pagos} {total.pagos === 1 ? 'cobro' : 'cobros'} de {total.alumnos}{' '}
            {total.alumnos === 1 ? 'alumno' : 'alumnos'}. Nadie cobra comisión por ellos.
            Se arregla asignándole un tutor a cada formación.
            {' '}Solo se cuentan los cobros desde que las comisiones aplican: los de antes
            pudieron tener tutor entonces.
          </p>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">
            {cargando ? 'cargando…' : `${vistas.length} ${vistas.length === 1 ? 'formación' : 'formaciones'}`}
          </span>
          <div className="relative ml-auto min-w-[200px]">
            <MagnifyingGlass size={14} weight="bold"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar formación…"
              className="w-full h-8 pl-8 pr-3 rounded-md border border-border bg-background text-sm" />
          </div>
        </div>

        {!cargando && filas.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Todas tienen tutor"
            description="Ninguna formación con ventas se ha quedado sin tutor asignado. Cuando entre un cobro de una que no lo tenga, aparecerá aquí." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Formación</th>
                  <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Proyecto</th>
                  <th className="text-right font-medium px-4 py-2">Alumnos</th>
                  <th className="text-right font-medium px-4 py-2">Cobros</th>
                  <th className="text-right font-medium px-4 py-2">Cobrado</th>
                  <th className="text-left font-medium px-4 py-2 hidden lg:table-cell">Último</th>
                  {/* Se llama META porque es como lo llama quien la pidió, pero
                      dice más que Meta: también cuando se busca sin anuncio. */}
                  <th className="text-left font-medium px-4 py-2">META</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {vistas.map((f) => (
                  <tr key={f.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{f.nombre}</span>
                      {f.precio ? (
                        <span className="block text-xs text-muted-foreground">
                          catálogo {euros(f.precio)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">
                      {f.proyecto || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{f.alumnos}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{f.pagos}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {euros(f.cobrado)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                      {fecha(f.ultimo_cobro)}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Toda la celda abre el diálogo: el estado y el sitio
                          donde se cambia son la misma cosa. */}
                      {/* Se pulsaba la celda entera, pero nada decia que fuera
                          pulsable: parecia texto. Ahora es un boton con su
                          borde y su lapiz. */}
                      <button type="button" onClick={() => abrirBusqueda(f)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-muted hover:border-foreground/30 transition-colors"
                        title="Decir si se busca tutor y con qué anuncio">
                        <Meta f={f} />
                        <PencilSimple size={12} weight="bold" className="text-muted-foreground shrink-0" />
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {/* Lleva a Tutores, que es donde se asigna. La formación va
                          en la dirección para no tener que buscarla otra vez. */}
                      <button type="button"
                        onClick={() => navigate(`/tutores?formacion=${f.id}`)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline whitespace-nowrap">
                        Asignar tutor <ArrowRight size={12} weight="bold" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editando && (
        <DialogoBusquedaTutor
          formacion={editando}
          anuncios={anuncios}
          cargandoAnuncios={cargandoAnuncios}
          guardando={guardando}
          onGuardar={guardarBusqueda}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
}
