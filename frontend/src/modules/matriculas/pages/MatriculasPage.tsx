import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import usePermission from '@/shared/hooks/usePermission';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import BarraFiltros from '@/shared/components/ui/BarraFiltros';
import MatriculasFiltros, { SIN_FILTROS, type Filtros } from '../components/MatriculasFiltros';
import { GraduationCap, Eye, PlugsConnected, Certificate, ChatText, SealCheck, IdentificationCard, Camera, Scroll, Signature, CheckCircle } from '@phosphor-icons/react';
import { ESTADO_LABEL, ESTADO_COLOR, enHoraDeMadrid } from '../lib/estados';
import { toast } from '@/shared/hooks/useToast';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import WebhooksTab from '../components/WebhooksTab';
import MatriculaDetail from '../components/MatriculaDetail';
import { CERTIFEX_PANEL } from '@/shared/lib/certifexPanel';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';

// Certificaciones (Certifex). Diego, 30/09: «meterlo en la parte de matrículas en
// una subsección que sea certificaciones [...] cuando alguien termina la formación,
// en el CRM aprobamos y Certifex emite». Carga aparte: es una pantalla grande y
// solo la abre administración.
const CertifexEmisionesPage = lazy(() => import('@/modules/certifex/pages/CertifexEmisionesPage'));
const CertifexConsultasPage = lazy(() => import('@/modules/certifex/pages/CertifexConsultasPage'));
// Diplomas (#272): lo que el alumno pide desde Moodle y los diplomas emitidos. Misma
// regla que Certificaciones: en desarrollo, solo en pruebas, y solo administración.
const CertifexDiplomasPage = lazy(() => import('@/modules/certifex/pages/CertifexDiplomasPage'));

// Los documentos de una matrícula, con los nombres del contrato de la #198 y en
// el orden de Diego (#199): «DNI por las dos caras, foto, título, firma». Los
// cinco siempre; `dni_dorso` y `foto` faltan hasta que el webhook los reciba.
const DOCUMENTOS = [
  { clave: 'dni_frente', nombre: 'DNI (delante)', Icono: IdentificationCard },
  { clave: 'dni_dorso', nombre: 'DNI (detrás)', Icono: IdentificationCard },
  { clave: 'foto', nombre: 'Foto', Icono: Camera },
  { clave: 'titulo', nombre: 'Título', Icono: Scroll },
  { clave: 'firma', nombre: 'Firma', Icono: Signature },
];

/**
 * Un icono por documento (Diego: «con una marca si ha llegado o un hueco si
 * falta. Pasando el ratón, el nombre del documento»).
 */
function Documentos({ documentos }: { documentos?: Record<string, boolean> }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {DOCUMENTOS.map(({ clave, nombre, Icono }) => {
        const llego = !!documentos?.[clave];
        const texto = `${nombre}: ${llego ? 'recibido' : 'falta'}`;
        return (
          <span key={clave} title={texto} aria-label={texto} role="img"
            className={`relative inline-flex h-6 w-6 items-center justify-center rounded-md border ${llego
              ? 'border-success/30 bg-success-soft text-success-soft-foreground'
              : 'border-dashed border-border text-muted-foreground/60'}`}>
            <Icono size={13} weight={llego ? 'fill' : 'regular'} />
            {llego && (
              <CheckCircle size={11} weight="fill" data-marca="recibido"
                className="absolute -right-1.5 -top-1.5 rounded-full bg-card text-success" />
            )}
          </span>
        );
      })}
    </span>
  );
}

/** La venta, si la hay; si no, «Sin venta» (#199). */
function Venta({ conversionId }: { conversionId?: number | null }) {
  if (!conversionId) return <span className="text-muted-foreground">Sin venta</span>;
  return <Link to={`/ventas/${conversionId}`} className="text-primary underline-offset-2 hover:underline">Ver venta</Link>;
}

