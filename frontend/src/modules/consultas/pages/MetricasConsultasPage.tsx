import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { consultasApi, haceCuanto, type Metricas, type MediaMediana, type FilaRanking } from '../api/consultas.api';
import ConsultasNav, { useQuienSoy, VistaMiasTodas, mensajeDeError, fechaCorta, useUltimaPeticion } from '../components/ConsultasNav';

/*
  Métricas de las consultas (#189, sección 7 de la especificación). La
  principal es la primera respuesta. Media y mediana: la mediana no se deja
  arrastrar por un caso suelto. Cada tutor ve las suyas; administración ve
  las de su ámbito (selector de arriba) y el ranking de tutores y de campus.
*/

const horas = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toLocaleString('es-ES')} h`);
const dias = (d: number | null) => (d == null ? '—' : `${d.toLocaleString('es-ES')} días`);
const pct = (p: number | null) => (p == null ? '—' : `${p} %`);

function Cifra({ titulo, valor, detalle, destacada }: { titulo: string; valor: string; detalle?: string; destacada?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card px-4 py-3 ${destacada ? 'border-primary' : 'border-border'}`}>
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-xl font-semibold tabular-nums">{valor}</p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

const mm = (m: MediaMediana, f: (n: number | null) => string) => ({ valor: f(m.mediana), detalle: `Mediana · media ${f(m.media)}` });

