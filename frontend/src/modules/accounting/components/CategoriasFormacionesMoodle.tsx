import { useState } from 'react';
import { ArrowsClockwise, FloppyDisk } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import { formacionesApi, TIPOS_FORMACION, type CategoriasDelCampus, type TipoFormacion } from '@/modules/products/api/formaciones.api';
import { etiquetaDeCategoria, TIPO_EN_PLURAL } from '@/modules/products/lib/moodleFormacion';

/**
 * Integraciones › Moodle: en qué categoría del Moodle de este campus va el curso de cada
 * tipo de formación cuando se crea desde Productos › Formaciones (CRM#1113 /
 * CRM-ISEIE#767, fase 2). Se guarda en la integración del campus.
 *
 * Cada tipo: «Proponer por el nombre» (la que se llame «Cursos», «Diplomados»,
 * «Másteres»… o, si no hay, la de por defecto), «La de por defecto del Moodle» o una
 * categoría concreta. Leer las categorías solo lee el Moodle.
 */
const PROPONER = '';
const POR_DEFECTO = '0';

export default function CategoriasFormacionesMoodle({ projectId }: { projectId: number }) {
  const [datos, setDatos] = useState<CategoriasDelCampus | null>(null);
  const [elegidas, setElegidas] = useState<Record<TipoFormacion, string>>({ curso: PROPONER, diplomado: PROPONER, master: PROPONER });
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar(refrescar = false) {
    setCargando(true);
    setError(null);
    try {
      const r = await formacionesApi.categoriasDelCampus(projectId, refrescar);
      const d = r.data ?? null;
      setDatos(d);
      if (d) {
        setElegidas({
          curso: d.guardadas.curso === undefined ? PROPONER : String(d.guardadas.curso),
          diplomado: d.guardadas.diplomado === undefined ? PROPONER : String(d.guardadas.diplomado),
          master: d.guardadas.master === undefined ? PROPONER : String(d.guardadas.master),
        });
      }
    } catch (e) {
      setError((e as { data?: { error?: string }; message?: string })?.data?.error || (e as Error).message);
    } finally { setCargando(false); }
  }

  async function guardar() {
    setGuardando(true);
    try {
      const comoId = (v: string) => (v === PROPONER ? null : Number(v));
      await formacionesApi.guardarCategorias(projectId, {
        curso: comoId(elegidas.curso), diplomado: comoId(elegidas.diplomado), master: comoId(elegidas.master),
      });
      toast({ title: 'Categorías guardadas', description: 'Se usarán al crear en Moodle las formaciones de este campus.' });
      await cargar();
    } catch (e) {
      toast({ title: 'No se han podido guardar', description: (e as { data?: { error?: string }; message?: string })?.data?.error || (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  const propuestaDe = (tipo: TipoFormacion) => {
    const p = datos?.propuesta[tipo];
    return p ? `Proponer por el nombre (ahora: ${p.nombre})` : 'Proponer por el nombre (ahora: ninguna encaja, la de por defecto)';
  };

  return (
    <div className="rounded-md border border-border p-3 space-y-2" data-testid="moodle-categorias-formaciones">
      <p className="text-sm font-semibold">Categorías para las formaciones</p>
      <p className="text-xs text-muted-foreground">
        Dónde se crea el curso al pulsar «Crear en Moodle» en Productos › Formaciones. En la ficha de cada formación se puede cambiar antes de crear.
      </p>
      {!datos && (
        <button type="button" onClick={() => cargar()} disabled={cargando}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
          <ArrowsClockwise size={12} weight="bold" aria-hidden="true" /> {cargando ? 'Leyendo el Moodle…' : 'Ver las categorías del Moodle'}
        </button>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      {datos && (
        <>
          {datos.fuente === 'cursos' && (
            <p className="text-xs text-muted-foreground">
              Solo salen las categorías que ya tienen algún curso: el servicio del plugin no tiene <code>core_course_get_categories</code>.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            {TIPOS_FORMACION.map((t) => (
              <div key={t.value}>
                <label htmlFor={`moodle-cat-${t.value}-${projectId}`} className="text-[11px] font-semibold text-muted-foreground mb-1 block">
                  Categoría para {TIPO_EN_PLURAL[t.value]}
                </label>
                <select id={`moodle-cat-${t.value}-${projectId}`} value={elegidas[t.value]} className={inputClass}
                  onChange={(e) => setElegidas((x) => ({ ...x, [t.value]: e.target.value }))}>
                  <option value={PROPONER}>{propuestaDe(t.value)}</option>
                  <option value={POR_DEFECTO}>La de por defecto del Moodle</option>
                  {datos.categorias.map((c) => <option key={c.id} value={String(c.id)}>{etiquetaDeCategoria(c, datos.categorias)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={guardar} disabled={guardando}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
              <FloppyDisk size={12} weight="bold" aria-hidden="true" /> {guardando ? 'Guardando…' : 'Guardar categorías'}
            </button>
            <button type="button" onClick={() => cargar(true)} disabled={cargando}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
              <ArrowsClockwise size={12} weight="bold" aria-hidden="true" /> Volver a leer
            </button>
          </div>
        </>
      )}
    </div>
  );
}