export default function MatriculasPage() {
  const { activeProject, activeIssuerId, activeIssuer } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string } | null;
    activeIssuerId: number | null; activeIssuer: { nombre?: string } | null;
  };
  // El listado va por campus, por empresa o con «Todos» (#199: «por empresa y con
  // "Todos los proyectos", como el resto del CRM»). Los webhooks no: se montan
  // para un campus, y sin uno elegido se dice que hay que elegirlo.
  const campusElegido = !activeIssuerId && activeProject?.id && activeProject.id !== TODOS_LOS_PROYECTOS ? activeProject : null;
  const nombreAmbito = activeIssuerId ? (activeIssuer?.nombre || 'esta empresa')
    : campusElegido ? (campusElegido.nombre || 'este campus') : 'todos los campus';
  const { can, tieneRol } = usePermission();
  const [tab, setTab] = useState('list');
  // Certificaciones tiene dirección propia (/matriculas/certificaciones):
  // la campana enlaza ahí y no depende del proyecto elegido, porque Certifex va por
  // campus de Certifex, no por proyecto del CRM.
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Certificaciones y Diplomas (Certifex) se encienden por configuración
  // (VITE_CERTIFEX_PANEL, ver shared/lib/certifexPanel.ts): apagadas en producción
  // mientras no se enlace Certifex; apagadas, la dirección cae en el listado.
  const enCertificaciones = CERTIFEX_PANEL && location.pathname.replace(/\/$/, '').endsWith('/certificaciones');
  const enDiplomas = CERTIFEX_PANEL && location.pathname.replace(/\/$/, '').endsWith('/diplomas');
  const enCertifex = enCertificaciones || enDiplomas;
  // Los mismos roles que la API: emitir es de administración; las consultas de la web
  // las ve también soporte.
  const verEmisiones = tieneRol('superadmin', 'admin') && can('diplomas.view_emisiones');
  const verConsultas = tieneRol('superadmin', 'admin', 'soporte') && can('certifex_consultas.view');
  // Diplomas: administración los maneja; quien tenga `diplomas.view` (#384) los
  // VE, en solo lectura y con sus campus. Quien tenga `diplomas.emit` (Diego,
  // 22/10/2026: «que Dayana pueda emitir») los revisa, aprueba, emite y envía,
  // también con sus campus; rechazar, corregir y revocar siguen siendo de
  // administración. Es la misma regla que la API.
  const emiteDiplomas = verEmisiones || can('diplomas.emit');
  const verDiplomas = emiteDiplomas || can('diplomas.view');
  const diplomasSoloLectura = !emiteDiplomas;
  const diplomasSoloEmitir = emiteDiplomas && !verEmisiones;
  const vistaCert = params.get('vista') === 'consultas' || !verEmisiones ? 'consultas' : 'emisiones';
  const [data, setData] = useState([]);
  const [stats, setStats] = useState<{ total: number; solicitudes: number; pendientes: number; validadas: number; rechazadas: number }>({ total: 0, solicitudes: 0, pendientes: 0, validadas: 0, rechazadas: 0 });
  const [loading, setLoading] = useState(true);
  // Los filtros de Diego (#199): estado, curso, campus y fechas, en el desplegable
  // «Filtros» como en Prospectos; el buscador, arriba.
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS);
  const [search, setSearch] = useState('');
  const [cursos, setCursos] = useState<string[]>([]);
  // Los campus del filtro, los que da el servidor: los del ámbito (con «Todos»
  // del CRM entero, sin los de pruebas, que la lista no enseña).
  const [campusDelServidor, setCampusDelServidor] = useState<Array<{ id: number; nombre?: string }>>([]);
  // De 50 en 50: «Ver más» pide la página siguiente.
  const [pagina, setPagina] = useState(1);
  const [totalDeLaLista, setTotalDeLaLista] = useState(0);
  const [cargandoMas, setCargandoMas] = useState(false);
  const hayFiltros = !!(search.trim() || filtros.estado || filtros.curso || filtros.campusId || filtros.desde || filtros.hasta);
  const quitarFiltros = () => { setFiltros(SIN_FILTROS); setSearch(''); };
  // Los campus entre los que se puede filtrar. Con un campus en la cabecera no hay nada que elegir.
  const campusDelAmbito = campusElegido ? [] : campusDelServidor;
  const [detail, setDetail] = useState(null);

  // El enlace del aviso por correo (#714): /matriculas?matricula=ID abre su
  // ficha. El correo no lleva datos; la ficha, sí, y pide sesión y permiso como siempre.
  const matriculaDelEnlace = params.get('matricula');
  useEffect(() => {
    if (!matriculaDelEnlace || !/^[1-9]\d{0,14}$/.test(matriculaDelEnlace)) return;
    let vivo = true;
    client.get(`/matriculas/${matriculaDelEnlace}`)
      .then((res) => { if (vivo && res?.success && res.data?.id) setDetail(res.data); })
      .catch((err: any) => {
        const e = err?.data?.error;
        const motivo = typeof e === 'string' ? e : (typeof e?.message === 'string' ? e.message : 'Puede que no sea de tus campus.');
        if (vivo) toast({ title: 'No se puede abrir esa solicitud', description: motivo, variant: 'destructive' });
      });
    return () => { vivo = false; };
  }, [matriculaDelEnlace]);
  const cerrarFicha = () => {
    setDetail(null);
    if (params.get('matricula')) {
      const sin = new URLSearchParams(params);
      sin.delete('matricula');
      setParams(sin, { replace: true });
    }
  };
  const [rechazoTarget, setRechazoTarget] = useState(null);

  // Al cambiar la cabecera, el campus filtrado puede dejar de ser de este ámbito.
  useEffect(() => { setFiltros((f) => (f.campusId ? { ...f, campusId: '' } : f)); }, [activeIssuerId, activeProject?.id]);

  /** La lista: la primera página (pantalla nueva) o, con `mas`, la siguiente añadida debajo. */
  const load = useCallback(async (mas = false) => {
    const siguiente = mas === true ? pagina + 1 : 1;
    if (mas === true) setCargandoMas(true); else setLoading(true);
    try {
      const params = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject });
      params.set('page', String(siguiente));
      if (filtros.estado) params.set('estado', filtros.estado);
      if (filtros.curso) params.set('curso', filtros.curso);
      if (filtros.campusId) params.set('campusId', filtros.campusId);
      if (filtros.desde) params.set('desde', filtros.desde);
      if (filtros.hasta) params.set('hasta', filtros.hasta);
      if (search.trim()) params.set('search', search.trim());
      const res = await client.get(`/matriculas?${params}`);
      if (res.success) {
        setData((antes) => (siguiente > 1 ? [...antes, ...(res.data || [])] : (res.data || [])));
        setPagina(siguiente);
        setTotalDeLaLista(Number((res.pagination as { total?: number } | undefined)?.total) || 0);
        setCursos(Array.isArray(res.cursos) ? res.cursos : []);
        setCampusDelServidor(Array.isArray(res.campus) ? res.campus : []);
        const s = (res.stats || {}) as Partial<typeof stats>;
        setStats({ total: s.total ?? 0, solicitudes: s.solicitudes ?? 0, pendientes: s.pendientes ?? 0, validadas: s.validadas ?? 0, rechazadas: s.rechazadas ?? 0 });
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally { setLoading(false); setCargandoMas(false); }
  }, [activeIssuerId, activeProject?.id, filtros, search, pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cada vez que cambian la cabecera, los filtros o la búsqueda, desde la primera página.
  useEffect(() => { load(); }, [activeIssuerId, activeProject?.id, filtros, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // En el móvil la fila de pestañas se desliza y «Diplomas», la última, quedaba fuera de
  // la vista: la activa se trae a la vista al entrar.
  const pestanaDiplomas = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (enDiplomas) pestanaDiplomas.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [enDiplomas]);

  async function handleEstado(m, estado) {
    if (estado === 'rechazada') {
      setRechazoTarget(m);
      return;
    }
    try {
      const res = await client.post(`/matriculas/${m.id}/estado`, { estado, motivo_rechazo: null });
      toast({ title: estado === 'datos_validados' ? 'Datos validados' : 'Matrícula validada' });
      load();
      // La ficha sigue abierta, con el estado nuevo, sus botones y la línea del historial.
      if (detail?.id === m.id && res?.data) setDetail(res.data);
    } catch (err) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  async function confirmRechazo(motivo) {
    if (!rechazoTarget || !motivo) return;
    const m = rechazoTarget;
    setRechazoTarget(null);
    try {
      const res = await client.post(`/matriculas/${m.id}/estado`, { estado: 'rechazada', motivo_rechazo: motivo });
      toast({ title: 'Rechazada' });
      load();
      if (detail?.id === m.id && res?.data) setDetail(res.data);
    } catch (err) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Matrículas"
        subtitle={enDiplomas
          ? 'Diplomas: lo que piden los alumnos al terminar, y los diplomas emitidos, enviados y revocados'
          : enCertificaciones
          ? 'Certificaciones: quien termina la formación se aprueba aquí, y Certifex emite su título'
          : `${stats.total || 0} matrículas en ${campusDelServidor.find((c) => String(c.id) === filtros.campusId)?.nombre || nombreAmbito}`}
      />

      <div className="flex overflow-x-auto border-b border-border [&>button]:shrink-0">
        <button
          onClick={() => { setTab('list'); if (enCertifex) navigate('/matriculas'); }}
          className={`flex items-center gap-2 px-3 h-9 text-sm font-bold border-b-2 focus:outline-none focus:ring-2 focus:ring-primary/40 ${!enCertifex && tab === 'list' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
        >
          <GraduationCap size={14} /> Listado
        </button>
        {/* Los webhooks, como en la API: solo admin y super admin (#198). */}
        {verEmisiones && (
          <button
            onClick={() => { setTab('webhooks'); if (enCertifex) navigate('/matriculas'); }}
            className={`flex items-center gap-2 px-3 h-9 text-sm font-bold border-b-2 focus:outline-none focus:ring-2 focus:ring-primary/40 ${!enCertifex && tab === 'webhooks' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >
            <PlugsConnected size={14} /> <span className="hidden sm:inline">Webhooks de admisión</span><span className="sm:hidden">Webhooks</span>
          </button>
        )}
        {CERTIFEX_PANEL && verConsultas && (
          <button
            onClick={() => navigate('/matriculas/certificaciones')}
            className={`flex items-center gap-2 px-3 h-9 text-sm font-bold border-b-2 focus:outline-none focus:ring-2 focus:ring-primary/40 ${enCertificaciones ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >
            <Certificate size={14} /> Certificaciones
          </button>
        )}
        {CERTIFEX_PANEL && verDiplomas && (
          <button
            ref={pestanaDiplomas}
            aria-current={enDiplomas ? 'page' : undefined}
            onClick={() => navigate('/matriculas/diplomas')}
            className={`flex items-center gap-2 px-3 h-9 text-sm font-bold border-b-2 focus:outline-none focus:ring-2 focus:ring-primary/40 ${enDiplomas ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
          >
            <SealCheck size={14} /> Diplomas
          </button>
        )}
      </div>

      {enDiplomas ? (
        !verDiplomas ? (
          <EmptyState icon={SealCheck} title="Solo administración" description="Los diplomas los aprueba, envía y revoca administración. Para verlos, pide que te den «Diplomas (Certifex) · Ver»." />
        ) : (
          <Suspense fallback={<SkeletonTable rows={5} columns={6} />}>
            <CertifexDiplomasPage soloLectura={diplomasSoloLectura} soloEmitir={diplomasSoloEmitir} />
          </Suspense>
        )
      ) : enCertificaciones ? (
        !verConsultas ? (
          <EmptyState icon={Certificate} title="Solo administración" description="Las certificaciones las aprueba y emite administración." />
        ) : (
          <div className="space-y-4">
            {verEmisiones && (
              <div className="flex items-center gap-1">
                {[
                  { clave: 'emisiones', rotulo: 'Emisiones', icono: Certificate },
                  { clave: 'consultas', rotulo: 'Consultas de la web', icono: ChatText },
                ].map(({ clave, rotulo, icono: Icono }) => (
                  <button
                    key={clave}
                    type="button"
                    aria-pressed={vistaCert === clave}
                    onClick={() => setParams(clave === 'consultas' ? { vista: 'consultas' } : {}, { replace: true })}
                    className={`h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                      vistaCert === clave
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground'}`}
                  >
                    <Icono size={13} /> {rotulo}
                  </button>
                ))}
              </div>
            )}
            <Suspense fallback={<SkeletonTable rows={5} columns={6} />}>
              {vistaCert === 'consultas' ? <CertifexConsultasPage embebida /> : <CertifexEmisionesPage embebida />}
            </Suspense>
          </div>
        )
      ) : tab === 'webhooks' && verEmisiones ? (
        campusElegido?.id ? <WebhooksTab project={{ id: campusElegido.id }} /> : (
          <EmptyState icon={PlugsConnected} title="Elige un campus"
            description="Cada webhook de admisión se conecta al formulario de un campus. Elige uno arriba para ver o crear el suyo." />
        )
      ) : <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
        {[
          { label: 'Total', value: stats.total, color: '#64748b' },
          // Lo que acaba de llegar del formulario de admisión (#199).
          { label: 'Solicitudes', value: stats.solicitudes, color: '#2563eb' },
          { label: 'Pendientes', value: stats.pendientes, color: '#d97706' },
          { label: 'Validadas', value: stats.validadas, color: '#059669' },
          { label: 'Rechazadas', value: stats.rechazadas, color: '#dc2626' },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-xl p-3 border-b-2" style={{ borderBottomColor: k.color }}>
            <p className="text-[11px] font-bold uppercase text-muted-foreground">{k.label}</p>
            <p className="text-xl font-extrabold mt-0.5" style={{ color: k.color }}>{k.value || 0}</p>
          </div>
        ))}
      </div>

      {/* Como en Prospectos: arriba el buscador, «Limpiar» y «Actualizar»; el
          resto de filtros, en el desplegable «Filtros» con sus píldoras. */}
      <BarraFiltros
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por nombre, email o DNI"
        hayFiltros={hayFiltros}
        onLimpiar={quitarFiltros}
        onActualizar={load}
        actualizando={loading}
      />
      <MatriculasFiltros filtros={filtros} onCambio={setFiltros} cursos={cursos} campus={campusDelAmbito} />

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {loading ? <SkeletonTable rows={5} columns={6} /> : data.length === 0 ? (
          // Los textos de Diego (#199): sin filtros, cómo empezar; con filtros,
          // decirlo y dejar quitarlos.
          hayFiltros ? (
            <EmptyState icon={GraduationCap} title="Ninguna matrícula con estos filtros" description={undefined}
              action={(
                <button type="button" onClick={quitarFiltros}
                  className="h-9 px-3 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40">
                  Quitar filtros
                </button>
              )} />
          ) : (
            <EmptyState icon={GraduationCap} title="Aún no ha llegado ninguna solicitud"
              description="Conecta el formulario de admisión en la pestaña Webhooks de admisión." />
          )
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase text-muted-foreground">
                  <tr>
                    {/* Las columnas de Diego (#199): Persona · Curso · Campus · Recibida · Estado · Documentos · Venta */}
                    <th className="text-left px-4 py-2.5 font-bold">Persona</th>
                    <th className="text-left px-4 py-2.5 font-bold">Curso</th>
                    {/* La empresa y el campus de cada solicitud (13/11/2026): con «Todos» o una empresa arriba
                        se mezclan campus de varias, y tiene que verse a quién pertenece cada una. */}
                    <th className="text-left px-4 py-2.5 font-bold">Empresa · campus</th>
                    {/* La gestora de su ficha (13/11/2026: «que se puedan vincular a su gestora»). */}
                    <th className="text-left px-4 py-2.5 font-bold">Gestora</th>
                    <th className="text-left px-4 py-2.5 font-bold">Recibida <span className="font-medium normal-case">(hora de Madrid)</span></th>
                    <th className="text-center px-4 py-2.5 font-bold">Estado</th>
                    <th className="text-left px-4 py-2.5 font-bold">Documentos</th>
                    <th className="text-left px-4 py-2.5 font-bold">Venta</th>
                    <th className="px-4 py-2.5"><span className="sr-only">Ver</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(m => (
                    <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-semibold">{m.lead_nombre || '—'}</div>
                        <div className="text-xs text-muted-foreground">{m.lead_email}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">{m.curso || '—'}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold">{m.empresa_nombre || 'Sin empresa'}</div>
                        <div className="text-muted-foreground">{m.campus_nombre || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {m.gestora_nombre || <span className="text-muted-foreground">Sin gestora</span>}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums whitespace-nowrap">{enHoraDeMadrid(m.recibida_at)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[m.estado]}`}>{ESTADO_LABEL[m.estado]}</span>
                      </td>
                      <td className="px-4 py-3"><Documentos documentos={m.documentos} /></td>
                      <td className="px-4 py-3 text-xs"><Venta conversionId={m.conversion_id} /></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setDetail(m)}
                          aria-label="Ver detalle de matrícula"
                          className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-border">
              {data.map(m => (
                <div key={m.id} className="p-3 flex items-start gap-3 hover:bg-muted/30">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${ESTADO_COLOR[m.estado]}`}>{ESTADO_LABEL[m.estado]}</span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{enHoraDeMadrid(m.recibida_at)}</span>
                    </div>
                    <p className="text-sm font-semibold truncate">{m.lead_nombre || '—'}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.lead_email}</p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {m.curso || 'Sin curso'}{m.campus_nombre ? ` · ${m.campus_nombre}` : ''}{m.empresa_nombre ? ` · ${m.empresa_nombre}` : ''}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">{m.gestora_nombre ? `Gestora: ${m.gestora_nombre}` : 'Sin gestora'}</p>
                    <div className="flex items-center gap-3 text-[11px] pt-0.5">
                      <Documentos documentos={m.documentos} />
                      <Venta conversionId={m.conversion_id} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setDetail(m)}
                      aria-label="Ver detalle de matrícula"
                      className="h-8 w-8 inline-flex items-center justify-center rounded hover:bg-muted text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <Eye size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {/* De 50 en 50: sin esto, con «Todos» las que pasaban de 50 no se veían nunca. */}
            {data.length < totalDeLaLista && (
              <div className="flex justify-center border-t border-border p-3">
                <button type="button" onClick={() => load(true)} disabled={cargandoMas}
                  className="h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/40">
                  {cargandoMas ? 'Cargando…' : `Ver más (${data.length} de ${totalDeLaLista})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      </>}

      {/* Los botones de estado, solo para quien puede usarlos: el servidor deja
          cambiar el estado a admin y super admin (a la gestora le daba 403). La
          clave con el estado vuelve a montar la ficha con lo nuevo tras validar. */}
      {detail && (
        <MatriculaDetail key={`${detail.id}-${detail.estado}`} matricula={detail} onClose={cerrarFicha} onChange={() => load()}
          onEstado={tieneRol('superadmin', 'admin') ? handleEstado : undefined} pausada={!!rechazoTarget}
          puedeAsignar={can('leads.assign')} verFacturas={can('facturas.view')} />
      )}
      <PromptDialog
        open={!!rechazoTarget}
        title="Rechazar matrícula"
        message="Indica el motivo del rechazo para que el solicitante pueda recibirlo."
        placeholder="Ej: documentación incompleta o ilegible…"
        multiline
        confirmLabel="Rechazar"
        onConfirm={confirmRechazo}
        onCancel={() => setRechazoTarget(null)}
      />
    </div>
  );
}
