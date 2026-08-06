import { useCallback, useEffect, useMemo, useState } from 'react';
import { WhatsappLogo, Copy, CheckCircle, ArrowRight, Warning, UsersThree } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { abrirWhatsapp } from '@/shared/lib/telefono';
import client from '@/shared/api/client';
import { whatsappApi, type PlantillaWhatsapp, type ProspectoCola } from '../api/whatsapp.api';
import { rellenar, diasSinContacto } from '../lib/plantilla';

// La pantalla está pensada para ocupar MEDIA pantalla, con WhatsApp Web al
// lado. Por eso no hay diálogos ni tablas anchas: todo cabe en una columna
// estrecha y se ve sin desplazarse en horizontal.

const ESTADOS = ['por_contactar', 'contactado', 'en_seguimiento', 'proxima_convocatoria'];

export default function WhatsappPage() {
  const { user } = useAuth() as { user: { role?: string; userId?: number; id?: number } | null };
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [cola, setCola] = useState<ProspectoCola[]>([]);
  const [plantillas, setPlantillas] = useState<PlantillaWhatsapp[]>([]);
  const [elegido, setElegido] = useState<ProspectoCola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [estado, setEstado] = useState('');
  const [sinContactar, setSinContactar] = useState(false);
  const [responsableId, setResponsableId] = useState<number | null>(null);
  const [gestoras, setGestoras] = useState<Array<{ id: number; nombre: string }>>([]);
  const [copiada, setCopiada] = useState<number | null>(null);

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
      const lista = c.success ? (c.data || []) : [];
      setCola(lista);
      setPlantillas(p.success ? (p.data || []) : []);
      // Mantener el elegido si sigue en la cola; si no, el primero.
      setElegido((prev) => lista.find((x) => x.id === prev?.id) || lista[0] || null);
    } finally {
      setCargando(false);
    }
  }, [projectId, responsableId, estado, sinContactar]);

  useEffect(() => { cargar(); }, [cargar]);

  const textos = useMemo(
    () => (elegido ? plantillas.map((t) => ({ ...t, texto: rellenar(t.body, elegido, activeProject?.nombre) })) : []),
    [plantillas, elegido, activeProject?.nombre],
  );

  // La bisagra del módulo: apuntar el contacto ANTES de que ocurra nada. Si
  // esto no queda escrito, en dos semanas la cola miente y «quién va atrasada»
  // deja de valer. Y si falla, se avisa — no se traga en un catch vacío como
  // hacía el botón de la lista de prospectos.
  async function apuntar(p: ProspectoCola, comoTitulo: string) {
    try {
      const r = await whatsappApi.registrarContacto(p.id, `WhatsApp · ${comoTitulo}`);
      if (!r.success) throw new Error(r.error || 'no se pudo registrar');
      setCola((prev) => prev.map((x) => x.id === p.id
        ? { ...x, ultimo_contacto: new Date().toISOString(), contactos: x.contactos + 1 } : x));
      return true;
    } catch (e) {
      toast({
        title: 'No se ha podido registrar el contacto',
        description: 'El mensaje se ha preparado igual, pero apúntalo a mano en la ficha.',
        variant: 'destructive',
      });
      return false;
    }
  }

  async function copiarYAbrir(t: { id: number; label: string; texto: string }) {
    if (!elegido) return;
    try { await navigator.clipboard.writeText(t.texto); } catch { /* sin portapapeles, el chat lleva el texto igual */ }
    setCopiada(t.id);
    setTimeout(() => setCopiada(null), 1800);
    await apuntar(elegido, t.label);
    if (!abrirWhatsapp(elegido.telefono, t.texto)) {
      toast({ title: 'Ese teléfono no sirve', description: elegido.telefono || '(vacío)', variant: 'destructive' });
    }
  }

  function siguiente() {
    const i = cola.findIndex((x) => x.id === elegido?.id);
    setElegido(cola[i + 1] || cola[0] || null);
  }

  if (!projectId) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Elige un proyecto concreto para trabajar la cola de WhatsApp.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <WhatsappLogo size={26} weight="duotone" className="text-emerald-600" />
            WhatsApp
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            A quién toca escribir. Coloca esta ventana a media pantalla y WhatsApp Web al lado.
          </p>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-card text-sm">
            <UsersThree size={14} className="text-muted-foreground" />
            <select value={responsableId ?? ''} onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : null)}
              className="bg-transparent focus:outline-none max-w-[170px]" title="Ver la cola de otra gestora">
              <option value="">Todas las gestoras</option>
              {gestoras.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
            </select>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <select value={estado} onChange={(e) => setEstado(e.target.value)}
          className="h-9 px-2.5 rounded-md border border-border bg-card text-sm">
          <option value="">Todos los estados</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{e.replace(/_/g, ' ')}</option>)}
        </select>
        <button type="button" onClick={() => setSinContactar((v) => !v)}
          className={`h-9 px-3 rounded-md text-sm font-semibold border transition-colors ${
            sinContactar ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:text-foreground'
          }`}>
          Sin contactar nunca
        </button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {cargando ? 'cargando…' : `${cola.length} en la cola`}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] gap-4">
        {/* La cola */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="max-h-[62vh] overflow-y-auto divide-y divide-border">
            {cola.length === 0 && !cargando && (
              <p className="p-6 text-sm text-muted-foreground text-center">
                Nadie pendiente con estos filtros.
              </p>
            )}
            {cola.map((p) => {
              const dias = diasSinContacto(p);
              const activo = p.id === elegido?.id;
              return (
                <button key={p.id} type="button" onClick={() => setElegido(p)}
                  className={`w-full text-left px-3 py-2.5 transition-colors ${
                    activo ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-muted/50 border-l-2 border-l-transparent'
                  }`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">{p.nombre || 'Sin nombre'}</span>
                    {p.contactos === 0
                      ? <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 shrink-0">SIN CONTACTAR</span>
                      : <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">{dias}&nbsp;d</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{p.producto}</div>
                  <div className="text-[11px] text-muted-foreground/70">
                    {p.status.replace(/_/g, ' ')}{esAdmin && p.gestora ? ` · ${p.gestora}` : ''}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Las plantillas, ya rellenadas */}
        <div className="bg-card border border-border rounded-lg p-4">
          {!elegido ? (
            <p className="text-sm text-muted-foreground text-center py-10">Elige a alguien de la cola.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-border">
                <div className="min-w-0">
                  <h2 className="font-bold truncate">{elegido.nombre}</h2>
                  <p className="text-xs text-muted-foreground truncate">
                    {elegido.producto} · {elegido.telefono || 'sin teléfono'}
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-0.5">
                    Entró el {elegido.entrada}
                    {elegido.contactos === 0
                      ? ' · nunca se le ha escrito'
                      : ` · ${elegido.contactos} contactos, el último hace ${diasSinContacto(elegido)} días`}
                  </p>
                </div>
                <button type="button" onClick={siguiente}
                  className="shrink-0 inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-foreground">
                  Siguiente <ArrowRight size={13} weight="bold" />
                </button>
              </div>

              {textos.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Este proyecto no tiene plantillas todavía.
                </p>
              )}

              <div className="space-y-2.5">
                {textos.map((t) => (
                  <div key={t.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        {t.label}
                        {t.ambito === 'personal' && (
                          <span className="ml-1.5 font-normal normal-case text-muted-foreground/60">· solo tuya</span>
                        )}
                      </span>
                      <button type="button" onClick={() => copiarYAbrir(t)}
                        disabled={!elegido.telefono}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40">
                        {copiada === t.id ? <CheckCircle size={13} weight="fill" /> : <Copy size={13} weight="bold" />}
                        {copiada === t.id ? 'Copiado' : 'Copiar y abrir'}
                      </button>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{t.texto}</p>
                  </div>
                ))}
              </div>

              {!elegido.telefono && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-2.5">
                  <Warning size={15} weight="fill" className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900 dark:text-amber-300">
                    Esta persona no tiene teléfono, así que no se le puede escribir por aquí.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
