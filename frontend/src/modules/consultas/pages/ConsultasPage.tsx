import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowsClockwise, ChatCircleText, LockKey, MagnifyingGlass } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import { inputClass } from '@/shared/lib/ui';
import { tieneRol, ROLES_DE_TUTOR } from '@/shared/lib/roles';
import usePermission from '@/shared/hooks/usePermission';
import {
  consultasApi, semaforo, haceCuanto, type ConsultaFila, type FiltrosConsultas, type CampusSinTutor,
} from '../api/consultas.api';
import ConsultasNav from '../components/ConsultasNav';
import CampusSinTutorAviso from '../components/CampusSinTutorAviso';

/*
  Consultas de alumnos (#188).

    · El tutor: su bandeja, las abiertas por antigüedad con el semáforo del
      plazo (verde / ámbar / rojo, 24 h de inicio).
    · Administración: todas las del ámbito de arriba (empresa, campus o todos),
      con filtros, «sin tutor» y «Leer el campus ahora».
*/

type Vista = 'mias' | 'todas';
const PESTANAS: Array<{ clave: NonNullable<FiltrosConsultas['estado']> | 'todas'; texto: string }> = [
  { clave: 'pendientes', texto: 'Pendientes' },
  { clave: 'respondida', texto: 'Respondidas' },
  { clave: 'cerrada', texto: 'Cerradas' },
  { clave: 'todas', texto: 'Todas' },
];

