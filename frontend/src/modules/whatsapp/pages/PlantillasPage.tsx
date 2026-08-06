import { useCallback, useEffect, useState } from 'react';
import { WhatsappLogo, Plus, Trash, FloppyDisk, Users, User } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { whatsappApi, type PlantillaWhatsapp } from '../api/whatsapp.api';

// Editor de plantillas. Antes vivían en el localStorage del navegador: cada
// gestora tenía las suyas en su equipo, nadie podía revisarlas y si cambiaba de
// ordenador las perdía. Ahora están en la base de datos.

const VARIABLES = ['{nombre}', '{nombreCompleto}', '{producto}', '{proyecto}', '{email}', '{telefono}'];

export default function PlantillasWhatsappPage() {
  const { user } = useAuth() as { user: { role?: string } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [lista, setLista] = useState<PlantillaWhatsapp[]>([]);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState<Record<number, { label: string; body: string }>>({});
  const [nueva, setNueva] = useState<{ label: string; body: string; ambito: 'compartida' | 'personal' } | null>(null);
  // Borrado en dos pasos en vez de un diálogo: ISEIE tiene useConfirm() y el
  // CRM hermano un componente distinto, así que depender de cualquiera de los
  // dos obligaría a tener dos versiones de esta pantalla.
  const [porBorrar, setPorBorrar] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    setCargando(true);
    try {
      const r = await whatsappApi.plantillas(projectId);
      setLista(r.success ? (r.data || []) : []);
      setBorrador({});
    } finally { setCargando(false); }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(t: PlantillaWhatsapp) {
    const b = borrador[t.id];
    if (!b) return;
    const r = await whatsappApi.editarPlantilla(t.id, { label: b.label, body: b.body });
    if (r.success) {
      toast({ title: 'Plantilla guardada' });
      cargar();
    } else {
      toast({ title: 'No se pudo guardar', description: r.error, variant: 'destructive' });
    }
  }

  async function borrar(t: PlantillaWhatsapp) {
    if (porBorrar !== t.id) { setPorBorrar(t.id); setTimeout(() => setPorBorrar(null), 4000); return; }
    setPorBorrar(null);
    const r = await whatsappApi.borrarPlantilla(t.id);
    if (r.success) { toast({ title: 'Plantilla borrada' }); cargar(); }
  }

  async function crear() {
    if (!projectId || !nueva) return;
    if (!nueva.label.trim() || !nueva.body.trim()) {
      toast({ title: 'Falta el nombre o el texto', variant: 'destructive' }); return;
    }
    const r = await whatsappApi.crearPlantilla({ projectId, ...nueva });
    if (r.success) { toast({ title: 'Plantilla creada' }); setNueva(null); cargar(); }
    else toast({ title: 'No se pudo crear', description: r.error, variant: 'destructive' });
  }

  if (!projectId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Elige un proyecto concreto para ver sus plantillas.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <WhatsappLogo size={26} weight="duotone" className="text-emerald-600" />
            Plantillas de WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Las compartidas las ve todo el equipo. Las tuyas, solo tú.
          </p>
        </div>
        {!nueva && (
          <button type="button"
            onClick={() => setNueva({ label: '', body: '', ambito: esAdmin ? 'compartida' : 'personal' })}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
            <Plus size={14} weight="bold" /> Nueva
          </button>
        )}
      </header>

      <p className="text-xs text-muted-foreground">
        Variables disponibles:{' '}
        {VARIABLES.map((v) => (
          <code key={v} className="mx-0.5 px-1 py-0.5 rounded bg-muted/60 font-mono text-[11px]">{v}</code>
        ))}
      </p>

      {nueva && (
        <div className="bg-card border border-primary/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <input value={nueva.label} onChange={(e) => setNueva({ ...nueva, label: e.target.value })}
              placeholder="Nombre (p. ej. «Primer contacto»)" autoFocus
              className="flex-1 h-9 px-3 rounded-md border border-border bg-card text-sm" />
            {esAdmin && (
              <select value={nueva.ambito}
                onChange={(e) => setNueva({ ...nueva, ambito: e.target.value as 'compartida' | 'personal' })}
                className="h-9 px-2 rounded-md border border-border bg-card text-sm">
                <option value="compartida">Para todo el equipo</option>
                <option value="personal">Solo para mí</option>
              </select>
            )}
          </div>
          <textarea value={nueva.body} onChange={(e) => setNueva({ ...nueva, body: e.target.value })}
            rows={4} placeholder="Hola {nombre}, te escribo por {producto}…"
            className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm leading-relaxed" />
          <div className="flex gap-2">
            <button type="button" onClick={crear}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold">Crear</button>
            <button type="button" onClick={() => setNueva(null)}
              className="h-9 px-3 rounded-md border border-border text-sm">Cancelar</button>
          </div>
        </div>
      )}

      {cargando && <div className="bg-card border border-border rounded-lg p-6 h-40 animate-pulse" />}

      {!cargando && lista.length === 0 && !nueva && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          Este proyecto no tiene plantillas todavía.
        </div>
      )}

      <div className="space-y-3">
        {lista.map((t) => {
          const b = borrador[t.id] || { label: t.label, body: t.body };
          const tocada = b.label !== t.label || b.body !== t.body;
          // Las compartidas solo las toca un admin; las personales, su dueño.
          const puedo = t.ambito === 'personal' || esAdmin;
          return (
            <div key={t.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span title={t.ambito === 'compartida' ? 'La ve todo el equipo' : 'Solo tuya'}>
                  {t.ambito === 'compartida'
                    ? <Users size={15} weight="duotone" className="text-muted-foreground" />
                    : <User size={15} weight="duotone" className="text-muted-foreground" />}
                </span>
                <input value={b.label} disabled={!puedo}
                  onChange={(e) => setBorrador({ ...borrador, [t.id]: { ...b, label: e.target.value } })}
                  className="flex-1 h-8 px-2 rounded-md border border-transparent hover:border-border focus:border-border bg-transparent text-sm font-semibold disabled:opacity-70" />
                {puedo && tocada && (
                  <button type="button" onClick={() => guardar(t)}
                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                    <FloppyDisk size={13} weight="bold" /> Guardar
                  </button>
                )}
                {puedo && (
                  <button type="button" onClick={() => borrar(t)}
                    title={t.ambito === 'compartida' ? 'Desaparece para todo el equipo' : 'Solo desaparece para ti'}
                    className={`h-8 grid place-items-center rounded-md border text-xs font-semibold transition-colors ${
                      porBorrar === t.id
                        ? 'px-2.5 border-red-500 text-red-600 dark:text-red-400'
                        : 'w-8 border-border text-muted-foreground hover:text-red-600'
                    }`}>
                    {porBorrar === t.id ? '¿Seguro?' : <Trash size={14} />}
                  </button>
                )}
              </div>
              <textarea value={b.body} disabled={!puedo} rows={3}
                onChange={(e) => setBorrador({ ...borrador, [t.id]: { ...b, body: e.target.value } })}
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm leading-relaxed disabled:opacity-70" />
              {!puedo && (
                <p className="text-[11px] text-muted-foreground/70 mt-1">
                  Es compartida: solo un administrador puede cambiarla.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
