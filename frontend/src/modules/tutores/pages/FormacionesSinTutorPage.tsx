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
import { GraduationCap, Warning, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { tutoresApi, type FormacionSinTutor } from '../api/tutores.api';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';

const euros = (n: unknown) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));

const fecha = (d: unknown) =>
  d ? new Date(String(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function FormacionesSinTutorPage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [filas, setFilas] = useState<FormacionSinTutor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busca, setBusca] = useState('');

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
    </div>
  );
}
