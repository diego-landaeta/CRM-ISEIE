import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowSquareOut, ArrowsClockwise, CheckCircle, Warning } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';
import { EtiquetaEnPruebas } from '@/shared/components/ui/EnPruebas';
import {
  redaccionMoodleApi, type CampusRedaccion, type CursoRedaccion, type EstadoCursoRedaccion,
  type PorQueEsSuyo, type RedaccionEnMoodle as Datos,
} from '../api/campusTutor.api';

/*
  Las tutoras redactoras en Moodle (#1026).

  Para ver sus cursos en «Mi campus» y recibir las dudas del chat del curso, en cada
  campus necesita su cuenta (con el mismo correo que en el CRM, o vinculada a mano) y
  estar matriculada en cada curso que redacta con el rol «Profesor» (`editingteacher`),
  por matrícula manual: así están hoy Yaibeth, Paola y las demás tutoras en todos los
  campus (Diego, #1059: «igual que las tutoras de hoy»). «Profesor sin permiso de
  edición» (`teacher`) no le deja redactar el curso: se marca aparte y no cuenta como
  listo. El CRM no matricula a nadie como profesora: solo mira.

  Dos sitios:
    · la ficha de Tutores (quien gestiona tutores), con el enlace a la página de
      participantes de cada curso para matricularla;
    · «Mi campus» de la propia redactora (`propia`): lo suyo, con el id de su sesión,
      y lo que tiene que pedir a coordinación.

  Va detrás de SOLO_EN_PRUEBAS donde se usa (las rutas tampoco se montan en producción).
*/

type Estado = { texto: string; clase: string };

const VERDE = 'bg-success-soft text-success-soft-foreground';
const AMBAR = 'bg-warning-soft text-warning-soft-foreground';
const ROJO = 'bg-destructive-soft text-destructive-soft-foreground';
const GRIS = 'bg-muted text-muted-foreground';

const ESTADO: Record<EstadoCursoRedaccion, Estado> = {
  profesora: { texto: 'Profesor', clase: VERDE },
  sin_edicion: { texto: 'Profesor sin permiso de edición', clase: AMBAR },
  otro_rol: { texto: 'Matriculada, sin el rol «Profesor»', clase: AMBAR },
  sin_matricula: { texto: 'Sin matricular', clase: ROJO },
  sin_comprobar: { texto: 'Sin comprobar', clase: GRIS },
};

const POR: Record<PorQueEsSuyo, string> = {
  colaboracion: 'colaboración',
  curso_pendiente: 'curso pendiente',
  responsable: 'responsable de desarrollarlo',
};

const porQue = (por: PorQueEsSuyo[]) => por.map((p) => POR[p] || p).join(' y ');

/** Qué hacer en Moodle con el curso, para quien lo puede hacer. */
const accion = (estado: EstadoCursoRedaccion) => (estado === 'sin_matricula' ? 'Matricularla en Moodle' : 'Cambiarle el rol en Moodle');

