import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Plus, X, Warning, Trash, CheckCircle, Copy, ArrowsClockwise } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import BuscadorCurso from '../components/BuscadorCurso';
import { tutoresApi, type Tutor, type Colaboracion, type AjustesTutores } from '../api/tutores.api';

// Tutores y sus colaboraciones.
//
// Una lista a la izquierda y, al elegir a alguien, sus formaciones con el
// porcentaje y las fechas. La fecha importa tanto como el porcentaje: cada
// tutor cobra desde el dia que empezo, no desde que se creo el modulo.

interface Formacion { id: number; nombre: string; precio: string }

// Un curso tal como se asigna en el alta: cada uno con SU fecha. No es un
// detalle: un tutor puede llevar Logopedia desde marzo y haber cogido Disfagia
// en septiembre, y cobrar de los dos desde el mismo dia le regala meses.
interface CursoDelAlta { productId: number; pct: number; desde: string }

const hoy = () => new Date().toISOString().slice(0, 10);
const soloFecha = (f: string | null) => (f ? String(f).slice(0, 10) : null);

const enCastellano = (f: string) => {
  const [a, m, d] = f.split('-');
  return d && m && a ? `${d}/${m}/${a}` : f;
};

// Contraseña legible para dictarla por telefono: sin l/1/O/0, que al oido son
// la misma letra y acaban en una llamada de vuelta.
function generarContrasena() {
  const letras = 'abcdefghijkmnpqrstuvwxyz';
  const mayus = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numeros = '23456789';
  const de = (s: string, n: number) => Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  return `${de(mayus, 1)}${de(letras, 5)}${de(numeros, 3)}`;
}

