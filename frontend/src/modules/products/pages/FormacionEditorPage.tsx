import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowSquareOut, ArrowUp, BookOpen, FloppyDisk, GraduationCap, Plus, Trash, UserPlus, Warning,
} from '@phosphor-icons/react';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import usePermission from '@/shared/hooks/usePermission';
import { useCampusDeLaPantalla } from '@/shared/hooks/useCampusDeLaPantalla';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import { hoyEnMadrid } from '@/shared/lib/fechas';
import { tutoresApi } from '@/modules/tutores/api/tutores.api';
import { campusDelRechazo } from '@/modules/tutores/lib/colaboraciones';
import { formacionesApi, HORAS_POR_TIPO, TIPOS_FORMACION, type Formacion, type TipoFormacion } from '../api/formaciones.api';
import {
  datosDeForm, formDesde, moduloVacio, moverModulo, problemaDelForm, sumaDeHoras, type FormacionForm, type ModuloForm,
} from '../lib/formacionForm';
import { RUTA_FORMACIONES, rutaDeFormacion } from '../lib/rutasFormacion';
import LlevarAMoodle from '../components/LlevarAMoodle';
import AlumnosDeFormacion from '../components/AlumnosDeFormacion';

/**
 * La ficha de una formación (CRM-ISEIE#767, gemela de CRM#1113): sus datos, sus módulos y sus tutoras,
 * en una pantalla. Al guardar va todo de una vez (datos y módulos en una
 * transacción). Las tutoras son las colaboraciones de Tutores: se añaden y se
 * quitan aquí mismo: solo la tutora y desde cuándo (sin «% de comisión», Diego
 * 24/11; el % se pone en Tutores); quitar una con comisiones la cierra con fecha de
 * fin, no la borra.
 *
 * Fases siguientes (en la misma pantalla): crear o actualizar su curso de Moodle
 * con una sección por módulo, y su ficha en la web.
 */

const MONEDAS = ['EUR', 'USD', 'MXN', 'COP', 'CLP', 'PEN', 'ARS'];

