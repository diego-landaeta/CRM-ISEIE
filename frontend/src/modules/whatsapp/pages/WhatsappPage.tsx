import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WhatsappLogo, Copy, CheckCircle, ArrowRight, Warning, X, ChatText, ArrowSquareOut,
  CornersOut, List } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { abrirWhatsapp } from '@/shared/lib/telefono';
import client from '@/shared/api/client';
import { whatsappApi, type PlantillaWhatsapp, type ProspectoCola } from '../api/whatsapp.api';
import { rellenar, diasSinContacto } from '../lib/plantilla';
import AvisoUso from '../components/AvisoUso';

// WhatsApp Web ocupa la pantalla ENTERA. Nada le roba ancho de forma
// permanente: los contactos son un cajón lateral que se abre, se elige a
// alguien y se cierra solo, y las plantillas salen en un popup encima.
//
// La primera versión ponía los contactos en una columna fija de 300 px. Se veía
// bien en la maqueta y apretado en uso real: al chat le quedaban unos 1.000 px
// y WhatsApp reparte ese ancho entre su lista de conversaciones y el mensaje,
// así que el texto acababa en una franja estrecha.

const ESTADOS = ['por_contactar', 'contactado', 'en_seguimiento', 'proxima_convocatoria'];

// Todo el alto que queda por debajo de la cabecera del CRM. Antes se restaban
// 230 px por el aviso desplegado; ahora el aviso vive plegado y esos píxeles
// son para el chat, que es lo que se estaba viendo pequeño.
const ALTO = 'h-[calc(100vh-170px)] min-h-[420px]';