export default function TutoresPage() {
  const { user } = useAuth() as { user: { role?: string; gestor_colaboraciones?: boolean } | null };
  const { activeProject, projects } = useProjectContext() as {
    activeProject: { id: number } | null;
    projects: Array<{ id: number; nombre: string }>;
  };
  const puede = ['admin', 'superadmin'].includes(user?.role || '') || user?.gestor_colaboraciones === true;
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [tutores, setTutores] = useState<Tutor[]>([]);
  const [elegido, setElegido] = useState<Tutor | null>(null);
  const [colabs, setColabs] = useState<Colaboracion[]>([]);
  const [formaciones, setFormaciones] = useState<Formacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [popupAlta, setPopupAlta] = useState(false);
  const [popupColab, setPopupColab] = useState(false);
  const [cursoColab, setCursoColab] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState<number | null>(null);
  // Cursos que se le asignan EN EL ALTA. Crear al tutor y luego entrar a
  // añadirle cursos son dos pasos para una sola decision: cuando das de alta a
  // alguien ya sabes que imparte.
  const [cursosAlta, setCursosAlta] = useState<CursoDelAlta[]>([]);
  // La fila de "añadir curso", en estado y no leyendo el DOM a mano.
  const [nuevoCurso, setNuevoCurso] = useState('');
  const [nuevoPct, setNuevoPct] = useState('10');
  const [nuevaFecha, setNuevaFecha] = useState(hoy());
  const [ajustes, setAjustes] = useState<AjustesTutores | null>(null);
  const [contrasena, setContrasena] = useState('');
  const [copiada, setCopiada] = useState(false);
  // En que marcas da clase. Un profesor puede estar en varias —Filtracion en
  // ICTESS y Logopedia en Fono Aprende— y solo puede cobrar de cursos de las
  // marcas en las que este dado de alta.
  const [marcas, setMarcas] = useState<number[]>([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await tutoresApi.listar(projectId);
      setTutores(r.success ? (r.data || []) : []);
    } finally { setCargando(false); }
  }, [projectId]);

  useEffect(() => { if (puede) cargar(); }, [cargar, puede]);

  useEffect(() => {
    if (!projectId) return;
    client.get(`/products?projectId=${projectId}&limit=500`)
      .then((r) => setFormaciones(r.success ? (r.data || []) : []))
      .catch(() => setFormaciones([]));
  }, [projectId]);

  // El arranque del modulo manda sobre la fecha por defecto: si las comisiones
  // empiezan en agosto, proponer hoy solo invita a ponerlo mal.
  useEffect(() => {
    tutoresApi.ajustes().then((r) => {
      if (!r.success || !r.data) return;
      setAjustes(r.data);
      const arranque = String(r.data.aplica_desde).slice(0, 10);
      setNuevaFecha(arranque > hoy() ? arranque : hoy());
    }).catch(() => { /* se queda con hoy */ });
  }, []);

  // Cerrar con Escape, que es lo que hace todo el mundo antes de buscar la X.
  useEffect(() => {
    if (!popupAlta && !popupColab) return;
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPopupAlta(false); setPopupColab(false); }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [popupAlta, popupColab]);

  function anadirCursoAlAlta() {
    const id = Number(nuevoCurso);
    if (!id) return;
    const pct = Number(nuevoPct);
    if (!(pct >= 0 && pct <= 100)) return;
    setCursosAlta((prev) => [...prev, { productId: id, pct, desde: nuevaFecha }]);
    setNuevoCurso('');
  }

  function abrirAlta() {
    setCursosAlta([]);
    setNuevoCurso('');
    setNuevoPct(String(ajustes?.pct_por_defecto ?? 10));
    setContrasena('');
    setCopiada(false);
    setMarcas(projectId ? [projectId] : []);
    setPopupAlta(true);
  }

  const cargarColabs = useCallback(async (t: Tutor) => {
    const r = await tutoresApi.colaboraciones(t.id);
    setColabs(r.success ? (r.data || []) : []);
  }, []);

  function elegir(t: Tutor) { setElegido(t); cargarColabs(t); }

  function abrirColab() { setCursoColab(null); setPopupColab(true); }

  // Una fila de la lista. Se saca aparte porque se pinta en dos grupos: los de
  // este proyecto y los de las marcas hermanas.
  const fila = (t: Tutor) => (
    <button key={t.id} type="button" onClick={() => elegir(t)}
      className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${
        t.id === elegido?.id ? 'bg-primary/10 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'
      }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-sm truncate">{t.nombre}</span>
        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
          {t.formaciones} {t.formaciones === 1 ? 'curso' : 'cursos'}
        </span>
      </div>
      <div className="text-xs text-muted-foreground truncate">{t.email}</div>
      {t.marcas && (
        <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">{t.marcas}</div>
      )}
      {t.pendiente_de_entrar && (
        <div className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
          aún no ha entrado
        </div>
      )}
    </button>
  );

  async function altaTutor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!projectId) return;
    const f = new FormData(e.currentTarget);
    setGuardando(true);
    try {
      const r = await tutoresApi.alta({
        nombre: String(f.get('nombre') || ''),
        email: String(f.get('email') || ''),
        projectIds: marcas.length ? marcas : [projectId],
        dniNif: String(f.get('dniNif') || '') || undefined,
        iban: String(f.get('iban') || '') || undefined,
        telefono: String(f.get('telefono') || '') || undefined,
        password: contrasena || undefined,
      });
      if (!r.success) throw new Error(r.error || 'no se pudo');

      // Cada curso con SU fecha. Si alguno falla se dice cual: el tutor ya
      // existe y no tiene sentido deshacerlo por eso.
      const fallidos: string[] = [];
      for (const c of cursosAlta) {
        const rc = await tutoresApi.crearColaboracion({
          tutorId: r.data!.id, productId: c.productId, pct: c.pct, desde: c.desde,
        });
        if (!rc.success) fallidos.push(formaciones.find((x) => x.id === c.productId)?.nombre || String(c.productId));
      }
      if (fallidos.length) {
        toast({ title: 'Algún curso no se ha podido asignar', description: fallidos.join(', '), variant: 'destructive' });
      }

      const cuantos = cursosAlta.length - fallidos.length;
      toast({
        title: 'Tutor dado de alta',
        description: [
          r.data?.entraYa
            ? 'Ya puede entrar con el correo y la contraseña que le has puesto.'
            : 'Le llega un correo con el enlace para poner su contraseña. Caduca en 24 horas.',
          cuantos > 0 ? `Con ${cuantos} ${cuantos === 1 ? 'curso asignado' : 'cursos asignados'}.` : '',
        ].filter(Boolean).join(' '),
      });
      setPopupAlta(false);
      setCursosAlta([]);
      setContrasena('');
      cargar();
    } catch (err) {
      toast({ title: 'No se ha podido dar de alta', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  async function altaColaboracion(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!elegido) return;
    const f = new FormData(e.currentTarget);
    setGuardando(true);
    try {
      const r = await tutoresApi.crearColaboracion({
        tutorId: elegido.id,
        productId: Number(f.get('productId')),
        pct: Number(f.get('pct')),
        desde: String(f.get('desde')),
        hasta: String(f.get('hasta') || '') || null,
      });
      if (!r.success) throw new Error(r.error || 'no se pudo');
      setPopupColab(false);
      cargarColabs(elegido);
      cargar();
    } catch (err) {
      toast({ title: 'No se ha podido añadir', description: err instanceof Error ? err.message : '', variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  async function quitar(c: Colaboracion) {
    // Dos toques: el primero avisa, el segundo hace. Sin dialogo aparte, que
    // los dos CRM tienen componentes distintos para eso.
    if (borrando !== c.id) { setBorrando(c.id); setTimeout(() => setBorrando(null), 4000); return; }
    const r = await tutoresApi.borrarColaboracion(c.id);
    if (r.success && r.data?.desactivada) {
      toast({
        title: 'Desactivada, no borrada',
        description: `Ya generó ${r.data.comisiones} comisiones. Borrarla dejaría pagos apuntando a algo que no existe.`,
      });
    }
    setBorrando(null);
    if (elegido) { cargarColabs(elegido); cargar(); }
  }

  if (!puede) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Esta pantalla es para administradores y gestores de colaboraciones.
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Elige un proyecto concreto para ver sus tutores.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Tutores"
        subtitle={cargando ? 'cargando…' : `${tutores.length} ${tutores.length === 1 ? 'tutor' : 'tutores'} · cobran un porcentaje de lo que se cobra de sus formaciones`}
        actions={(
          <Button onClick={abrirAlta}>
            <Plus size={15} weight="bold" className="mr-1.5" /> Nuevo tutor
          </Button>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-3 items-start">
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="max-h-[calc(100vh-230px)] overflow-y-auto divide-y divide-border">
            {!cargando && tutores.length === 0 && (
              <EmptyState icon={GraduationCap} title="Sin tutores todavía"
                description="Da de alta el primero para asignarle formaciones." />
            )}
            {(() => {
              const deAqui = tutores.filter((t) => t.es_de_este_proyecto);
              const hermanos = tutores.filter((t) => !t.es_de_este_proyecto);
              return (
                <>
                  {hermanos.length > 0 && deAqui.length > 0 && (
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40">
                      De este proyecto
                    </div>
                  )}
                  {deAqui.map(fila)}
                  {hermanos.length > 0 && (
                    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40">
                      Otras marcas de la misma sociedad
                    </div>
                  )}
                  {hermanos.map(fila)}
                </>
              );
            })()}

          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          {!elegido ? (
            <EmptyState icon={GraduationCap} title="Elige un tutor"
              description="Verás sus formaciones, con el porcentaje y desde cuándo cobra cada una." />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="min-w-0">
                  <p className="font-bold truncate">{elegido.nombre}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {elegido.email}{elegido.dni_nif ? ` · ${elegido.dni_nif}` : ''}
                  </p>
                </div>
                <Button variant="outline" size="sm" className="ml-auto" onClick={abrirColab}>
                  <Plus size={14} weight="bold" className="mr-1.5" /> Añadir formación
                </Button>
              </div>

              {colabs.length === 0 ? (
                <EmptyState icon={Warning} title="Sin formaciones asignadas"
                  description="Mientras no tenga ninguna, no genera comisión."
                  action={<Button variant="outline" onClick={abrirColab}>Añadir la primera</Button>} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 font-semibold">Formación</th>
                        <th className="py-2 px-3 font-semibold">Proyecto</th>
                        <th className="py-2 px-3 font-semibold text-right">%</th>
                        <th className="py-2 px-3 font-semibold">Desde</th>
                        <th className="py-2 px-3 font-semibold">Hasta</th>
                        <th className="py-2 px-3 font-semibold">Estado</th>
                        <th className="py-2 pl-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {colabs.map((c) => (
                        <tr key={c.id}>
                          <td className="py-2 pr-3">{c.formacion}</td>
                          <td className="py-2 px-3 text-muted-foreground">{c.proyecto}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold">{Number(c.pct)} %</td>
                          <td className="py-2 px-3 tabular-nums">{soloFecha(c.vigente_desde)}</td>
                          <td className="py-2 px-3 tabular-nums text-muted-foreground">
                            {soloFecha(c.vigente_hasta) || 'en adelante'}
                          </td>
                          <td className="py-2 px-3">
                            {c.rige_hoy ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle size={13} weight="fill" /> vigente
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {c.activa ? 'fuera de fecha' : 'desactivada'}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pl-3 text-right">
                            <button type="button" onClick={() => quitar(c)}
                              className={`text-xs font-semibold inline-flex items-center gap-1 ${
                                borrando === c.id ? 'text-red-600' : 'text-muted-foreground hover:text-foreground'
                              }`}>
                              <Trash size={13} weight="bold" />
                              {borrando === c.id ? '¿Seguro?' : 'Quitar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Alta de tutor */}
      {popupAlta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPopupAlta(false)}>
          <form onSubmit={altaTutor} onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border">
              <div>
                <h2 className="font-bold text-base">Nuevo tutor</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sus datos, cómo entra, y los cursos por los que cobra.
                </p>
              </div>
              <button type="button" onClick={() => setPopupAlta(false)}
                className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Cerrar">
                <X size={18} weight="bold" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              <section className="space-y-3">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Quién es</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs font-medium sm:col-span-2">
                    Nombre y apellidos <span className="text-red-500">*</span>
                    <input name="nombre" required autoFocus
                      className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-normal" />
                  </label>
                  <label className="text-xs font-medium sm:col-span-2">
                    Correo <span className="text-red-500">*</span>
                    <input name="email" type="email" required
                      className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-normal" />
                    <span className="block text-[11px] text-muted-foreground font-normal mt-1">
                      Es con lo que entra al CRM.
                    </span>
                  </label>
                  <label className="text-xs font-medium">
                    DNI / NIF
                    <input name="dniNif"
                      className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-normal" />
                  </label>
                  <label className="text-xs font-medium">
                    Teléfono
                    <input name="telefono"
                      className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-normal" />
                  </label>
                  <label className="text-xs font-medium sm:col-span-2">
                    IBAN
                    <input name="iban" placeholder="ES00 0000 0000 0000 0000 0000"
                      className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm font-normal tabular-nums" />
                    <span className="block text-[11px] text-muted-foreground font-normal mt-1">
                      Donde se le paga. Puedes dejarlo para más adelante.
                    </span>
                  </label>
                </div>
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Cómo entra</h3>
                <div className="flex gap-2">
                  <input value={contrasena} onChange={(e) => { setContrasena(e.target.value); setCopiada(false); }}
                    type="text" minLength={8} autoComplete="new-password" placeholder="Contraseña (mínimo 8)"
                    className="flex-1 h-9 px-3 rounded-md border border-border bg-background text-sm" />
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { setContrasena(generarContrasena()); setCopiada(false); }}>
                    <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> Generar
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!contrasena}
                    onClick={() => { navigator.clipboard?.writeText(contrasena); setCopiada(true); }}>
                    {copiada ? <CheckCircle size={14} weight="fill" className="text-emerald-600" /> : <Copy size={14} weight="bold" />}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {contrasena
                    ? 'Entra ya con esa contraseña. Cópiala antes de dar de alta — después no se puede volver a ver.'
                    : 'Si la dejas vacía se le manda un correo para que la ponga él, y eso necesita que Brevo esté configurado. Con contraseña entra al momento.'}
                </p>
              </section>

              {projects.length > 1 && (
                <section className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    En qué marcas da clase
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Solo podrá cobrar de cursos de las marcas que marques aquí.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {projects.map((p) => {
                      const puesta = marcas.includes(p.id);
                      return (
                        <button key={p.id} type="button"
                          onClick={() => setMarcas((prev) => puesta ? prev.filter((x) => x !== p.id) : [...prev, p.id])}
                          className={`px-2.5 h-8 rounded-md border text-xs transition-colors ${
                            puesta
                              ? 'border-primary bg-primary/10 text-primary font-semibold'
                              : 'border-border text-muted-foreground hover:bg-muted/50'
                          }`}>
                          {p.nombre}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              <section className="space-y-2 border-t border-border pt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Sus cursos</h3>
                  {cursosAlta.length > 0 && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {cursosAlta.length} {cursosAlta.length === 1 ? 'curso' : 'cursos'}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Puedes añadirle todos los que dé. Cada uno con su porcentaje y desde cuándo lo lleva.
                </p>

                <div className="grid grid-cols-[minmax(0,1fr)_5rem_9.5rem_auto] gap-2 items-end">
                  <label className="text-[11px] text-muted-foreground min-w-0">
                    Curso
                    <div className="mt-1">
                      <BuscadorCurso
                        cursos={formaciones}
                        valor={nuevoCurso ? Number(nuevoCurso) : null}
                        onElegir={(id) => setNuevoCurso(id ? String(id) : '')}
                        excluir={cursosAlta.map((c) => c.productId)}
                      />
                    </div>
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    %
                    <input type="number" step="0.5" min="0" max="100" value={nuevoPct}
                      onChange={(e) => setNuevoPct(e.target.value)}
                      className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm tabular-nums" />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Lo lleva desde
                    <input type="date" value={nuevaFecha} onChange={(e) => setNuevaFecha(e.target.value)}
                      className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
                  </label>
                  <Button type="button" variant="outline" size="sm" disabled={!nuevoCurso}
                    onClick={anadirCursoAlAlta} className="h-9">
                    <Plus size={14} weight="bold" className="mr-1" /> Añadir
                  </Button>
                </div>

                {cursosAlta.length > 0 ? (
                  <ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
                    {cursosAlta.map((c) => (
                      <li key={c.productId} className="flex items-center gap-3 px-3 py-2 text-sm bg-muted/30">
                        <div className="min-w-0 flex-1">
                          <p className="truncate">{formaciones.find((fo) => fo.id === c.productId)?.nombre}</p>
                          <p className="text-[11px] text-muted-foreground tabular-nums">
                            desde el {enCastellano(c.desde)}
                          </p>
                        </div>
                        <span className="tabular-nums font-semibold shrink-0">{c.pct} %</span>
                        <button type="button" aria-label="Quitar"
                          className="text-muted-foreground hover:text-red-600 shrink-0"
                          onClick={() => setCursosAlta((prev) => prev.filter((x) => x.productId !== c.productId))}>
                          <Trash size={14} weight="bold" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground border border-dashed border-border rounded-md px-3 py-3 text-center">
                    Sin cursos todavía. Mientras no tenga ninguno, no genera comisión.
                  </p>
                )}

                {ajustes && (
                  <p className="text-[11px] text-muted-foreground flex gap-1.5">
                    <Warning size={13} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
                    <span>
                      Aunque pongas una fecha anterior, no se paga nada cobrado antes del{' '}
                      <strong className="tabular-nums">{enCastellano(String(ajustes.aplica_desde).slice(0, 10))}</strong>,
                      que es el arranque del módulo.
                    </span>
                  </p>
                )}
              </section>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button type="button" variant="outline" onClick={() => setPopupAlta(false)}>Cancelar</Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? 'Dando de alta…' : 'Dar de alta'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Añadir formación */}
      {popupColab && elegido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPopupColab(false)}>
          <form onSubmit={altaColaboracion} onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-bold">Formación de {elegido.nombre}</h2>
              <button type="button" onClick={() => setPopupColab(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} weight="bold" />
              </button>
            </div>

            {/* Con cientos de cursos, un desplegable no vale: hay que poder escribir. */}
            <BuscadorCurso
              cursos={formaciones}
              valor={cursoColab}
              onElegir={setCursoColab}
              excluir={colabs.map((c) => c.product_id)}
              autoFocus
            />
            <input type="hidden" name="productId" value={cursoColab ?? ''} />

            <div className="grid grid-cols-3 gap-2">
              <label className="text-xs text-muted-foreground">
                Porcentaje
                <input name="pct" type="number" step="0.5" min="0" max="100" defaultValue="10" required
                  className="mt-1 w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
              </label>
              <label className="text-xs text-muted-foreground">
                Desde
                <input name="desde" type="date" defaultValue={hoy()} required
                  className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
              </label>
              <label className="text-xs text-muted-foreground">
                Hasta
                <input name="hasta" type="date"
                  className="mt-1 w-full h-9 px-2 rounded-md border border-border bg-background text-sm" />
              </label>
            </div>

            <p className="text-xs text-muted-foreground flex gap-1.5">
              <Warning size={14} weight="fill" className="text-amber-500 shrink-0 mt-0.5" />
              <span>
                <strong>Desde</strong> es el día que empezó con esta formación, no el de hoy si ya llevaba
                tiempo. Cobra los pagos a partir de esa fecha — y nunca antes del arranque general del módulo.
              </span>
            </p>

            <Button type="submit" disabled={guardando} className="w-full">
              {guardando ? 'Guardando…' : 'Añadir'}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