export function Semaforo({ c, plazoHoras }: { c: Pick<ConsultaFila, 'estado' | 'espera_desde' | 'entrada_at'>; plazoHoras: number }) {
  const s = semaforo(c, plazoHoras);
  if (!s) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold bg-muted text-muted-foreground">
        {c.estado === 'respondida' ? 'Respondida' : 'Cerrada'}
      </span>
    );
  }
  const clase = {
    verde: 'bg-success-soft text-success-soft-foreground',
    ambar: 'bg-warning-soft text-warning-soft-foreground',
    rojo: 'bg-destructive-soft text-destructive-soft-foreground',
  }[s.color];
  const texto = { verde: 'En plazo', ambar: 'Cerca del plazo', rojo: 'Fuera de plazo' }[s.color];
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold ${clase}`}
      title={`Espera respuesta desde ${new Date(c.espera_desde || c.entrada_at).toLocaleString('es-ES')} · plazo ${plazoHoras} h`}>
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-current" />
      {texto} · {haceCuanto(s.horas)}
    </span>
  );
}

export default function ConsultasPage() {
  const { user } = useAuth() as { user: { role?: string; roles_extra?: string[] } | null };
  const { activeProject, activeIssuerId } = useProjectContext() as unknown as {
    activeProject: { id?: number | null; nombre?: string } | null; activeIssuerId: number | null;
  };
  // Lo que dice el servidor (#423): sale si salía antes Y tiene el permiso.
  const { can } = usePermission();
  const esTutor = tieneRol(user as never, ...ROLES_DE_TUTOR) && can('consultas.atender');
  // Como el servidor (`veTodoElCrm`): superadmin y soporte cuentan solo como rol
  // principal; admin, también de más. Si no, el botón sale y el servidor da 403.
  const esAdmin = (['superadmin', 'soporte'].includes(user?.role || '') || tieneRol(user as never, 'admin')) && can('consultas.view');
  const sinAcceso = !can('consultas.view') && !can('consultas.atender');
  const [vista, setVista] = useState<Vista>(esTutor ? 'mias' : 'todas');
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]['clave']>('pendientes');
  const [sinTutor, setSinTutor] = useState(false);
  const [buscar, setBuscar] = useState('');
  // Lo que se busca de verdad, un momento después de dejar de escribir.
  const [buscarYa, setBuscarYa] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBuscarYa(buscar.trim()), 300);
    return () => clearTimeout(t);
  }, [buscar]);
  // Solo vale la respuesta de la última petición: una vieja que llegue tarde no pisa la lista.
  const ultima = useRef(0);
  const [lista, setLista] = useState<ConsultaFila[]>([]);
  // Cuántas hay aunque la lista venga recortada (el servidor trae como mucho 200).
  const [total, setTotal] = useState(0);
  const [plazo, setPlazo] = useState(24);
  const [cargando, setCargando] = useState(true);
  const [leyendo, setLeyendo] = useState(false);

  const ambito = useMemo(() => ({ projectId: activeIssuerId ? null : activeProject?.id ?? null, issuerId: activeIssuerId }),
    [activeProject?.id, activeIssuerId]);

  const cargar = useCallback(async () => {
    const yo = ++ultima.current;
    setCargando(true);
    const f: FiltrosConsultas = { estado: pestana === 'todas' ? undefined : pestana, buscar: buscarYa || undefined };
    try {
      const r = vista === 'mias' ? await consultasApi.mias(f) : await consultasApi.panel(ambito, { ...f, sinTutor });
      if (yo !== ultima.current) return;
      if (r.success && r.data) { setLista(r.data.consultas); setTotal(r.data.total ?? r.data.consultas.length); setPlazo(r.data.plazoHoras); }
    } catch (e: unknown) {
      if (yo !== ultima.current) return;
      // Sin datos viejos debajo de la cabecera nueva: si no se ha podido cargar, la lista va vacía.
      setLista([]);
      setTotal(0);
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se han podido cargar las consultas', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { if (yo === ultima.current) setCargando(false); }
  }, [vista, pestana, buscarYa, sinTutor, ambito]);

  useEffect(() => { if (!sinAcceso) cargar(); }, [cargar, sinAcceso]);

  // Campus conectados sin tutor para las consultas (#189): solo administración.
  const [sinTutorCampus, setSinTutorCampus] = useState<CampusSinTutor[]>([]);
  useEffect(() => {
    if (!esAdmin || vista !== 'todas') { setSinTutorCampus([]); return; }
    consultasApi.campusSinTutor(ambito).then((r) => setSinTutorCampus(r.data || [])).catch(() => setSinTutorCampus([]));
  }, [esAdmin, vista, ambito]);

  async function leerAhora() {
    setLeyendo(true);
    try {
      const r = await consultasApi.leerAhora(ambito);
      const datos = r.data || [];
      const nuevos = datos.reduce((s, x) => s + (x.nuevos || 0), 0);
      const errores = datos.flatMap((x) => x.errores || []);
      if (!datos.length) {
        toast({ title: 'Ningún campus lee consultas', description: 'Márcalo en Finanzas → Integraciones → «Campus (Moodle)» → «Leer las consultas de este campus».' });
      } else if (errores.length) {
        toast({ title: 'Leído, con avisos', description: errores[0], variant: 'destructive' });
      } else {
        toast({ title: nuevos ? `${nuevos} mensaje(s) nuevo(s)` : 'Nada nuevo en el campus' });
      }
      await cargar();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido leer el campus', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setLeyendo(false); }
  }

  // Sin ninguno de los dos permisos el servidor da 403: mejor decirlo que
  // enseñar «Nada pendiente», como si no hubiera consultas.
  if (sinAcceso) {
    return (
      <div className="space-y-4 pb-8">
        <PageHeader title="Consultas de alumnos" subtitle="Las dudas que escriben los alumnos en el campus" />
        <div className="bg-card border border-border rounded-lg">
          <EmptyState icon={LockKey} title="No tienes acceso a las consultas de alumnos"
            description="Las atienden los tutores y las ve administración. Si crees que deberías verlas, pídelo a un administrador." />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader
        title="Consultas de alumnos"
        subtitle={vista === 'mias'
          ? 'Las dudas que te escriben tus alumnos en el campus. Responde desde aquí: les llega al campus.'
          : `Todas las consultas de ${activeIssuerId ? 'la empresa elegida' : activeProject?.id && activeProject.id > 0 ? activeProject.nombre : 'tus campus'}.`}
        actions={esAdmin && vista === 'todas' ? (
          <Button variant="outline" size="sm" onClick={leerAhora} disabled={leyendo}>
            <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> {leyendo ? 'Leyendo…' : 'Leer el campus ahora'}
          </Button>
        ) : undefined}
      />

      <CampusSinTutorAviso campus={sinTutorCampus} />

      {esTutor && esAdmin && (
        <div role="tablist" aria-label="Qué consultas" className="inline-flex rounded-md border border-border bg-muted p-0.5">
          {(['mias', 'todas'] as Vista[]).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)}
              className={`h-8 px-3 rounded text-sm font-semibold ${vista === v ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}>
              {v === 'mias' ? 'Mis consultas' : 'Todas'}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Estado" className="flex flex-wrap gap-1">
          {PESTANAS.map((p) => (
            <button key={p.clave} type="button" role="tab" aria-selected={pestana === p.clave} onClick={() => setPestana(p.clave)}
              className={`h-8 px-3 rounded-md text-sm font-semibold border ${pestana === p.clave ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted'}`}>
              {p.texto}
            </button>
          ))}
          {esAdmin && vista === 'todas' && (
            <label className="ml-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" checked={sinTutor} onChange={(e) => setSinTutor(e.target.checked)} /> Solo sin tutor
            </label>
          )}
        </div>
        <div className="relative sm:w-72">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} autoComplete="off"
            placeholder="Buscar alumno, correo o curso" aria-label="Buscar alumno, correo o curso"
            className={`${inputClass} pl-8`} />
        </div>
      </div>

      {cargando ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : lista.length === 0 ? (
        <EmptyState icon={ChatCircleText} title={pestana === 'pendientes' ? 'Nada pendiente' : 'No hay consultas aquí'}
          description={pestana === 'pendientes' ? 'Ningún alumno espera respuesta.' : 'Cambia de pestaña o de filtro.'} />
      ) : (
        <>
        {total > lista.length && (
          <p className="text-xs text-muted-foreground" role="status">
            Se ven {lista.length} de {total}. Para encontrar una que no sale, búscala por el alumno, el correo o el curso.
          </p>
        )}
        <ul className="divide-y divide-border rounded-lg border border-border bg-card" aria-label="Consultas">
          {lista.map((c) => (
            <li key={c.id}>
              <Link to={`/consultas/${c.id}`} className="block px-4 py-3 hover:bg-muted/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-sm">{c.alumno_nombre || 'Alumno sin nombre'}</span>
                  <Semaforo c={c} plazoHoras={plazo} />
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {c.campus}{c.curso_nombre ? ` · ${c.curso_nombre}` : ''}
                  {vista === 'todas' ? ` · ${c.tutor ? `Tutor: ${c.tutor}` : 'Sin tutor'}` : ''}
                  {c.sin_enviar > 0 ? ' · respuesta sin llegar al campus' : ''}
                </p>
                {c.ultimo_mensaje && <p className="mt-1 text-sm text-foreground line-clamp-2">{c.ultimo_mensaje}</p>}
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
    </div>
  );
}
