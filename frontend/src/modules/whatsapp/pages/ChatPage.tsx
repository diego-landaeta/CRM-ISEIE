import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MainContainer, ChatContainer, MessageList, Message, MessageInput,
  ConversationList, Conversation, Avatar, Sidebar, Search, ConversationHeader,
  MessageSeparator, InfoButton, Loader,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { Prohibit, PencilSimpleLine, X, MagnifyingGlass, Microphone, Stop, UsersThree, PlugsConnected } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import {
  chatApi, urlMedia,
  type ChatWhatsapp, type MensajeWhatsapp, type ConexionWhatsapp,
} from '../api/whatsapp.api';
import './chat.css';

// El chat de WhatsApp dentro del CRM.
//
// La maquetacion la pone @chatscope/chat-ui-kit-react (MIT), que es un kit de
// mensajeria ya hecho: burbujas, agrupado, separadores, lista de
// conversaciones. No tiene sentido reinventar eso a mano — lo que si es nuestro
// es lo de debajo: los frenos, el cruce con leads y los adjuntos.
const CADA_MS = 5000;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

function diaDe(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const igual = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (igual(d, hoy)) return 'Hoy';
  if (igual(d, ayer)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

const iniciales = (n: string) =>
  n.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';

/**
 * La foto de perfil de WhatsApp, con las iniciales de recurso.
 *
 * La direccion que da WhatsApp caduca, asi que puede fallar en cualquier
 * momento: cuando pasa se cae a las letras en vez de dejar un hueco roto.
 */
function Foto({ nombre, url, grupo }: { nombre: string; url?: string | null; grupo?: boolean }) {
  const [rota, setRota] = useState(false);
  if (url && !rota) {
    return <img src={url} alt={nombre} className="wa-foto" onError={() => setRota(true)} />;
  }
  // Un grupo sin foto se distingue de una persona sin foto.
  if (grupo) return <div className="wa-inicial" title={nombre}><UsersThree size={17} weight="fill" /></div>;
  return <div className="wa-inicial" title={nombre}>{iniciales(nombre)}</div>;
}

/** Lo que va dentro de la burbuja cuando el mensaje trae un archivo. */
function Adjunto({ m, alPedir, bajando }: { m: MensajeWhatsapp; alPedir: (id: number) => void; bajando: boolean }) {
  // La direccion la arma el frontend y el permiso lo firma el servidor. Sin
  // firma, el navegador pedia el archivo sin cabeceras y recibia un 401; con la
  // direccion entera puesta por el servidor, le faltaba el prefijo /crm/ y
  // pedia algo que no existe. Las dos mitades, cada una de quien la sabe.
  const url = urlMedia(m.id) + (m.media_firma || '');
  // Sin archivo no significa que haya fallado.
  //
  // Del historial viejo no se baja todo a la vez: con un movil de anos son mas
  // de 17.000 archivos y mas de una hora de cola, con lo recien llegado
  // esperando detras. Lo que se deja fuera se pide aqui, de uno en uno y
  // saltandose la cola. Antes ponia «no se pudo descargar», que ademas era
  // mentira: no habia fallado nada, es que no le tocaba.
  if (!m.media_url) {
    return (
      <button type="button" className="wa-pedir" onClick={() => alPedir(m.id)} disabled={bajando}>
        {bajando ? 'Buscando…' : `⬇ Descargar ${m.tipo}`}
      </button>
    );
  }
  if (m.tipo === 'audio') return <audio controls preload="none" src={url} className="wa-audio" />;
  // El sticker no lleva burbuja ni ocupa como una foto: en WhatsApp va suelto
  // sobre el fondo y es pequeño. Salia a 512 px dentro de un recuadro verde.
  if (m.tipo === 'sticker') {
    return <img src={url} alt={m.nombre_archivo || 'sticker'} className="wa-sticker" />;
  }
  if (m.tipo === 'imagen') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={m.nombre_archivo || 'imagen'} className="wa-imagen" />
      </a>
    );
  }
  if (m.tipo === 'video') return <video controls preload="metadata" src={url} className="wa-imagen" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="wa-doc">
      📄 {m.nombre_archivo || 'documento'}
    </a>
  );
}

const TIC = { enviado: '✓', entregado: '✓✓', leido: '✓✓', fallido: '⚠' } as const;

