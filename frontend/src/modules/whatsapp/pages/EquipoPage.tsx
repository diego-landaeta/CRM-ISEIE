import { useCallback, useEffect, useRef, useState } from 'react';
import { WhatsappLogo, ArrowsClockwise, CornersOut, ArrowLeft, Info } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import client from '@/shared/api/client';

// El WhatsApp del equipo, para quien manda.
//
// Una tarjeta por persona con sala propia. «Entrar» abre SU sala —no una
// compartida— y desde dentro se puede tomar el control para escribir por ella.
//
// Las salas se encienden al entrar y se apagan solas al rato sin nadie. Por eso
// mientras la ventana esta abierta se manda un latido: sin el, la sala se
// apagaria a media conversacion.

interface Miembro {
  id: number;
  nombre: string;
  email: string;
  role: string;
  disponible: boolean;
  ultimoAcceso: string | null;
  creada: boolean;
  encendida: boolean;
  desde: string | null;
}

function Estado({ m }: { m: Miembro }) {
  if (m.encendida) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> en marcha
      </span>
    );
  }
  if (m.creada) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" /> apagada
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full border border-current" /> sin sala
    </span>
  );
}

export default function EquipoWhatsappPage() {
  const { user } = useAuth() as { user: { role?: string } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [gente, setGente] = useState<Miembro[]>([]);
  const [configurado, setConfigurado] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [abriendo, setAbriendo] = useState<number | null>(null);
  const [dentro, setDentro] = useState<{ id: number; nombre: string; url: string } | null>(null);
  const marco = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    setCargando(true);
    try {
      const r = await client.get(`/whatsapp/equipo?projectId=${projectId}`);
      if (r.success) { setGente(r.data?.gente || []); setConfigurado(r.data?.configurado !== false); }
    } finally { setCargando(false); }
  }, [projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Refrescar el estado cada medio minuto: una sala puede apagarse sola y la
  // tarjeta debe decir la verdad sin que haya que recargar la pagina.
  useEffect(() => {
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [cargar]);

  // Mientras estas mirando una sala, avisar de que sigues ahi.
  useEffect(() => {
    if (!dentro) return undefined;
    const latir = () => { client.post(`/whatsapp/equipo/${dentro.id}/latido`, {}).catch(() => {}); };
    latir();
    const t = setInterval(latir, 4 * 60 * 1000);
    return () => clearInterval(t);
  }, [dentro]);

  async function entrar(m: Miembro) {
    setAbriendo(m.id);
    try {
      const r = await client.post(`/whatsapp/equipo/${m.id}/abrir`, {});
      if (!r.success || !r.data?.url) throw new Error(r.error || 'no se pudo abrir');
      setDentro({ id: m.id, nombre: m.nombre, url: r.data.url });
      if (r.data.nueva) {
        toast({
          title: `Sala creada para ${m.nombre}`,
          description: 'Tarda unos segundos en arrancar. Tendrá que vincular su móvil una vez.',
        });
      }
      cargar();
    } catch (e) {
      toast({
        title: 'No se ha podido abrir su sala',
        description: e instanceof Error ? e.message : 'Inténtalo de nuevo en unos segundos.',
        variant: 'destructive',
      });
    } finally { setAbriendo(null); }
  }

  function pantallaCompleta() {
    const el = marco.current;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    el.requestFullscreen?.().catch(() => {});
  }

  if (!esAdmin) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Esta pantalla es para administradores.
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Elige un proyecto concreto para ver el WhatsApp del equipo.
      </div>
    );
  }

  // Dentro de una sala, la pantalla es SOLO la sala.
  //
  // La primera version la ponia debajo de las tarjetas, y entre la cabecera del
  // CRM y una fila de tarjetas le quedaban unos 500 px de alto: WhatsApp ahi
  // dentro se lee fatal. Trabajar en el WhatsApp de alguien y elegir a quien
  // entrar son dos momentos distintos, y no tienen por que compartir pantalla.
  if (dentro) {
    return (
      <div ref={marco} className="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-[calc(100vh-118px)] min-h-[460px]">
        <div className="px-3 py-2 border-b border-border flex items-center gap-3 shrink-0">
          <button type="button" onClick={() => setDentro(null)}
            className="h-8 px-2.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
            <ArrowLeft size={14} weight="bold" /> Equipo
          </button>
          <div className="min-w-0">
            <p className="text-sm font-bold truncate leading-tight">WhatsApp de {dentro.nombre}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">
              entras como administrador · puedes tomar el control
            </p>
          </div>
          <button type="button" onClick={pantallaCompleta}
            className="ml-auto h-8 px-2.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 shrink-0"
            title="Ocupar el monitor entero (Esc para salir)">
            <CornersOut size={14} weight="bold" /> Pantalla completa
          </button>
        </div>
        <iframe src={dentro.url} title={`WhatsApp de ${dentro.nombre}`}
          className="flex-1 w-full bg-black"
          allow="clipboard-read; clipboard-write; autoplay; fullscreen" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 mr-2">
          <WhatsappLogo size={22} weight="duotone" className="text-emerald-600" />
          WhatsApp · Equipo
        </h1>
        <button type="button" onClick={cargar}
          className="h-8 px-2.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowsClockwise size={14} weight="bold" /> Actualizar
        </button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {cargando ? 'cargando…' : `${gente.length} con sala propia`}
        </span>
      </div>

      {!configurado && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
            <Info size={16} weight="fill" /> No hay gestor de salas configurado
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
            Falta <code>WHATSAPP_SALAS_URL</code> y <code>WHATSAPP_SALAS_TOKEN</code> en el servidor.
            Sin eso no se puede saber quién tiene sala ni abrirla.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {gente.map((m) => (
          <div key={m.id} className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
            <div className="min-w-0">
              <p className="font-semibold truncate">{m.nombre}</p>
              <p className="text-xs text-muted-foreground truncate">{m.email}</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Estado m={m} />
              {m.desde && <span className="text-[11px] text-muted-foreground">{m.desde}</span>}
            </div>
            <button type="button" onClick={() => entrar(m)} disabled={abriendo === m.id}
              className="h-9 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60">
              {abriendo === m.id ? 'Abriendo…' : (m.creada ? 'Entrar' : 'Crear sala y vincular')}
            </button>
          </div>
        ))}
        {!cargando && gente.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-full p-6 text-center">
            Nadie de este proyecto tiene sala propia todavía.
          </p>
        )}
      </div>

    </div>
  );
}