export default function FormacionEditorPage() {
  const { id: param } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const campusPantalla = useCampusDeLaPantalla();
  const { can } = usePermission();
  const esNueva = param === 'nueva';
  const productId = esNueva ? null : Number(param);
  const campusId = Number(params.get('campus')) || campusPantalla.id || null;

  const [formacion, setFormacion] = useState<Formacion | null>(null);
  const [form, setForm] = useState<FormacionForm>(() => formDesde(null));
  const [cargando, setCargando] = useState(!esNueva);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [cambiado, setCambiado] = useState(false);

  const puedeEditar = esNueva ? can('products.create') : can('products.edit');

  const cargar = useCallback(async () => {
    if (!productId || !campusId) return;
    setCargando(true);
    setError(null);
    try {
      const r = await formacionesApi.ver(productId, campusId);
      setFormacion(r.data ?? null);
      setForm(formDesde(r.data));
      setCambiado(false);
    } catch (e) {
      setError((e as Error).message);
    } finally { setCargando(false); }
  }, [productId, campusId]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = (cambios: Partial<FormacionForm>) => { setForm((f) => ({ ...f, ...cambios })); setCambiado(true); };
  const cambiarModulo = (i: number, cambios: Partial<ModuloForm>) => {
    setForm((f) => ({ ...f, modulos: f.modulos.map((m, j) => (j === i ? { ...m, ...cambios } : m)) }));
    setCambiado(true);
  };

  const problema = problemaDelForm(form);
  const suma = useMemo(() => sumaDeHoras(form.modulos), [form.modulos]);
  const horasDeLaRegla = form.tipo ? HORAS_POR_TIPO[form.tipo] : null;
  const horasEscritas = Number(form.horas) || null;
  const descuadre = horasEscritas && suma > 0 && suma !== horasEscritas;

  async function guardar() {
    if (!campusId || problema) return;
    setGuardando(true);
    try {
      const datos = datosDeForm(form);
      const r = productId
        ? await formacionesApi.guardar(productId, campusId, datos)
        : await formacionesApi.crear(campusId, datos);
      toast({ title: productId ? 'Formación guardada' : 'Formación creada', description: datos.nombre });
      if (!productId && r.data?.id) {
        navigate(rutaDeFormacion(r.data.id, campusId), { replace: true });
        return;
      }
      setFormacion(r.data ?? null);
      setForm(formDesde(r.data));
      setCambiado(false);
    } catch (e) {
      toast({ title: 'No se ha podido guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  if (!campusId) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-sm text-muted-foreground">
          Elige el campus en <Link to={RUTA_FORMACIONES} className="font-semibold underline">Formaciones</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-10 sm:p-6">
      <div className="flex items-center gap-2">
        <Link to={RUTA_FORMACIONES} aria-label="Volver a Formaciones" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card hover:bg-muted">
          <ArrowLeft size={15} aria-hidden="true" />
        </Link>
        <h1 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground sm:text-lg">
          <BookOpen size={20} weight="duotone" aria-hidden="true" className="shrink-0 text-primary" />
          <span className="truncate">{esNueva ? 'Nueva formación' : (formacion?.nombre || 'Formación')}</span>
        </h1>
        {puedeEditar && (
          <button
            type="button" onClick={guardar} disabled={guardando || Boolean(problema) || (!esNueva && !cambiado)}
            title={problema || undefined}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <FloppyDisk size={14} weight="bold" aria-hidden="true" />
            {guardando ? 'Guardando…' : (esNueva ? 'Crear formación' : 'Guardar')}
          </button>
        )}
      </div>

      {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
      {error && <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground" role="alert">{error}</p>}

      {!cargando && !error && (
        <>
          {formacion?.de_la_web && (
            <p className="flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" role="status">
              <Warning size={15} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                Esta formación viene de la web: en cada importación se vuelven a escribir el nombre, el precio y lo que diga la web.
                Los módulos, el tipo y las fechas se quedan. Hasta que el CRM escriba en la web, cambia allí lo que deba durar.
              </span>
            </p>
          )}
          {problema && cambiado && <p className="text-sm text-destructive" role="alert">{problema}</p>}

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Datos</h2>
            <Field label="Nombre" required htmlFor="formacion-nombre">
              <input id="formacion-nombre" value={form.nombre} disabled={!puedeEditar} onChange={(e) => cambiar({ nombre: e.target.value })}
                placeholder="Máster en …" className={inputClass} autoComplete="off" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Tipo" htmlFor="formacion-tipo"
                hint={!formacion?.tipo_formacion && formacion?.tipo_por_nombre ? 'Propuesto por el nombre: se guarda al guardar.' : undefined}>
                <Select<TipoFormacion | ''> id="formacion-tipo" value={form.tipo} disabled={!puedeEditar}
                  onChange={(v) => cambiar({ tipo: v })} placeholder="Sin decir"
                  options={[{ value: '', label: 'Sin decir' }, ...TIPOS_FORMACION]} ariaLabel="Tipo de formación" />
              </Field>
              <Field label="Horas totales" htmlFor="formacion-horas"
                hint={[
                  suma > 0 ? `Los módulos suman ${suma} h.` : null,
                  !form.horas && horasDeLaRegla ? `Vacío: ${horasDeLaRegla} h (la regla del tipo).` : null,
                  formacion?.horas_texto && formacion.horas_totales == null ? `Guardado: «${formacion.horas_texto}».` : null,
                ].filter(Boolean).join(' ') || undefined}>
                <input id="formacion-horas" type="number" min={1} max={5000} inputMode="numeric" value={form.horas} disabled={!puedeEditar}
                  onChange={(e) => cambiar({ horas: e.target.value })} placeholder={horasDeLaRegla ? String(horasDeLaRegla) : ''} className={inputClass} />
              </Field>
              <Field label="Modalidad" htmlFor="formacion-modalidad">
                <input id="formacion-modalidad" value={form.modalidad} disabled={!puedeEditar} onChange={(e) => cambiar({ modalidad: e.target.value })}
                  placeholder="Online" className={inputClass} autoComplete="off" />
              </Field>
            </div>
            {descuadre && (
              <p className="text-xs text-warning-soft-foreground">Las horas totales ({horasEscritas}) no coinciden con la suma de los módulos ({suma}).</p>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Precio" htmlFor="formacion-precio">
                <input id="formacion-precio" type="number" min={0} step="0.01" inputMode="decimal" value={form.precio} disabled={!puedeEditar}
                  onChange={(e) => cambiar({ precio: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Moneda" htmlFor="formacion-moneda">
                <Select<string> id="formacion-moneda" value={form.moneda} disabled={!puedeEditar} onChange={(v) => cambiar({ moneda: v })}
                  options={[...new Set([form.moneda, ...MONEDAS].filter(Boolean))].map((m) => ({ value: m, label: m }))} ariaLabel="Moneda" />
              </Field>
              <Field label="Inicio" htmlFor="formacion-inicio" hint={formacion?.fecha_inicio_texto ? `En la web: «${formacion.fecha_inicio_texto}».` : undefined}>
                <input id="formacion-inicio" type="date" value={form.fecha_inicio} disabled={!puedeEditar}
                  onChange={(e) => cambiar({ fecha_inicio: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Fin" htmlFor="formacion-fin">
                <input id="formacion-fin" type="date" value={form.fecha_fin} min={form.fecha_inicio || undefined} disabled={!puedeEditar}
                  onChange={(e) => cambiar({ fecha_fin: e.target.value })} className={inputClass} />
              </Field>
            </div>
          </section>

          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Módulos</h2>
              <span className="text-xs text-muted-foreground tabular-nums">{form.modulos.length}{suma > 0 ? ` · ${suma} h` : ''}</span>
              {puedeEditar && (
                <button type="button" onClick={() => cambiar({ modulos: [...form.modulos, moduloVacio()] })}
                  className="ml-auto inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-semibold hover:bg-muted">
                  <Plus size={13} weight="bold" aria-hidden="true" /> Añadir módulo
                </button>
              )}
            </div>
            {form.modulos.length === 0 && (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                Sin módulos. Son los que imprime el diploma y, en la fase siguiente, las secciones del curso de Moodle.
              </p>
            )}
            <ol className="space-y-3">
              {form.modulos.map((m, i) => (
                <li key={m.clave} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
                    <input value={m.titulo} disabled={!puedeEditar} onChange={(e) => cambiarModulo(i, { titulo: e.target.value })}
                      placeholder="Título del módulo" aria-label={`Título del módulo ${i + 1}`} className={inputClass} autoComplete="off" />
                    <input type="number" min={0} max={2000} inputMode="numeric" value={m.horas} disabled={!puedeEditar}
                      onChange={(e) => cambiarModulo(i, { horas: e.target.value })} placeholder="Horas" aria-label={`Horas del módulo ${i + 1}`}
                      className={`${inputClass} !w-24 shrink-0`} />
                    {puedeEditar && (
                      <div className="flex shrink-0 items-center">
                        <button type="button" onClick={() => cambiar({ modulos: moverModulo(form.modulos, i, -1) })} disabled={i === 0}
                          aria-label={`Subir el módulo ${i + 1}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40">
                          <ArrowUp size={14} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => cambiar({ modulos: moverModulo(form.modulos, i, 1) })} disabled={i === form.modulos.length - 1}
                          aria-label={`Bajar el módulo ${i + 1}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40">
                          <ArrowDown size={14} aria-hidden="true" />
                        </button>
                        <button type="button" onClick={() => cambiar({ modulos: form.modulos.filter((_, j) => j !== i) })}
                          aria-label={`Quitar el módulo ${i + 1}`} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive-soft">
                          <Trash size={14} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                  <textarea value={m.descripcion} disabled={!puedeEditar} onChange={(e) => cambiarModulo(i, { descripcion: e.target.value })}
                    placeholder="Temario o descripción del módulo" aria-label={`Temario del módulo ${i + 1}`} rows={3}
                    className={`${inputClass} !h-auto py-2`} />
                </li>
              ))}
            </ol>
          </section>

          {formacion && <Tutoras formacion={formacion} campusId={campusId} alCambiar={cargar} />}

          {formacion && campusId && <AlumnosDeFormacion productId={formacion.id} campusId={campusId} />}

          {formacion && (
            <section className="space-y-2 rounded-lg border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <GraduationCap size={16} aria-hidden="true" /> Curso de Moodle
              </h2>
              {formacion.cursos_moodle.length > 0 ? (
                <ul className="text-sm text-foreground">
                  {formacion.cursos_moodle.map((c) => (
                    <li key={c.curso_moodle_id}>
                      {c.url
                        ? <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline">{c.curso_nombre || `Curso ${c.curso_moodle_id}`} <ArrowSquareOut size={12} aria-hidden="true" /></a>
                        : (c.curso_nombre || `Curso ${c.curso_moodle_id}`)}
                      {' '}<span className="text-xs text-muted-foreground">(id {c.curso_moodle_id})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Sin curso de Moodle unido.</p>
              )}
              <LlevarAMoodle formacion={formacion} campusId={campusId} pendiente={cambiado}
                alGuardar={(f) => { setFormacion(f); setForm(formDesde(f)); setCambiado(false); }} />
              <p className="text-xs text-muted-foreground">
                También se une a mano en <Link to="/products/cursos-moodle" className="font-semibold underline">Cursos de Moodle</Link>.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Las tutoras de la formación: las colaboraciones de Tutores. Quien gestiona
 * colaboraciones (`tutores.gestionar`) añade y quita aquí; los demás solo ven.
 */
function Tutoras({ formacion, campusId, alCambiar }: { formacion: Formacion; campusId: number; alCambiar: () => void }) {
  const { can } = usePermission();
  const gestiona = can('tutores.gestionar');
  const [tutores, setTutores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [tutorId, setTutorId] = useState<number | null>(null);
  const [desde, setDesde] = useState(hoyEnMadrid());
  const [enviando, setEnviando] = useState(false);
  const [otroCampus, setOtroCampus] = useState<string | null>(null);
  const [quitando, setQuitando] = useState<{ colaboracion_id: number; nombre: string } | null>(null);

  useEffect(() => {
    if (!gestiona) return;
    tutoresApi.listar(campusId).then((r) => setTutores((r.data ?? []).map((t) => ({ id: t.id, nombre: t.nombre })))).catch(() => setTutores([]));
  }, [gestiona, campusId]);

  const yaEstan = new Set(formacion.tutoras.map((t) => t.tutor_id));
  const opciones = tutores.filter((t) => !yaEstan.has(t.id)).map((t) => ({ value: t.id as number | null, label: t.nombre }));

  async function anadir(anadirAlCampus = false) {
    if (!tutorId) return;
    setEnviando(true);
    try {
      // Sin «% de comisión» (Diego, 24/11: «no va»): solo la tutora y desde cuándo. El %,
      // si hace falta, se pone en Tutores; sin él la colaboración no cobra (0 %).
      await tutoresApi.crearColaboracion({ tutorId, productId: formacion.id, desde, anadirAlCampus });
      toast({ title: 'Tutora añadida', description: tutores.find((t) => t.id === tutorId)?.nombre });
      setTutorId(null); setOtroCampus(null);
      alCambiar();
    } catch (e) {
      // La tutora no está en el campus de la formación: se pregunta, como en Tutores (#384).
      const otro = campusDelRechazo(e);
      if (otro) setOtroCampus(otro.proyecto || 'otro campus');
      else toast({ title: 'No se ha podido añadir', description: (e as Error).message, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  async function quitar() {
    if (!quitando) return;
    setEnviando(true);
    try {
      const r = await tutoresApi.borrarColaboracion(quitando.colaboracion_id);
      toast({ title: r.data?.desactivada ? 'Colaboración cerrada (tenía comisiones)' : 'Tutora quitada', description: quitando.nombre });
      setQuitando(null);
      alCambiar();
    } catch (e) {
      toast({ title: 'No se ha podido quitar', description: (e as Error).message, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Tutoras</h2>
      {formacion.tutoras.length === 0 && <p className="text-sm text-muted-foreground">Sin tutora.</p>}
      {formacion.tutoras.length > 0 && (
        <ul className="divide-y divide-border text-sm">
          {formacion.tutoras.map((t) => (
            <li key={t.colaboracion_id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-foreground">{t.nombre}</span>
              {t.vigente_desde && <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">desde {t.vigente_desde}</span>}
              {gestiona && (
                <button type="button" onClick={() => setQuitando({ colaboracion_id: t.colaboracion_id, nombre: t.nombre })}
                  aria-label={`Quitar a ${t.nombre}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-destructive-soft">
                  <Trash size={13} aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {gestiona && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Tutora" className="min-w-48 flex-1">
            <Select<number | null> value={tutorId} onChange={setTutorId} options={opciones} placeholder="Elegir tutora" ariaLabel="Tutora" />
          </Field>
          <Field label="Desde" className="w-40">
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} aria-label="Desde" className={inputClass} />
          </Field>
          <button type="button" onClick={() => anadir()} disabled={!tutorId || enviando}
            className="inline-flex h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            <UserPlus size={14} aria-hidden="true" /> Añadir
          </button>
        </div>
      )}
      {!gestiona && <p className="text-xs text-muted-foreground">Las tutoras se asignan en Tutores (permiso «Gestionar colaboraciones»).</p>}
      <ConfirmDialog
        open={Boolean(otroCampus)} title="La tutora no está en este campus"
        message={`La formación es de ${otroCampus}. ¿La damos de alta en ese campus y le asignamos la formación?`}
        confirmLabel="Sí, añadirla" onConfirm={() => anadir(true)} onCancel={() => setOtroCampus(null)} loading={enviando}
      />
      <ConfirmDialog
        open={Boolean(quitando)} title="Quitar tutora" tone="destructive"
        message={`¿Quitar a ${quitando?.nombre} de esta formación? Si ya tiene comisiones, la colaboración se cierra con fecha de hoy y no se borra.`}
        confirmLabel="Quitar" onConfirm={quitar} onCancel={() => setQuitando(null)} loading={enviando}
      />
    </section>
  );
}
