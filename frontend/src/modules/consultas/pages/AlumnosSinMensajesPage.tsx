import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowsClockwise, PaperPlaneRight, UserCircleMinus } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Field from '@/shared/components/ui/Field';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import { consultasApi, type AlumnoSinMensajes, type Color } from '../api/consultas.api';
import ConsultasNav, { useQuienSoy, VistaMiasTodas, mensajeDeError, fechaCorta, useUltimaPeticion } from '../components/ConsultasNav';

/*
  «Alumnos sin mensajes» (#189): los alumnos matriculados de cada tutor con los
  que aún no hay ninguna conversación, ni en el campus ni en el CRM. Los más
  antiguos arriba; ámbar desde el día 5 y rojo desde el 7 (decisión 7).
  «Escribir al alumno» manda el mensaje al campus y lo saca de la lista.
*/

const CLASE: Record<Color, string> = {
  verde: 'bg-success-soft text-success-soft-foreground',
  ambar: 'bg-warning-soft text-warning-soft-foreground',
  rojo: 'bg-destructive-soft text-destructive-soft-foreground',
};

export function DiasSinContacto({ a }: { a: Pick<AlumnoSinMensajes, 'dias' | 'color'> }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${CLASE[a.color]}`}>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current" />
      {a.dias === 1 ? '1 día' : `${a.dias} días`}
    </span>
  );
}

function Escribir({ a, onHecho, onCancelar }: { a: AlumnoSinMensajes; onHecho: () => void; onCancelar: () => void }) {
  const [texto, setTexto] = useState('');
  const [falta, setFalta] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const id = `escribir-${a.id}`;

  async function enviar() {
    if (!texto.trim()) { setFalta(true); return; }
    setEnviando(true);
    try {
      const r = await consultasApi.escribirAlAlumno(a.id, texto.trim());
      if (r.data?.enviado) {
        toast({ title: 'Mensaje enviado al campus', description: `${a.alumno_nombre || 'El alumno'} ya no sale en esta lista.` });
      } else {
        toast({ title: 'Guardado, pero no ha llegado al campus', description: r.data?.error || 'Reinténtalo desde la consulta.', variant: 'destructive' });
      }
      onHecho();
    } catch (e) {
      toast({ title: 'No se ha podido enviar', description: mensajeDeError(e), variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <div className="mt-2 space-y-2">
      <Field label="Mensaje al alumno" htmlFor={id} required
        hint="Le llega al campus como un mensaje tuyo y queda como una conversación más en Consultas."
        error={falta ? 'Falta el mensaje: escríbelo en «Mensaje al alumno».' : undefined}>
        <textarea id={id} rows={4} value={texto}
          onChange={(e) => { setTexto(e.target.value); if (e.target.value.trim()) setFalta(false); }}
          className={`${inputClass} h-auto py-2`} />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" onClick={enviar} disabled={enviando}>
          <PaperPlaneRight size={14} weight="bold" className="mr-1.5" /> {enviando ? 'Enviando…' : 'Enviar al campus'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancelar} disabled={enviando}>Cancelar</Button>
      </div>
    </div>
  );
}

export default function AlumnosSinMensajesPage() {
  const { esTutor, esAdmin } = useQuienSoy();
  const { activeProject, activeIssuerId } = useProjectContext() as unknown as {
    activeProject: { id?: number | null; nombre?: string } | null; activeIssuerId: number | null;
  };
  const [vista, setVista] = useState<'mias' | 'todas'>(esTutor ? 'mias' : 'todas');
  const [lista, setLista] = useState<AlumnoSinMensajes[]>([]);
  const [dias, setDias] = useState({ ambar: 5, rojo: 7 });
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [sincronizando, setSincronizando] = useState(false);

  const ambito = useMemo(() => ({ projectId: activeIssuerId ? null : activeProject?.id ?? null, issuerId: activeIssuerId }),
    [activeProject?.id, activeIssuerId]);

  const nueva = useUltimaPeticion();
  const cargar = useCallback(async () => {
    const vale = nueva();
    setCargando(true);
    try {
      const r = await consultasApi.alumnosSinMensajes(vista === 'todas' ? ambito : undefined);
      if (!vale()) return;
      if (r.success && r.data) { setLista(r.data.alumnos); setDias({ ambar: r.data.diasAmbar, rojo: r.data.diasRojo }); }
    } catch (e) {
      if (!vale()) return;
      setLista([]);
      toast({ title: 'No se han podido cargar los alumnos', description: mensajeDeError(e), variant: 'destructive' });
    } finally { if (vale()) setCargando(false); }
  }, [vista, ambito, nueva]);

  useEffect(() => { cargar(); }, [cargar]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await consultasApi.sincronizarAlumnos(ambito);
      const datos = r.data || [];
      const errores = datos.flatMap((x) => x.errores || []);
      if (!datos.length) {
        toast({ title: 'Ningún campus lee consultas', description: 'Márcalo en Finanzas → Integraciones → «Campus (Moodle)» → «Leer las consultas de este campus».' });
      } else if (errores.length) {
        toast({ title: 'Sincronizado, con avisos', description: errores[0], variant: 'destructive' });
      } else {
        const nuevos = datos.reduce((s, x) => s + (x.nuevos || 0), 0);
        toast({ title: nuevos ? `${nuevos} alumno(s) nuevo(s)` : 'Sin alumnos nuevos en el campus' });
      }
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido sincronizar', description: mensajeDeError(e), variant: 'destructive' });
    } finally { setSincronizando(false); }
  }

  const deTodos = vista === 'todas';

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader
        title="Alumnos sin mensajes"
        subtitle={deTodos
          ? 'Alumnos matriculados con los que su tutor aún no ha hablado. Los más antiguos arriba.'
          : 'Tus alumnos matriculados con los que aún no has hablado. Los más antiguos arriba: escríbeles desde aquí.'}
        actions={esAdmin && deTodos ? (
          <Button variant="outline" size="sm" onClick={sincronizar} disabled={sincronizando}>
            <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
          </Button>
        ) : undefined}
      />

      {esTutor && esAdmin && <VistaMiasTodas vista={vista} onChange={setVista} textoMias="Mis alumnos" />}

      <p className="text-xs text-muted-foreground">
        Días sin contacto desde la matrícula: ámbar desde el día {dias.ambar} y rojo desde el {dias.rojo}.
        La lista se actualiza con el campus una vez al día.
      </p>

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : lista.length === 0 ? (
        <EmptyState icon={UserCircleMinus} title="Nadie sin contactar"
          description={deTodos ? 'Todos los alumnos matriculados tienen ya una conversación con su tutor.' : 'Ya has hablado con todos tus alumnos.'} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Alumno</th>
                <th scope="col" className="px-3 py-2 font-semibold">Curso</th>
                <th scope="col" className="px-3 py-2 font-semibold">Proyecto</th>
                {deTodos && <th scope="col" className="px-3 py-2 font-semibold">Tutor</th>}
                <th scope="col" className="px-3 py-2 font-semibold">Matrícula</th>
                <th scope="col" className="px-3 py-2 font-semibold">Sin contacto</th>
                {!deTodos && <th scope="col" className="px-3 py-2"><span className="sr-only">Acción</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lista.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-3 py-2">
                    <span className="font-semibold">{a.alumno_nombre || 'Alumno sin nombre'}</span>
                    {a.alumno_email && <span className="block text-xs text-muted-foreground">{a.alumno_email}</span>}
                    {abierto === a.id && (
                      <Escribir a={a} onCancelar={() => setAbierto(null)} onHecho={() => { setAbierto(null); cargar(); }} />
                    )}
                  </td>
                  <td className="px-3 py-2">{a.curso_nombre || '—'}</td>
                  <td className="px-3 py-2">{a.campus}</td>
                  {deTodos && <td className="px-3 py-2">{a.tutor || '—'}</td>}
                  <td className="px-3 py-2 whitespace-nowrap"
                    title={a.matricula_aproximada ? 'Aproximada: el día que el CRM vio al alumno en el campus por primera vez.' : undefined}>
                    {a.matricula_aproximada ? '≈ ' : ''}{fechaCorta(a.matriculado_desde)}
                  </td>
                  <td className="px-3 py-2"><DiasSinContacto a={a} /></td>
                  {!deTodos && (
                    <td className="px-3 py-2 text-right">
                      {abierto !== a.id && (
                        <Button size="sm" variant="outline" onClick={() => setAbierto(a.id)}>Escribir al alumno</Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!deTodos && lista.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Lo que escribas queda en <Link to="/consultas" className="underline">Consultas</Link> como una conversación más.
        </p>
      )}
    </div>
  );
}