function Curso({ c, propia }: { c: CursoRedaccion; propia: boolean }) {
  const e = ESTADO[c.estado];
  const falta = c.estado !== 'profesora' && c.estado !== 'sin_comprobar';
  return (
    // Nombre arriba, entero; debajo, el estado y el enlace. En una sola fila el nombre del
    // curso se cortaba en el ancho de la ficha.
    <li className="space-y-1 py-2 text-sm">
      <span className="block min-w-0">
        <span className="block break-words font-medium">
          {c.curso_nombre || `Curso ${c.curso_moodle_id}`}
        </span>
        <span className="block text-xs text-muted-foreground">
          {c.producto}{!c.producto_activo ? ' (desactivado)' : ''} · por {porQue(c.por)}
        </span>
      </span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span>
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${e.clase}`}>{e.texto}</span>
          {c.estado === 'otro_rol' && c.roles.length > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({c.roles.join(', ')})</span>
          )}
        </span>
        <span>
          {/* Ella no se matricula: se lo pide a coordinación (lo dice la cabecera). */}
          {!propia && c.enlace && falta && (
            <a href={c.enlace} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {accion(c.estado)} <ArrowSquareOut size={12} weight="bold" aria-hidden />
              <span className="sr-only">(se abre en otra pestaña)</span>
            </a>
          )}
        </span>
      </span>
    </li>
  );
}

function Campus({ c, propia }: { c: CampusRedaccion; propia: boolean }) {
  const bien = c.problemas.length === 0 && c.cursos.every((k) => k.estado === 'profesora');
  return (
    <div className="rounded-md border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{c.campus}</p>
        {bien ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
            <CheckCircle size={13} weight="fill" aria-hidden /> Todo listo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-warning-soft-foreground">
            <Warning size={13} weight="fill" aria-hidden /> Falta algo
          </span>
        )}
      </div>
      {c.cuenta && (
        <p className="text-xs text-muted-foreground">
          {propia ? 'Tu cuenta' : 'Su cuenta'}: {c.cuenta.nombre || 'sin nombre'} (id {c.cuenta.id})
          {c.cuenta.vinculada ? ' · vinculada en el CRM' : ` · encontrada por ${propia ? 'tu' : 'su'} correo del CRM`}
        </p>
      )}
      {c.problemas.length > 0 && (
        <ul className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground space-y-1">
          {c.problemas.map((p) => (
            <li key={p} className="flex items-start gap-1.5"><Warning size={13} weight="fill" className="mt-0.5 shrink-0" aria-hidden />{p}</li>
          ))}
        </ul>
      )}
      <ul className="divide-y divide-border" aria-label={`Cursos que ${propia ? 'redactas' : 'redacta'} en ${c.campus}`}>
        {c.cursos.map((k) => <Curso key={`${k.product_id}-${k.curso_moodle_id}`} c={k} propia={propia} />)}
      </ul>
    </div>
  );
}

type Props = { tutorId: number; propia?: false } | { tutorId?: undefined; propia: true };

export default function RedaccionEnMoodle(props: Props) {
  const propia = props.propia === true;
  const tutorId = props.propia ? null : props.tutorId;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = tutorId == null ? await redaccionMoodleApi.mia() : await redaccionMoodleApi.ver(tutorId);
      // Solo con la forma que se espera: otra cosa (un servidor sin la ruta, una prueba
      // que contesta [] a todo) rompía la ficha entera con «reading 'length'».
      const d = r.success ? r.data : null;
      setDatos(d && Array.isArray(d.campus) && Array.isArray(d.sin_curso) ? d : null);
    } catch (e: unknown) {
      const x = e as { data?: { error?: string }; message?: string };
      setError(x?.data?.error || x?.message || 'No se ha podido mirar en los campus.');
      setDatos(null);
    } finally {
      setCargando(false);
    }
  }, [tutorId]);

  useEffect(() => { cargar(); }, [cargar]);

  // En la ficha: un tutor que no es redactora y no tiene cursos, nada que enseñar.
  if (!cargando && datos && !datos.es_redactora && datos.campus.length === 0 && datos.sin_curso.length === 0) return null;
  // En «Mi campus», solo la redactora: una tutora que imparte ya tiene sus cursos arriba.
  if (propia && (!datos || !datos.es_redactora)) return null;

  const titulo = propia ? 'redaccion-moodle-mia' : `redaccion-moodle-${tutorId}`;
  const pendientes = datos ? datos.campus.flatMap((c) => c.cursos).filter((k) => k.estado !== 'profesora').length : 0;

  const cuerpo = (
    <>
      {cargando && !datos && <p className="text-sm text-muted-foreground">Mirando en los campus…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {datos && (
        <>
          {datos.campus.length > 0 && (
            datos.lista ? (
              <p className="inline-flex items-center gap-1.5 rounded-md bg-success-soft px-2.5 py-1.5 text-xs font-semibold text-success-soft-foreground">
                <CheckCircle size={14} weight="fill" aria-hidden />
                {propia
                  ? 'Lista: eres «Profesor» en todos los cursos que redactas.'
                  : 'Lista: es «Profesor» en todos sus cursos de los campus que llevas.'}
              </p>
            ) : (
              <p className="inline-flex items-center gap-1.5 rounded-md bg-warning-soft px-2.5 py-1.5 text-xs font-semibold text-warning-soft-foreground">
                <Warning size={14} weight="fill" aria-hidden />
                {pendientes > 0
                  ? `${pendientes} ${pendientes === 1 ? 'curso' : 'cursos'} sin ${propia ? 'tu' : 'su'} rol «Profesor», o con algo que revisar en el campus.`
                  : 'Hay algo que revisar en el campus.'}
              </p>
            )
          )}

          {datos.campus.length === 0 && datos.sin_curso.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {propia ? 'No tienes' : 'No tiene'} cursos todavía. Son {propia ? 'tuyos' : 'suyos'} los productos en los que
              {propia ? ' tienes' : ' tiene'} una colaboración, un curso pendiente asignado o {propia ? 'eres' : 'es'} la
              «Responsable de desarrollarlo».
            </p>
          )}

          {datos.campus.map((c) => <Campus key={c.project_id} c={c} propia={propia} />)}

          {datos.sin_curso.length > 0 && (
            <div className="rounded-md border border-border p-3 text-xs space-y-1">
              <p className="font-semibold text-sm">Sin curso de Moodle unido</p>
              <p className="text-muted-foreground">
                {propia ? (
                  'Coordinación aún no ha unido estos productos a su curso de Moodle: hasta entonces no se puede comprobar.'
                ) : (
                  <>
                    No se puede comprobar hasta que el producto tenga su curso en{' '}
                    <Link to="/products/cursos-moodle" className="font-medium text-primary underline-offset-2 hover:underline">Productos › Cursos de Moodle</Link>.
                  </>
                )}
              </p>
              <ul className="list-disc pl-5">
                {datos.sin_curso.map((p) => (
                  <li key={p.product_id}>{p.producto}{!p.producto_activo ? ' (desactivado)' : ''} · por {porQue(p.por)}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  );

  const volver = (
    <Button variant="outline" size="sm" disabled={cargando} onClick={cargar} className={propia ? 'h-8 text-secundario' : undefined}>
      <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> Volver a mirar
    </Button>
  );

  if (propia) {
    // En «Mi campus», con la forma de las otras tarjetas de la columna («Por desarrollar»).
    return (
      <section aria-labelledby={titulo} aria-busy={cargando} className="rounded-lg border border-border bg-card">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <h2 id={titulo} className="flex flex-wrap items-center gap-2 text-normal font-semibold text-foreground">
            Los cursos que redactas <EtiquetaEnPruebas />
          </h2>
          {volver}
        </div>
        <div className="space-y-3 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            Para verlos aquí y recibir sus dudas, en cada campus necesitas tu cuenta (con tu correo del CRM) y estar
            matriculada en cada curso con el rol «Profesor», como las demás tutoras. Si falta algo, pídeselo a coordinación:
            la matrícula se hace en Moodle.
          </p>
          {cuerpo}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 border-t border-border pt-4 space-y-3" aria-labelledby={titulo} aria-busy={cargando}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titulo} className="flex flex-wrap items-center gap-2 font-bold text-sm">
            Sus cursos en Moodle <EtiquetaEnPruebas />
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Para ver sus cursos en «Mi campus» y recibir las dudas del chat, en cada campus necesita su cuenta (con su correo
            del CRM) y estar matriculada en cada curso que redacta con el rol <strong className="font-semibold">«Profesor»</strong>{' '}
            (<code>editingteacher</code>) por matrícula manual, igual que las demás tutoras. «Profesor sin permiso de edición»
            no le deja redactar. El CRM solo lo comprueba: la matrícula se hace en Moodle, con el enlace de cada curso.
          </p>
        </div>
        {volver}
      </div>
      {cuerpo}
    </section>
  );
}