function Ranking({ titulo, filas }: { titulo: string; filas: FilaRanking[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <h2 className="px-4 py-2 text-sm font-semibold border-b border-border">{titulo}</h2>
      {filas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Sin consultas en estas fechas.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">#</th>
              <th scope="col" className="px-3 py-2 font-semibold">Nombre</th>
              <th scope="col" className="px-3 py-2 font-semibold text-right">Consultas</th>
              <th scope="col" className="px-3 py-2 font-semibold text-right">1.ª respuesta (mediana)</th>
              <th scope="col" className="px-3 py-2 font-semibold text-right">Media</th>
              <th scope="col" className="px-3 py-2 font-semibold text-right">En plazo</th>
              <th scope="col" className="px-3 py-2 font-semibold text-right">Pendientes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filas.map((f, i) => (
              <tr key={f.id}>
                <td className="px-3 py-2 tabular-nums">{i + 1}</td>
                <td className="px-3 py-2 font-semibold">{f.nombre}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.consultas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{horas(f.primeraRespuestaHoras.mediana)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{horas(f.primeraRespuestaHoras.media)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{pct(f.enPlazoPct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{f.pendientes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MetricasConsultasPage() {
  const { esTutor, esAdmin } = useQuienSoy();
  const { activeProject, activeIssuerId } = useProjectContext() as unknown as {
    activeProject: { id?: number | null; nombre?: string } | null; activeIssuerId: number | null;
  };
  const [vista, setVista] = useState<'mias' | 'todas'>(esTutor ? 'mias' : 'todas');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [tutorId, setTutorId] = useState<number | null>(null);
  const [tutores, setTutores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [m, setM] = useState<Metricas | null>(null);
  const [cargando, setCargando] = useState(true);

  const ambito = useMemo(() => ({ projectId: activeIssuerId ? null : activeProject?.id ?? null, issuerId: activeIssuerId }),
    [activeProject?.id, activeIssuerId]);
  const deTodos = vista === 'todas';

  // Los tutores del ámbito, para el filtro.
  useEffect(() => {
    if (!deTodos) return;
    consultasApi.panelDeTutores(ambito)
      .then((r) => setTutores((r.data?.tutores || []).map((t) => ({ id: t.id, nombre: t.nombre }))))
      .catch(() => setTutores([]));
  }, [deTodos, ambito]);

  // Otra empresa o campus arriba: el tutor elegido puede no estar ya en la lista.
  useEffect(() => { setTutorId(null); }, [ambito]);

  const nueva = useUltimaPeticion();
  const cargar = useCallback(async () => {
    const vale = nueva();
    setCargando(true);
    try {
      const f = { desde: desde || undefined, hasta: hasta || undefined, tutorId };
      const r = await consultasApi.metricas(f, deTodos ? ambito : undefined);
      if (!vale()) return;
      if (r.success && r.data) setM(r.data);
    } catch (e) {
      if (!vale()) return;
      // Sin cifras del ámbito anterior debajo de la cabecera nueva.
      setM(null);
      toast({ title: 'No se han podido cargar las métricas', description: mensajeDeError(e), variant: 'destructive' });
    } finally { if (vale()) setCargando(false); }
  }, [desde, hasta, tutorId, deTodos, ambito, nueva]);

  useEffect(() => { cargar(); }, [cargar]);

  const c = m?.consultas;
  const a = m?.alumnos;
  const maxDia = Math.max(1, ...(c?.porDia || []).map((d) => d.n));

  return (
    <div className="space-y-4 pb-8">
      <ConsultasNav />
      <PageHeader title="Métricas"
        subtitle={deTodos
          ? 'Cómo se atienden las consultas en la empresa o el campus elegido arriba.'
          : 'Cómo atiendes tus consultas y a tus alumnos.'} />

      {esTutor && esAdmin && <VistaMiasTodas vista={vista} onChange={(v) => { setVista(v); setTutorId(null); }} textoMias="Las mías" />}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Desde" htmlFor="metricas-desde">
          <input id="metricas-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Hasta" htmlFor="metricas-hasta">
          <input id="metricas-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className={inputClass} />
        </Field>
        {deTodos && (
          <Field label="Tutor">
            <Select<number | null> ariaLabel="Tutor" value={tutorId} onChange={setTutorId} className="w-56"
              options={[{ value: null, label: 'Todos los tutores' }, ...tutores.map((t) => ({ value: t.id, label: t.nombre }))]} />
          </Field>
        )}
      </div>

      {cargando && !m ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : c && a && m ? (
        <>
          <section aria-label="Consultas" className="space-y-2">
            <h2 className="text-sm font-semibold">Consultas</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Cifra destacada titulo="Primera respuesta" {...mm(c.primeraRespuestaHoras, horas)} />
              <Cifra titulo="Resolución (hasta el cierre)" {...mm(c.resolucionHoras, horas)} />
              <Cifra titulo={`En plazo (${m.plazoHoras} h)`} valor={pct(c.enPlazoPct)} detalle={`${c.respondidas} respondidas de ${c.volumen}`} />
              <Cifra titulo="Pendientes" valor={String(c.pendientes.total)}
                detalle={c.pendientes.total ? `Media ${horas(c.pendientes.mediaHoras)} · la más antigua ${horas(c.pendientes.maximaHoras)}` : 'Ninguna esperando'} />
            </div>
          </section>

          <section aria-label="Volumen" className="rounded-lg border border-border bg-card p-4 space-y-2">
            <h2 className="text-sm font-semibold">Volumen: {c.volumen} {c.volumen === 1 ? 'consulta' : 'consultas'}</h2>
            {c.porDia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin consultas en estas fechas.</p>
            ) : (
              <ul className="space-y-1" aria-label="Consultas por día">
                {c.porDia.map((d) => (
                  <li key={d.dia} className="flex items-center gap-2 text-xs">
                    <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fechaCorta(d.dia)}</span>
                    <span className="h-3 rounded bg-primary" style={{ width: `${(d.n / maxDia) * 100}%`, minWidth: '0.25rem' }} aria-hidden="true" />
                    <span className="tabular-nums">{d.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Fuera de plazo" className="rounded-lg border border-border bg-card">
            <h2 className="px-4 py-2 text-sm font-semibold border-b border-border">Fuera de plazo ({c.fueraDePlazo.length})</h2>
            {c.fueraDePlazo.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Todas respondidas a tiempo.</p>
            ) : (
              <ul className="divide-y divide-border">
                {c.fueraDePlazo.map((f) => (
                  <li key={f.id}>
                    <Link to={`/consultas/${f.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-muted/50">
                      <span>
                        <span className="font-semibold">{f.alumno_nombre || 'Alumno sin nombre'}</span>
                        <span className="text-xs text-muted-foreground"> · {f.campus}{deTodos ? ` · ${f.tutor || 'Sin tutor'}` : ''}</span>
                      </span>
                      <span className="text-xs tabular-nums">
                        {f.estado === 'abierta' ? `Sin responder, ${haceCuanto(f.horas)}` : `Respondida a las ${horas(f.horas)}`}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Alumnos" className="space-y-2">
            <h2 className="text-sm font-semibold">Alumnos</h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Cifra titulo="Alumnos activos" valor={String(a.total)} />
              <Cifra titulo="Sin mensajes" valor={String(a.sinMensajes)}
                detalle={a.sinMensajes ? `Llevan de media ${dias(a.sinMensajesDiasMedia)}` : undefined} />
              <Cifra titulo="Contactados" valor={pct(a.contactadosPct)} />
              <Cifra titulo="Hasta el primer contacto" {...mm(a.primerContactoDias, dias)} />
            </div>
            {a.matriculaAproximada && (
              <p className="text-xs text-muted-foreground">
                La fecha de matrícula es aproximada: el día que el CRM vio al alumno en el campus por primera vez.
              </p>
            )}
          </section>

          {deTodos && m.ranking && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Ranking titulo="Ranking de tutores" filas={m.ranking.tutores} />
              <Ranking titulo="Ranking de campus" filas={m.ranking.campus} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