export default function WhatsappPage() {
  const { user } = useAuth() as { user: { role?: string } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [cola, setCola] = useState<ProspectoCola[]>([]);
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[]>([]);
  const [elegido, setElegido] = useState<ProspectoCola | null>(null);
  const [popup, setPopup] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState('');
  const [sinContactar, setSinContactar] = useState(false);
  const [responsableId, setResponsableId] = useState<number | null>(null);
  const [gestoras, setGestoras] = useState<Array<{ id: number; nombre: string }>>([]);
  const [copiada, setCopiada] = useState<number | null>(null);
  const [sala, setSala] = useState<{ configurada: boolean; url?: string; motivo?: string } | null>(null);
  // Cerrado de entrada: lo que la gestora quiere ver al entrar es el chat.
  const [colaVisible, setColaVisible] = useState(false);
  const marco = useRef<HTMLDivElement>(null);

  // Dónde vive el WhatsApp Web de esta persona. Lo dice el servidor: así la
  // dirección se cambia en el .env sin reconstruir el frontal.
  useEffect(() => {
    client.get(`/whatsapp/sala${responsableId ? `?userId=${responsableId}` : ''}`)
      .then((r) => setSala(r.success ? r.data : { configurada: false }))
      .catch(() => setSala({ configurada: false }));
  }, [responsableId]);

  useEffect(() => {
    if (!esAdmin || !projectId) return;
    client.get(`/users?limit=100&projectId=${projectId}`)
      .then((r) => setGestoras(r.success ? (r.data || []) : []))
      .catch(() => {});
  }, [esAdmin, projectId]);

  const cargar = useCallback(async () => {
    if (!projectId) return;
    setCargando(true);
    try {
      const [c, p] = await Promise.all([
        whatsappApi.cola({ projectId, responsableId, estado: estado || null, sinContactar }),
        whatsappApi.plantillas(projectId),
      ]);
      setCola(c.success ? (c.data || []) : []);
      setPlantillas(p.success ? (p.data || []) : []);
    } finally { setCargando(false); }
  }, [projectId, responsableId, estado, sinContactar]);

  useEffect(() => { cargar(); }, [cargar]);

  // Escape cierra el popup: es lo primero que intenta cualquiera.
  useEffect(() => {
    if (!popup) return undefined;
    const cerrar = (e: KeyboardEvent) => { if (e.key === 'Escape') setPopup(false); };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [popup]);

  const textos = useMemo(
    () => (elegido ? plantillas.map((t) => ({ ...t, texto: rellenar(t.body, elegido, activeProject?.nombre) })) : []),
    [plantillas, elegido, activeProject?.nombre],
  );

  // Apuntar el contacto ANTES de que ocurra nada. Si esto no queda escrito, en
  // dos semanas la cola miente. Y si falla, se avisa: no se traga en silencio.
  async function apuntar(p: ProspectoCola, titulo: string) {
    try {
      const r = await whatsappApi.registrarContacto(p.id, `WhatsApp · ${titulo}`);
      if (!r.success) throw new Error(r.error || 'no se pudo');
      setCola((prev) => prev.map((x) => x.id === p.id
        ? { ...x, ultimo_contacto: new Date().toISOString(), contactos: x.contactos + 1 } : x));
    } catch {
      toast({
        title: 'No se ha podido registrar el contacto',
        description: 'El mensaje está preparado, pero apúntalo a mano en la ficha.',
        variant: 'destructive',
      });
    }
  }

  async function copiarYAbrir(t: { id: number; label: string; texto: string }) {
    if (!elegido) return;
    try { await navigator.clipboard.writeText(t.texto); } catch { /* el chat lleva el texto igual */ }
    setCopiada(t.id);
    setTimeout(() => setCopiada(null), 1800);
    await apuntar(elegido, t.label);
    if (!abrirWhatsapp(elegido.telefono, t.texto)) {
      toast({ title: 'Ese teléfono no sirve', description: elegido.telefono || '(vacío)', variant: 'destructive' });
    }
    setPopup(false);
  }

  function elegir(p: ProspectoCola) { setElegido(p); setPopup(true); setColaVisible(false); }

  // Pantalla completa de verdad, la del navegador: WhatsApp pasa a ocupar el
  // monitor entero. Se sale con Esc, como en cualquier vídeo.
  function pantallaCompleta() {
    const el = marco.current;
    if (!el) return;
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    el.requestFullscreen?.().catch(() => {
      toast({ title: 'Tu navegador no deja poner esto a pantalla completa' });
    });
  }

  function siguiente() {
    const i = cola.findIndex((x) => x.id === elegido?.id);
    const sig = cola[i + 1] || cola[0];
    if (sig) elegir(sig);
  }

  if (!projectId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Elige un proyecto concreto para trabajar la cola de WhatsApp.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <AvisoUso />

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight flex items-center gap-2 mr-2">
          <WhatsappLogo size={22} weight="duotone" className="text-emerald-600" />
          WhatsApp
        </h1>
        <select value={estado} onChange={(e) => setEstado(e.target.value)}
          className="h-8 px-2 rounded-md border border-border bg-card text-sm">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
        </select>
        <button type="button" onClick={() => setSinContactar((v) => !v)}
          className={`h-8 px-2.5 rounded-md text-sm font-semibold border transition-colors ${
            sinContactar ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
          }`}>
          Sin contactar nunca
        </button>
        {esAdmin && (
          <select value={responsableId ?? ''} onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : null)}
            className="h-8 px-2 rounded-md border border-border bg-card text-sm max-w-[170px]" title="Ver la cola de otra gestora">
            <option value="">Todas las gestoras</option>
            {gestoras.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
        )}
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {cargando ? 'cargando…' : `${cola.length} en la cola`}
        </span>
        <button type="button" onClick={() => setColaVisible((v) => !v)}
          className="h-8 px-2.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          title="Abrir la lista de contactos">
          <List size={14} weight="bold" /> Contactos
        </button>
        <button type="button" onClick={pantallaCompleta}
          className="h-8 px-2.5 rounded-md text-xs font-semibold border border-border text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
          title="WhatsApp a pantalla completa (Esc para salir)">
          <CornersOut size={14} weight="bold" /> Pantalla completa
        </button>
      </div>

      {/* WhatsApp ocupa SIEMPRE todo el ancho. Los contactos son un cajon que
          se desliza por encima desde la izquierda: se abre, se elige a alguien
          y se cierra solo. Antes vivian en una columna fija que le robaba 300
          px al chat de forma permanente, y ahi es donde se veia apretado. */}
      <div className="relative">
        {colaVisible && (
          <button type="button" aria-label="Cerrar contactos"
            onClick={() => setColaVisible(false)}
            className="absolute inset-0 z-20 bg-black/40 rounded-lg" />
        )}
        <aside className={`absolute left-0 top-0 z-30 w-[300px] max-w-[85%] ${ALTO}
          bg-card border border-border rounded-lg shadow-2xl flex flex-col
          transition-transform duration-200 ${colaVisible ? 'translate-x-0' : '-translate-x-[110%] pointer-events-none'}`}>
          <div className="px-3 py-2 border-b border-border flex items-center justify-between gap-2 shrink-0">
            <span className="text-sm font-bold">Contactos</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">{cola.length}</span>
              <button type="button" onClick={() => setColaVisible(false)}
                className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                <X size={16} weight="bold" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-border">
            {cola.length === 0 && !cargando && (
              <p className="p-6 text-sm text-muted-foreground text-center">Nadie pendiente con estos filtros.</p>
            )}
            {cola.map((p) => {
              const dias = diasSinContacto(p);
              return (
                <button key={p.id} type="button" onClick={() => elegir(p)}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 ${
                    p.id === elegido?.id ? 'bg-primary/10 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{p.nombre || 'Sin nombre'}</span>
                    {p.contactos === 0
                      ? <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 shrink-0">SIN CONTACTAR</span>
                      : <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{dias} d</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{p.producto}</div>
                  <div className="text-[11px] text-muted-foreground/70">
                    {p.status.replace(/_/g, ' ')}{esAdmin && p.gestora ? ` · ${p.gestora}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div ref={marco}
          className={`bg-card border border-border rounded-lg overflow-hidden flex flex-col ${ALTO}`}>
          {sala?.configurada ? (
            <iframe src={sala.url} title="WhatsApp Web" className="flex-1 w-full bg-black"
              allow="clipboard-read; clipboard-write; autoplay; fullscreen" />
          ) : (
            // Sin navegador remoto todavía. No se deja un rectángulo en blanco
            // —el fallo de los «paneles externos» que ya están en el repo—: se
            // dice qué falta y se ofrece lo que sí funciona hoy.
            <div className="flex-1 grid place-items-center p-8">
              <div className="text-center max-w-sm">
                <WhatsappLogo size={44} weight="duotone" className="mx-auto mb-3 text-muted-foreground/40" />
                <p className="font-semibold mb-1">Aquí irá WhatsApp Web</p>
                <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                  Falta el navegador remoto en el servidor. Mientras tanto, ábrelo en una
                  ventana aparte y colócala junto a esta: al elegir un prospecto se
                  reutiliza siempre la misma, así que no se te llena de pestañas.
                </p>
                <a href="https://web.whatsapp.com" target="crm-whatsapp" rel="noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
                  <ArrowSquareOut size={15} weight="bold" /> Abrir WhatsApp Web
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Las plantillas, en popup: salen al elegir a alguien y se van al copiar */}
      {popup && elegido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setPopup(false)}>
          <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-card border-b border-border px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-bold truncate">{elegido.nombre}</h2>
                <p className="text-xs text-muted-foreground truncate">
                  {elegido.producto} · {elegido.telefono || 'sin teléfono'}
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  Entró el {elegido.entrada}
                  {elegido.contactos === 0
                    ? ' · nunca se le ha escrito'
                    : ` · ${elegido.contactos} contactos, el último hace ${diasSinContacto(elegido)} días`}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={siguiente}
                  className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Siguiente <ArrowRight size={13} weight="bold" />
                </button>
                <button type="button" onClick={() => setPopup(false)} title="Cerrar (Esc)"
                  className="h-8 w-8 grid place-items-center rounded-md border border-border text-muted-foreground hover:text-foreground">
                  <X size={15} weight="bold" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-2.5">
              {textos.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Este proyecto no tiene plantillas todavía.
                </p>
              )}
              {textos.map((t) => (
                <div key={t.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {t.label}
                      {t.ambito === 'personal' && (
                        <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">· solo tuya</span>
                      )}
                    </span>
                    <button type="button" onClick={() => copiarYAbrir(t)} disabled={!elegido.telefono}
                      className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40">
                      {copiada === t.id ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} weight="bold" />}
                      {copiada === t.id ? 'Copiado' : 'Copiar y abrir'}
                    </button>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{t.texto}</p>
                </div>
              ))}

              {!elegido.telefono && (
                <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                  <Warning size={15} weight="fill" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 dark:text-amber-300">
                    Esta persona no tiene teléfono, así que no se le puede escribir por aquí.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reabrir el popup sin tener que volver a la lista */}
      {elegido && !popup && (
        <button type="button" onClick={() => setPopup(true)}
          className="fixed bottom-5 right-20 z-40 inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-lg hover:bg-primary/90">
          <ChatText size={16} weight="bold" /> Plantillas de {elegido.nombre.split(/\s+/)[0]}
        </button>
      )}
    </div>
  );
}
