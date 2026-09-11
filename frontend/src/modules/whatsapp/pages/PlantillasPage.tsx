import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  WhatsappLogo, Plus, Trash, FloppyDisk, Users, User,
  MagnifyingGlass, Copy, Check, ImageSquare, PencilSimple, ChatText,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { whatsappApi, type PlantillaWhatsapp } from '../api/whatsapp.api';

/**
 * Las plantillas de WhatsApp, para CONSULTARLAS y para editarlas.
 *
 * Diego: «necesitamos un apartado para plantillas de WhatsApp que las gestoras
 * puedan usar».
 *
 * Esta pantalla era solo un editor: diez cuadros de texto grises y en desorden.
 * Para una gestora eso no es un sitio donde buscar el mensaje que le toca — es
 * un formulario que ademas no puede tocar, porque las compartidas solo las
 * cambia un administrador.
 *
 * Asi que la pantalla abre en modo CONSULTA: los mensajes agrupados por el dia
 * del proceso, con su letra pequena, la marca de los que llevan imagen, un
 * boton de copiar y el enlace al chat. El editor sigue entero, detras de
 * «Editar»: no se ha quitado nada.
 *
 * QUE NO HACE Y ES A PROPOSITO: no envia. Enviar es del chat, donde ademas se
 * rellenan los huecos con los datos de esa persona. Aqui el texto sale con los
 * huecos a la vista, que es como hay que leerlo antes de usarlo.
 */

const VARIABLES = ['{nombre}', '{nombreCompleto}', '{producto}', '{proyecto}', '{email}', '{teléfono}'];

// Sin tildes y en minuscula, para que «matricula» encuentre «Matrícula». Con un
// mapa y no con normalize('NFD'): se lee, y no hace falta una expresion regular
// de rangos Unicode para quitar cuatro acentos.
const TILDES: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i', ó: 'o', ò: 'o', ö: 'o', ô: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u', ñ: 'n', ç: 'c',
};
const plano = (s: string) =>
  (s || '').toLowerCase().split('').map((c) => TILDES[c] || c).join('');

/**
 * De que dia del proceso es cada plantilla.
 *
 * Sale del NOMBRE y no de una columna nueva: las del proceso se llaman «Día 1 ·
 * …», «Día X · …» porque asi las cargo la migracion 151, y las que alguien cree
 * a mano caen en «Otras», que es donde deben caer. Una columna obligaria a
 * rellenarla cada vez que una gestora crea una plantilla suya.
 */