export default function ChatPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id: number } | null };
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [chats, setChats] = useState<ChatWhatsapp[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [conv, setConv] = useState<ChatWhatsapp | null>(null);
  const [mensajes, setMensajes] = useState<MensajeWhatsapp[]>([]);
  // Cuantos mensajes se piden del hilo. Se sube al pulsar «ver mas»: sin esto
  // solo se veian los ultimos 100 y no habia forma de llegar a los de antes.
  const [cuantos, setCuantos] = useState(100);
  const [enviando, setEnviando] = useState(false);
  const [conexion, setConexion] = useState<ConexionWhatsapp | null>(null);
  const [filtro, setFiltro] = useState('');
  // Dos estados distintos, y la diferencia importa:
  //   · `cargando`  — todavia no ha vuelto la primera peticion.
  //   · `llegando`  — ya hay conversaciones, pero siguen entrando. Al emparejar,
  //                   WhatsApp manda el historial en tandas y la lista crece
  //                   durante un minuto largo: sin avisar, parece que faltan.
  const [cargando, setCargando] = useState(true);
  const [sync, setSync] = useState<{ entrando: boolean; mensajes: number; conversaciones: number; adjuntosPendientes: number } | null>(null);
  const cuantasAntes = useRef(0);
  const [grabando, setGrabando] = useState(false);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  // Los dos paneles que antes eran ventanas del navegador. window.prompt y
  // window.confirm los pinta el sistema operativo: rompen el chat por completo,
  // no se pueden dar estilo y en algunos navegadores ni salen.
  const [pidiendoTelefono, setPidiendoTelefono] = useState(false);
  const [telefonoNuevo, setTelefonoNuevo] = useState('');
  const [pidiendoMotivo, setPidiendoMotivo] = useState(false);
  // Los adjuntos que se estan pidiendo ahora mismo, para que el boton lo diga.
  const [bajando, setBajando] = useState<number[]>([]);
  const [motivoNuevo, setMotivoNuevo] = useState('');
  const [busca, setBusca] = useState('');
  const [candidatos, setCandidatos] = useState<Array<{ id: number; nombre: string; telefono: string | null; status: string }>>([]);
  const marco = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState(520);
  const ficheroRef = useRef<HTMLInputElement>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);

  useEffect(() => {
    const leer = () => chatApi.conexion().then((r) => setConexion(r.success ? r.data : null)).catch(() => {});
    leer();
    // La sesion se cae sola si el movil se queda sin internet. Se vigila para
    // que la gestora se entere en vez de escribir contra el vacio.
    const t = setInterval(leer, 30000);
    return () => clearInterval(t);
  }, []);

  const cargarLista = useCallback(async () => {
    try {
      const r = await chatApi.lista(projectId);
      if (!r.success) return;
      const lista = r.data || [];
      // Si han aparecido conversaciones desde la ultima vuelta, el historial
      // sigue entrando. Se apaga solo cuando deja de crecer.
      cuantasAntes.current = lista.length;
      setChats(lista);
    } finally {
      setCargando(false);
    }
  }, [projectId]);

  const cargarHilo = useCallback(async (id: number, limite = cuantos) => {
    const r = await chatApi.hilo(id, limite);
    if (!r.success) return;
    setConv(r.data.conversacion);
    setMensajes(r.data.mensajes || []);
  }, [cuantos]);

  useEffect(() => {
    cargarLista();
    const t = setInterval(() => {
      cargarLista();
      if (abierto) cargarHilo(abierto);
    }, CADA_MS);
    return () => clearInterval(t);
  }, [cargarLista, cargarHilo, abierto]);

  useEffect(() => { setCuantos(100); }, [abierto]);
  useEffect(() => { if (abierto) cargarHilo(abierto); }, [abierto, cargarHilo]);

  // El alto se MIDE, no se adivina.
  //
  // Estaba fijado a `100vh - 225px`, que es el mismo error que ya cometi con el
  // marco anterior: encima hay una barra de estado que aparece y desaparece, y
  // el relleno de la pagina cambia con el ancho. Sobraba media pantalla sin
  // usar. Se mide donde empieza el marco y se le da todo lo que queda.
  useEffect(() => {
    const medir = () => {
      const arriba = marco.current?.getBoundingClientRect().top;
      if (arriba === undefined) return;
      setAlto(Math.max(420, Math.round(window.innerHeight - arriba - 16)));
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', medir);
    return () => { ro.disconnect(); window.removeEventListener('resize', medir); };
  }, []);

  // Se pregunta al servidor si sigue entrando historial, en vez de adivinarlo
  // mirando si la lista crece: al emparejar hay tandas de varios minutos con
  // pausas largas en medio, y por el tamaño de la lista parecia que se habia
  // parado cuando no.
  useEffect(() => {
    const mirar = () => chatApi.sincronizacion()
      .then((r) => { if (r.success) setSync(r.data); })
      .catch(() => {});
    mirar();
    const t = setInterval(mirar, 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!nuevoAbierto) return undefined;
    const t = setTimeout(async () => {
      const r = await chatApi.buscarProspectos(projectId, busca);
      if (r.success) setCandidatos((r.data || []).filter((l) => l.telefono));
    }, 300);
    return () => clearTimeout(t);
  }, [nuevoAbierto, busca, projectId]);

  function fallo(e: unknown) {
    // Aqui contestan los frenos: ritmo, «no me escribas» y sin consentimiento.
    // El texto del servidor se enseña tal cual: esta escrito para una gestora.
    toast({ title: 'No se ha enviado', description: (e as Error).message, variant: 'destructive' });
  }

  async function enviar(texto: string) {
    const t = texto.replace(/<[^>]*>/g, '').trim();
    if (!t || !abierto || enviando) return;
    setEnviando(true);
    try {
      const r = await chatApi.enviar(abierto, t);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); }
  }

  async function mandarArchivo(f: File) {
    if (!abierto) return;
    setEnviando(true);
    try {
      const r = await chatApi.adjunto(abierto, f);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); }
  }

  async function alternarGrabacion() {
    if (grabando) { grabadora.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // WhatsApp espera opus. Chrome graba en webm y Firefox puede en ogg, pero
      // el codec de dentro es opus en los dos: se pide ogg primero porque es lo
      // que WhatsApp entiende sin convertir, y si no se puede, webm con opus.
      const formatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
      const formato = formatos.find((f) => MediaRecorder.isTypeSupported(f));
      const mr = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined);
      trozos.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGrabando(false);
        const blob = new Blob(trozos.current, { type: mr.mimeType || 'audio/webm' });
        const ext = (mr.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
        if (blob.size > 800) {
          await mandarArchivo(new File([blob], `nota-de-voz.${ext}`, { type: blob.type }));
        }
      };
      mr.start(); grabadora.current = mr; setGrabando(true);
    } catch {
      toast({ title: 'Sin microfono', description: 'El navegador no dio permiso para grabar.', variant: 'destructive' });
    }
  }

  async function abrirPorTelefono() {
    const t = telefonoNuevo.replace(/[^0-9]/g, '');
    if (t.length < 9) {
      toast({ title: 'Ese telefono no vale', description: 'Ponlo con prefijo de pais y sin signos.', variant: 'destructive' });
      return;
    }
    try {
      const r = await chatApi.abrirPorTelefono(t);
      if (!r.success) throw new Error(r.error || 'No se pudo abrir');
      setPidiendoTelefono(false); setTelefonoNuevo('');
      setNuevoAbierto(false); setBusca('');
      await cargarLista(); setAbierto(r.data.id);
      toast({
        title: 'Chat abierto',
        description: 'Si nunca te ha escrito y no es prospecto, el CRM se negara a enviar.',
      });
    } catch (e) { fallo(e); }
  }

  async function abrirCon(leadId: number) {
    try {
      const r = await chatApi.abrir(leadId);
      if (!r.success) throw new Error(r.error || 'No se pudo abrir');
      setNuevoAbierto(false); setBusca('');
      await cargarLista(); setAbierto(r.data.id);
    } catch (e) { fallo(e); }
  }

  /** Pide un adjunto del historial que no se bajo en su momento. */
  async function pedirAdjunto(mensajeId: number) {
    try {
      setBajando((b) => [...b, mensajeId]);
      const r = await chatApi.descargarAdjunto(mensajeId);
      if (!r.success) throw new Error(r.error || 'No se pudo pedir');
      if (abierto) await cargarHilo(abierto);
    } catch (e) {
      // Muchos archivos viejos ya no existen en WhatsApp. No es un fallo del
      // CRM y el mensaje del servidor lo explica: se ensena tal cual.
      fallo(e);
    } finally {
      setBajando((b) => b.filter((x) => x !== mensajeId));
    }
  }

  async function marcarNoEscribir() {
    if (!abierto) return;
    const r = await chatApi.noEscribir(abierto, motivoNuevo.trim());
    setPidiendoMotivo(false); setMotivoNuevo('');
    if (r.success) {
      toast({ title: 'Marcado', description: 'El CRM no volvera a escribir a este numero.' });
      cargarHilo(abierto); cargarLista();
    }
  }

  const nombreDe = (c: ChatWhatsapp) =>
    c.lead_nombre || c.nombre_push || (c.es_grupo ? 'Grupo sin nombre' : c.telefono);
  const visibles = filtro
    ? chats.filter((c) => `${nombreDe(c)} ${c.telefono}`.toLowerCase().includes(filtro.toLowerCase()))
    : chats;

  if (conexion && !conexion.configurado) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="font-semibold mb-1">WhatsApp no esta conectado</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{conexion.motivo}</p>
        <Link to="/whatsapp/conexion" className="text-sm text-primary hover:underline mt-3 inline-block">
          Ir a conectar el numero
        </Link>
      </div>
    );
  }

  let ultimoDia = '';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs bg-card border border-border rounded-lg px-3 py-1.5">
        <span className={`w-2 h-2 rounded-full ${conexion?.conectado ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {conexion?.conectado
          ? <span className="text-muted-foreground">
              Tu WhatsApp: <strong className="text-foreground">
                {conexion.nombre || (conexion.numero ? `+${conexion.numero}` : conexion.instancia)}
              </strong>
            </span>
          : <span className="text-amber-700 dark:text-amber-400">
              No tienes WhatsApp enlazado — <Link to="/whatsapp/conexion" className="underline">enlazar mi numero</Link>
            </span>}
        {/* La pantalla donde se enlaza o se desvincula el numero. Estaba solo en
            el menu lateral y desde el chat no habia forma de llegar. */}
        <Link to="/whatsapp/conexion" title="Conectar o desvincular el numero"
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <PlugsConnected size={14} weight="bold" />
          <span className="font-medium">Conexion</span>
        </Link>
      </div>

      <div ref={marco} className="wa-marco" style={{ height: alto }}>
        <MainContainer responsive>
          <Sidebar position="left" scrollable>
            <div className="wa-barra-lista">
              <Search placeholder="Buscar un chat" value={filtro}
                onChange={(v: string) => setFiltro(v)} onClearClick={() => setFiltro('')} />
              <button type="button" title="Escribir a un prospecto"
                onClick={() => setNuevoAbierto(true)} className="wa-btn-nuevo">
                <PencilSimpleLine size={16} weight="bold" />
              </button>
            </div>
            {sync?.entrando && (
              <div className="wa-sincronizando">
                Sincronizando… {sync.conversaciones} chats · {sync.mensajes} mensajes
                {sync.adjuntosPendientes > 0 && ` · ${sync.adjuntosPendientes} archivos en cola`}
              </div>
            )}
            {!sync?.entrando && (sync?.adjuntosPendientes ?? 0) > 0 && (
              <div className="wa-sincronizando">
                Descargando {sync?.adjuntosPendientes} archivos…
              </div>
            )}
            <ConversationList>
              {visibles.map((c) => (
                <Conversation key={c.id} name={nombreDe(c)}
                  info={c.no_escribir ? 'no escribir' : (c.ultimo_texto || c.telefono)}
                  active={abierto === c.id}
                  unreadCnt={c.no_leidos || undefined}
                  onClick={() => setAbierto(c.id)}>
                  <Avatar name={nombreDe(c)}><Foto nombre={nombreDe(c)} url={c.avatar_url} grupo={c.es_grupo} /></Avatar>
                </Conversation>
              ))}
            </ConversationList>
          </Sidebar>

          {conv ? (
            <ChatContainer>
              <ConversationHeader>
                <Avatar name={nombreDe(conv)}><Foto nombre={nombreDe(conv)} url={conv.avatar_url} grupo={conv.es_grupo} /></Avatar>
                <ConversationHeader.Content userName={nombreDe(conv)}
                  info={conv.es_grupo ? 'Grupo'
                    : conv.lead_id ? `${conv.telefono} · prospecto`
                    : `${conv.telefono} · sin prospecto`} />
                <ConversationHeader.Actions>
                  {conv.lead_id && (
                    <Link to={`/prospectos/${conv.lead_id}`} title="Ver la ficha del prospecto">
                      <InfoButton />
                    </Link>
                  )}
                  <button type="button" onClick={() => setPidiendoMotivo(true)} className="wa-btn-prohibir"
                    title="No volver a escribir a este numero">
                    <Prohibit size={17} />
                  </button>
                </ConversationHeader.Actions>
              </ConversationHeader>

              <MessageList>
                {/* Va como separador y no como <div> ni como MessageList.Content:
                    el primero no es un hijo que MessageList admita, y el segundo
                    es EXCLUYENTE —si aparece, el kit descarta todos los demas
                    hijos y el hilo se queda vacio—. Encima queda como la pildora
                    gris de WhatsApp, que es justo lo que se buscaba. */}
                {mensajes.length >= cuantos && (
                  <MessageSeparator className="wa-ver-mas" content="Ver mensajes anteriores"
                    role="button" tabIndex={0}
                    onClick={() => setCuantos((n) => n + 200)}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') setCuantos((n) => n + 200);
                    }} />
                )}
                {/* flatMap y no map: MessageList solo admite sus propios hijos,
                    y envolver cada mensaje en un <div> para colgarle el
                    separador del dia le rompia la estructura. Van sueltos. */}
                {mensajes.flatMap((m, i) => {
                  const dia = diaDe(m.ts);
                  const nuevoDia = dia !== ultimoDia;
                  if (nuevoDia) ultimoDia = dia;
                  const prev = mensajes[i - 1];
                  const sig = mensajes[i + 1];
                  const mismoQuePrev = !nuevoDia && prev?.direccion === m.direccion;
                  const mismoQueSig = sig?.direccion === m.direccion && diaDe(sig.ts) === dia;
                  const posicion = mismoQuePrev && mismoQueSig ? 'normal'
                    : mismoQuePrev ? 'last' : mismoQueSig ? 'first' : 'single';
                  const mia = m.direccion === 'saliente';
                  return [
                    nuevoDia ? <MessageSeparator key={`d${m.id}`} content={dia} /> : null,
                    <Message key={m.id} className={m.tipo === 'sticker' ? 'wa-msg-sticker' : undefined}
                      model={{
                        direction: mia ? 'outgoing' : 'incoming',
                        position: posicion,
                        type: 'custom',
                      }}>
                      <Message.CustomContent>
                        {m.tipo !== 'texto' && <div className="wa-adjunto"><Adjunto m={m} alPedir={pedirAdjunto} bajando={bajando.includes(m.id)} /></div>}
                        {m.texto && <div className="wa-texto">{m.texto}</div>}
                        <span className={`wa-meta ${m.estado === 'leido' ? 'wa-leido' : ''}`}>
                          {hora(m.ts)}{mia && m.estado ? ` ${TIC[m.estado]}` : ''}
                        </span>
                      </Message.CustomContent>
                    </Message>,
                  ].filter(Boolean);
                })}
              </MessageList>

              {conv.no_escribir ? (
                <div className="wa-bloqueado">
                  <Prohibit size={15} weight="bold" />
                  <span>
                    Esta persona pidio que no se le escriba.
                    {conv.motivo_no_escribir ? ` (${conv.motivo_no_escribir})` : ''}
                  </span>
                </div>
              ) : (
                <MessageInput placeholder={grabando ? 'Grabando nota de voz…' : 'Escribe un mensaje'}
                  onSend={enviar} disabled={enviando} attachButton
                  onAttachClick={() => ficheroRef.current?.click()}
                  sendDisabled={enviando} />
              )}
            </ChatContainer>
          ) : (
            <ChatContainer>
              <MessageList>
                <MessageList.Content className="wa-vacio">
                  {chats.length === 0 && !cargando
                    ? 'Aqui apareceran tus conversaciones en cuanto enlaces tu numero.'
                    : 'Elige una conversacion, o escribe a un prospecto con el lapiz de la izquierda.'}
                </MessageList.Content>
              </MessageList>
            </ChatContainer>
          )}
        </MainContainer>

        {/* El microfono va aparte: el kit no trae boton de nota de voz. */}
        {conv && !conv.no_escribir && (
          <button type="button" onClick={alternarGrabacion} disabled={enviando}
            title={grabando ? 'Parar y enviar la nota de voz' : 'Grabar una nota de voz'}
            className={`wa-btn-micro ${grabando ? 'wa-grabando' : ''}`}>
            {grabando ? <Stop size={17} weight="fill" /> : <Microphone size={18} />}
          </button>
        )}
      </div>

      <input ref={ficheroRef} type="file" className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) mandarArchivo(f); e.target.value = ''; }} />

      {/* Escribir a un numero suelto. Antes era un window.prompt del navegador:
          una caja gris del sistema encima del chat, imposible de dar estilo. */}
      {pidiendoTelefono && (
        <div className="wa-velo" onClick={() => setPidiendoTelefono(false)}>
          <form className="wa-panel" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); abrirPorTelefono(); }}>
            <div className="wa-panel-cabecera">
              <span>Escribir a un numero</span>
              <button type="button" onClick={() => setPidiendoTelefono(false)} className="wa-panel-cerrar">
                <X size={15} />
              </button>
            </div>
            <div className="wa-panel-cuerpo">
              <input autoFocus value={telefonoNuevo} inputMode="numeric"
                onChange={(e) => setTelefonoNuevo(e.target.value)}
                placeholder="34600111222" className="wa-campo" />
              <p className="wa-panel-nota">
                Con prefijo de pais y sin signos. Si esa persona no es prospecto y nunca
                te ha escrito, el CRM se negara a enviarle nada.
              </p>
            </div>
            <div className="wa-panel-pie">
              <button type="button" onClick={() => setPidiendoTelefono(false)} className="wa-btn-suave">Cancelar</button>
              <button type="submit" className="wa-btn-verde">Abrir chat</button>
            </div>
          </form>
        </div>
      )}

      {/* «No volver a escribir». Igual: era otro prompt del navegador. */}
      {pidiendoMotivo && (
        <div className="wa-velo" onClick={() => setPidiendoMotivo(false)}>
          <form className="wa-panel" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); marcarNoEscribir(); }}>
            <div className="wa-panel-cabecera">
              <span>No volver a escribir</span>
              <button type="button" onClick={() => setPidiendoMotivo(false)} className="wa-panel-cerrar">
                <X size={15} />
              </button>
            </div>
            <div className="wa-panel-cuerpo">
              <p className="wa-panel-nota">
                El CRM no le enviara nada mas a <strong>{conv ? nombreDe(conv) : ''}</strong>,
                ni con plantilla ni «solo una ultima vez». Se puede quitar despues.
              </p>
              <input autoFocus value={motivoNuevo} onChange={(e) => setMotivoNuevo(e.target.value)}
                placeholder="Motivo (opcional): pidio que no le escribieran…" className="wa-campo" />
            </div>
            <div className="wa-panel-pie">
              <button type="button" onClick={() => setPidiendoMotivo(false)} className="wa-btn-suave">Cancelar</button>
              <button type="submit" className="wa-btn-rojo">Marcar</button>
            </div>
          </form>
        </div>
      )}

      {/* Chat nuevo. Se elige un PROSPECTO, no se teclea un numero suelto: quien
          esta en la base dejo su telefono en un formulario nuestro, y esa es la
          diferencia entre escribir a quien lo pidio y escribir en frio. */}
      {nuevoAbierto && (
        <div className="wa-velo" onClick={() => setNuevoAbierto(false)}>
          <div className="wa-panel" onClick={(e) => e.stopPropagation()}>
            <div className="wa-panel-cabecera">
              <span>Escribir a un prospecto</span>
              <button type="button" onClick={() => setNuevoAbierto(false)} className="wa-panel-cerrar">
                <X size={15} />
              </button>
            </div>
            <div className="wa-panel-cuerpo">
              <div className="relative">
                <MagnifyingGlass size={14} className="wa-lupa" />
                <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Nombre, email o telefono…" className="wa-campo wa-campo-lupa" />
              </div>
            </div>
            <div className="wa-lista-panel">
              <button type="button" onClick={() => { setPidiendoTelefono(true); setNuevoAbierto(false); }}
                className="wa-fila wa-fila-accion">
                + Escribir a un numero que no esta en la base
              </button>
              {candidatos.length === 0 && (
                <p className="wa-panel-nota" style={{ padding: '14px', textAlign: 'center' }}>
                  Sin prospectos con telefono. Solo se puede escribir a quien dejo el suyo.
                </p>
              )}
              {candidatos.map((l) => (
                <button key={l.id} type="button" onClick={() => abrirCon(l.id)} className="wa-fila">
                  <div className="wa-fila-nombre">{l.nombre}</div>
                  <div className="wa-fila-dato">{l.telefono} · {l.status}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
