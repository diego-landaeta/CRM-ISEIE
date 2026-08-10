import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Plus, X, Warning, Trash, CheckCircle } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import { tutoresApi, type Tutor, type Colaboracion } from '../api/tutores.api';

// Tutores y sus colaboraciones.
//
// Una lista a la izquierda y, al elegir a alguien, sus formaciones con el
// porcentaje y las fechas. La fecha importa tanto como el porcentaje: cada
// tutor cobra desde el dia que empezo, no desde que se creo el modulo.

interface Formacion { id: number; nombre: string; precio: string }

const hoy = () => new Date().toISOString().slice(0, 10);
const soloFecha = (f: string | null) => (f ? String(f).slice(0, 10) : null);

export default function TutoresPage() {
  const { user } = useAuth() as { user: { role?: string; gestor_colaboraciones?: boolean } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id: number } | null };
  const puede = ['admin', 'superadmin'].includes(user?.role || '') || user?.gestor_colaboraciones === true;
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [tutores, setTutores] = useState<Tutor[]>([]);
  const [elegido, setElegido] = useState<Tutor | null>(null);
  const [colabs, setColabs] = useState<Colaboracion[]>([]);
  const [formaciones, setFormaciones] = useState<Formacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [popupAlta, setPopupAlta] = useState(false);
  const [popupColab, setPopupColab] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [borrando, setBorrando] = useState<number | null>(null);

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

  const cargarColabs = useCallback(async (t: Tutor) => {
    const r = await tutoresApi.colaboraciones(t.id);
    setColabs(r.success ? (r.data || []) : []);
  }, []);

  function elegir(t: Tutor) { setElegido(t); cargarColabs(t); }

  async function altaTutor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!projectId) return;
    const f = new FormData(e.currentTarget);
    setGuardando(true);
    try {
      const r = await tutoresApi.alta({
        nombre: String(f.get('nombre') || ''),
        email: String(f.get('email') || ''),
        projectIds: [projectId],
        dniNif: String(f.get('dniNif') || '') || undefined,
        iban: String(f.get('iban') || '') || undefined,
        telefono: String(f.get('telefono') || '') || undefined,
        password: String(f.get('password') || '') || undefined,
      });
      if (!r.success) throw new Error(r.error || 'no se pudo');
      toast({
        title: 'Tutor dado de alta',
        description: r.data?.entraYa
          ? 'Ya puede entrar con el correo y la contraseña que le has puesto.'
          : 'Le llega un correo con el enlace para poner su contraseña. Caduca en 24 horas.',
      });
      setPopupAlta(false);
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
          <Button onClick={() => setPopupAlta(true)}>
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
            {tutores.map((t) => (
              <button key={t.id} type="button" onClick={() => elegir(t)}
                className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${
                  t.id === elegido?.id ? 'bg-primary/10 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'
                }`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{t.nombre}</span>
                  <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                    {t.formaciones} {t.formaciones === 1 ? 'formación' : 'formaciones'}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground truncate">{t.email}</div>
                {t.pendiente_de_entrar && (
                  <div className="text-[11px] text-amber-700 dark:text-amber-400 font-semibold mt-0.5">
                    aún no ha entrado
                  </div>
                )}
              </button>
            ))}
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
                <Button variant="outline" size="sm" className="ml-auto" onClick={() => setPopupColab(true)}>
                  <Plus size={14} weight="bold" className="mr-1.5" /> Añadir formación
                </Button>
              </div>

              {colabs.length === 0 ? (
                <EmptyState icon={Warning} title="Sin formaciones asignadas"
                  description="Mientras no tenga ninguna, no genera comisión."
                  action={<Button variant="outline" onClick={() => setPopupColab(true)}>Añadir la primera</Button>} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                        <th className="py-2 pr-3 font-semibold">Formación</th>
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
            className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-bold">Nuevo tutor</h2>
              <button type="button" onClick={() => setPopupAlta(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} weight="bold" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Si le pones contraseña, entra ya. Si lo dejas en blanco, se le manda un correo
              con el enlace para ponérsela él — y eso necesita que Brevo esté configurado.
            </p>
            <input name="nombre" required placeholder="Nombre y apellidos"
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            <input name="email" type="email" required placeholder="Correo"
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <input name="dniNif" placeholder="DNI / NIF"
                className="h-9 px-3 rounded-md border border-border bg-background text-sm" />
              <input name="telefono" placeholder="Teléfono"
                className="h-9 px-3 rounded-md border border-border bg-background text-sm" />
            </div>
            <input name="iban" placeholder="IBAN (para pagarle)"
              className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
            <div>
              <input name="password" type="text" minLength={8} autoComplete="new-password"
                placeholder="Contraseña (opcional, mínimo 8)"
                className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
              <p className="text-[11px] text-muted-foreground mt-1">
                Se la tendrás que decir tú. Si la dejas vacía, la pone él desde el correo.
              </p>
            </div>
            <Button type="submit" disabled={guardando} className="w-full">
              {guardando ? 'Dando de alta…' : 'Dar de alta'}
            </Button>
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

            <select name="productId" required className="w-full h-9 px-2 rounded-md border border-border bg-background text-sm">
              <option value="">Elige la formación…</option>
              {formaciones.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>

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