const GRUPOS: { clave: string; titulo: string; desc: string; casa: (l: string) => boolean }[] = [
  { clave: 'd1', titulo: 'Día 1 · Primer contacto', desc: 'Saludo, ficha de la formación y aviso del correo', casa: (l) => l.startsWith('Día 1') },
  { clave: 'd2', titulo: 'Día 2 · Prueba social', desc: 'Las opiniones, en tres mensajes seguidos', casa: (l) => l.startsWith('Día 2') },
  { clave: 'd3', titulo: 'Día 3 · Última plaza', desc: 'Cierre de convocatoria y facilidades de pago', casa: (l) => l.startsWith('Día 3') },
  { clave: 'd4', titulo: 'Día 4 · Último recurso', desc: 'El descuento o la beca, según el CRM', casa: (l) => l.startsWith('Día 4') },
  { clave: 'dx', titulo: 'Fin de mes · Seguimiento', desc: 'Para toda la base, sin presión de venta', casa: (l) => l.startsWith('Día X') },
  { clave: 'otras', titulo: 'Otras', desc: 'Las que no son del proceso comercial', casa: () => true },
];

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
  // Abre en consulta. El editor es la excepción: se entra aquí a buscar qué
  // mandar mucho más a menudo que a cambiar un texto.
  const [modo, setModo] = useState<'consulta' | 'editar'>('consulta');
  const [busca, setBusca] = useState('');
  const [copiada, setCopiada] = useState<number | null>(null);

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

  // Las apagadas no llegan: el backend ya filtra por `active`, asi que las
  // cuatro genericas viejas --«Saludo inicial», «Oferta»...-- no salen ni aqui
  // ni en el editor.
  //
  // Cada una cae en UN grupo, el primero que la reconoce: «Otras» acepta a
  // cualquiera, asi que sin esto la del dia 1 saldria dos veces.
  const agrupadas = useMemo(() => {
    const q = plano(busca.trim());
    const filtradas = q
      ? lista.filter((t) => plano(t.label).includes(q) || plano(t.body).includes(q))
      : lista;
    const puestas = new Set<number>();
    return GRUPOS
      .map((g) => {
        const suyas = filtradas.filter((t) => !puestas.has(t.id) && g.casa(t.label || ''));
        suyas.forEach((t) => puestas.add(t.id));
        return { ...g, plantillas: suyas };
      })
      .filter((g) => g.plantillas.length > 0);
  }, [lista, busca]);

  const cuantas = agrupadas.reduce((n, g) => n + g.plantillas.length, 0);

  async function copiar(t: PlantillaWhatsapp) {
    try {
      await navigator.clipboard.writeText(t.body);
      setCopiada(t.id);
      setTimeout(() => setCopiada((v) => (v === t.id ? null : v)), 2000);
    } catch {
      // Sin permiso de portapapeles no se puede copiar por codigo, y callarlo
      // haria creer que se copio. Se dice, y se selecciona a mano.
      toast({ title: 'No se pudo copiar', description: 'Selecciona el texto y cópialo a mano.', variant: 'destructive' });
    }
  }

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
            {modo === 'consulta'
              ? 'Los mensajes del proceso, por el día que toca. Copia el que necesites o úsalo desde el chat.'
              : 'Las compartidas las ve todo el equipo. Las tuyas, solo tú.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={() => { setModo(modo === 'consulta' ? 'editar' : 'consulta'); setNueva(null); }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted/60">
            {modo === 'consulta'
              ? <><PencilSimple size={14} weight="bold" /> Editar</>
              : <><MagnifyingGlass size={14} weight="bold" /> Consultar</>}
          </button>
          {modo === 'editar' && !nueva && (
            <button type="button"
              onClick={() => setNueva({ label: '', body: '', ambito: esAdmin ? 'compartida' : 'personal' })}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              <Plus size={14} weight="bold" /> Nueva
            </button>
          )}
        </div>
      </header>

      {modo === 'consulta' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="relative flex-1">
              <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nombre o por lo que dice el mensaje…"
                className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-card text-sm" />
            </div>
            <Link to="/whatsapp/chat"
              className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted/60">
              <ChatText size={14} weight="bold" /> Ir al chat
            </Link>
          </div>

          {cargando && <div className="bg-card border border-border rounded-lg p-6 h-40 animate-pulse" />}

          {!cargando && cuantas === 0 && (
            <div className="bg-card border border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
              {busca.trim()
                ? 'No hay ninguna que diga eso.'
                : 'Este proyecto no tiene plantillas todavía.'}
            </div>
          )}

          {agrupadas.map((g) => (
            <section key={g.clave} className="space-y-2">
              <div className="flex items-baseline gap-2 pt-1">
                <h2 className="text-sm font-semibold">{g.titulo}</h2>
                <span className="text-[11px] text-muted-foreground">{g.desc}</span>
              </div>
              {g.plantillas.map((t) => (
                <article key={t.id} className="bg-card border border-border rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{t.label}</span>
                      {t.pide_adjunto && (
                        <span title="Va con una imagen detrás"
                          className="inline-flex flex-shrink-0 items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                          <ImageSquare size={11} weight="bold" /> imagen
                        </span>
                      )}
                      {t.ambito === 'personal' && (
                        <span title="Solo tuya" className="flex-shrink-0 text-muted-foreground">
                          <User size={13} weight="duotone" />
                        </span>
                      )}
                    </h3>
                    <button type="button" onClick={() => copiar(t)}
                      className="inline-flex flex-shrink-0 items-center gap-1 h-8 px-2.5 rounded-md border border-border text-xs font-semibold hover:bg-muted/60">
                      {copiada === t.id
                        ? <><Check size={13} weight="bold" className="text-emerald-600" /> Copiado</>
                        : <><Copy size={13} weight="bold" /> Copiar</>}
                    </button>
                  </div>
                  {/* El texto tal cual, con los huecos a la vista: es como hay
                      que leerlo antes de mandarlo. Quien los rellena es el chat. */}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{t.body}</p>
                  {t.pista && (
                    <p className="mt-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                      {t.pista}
                    </p>
                  )}
                </article>
              ))}
            </section>
          ))}
        </>
      )}

      {modo === 'editar' && (
        <>
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
        </>
      )}
    </div>
  );
}
