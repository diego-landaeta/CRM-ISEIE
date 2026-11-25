import { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut, GraduationCap, Warning } from '@phosphor-icons/react';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import { formacionesApi, type Formacion, type VistaPreviaMoodle } from '../api/formaciones.api';
import { nombreDeCategoria, opcionesDeCategoria, problemaDelNombreCorto, textoDelOrigen } from '../lib/moodleFormacion';

/**
 * Fase 2 (CRM#1113 / CRM-ISEIE#767): «Crear en Moodle» / «Actualizar en Moodle».
 *
 * Antes de pulsar se ve qué se va a hacer: crear o actualizar, en qué categoría, con qué
 * nombre corto, oculto o visible y una sección por módulo. Al crear, la categoría y el
 * nombre corto se pueden cambiar aquí (si no, los del campus y la regla). Después, el
 * enlace al curso. Solo sale con el interruptor encendido, el permiso
 * `moodle.crear_cursos` y el Moodle del campus conectado.
 */
export default function LlevarAMoodle({ formacion, campusId, pendiente, alGuardar }: {
  formacion: Formacion; campusId: number; pendiente: boolean; alGuardar: (f: Formacion) => void;
}) {
  const disponible = Boolean(formacion.moodle?.disponible && formacion.moodle.conectado);
  const [vista, setVista] = useState<VistaPreviaMoodle | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoria, setCategoria] = useState(0);
  const [nombreCorto, setNombreCorto] = useState('');
  const [preguntando, setPreguntando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    if (!disponible) return;
    setCargando(true);
    setError(null);
    try {
      const r = await formacionesApi.vistaMoodle(formacion.id, campusId);
      const v = r.data ?? null;
      setVista(v);
      setCategoria(v?.categoria?.id ?? 0);
      setNombreCorto(v?.nombre_corto?.valor ?? '');
    } catch (e) {
      setVista(null);
      setError((e as Error).message);
    } finally { setCargando(false); }
    // La formación guardada cambia de objeto al guardar: se vuelve a mirar.
  }, [disponible, formacion, campusId]);
  useEffect(() => { cargar(); }, [cargar]);

  if (!formacion.moodle?.disponible) return null;
  if (!formacion.moodle.conectado) {
    return <p className="text-xs text-muted-foreground">Este campus no tiene su Moodle conectado: no se puede crear el curso desde aquí.</p>;
  }

  const actualizar = vista ? vista.accion === 'actualizar' : formacion.cursos_moodle.length > 0;
  const sinModulos = formacion.modulos.length === 0;
  const problemaCorto = !actualizar ? problemaDelNombreCorto(nombreCorto) : null;
  const motivo = pendiente ? 'Guarda antes los cambios.'
    : sinModulos ? 'Añade al menos un módulo.'
      : vista?.accion === 'varios' ? 'Está unida a varios cursos: deja uno en «Cursos de Moodle».'
        : problemaCorto;
  const categorias = vista?.categorias ?? [];

  async function llevar() {
    setEnviando(true);
    try {
      const elegido = actualizar ? {} : { categoria, nombre_corto: nombreCorto.trim() || null };
      const r = await formacionesApi.llevarAMoodle(formacion.id, campusId, elegido);
      const c = r.data?.curso;
      toast({
        title: c?.creado ? 'Curso creado en Moodle' : 'Curso actualizado en Moodle',
        description: [
          c?.nombre,
          c?.nombreCorto ? `nombre corto ${c.nombreCorto}` : null,
          c ? `${c.secciones.length} secciones` : null,
          c && !c.visible ? 'oculto a los alumnos' : null,
          c?.sobran ? `${c.sobran} secciones de más sin tocar` : null,
        ].filter(Boolean).join(' · '),
      });
      // Lo que Moodle no ha podido hacer sin fallar (p. ej. sin el plugin «Fecha relativa», CRM#1124).
      for (const aviso of c?.avisos ?? []) toast({ title: 'Aviso de Moodle', description: aviso, variant: 'warning', duration: 10000 });
      setPreguntando(false);
      if (r.data?.formacion) alGuardar(r.data.formacion);
    } catch (e) {
      toast({ title: 'No se ha podido llevar a Moodle', description: (e as Error).message, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 text-sm" data-testid="moodle-vista-previa">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          {actualizar ? 'Qué se va a actualizar en Moodle' : 'Qué se va a crear en Moodle'}
        </p>
        {cargando && <p className="text-xs text-muted-foreground">Mirando el campus…</p>}
        {error && (
          <p className="flex items-center gap-1 text-xs text-destructive" role="alert">
            <Warning size={14} aria-hidden="true" /> {error}
          </p>
        )}
        {vista && (
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            {vista.accion === 'crear' && (
              <>
                <dt className="text-xs font-semibold text-muted-foreground">
                  <label htmlFor={`moodle-categoria-${formacion.id}`}>Categoría</label>
                </dt>
                <dd>
                  <select id={`moodle-categoria-${formacion.id}`} value={categoria} onChange={(e) => setCategoria(Number(e.target.value))}
                    className={inputClass} disabled={enviando}>
                    {opcionesDeCategoria(categorias).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {vista.categoria && categoria === vista.categoria.id && (
                    <p className="mt-1 text-xs text-muted-foreground">De serie: {textoDelOrigen(vista.categoria.origen)}.</p>
                  )}
                  {vista.fuente_categorias === 'cursos' && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Solo salen las categorías que ya tienen algún curso: el servicio del plugin no deja leer el árbol entero.
                    </p>
                  )}
                </dd>
                <dt className="text-xs font-semibold text-muted-foreground">
                  <label htmlFor={`moodle-corto-${formacion.id}`}>Nombre corto</label>
                </dt>
                <dd>
                  <input id={`moodle-corto-${formacion.id}`} value={nombreCorto} onChange={(e) => setNombreCorto(e.target.value)}
                    maxLength={250} className={`${inputClass} font-mono`} disabled={enviando} autoComplete="off" />
                  {vista.nombre_corto && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {vista.nombre_corto.origen === 'sku' ? 'Es el SKU del producto.' : 'Tipo + nombre + año de inicio.'}
                      {vista.nombre_corto.ajustado && ` «${vista.nombre_corto.propuesto}» ya existe en el campus: se propone el siguiente.`}
                      {' '}Si al crear ya existe, se le añade -2, -3…
                    </p>
                  )}
                  {problemaCorto && <p className="mt-1 text-xs text-destructive">{problemaCorto}</p>}
                </dd>
                <dt className="text-xs font-semibold text-muted-foreground">Visibilidad</dt>
                <dd>Oculto a los alumnos: lo publicas tú en Moodle cuando esté listo.</dd>
              </>
            )}
            {vista.accion === 'actualizar' && (
              <>
                <dt className="text-xs font-semibold text-muted-foreground">Curso</dt>
                <dd>
                  {vista.cursos_unidos.map((c) => (
                    <span key={c.id}>
                      {c.url
                        ? <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">{c.nombre || `Curso ${c.id}`} <ArrowSquareOut size={12} aria-hidden="true" /></a>
                        : (c.nombre || `Curso ${c.id}`)}
                    </span>
                  ))}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Se cambian el nombre, las fechas y las secciones. La categoría, el nombre corto y la visibilidad se quedan como estén en Moodle.
                  </p>
                </dd>
              </>
            )}
            {(vista.inicio || vista.fin) && (
              <>
                <dt className="text-xs font-semibold text-muted-foreground">Fechas</dt>
                <dd>{vista.inicio || '—'} → {vista.fin || '—'}</dd>
              </>
            )}
            <dt className="text-xs font-semibold text-muted-foreground">Secciones</dt>
            <dd>
              {vista.secciones.length === 0 ? 'Ninguna: añade módulos.' : (
                <ol className="list-decimal pl-5">
                  {vista.secciones.map((s, i) => (
                    <li key={`${i}-${s}`}>
                      {s}
                      {vista.desbloqueo?.[i] ? <span className="text-xs text-muted-foreground"> · se desbloquea a los {vista.desbloqueo[i]} días</span> : null}
                    </li>
                  ))}
                </ol>
              )}
              {vista.secciones.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Una por módulo, con su temario. Las secciones de más que ya tenga el curso no se borran.</p>}
            </dd>
          </dl>
        )}
        {vista?.aviso && <p className="mt-2 text-xs text-warning-soft-foreground">{vista.aviso}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setPreguntando(true)} disabled={Boolean(motivo) || enviando || cargando} title={motivo || undefined}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
          <GraduationCap size={14} aria-hidden="true" />
          {actualizar ? 'Actualizar en Moodle' : 'Crear en Moodle'}
        </button>
        {motivo && <span className="text-xs text-muted-foreground">{motivo}</span>}
      </div>
      <ConfirmDialog
        open={preguntando}
        title={actualizar ? 'Actualizar el curso en Moodle' : 'Crear el curso en Moodle'}
        message={actualizar
          ? `Se cambian el nombre, las fechas y las secciones del curso unido para que sean los ${formacion.modulos.length} módulos de la formación. Las secciones de más no se borran.`
          : `Se crea el curso «${formacion.nombre}» en ${nombreDeCategoria(categoria, categorias)}, con el nombre corto «${nombreCorto.trim() || vista?.nombre_corto?.valor || ''}» y ${formacion.modulos.length} secciones (una por módulo), oculto a los alumnos, y queda unido a esta formación.`}
        confirmLabel={actualizar ? 'Actualizar' : 'Crear curso'}
        onConfirm={llevar} onCancel={() => setPreguntando(false)} loading={enviando}
      />
    </div>
  );
}
