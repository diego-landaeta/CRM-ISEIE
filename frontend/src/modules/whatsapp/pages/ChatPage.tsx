import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MainContainer, ChatContainer, MessageList, Message, MessageInput,
  ConversationList, Conversation, Avatar, Sidebar, Search, ConversationHeader,
  MessageSeparator, InfoButton, Loader, InputToolbox,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { Prohibit, PencilSimpleLine, X, MagnifyingGlass, Microphone, Stop, UsersThree, PlugsConnected, WarningCircle, ArrowBendUpLeft, ArrowsOut, ArrowsIn, CaretLeft } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import {
  chatApi, urlMedia,
  type ChatWhatsapp, type MensajeWhatsapp, type ConexionWhatsapp,
} from '../api/whatsapp.api';
import SelectorDeSesion, { type SesionElegida } from '../components/SelectorDeSesion';
import Tour, { tourPendiente } from '../components/Tour';
import NotaDeVoz from '../components/NotaDeVoz';
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
  // La nota de voz, con reproductor propio. El <audio controls> del navegador
  // es un pastillon blanco que no se puede pintar de otro color.
  if (m.tipo === 'audio') return <NotaDeVoz src={url} mia={m.direccion === 'saliente'} />;
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

  // De quien es el WhatsApp que se esta viendo. Una gestora solo tiene el suyo
  // y el selector ni aparece; quien manda puede abrir el de otra persona.
  const [sesion, setSesion] = useState<SesionElegida>({ usuarioId: null, nombre: '', esMia: true });
  const deQuien = sesion.usuarioId;

  // Se puede llegar aqui desde la ficha de un prospecto o desde Clientes, con
  // la conversacion ya en la direccion. Antes esos botones abrian WhatsApp Web
  // en otra pestaña: se salia del CRM y no quedaba registro de nada.
  const [params, setParams] = useSearchParams();

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
  // El mensaje fallido que se esta reintentando ahora mismo.
  const [reintentando, setReintentando] = useState<number | null>(null);
  // El mensaje al que se esta respondiendo, si hay alguno.
  const [citando, setCitando] = useState<MensajeWhatsapp | null>(null);
  // El tour, solo la primera vez y solo cuando ya hay algo que enseñar: sobre
  // una pantalla vacia no señala nada y no se entiende.
  const [tour, setTour] = useState(false);
  // Solo el chat, sin el resto del CRM alrededor. Para cuando se pasa la
  // mañana aqui: el menu, la cabecera y el selector de proyecto no pintan nada.
  const [aPantalla, setAPantalla] = useState(false);
  // En un telefono no caben la lista y el hilo a la vez: o una u otro, como en
  // WhatsApp. Se mide el ancho de verdad en vez de suponerlo.
  const [estrecho, setEstrecho] = useState(() => window.innerWidth < 900);
  // Quien esta escribiendo al otro lado. En un grupo dice ademas QUIEN de
  // todos: «Maria escribiendo…», que es lo unico que sirve cuando son quince.
  const [escribiendo, setEscribiendo] = useState<{ quien: string; que: string } | null>(null);
  const [motivoNuevo, setMotivoNuevo] = useState('');
  const [busca, setBusca] = useState('');
  const [candidatos, setCandidatos] = useState<Array<{ id: number; nombre: string; telefono: string | null; status: string }>>([]);
  const marco = useRef<HTMLDivElement>(null);
  const [alto, setAlto] = useState(520);
  const ficheroRef = useRef<HTMLInputElement>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);

  useEffect(() => {
    // La conexion que importa es la de la sesion ABIERTA, no la de quien mira.
    // Sin el `deQuien`, un admin con la sesion de una gestora delante veia su
    // propio estado: el chat decia «no se puede enviar» aunque el numero de ella
    // estuviera perfectamente conectado.
    setConexion(null);
    const leer = () => chatApi.conexion(deQuien)
      .then((r) => setConexion(r.success ? r.data : null)).catch(() => {});
    leer();
    // La sesion se cae sola si el movil se queda sin internet. Se vigila para
    // que la gestora se entere en vez de escribir contra el vacio.
    const t = setInterval(leer, 30000);
    return () => clearInterval(t);
  }, [deQuien]);

  // Cambiar de persona vacia la pantalla antes de traer lo suyo. Sin esto se
  // quedan a la vista los chats de la anterior mientras carga, y basta un
  // segundo de confusion para escribirle a quien no era.
  useEffect(() => {
    setChats([]);
    setAbierto(null);
    setConv(null);
    setMensajes([]);
    setCargando(true);
  }, [deQuien]);

  // Abrir la que venga en la direccion, una sola vez: despues se quita de la
  // barra para que al recargar no vuelva a saltar a ella.
  useEffect(() => {
    const pedida = parseInt(params.get('conv') || '', 10);
    if (!Number.isInteger(pedida)) return;
    setAbierto(pedida);
    params.delete('conv');
    setParams(params, { replace: true });
  }, [params, setParams]);

  const cargarLista = useCallback(async () => {
    try {
      // La lista NO se filtra por proyecto, a proposito.
      //
      // El WhatsApp de una gestora es UNA bandeja: sus conversaciones son de los
      // proyectos que sean, y muchas de nadie todavia. Filtrando por el proyecto
      // elegido se veian 6 de 28 — y lo peor no era no verlas: era mandar un
      // mensaje, no encontrarlo en la lista y pensar que el CRM no lo habia
      // guardado. Estaba guardado; estaba escondido.
      //
      // De que proyecto es cada una se dice en la propia fila.
      const r = await chatApi.lista(null, deQuien);
      if (!r.success) return;
      const lista = r.data || [];
      // Si han aparecido conversaciones desde la ultima vuelta, el historial
      // sigue entrando. Se apaga solo cuando deja de crecer.
      cuantasAntes.current = lista.length;
      setChats(lista);
    } finally {
      setCargando(false);
    }
  }, [projectId, deQuien]);

  const cargarHilo = useCallback(async (id: number, limite = cuantos) => {
    const r = await chatApi.hilo(id, limite, deQuien);
    if (!r.success) return;
    setConv(r.data.conversacion);
    setMensajes(r.data.mensajes || []);
    setEscribiendo(r.data.escribiendo || null);
  }, [cuantos, deQuien]);

  useEffect(() => {
    cargarLista();
    const t = setInterval(() => {
      cargarLista();
      if (abierto) cargarHilo(abierto);
    }, CADA_MS);
    return () => clearInterval(t);
  }, [cargarLista, cargarHilo, abierto]);

  useEffect(() => { setCuantos(100); setCitando(null); }, [abierto]);

  // Escape para salir. Es lo que todo el mundo intenta primero, y sin esto hay
  // que buscar el boton con el raton.
  useEffect(() => {
    if (!aPantalla) return undefined;
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAPantalla(false); };
    window.addEventListener('keydown', alPulsar);
    // Se bloquea el desplazamiento de la pagina de detras mientras tanto.
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', alPulsar);
      document.body.style.overflow = antes;
    };
  }, [aPantalla]);

  useEffect(() => {
    if (chats.length && conv && tourPendiente()) setTour(true);
  }, [chats.length, conv]);
  useEffect(() => { if (abierto) cargarHilo(abierto); }, [abierto, cargarHilo]);

  // El alto se MIDE, no se adivina.
  //
  // Estaba fijado a `100vh - 225px`, que es el mismo error que ya cometi con el
  // marco anterior: encima hay una barra de estado que aparece y desaparece, y
  // el relleno de la pagina cambia con el ancho. Sobraba media pantalla sin
  // usar. Se mide donde empieza el marco y se le da todo lo que queda.
  // Lo que ocupa el relleno de la pagina POR DEBAJO del marco.
  //
  // Se descubre midiendo, no se adivina. Restaba 16 px a ojo y la pagina
  // desbordaba justo 16: el contenedor de la pantalla anade su propio relleno
  // abajo, y eso saca una barra de desplazamiento en el navegador ademas de la
  // del chat. Dos barras, y la de fuera mueve todo.
  //
  // Se apunta una sola vez y se reutiliza: recalcularlo en cada medicion
  // encogeria el marco un poco mas cada vuelta, porque cambiar su alto vuelve a
  // disparar la medicion.
  const sobra = useRef(0);

  useEffect(() => {
    const medir = () => {
      const arriba = marco.current?.getBoundingClientRect().top;
      if (arriba === undefined) return;
      setAlto(Math.max(420, Math.round(window.innerHeight - arriba - sobra.current)));
    };
    const mirarAncho = () => setEstrecho(window.innerWidth < 900);
    mirarAncho();
    window.addEventListener('resize', mirarAncho);
    medir();
    // Tras pintar: si la pagina desborda, ese sobrante es el relleno de abajo.
    const t = setTimeout(() => {
      const raiz = document.documentElement;
      const extra = raiz.scrollHeight - raiz.clientHeight;
      if (extra > 2) { sobra.current += extra; medir(); }
    }, 120);
    const ro = new ResizeObserver(medir);
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', medir);
    return () => {
      clearTimeout(t); ro.disconnect();
      window.removeEventListener('resize', medir);
      window.removeEventListener('resize', mirarAncho);
    };
  }, []);

  // Se pregunta al servidor si sigue entrando historial, en vez de adivinarlo
  // mirando si la lista crece: al emparejar hay tandas de varios minutos con
  // pausas largas en medio, y por el tamaño de la lista parecia que se habia
  // parado cuando no.
  useEffect(() => {
    const mirar = () => chatApi.sincronizacion(deQuien)
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
      const r = await chatApi.enviar(abierto, t, citando?.id ?? null, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      setCitando(null);
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); }
  }

  /** Vuelve a enviar un mensaje que no salio, con su mismo texto. */
  async function reintentar(m: MensajeWhatsapp) {
    if (!abierto || !m.texto) return;
    setReintentando(m.id);
    try {
      const r = await chatApi.enviar(abierto, m.texto, null, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setReintentando(null); }
  }

  async function mandarArchivo(f: File) {
    if (!abierto) return;
    setEnviando(true);
    try {
      const r = await chatApi.adjunto(abierto, f, undefined, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); }
  }

  /**
   * Pegar o arrastrar una imagen manda la imagen.
   *
   * La caja de escribir es un contenteditable, asi que al pegar una foto el
   * navegador la mete DENTRO como <img> a tamano real: se comia la barra
   * entera y tapaba media pantalla. Y al darle a enviar no salia nada, porque
   * el texto se limpia de etiquetas antes de mandarlo — la foto desaparecia sin
   * decir por que.
   *
   * En WhatsApp Web pegar una foto la envia. Aqui igual.
   */
  function archivosDe(dt: DataTransfer | null): File[] {
    if (!dt) return [];
    const items = [...(dt.files || [])];
    if (items.length) return items;
    return [...(dt.items || [])]
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => Boolean(f));
  }

  async function pegarOSoltar(e: React.ClipboardEvent | React.DragEvent) {
    const dt = 'clipboardData' in e ? e.clipboardData : e.dataTransfer;
    const archivos = archivosDe(dt);
    if (!archivos.length) return;          // texto normal: que siga su camino
    e.preventDefault();
    e.stopPropagation();
    if (!abierto) {
      toast({ title: 'Elige una conversacion antes', variant: 'destructive' });
      return;
    }
    // De uno en uno: cada envio pasa por los frenos y por su pausa.
    for (const f of archivos) await mandarArchivo(f);
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
      const r = await chatApi.abrirPorTelefono(t, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo abrir');
      setPidiendoTelefono(false); setTelefonoNuevo('');
      setNuevoAbierto(false); setBusca('');
      await cargarLista(); setAbierto(r.data.id);
      toast({
        title: 'Chat abierto',
        description: 'Escribe con cabeza: a quien no pidio informacion es mas facil que te reporte.',
      });
    } catch (e) { fallo(e); }
  }

  async function abrirCon(leadId: number) {
    try {
      const r = await chatApi.abrir(leadId, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo abrir');
      setNuevoAbierto(false); setBusca('');
      await cargarLista(); setAbierto(r.data.id);
    } catch (e) { fallo(e); }
  }

  /** Pide un adjunto del historial que no se bajo en su momento. */
  async function pedirAdjunto(mensajeId: number) {
    try {
      setBajando((b) => [...b, mensajeId]);
      const r = await chatApi.descargarAdjunto(mensajeId, deQuien);
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
    const r = await chatApi.noEscribir(abierto, motivoNuevo.trim(), deQuien);
    setPidiendoMotivo(false); setMotivoNuevo('');
    if (r.success) {
      toast({ title: 'Marcado', description: 'El CRM no volvera a escribir a este numero.' });
      cargarHilo(abierto); cargarLista();
    }
  }

  const nombreDe = (c: ChatWhatsapp) => {
    // El chat de uno consigo mismo. WhatsApp no manda nombre para el —manda el
    // numero, y encima enmascarado— asi que salia un telefono donde deberia
    // decir lo que es.
    // Solo cuando miras TU sesion: en la de otra persona, ese numero es el
    // suyo, no el tuyo, y poner «Tu» ahi seria mentir.
    const mio = sesion.esMia ? (conexion?.numero || '').replace(/[^0-9]/g, '') : '';
    if (mio && c.telefono?.replace(/[^0-9]/g, '') === mio) return 'Tu (mensajes contigo mismo)';
    return c.lead_nombre || c.nombre_push || (c.es_grupo ? 'Grupo sin nombre' : c.telefono);
  };

  // Lo que se ensena debajo del nombre.
  //
  // Antes: el ultimo texto, y si no habia, el telefono. Pero un grupo no tiene
  // telefono: tiene un identificador de 18 cifras, y eso es lo que salia
  // pintado —dieciocho cifras seguidas— cada vez que el ultimo mensaje era una foto
  // o un sticker. Ahora se dice QUE fue, como en WhatsApp.
  const ADELANTO: Record<string, string> = {
    imagen: '📷 Foto', video: '🎥 Video', audio: '🎤 Nota de voz',
    documento: '📄 Documento', sticker: 'Sticker',
  };
  // De que proyecto es cada chat, dicho SIEMPRE.
  //
  // La lista ya no filtra por el proyecto elegido —el WhatsApp de una gestora es
  // una sola bandeja— asi que hace falta decir de donde viene cada conversacion.
  // Y las que no son de ningun proyecto tambien lo dicen: son las de alguien que
  // aun no esta en el CRM, y saber eso de un vistazo es justo lo util.
  const etiquetaDe = (c: ChatWhatsapp) =>
    c.proyecto_nombre || (c.lead_id ? 'sin proyecto' : 'no es prospecto');

  const adelantoDe = (c: ChatWhatsapp) => `${etiquetaDe(c)} · ${adelantoBase(c)}`;

  const adelantoBase = (c: ChatWhatsapp) => {
    if (c.no_escribir) return 'no escribir';
    if (c.ultimo_texto) return c.ultimo_texto;
    if (c.ultimo_tipo && ADELANTO[c.ultimo_tipo]) return ADELANTO[c.ultimo_tipo];
    // Sin nada que adelantar: el telefono si es una persona, y para un grupo
    // nada — su identificador no le dice nada a nadie.
    return c.es_grupo ? 'Grupo' : c.telefono;
  };
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

  // Por que no se puede escribir ahora mismo, si es que no se puede.
  //
  // Antes la caja seguia activa con WhatsApp caido: se escribia el mensaje
  // entero, se le daba a enviar, y el error salia DESPUES con el texto ya
  // perdido. Peor todavia con el movil sin cobertura, que es cuando mas pasa.
  const bloqueo = conexion && !conexion.conectado
    ? {
        icono: <WarningCircle size={15} weight="fill" />,
        texto: 'WhatsApp no esta conectado, no se puede enviar.',
        marcador: 'Sin conexion con WhatsApp',
      }
    : conv?.no_escribir
    ? {
        icono: <Prohibit size={15} weight="bold" />,
        texto: `Esta persona pidio que no se le escriba.${conv.motivo_no_escribir ? ` (${conv.motivo_no_escribir})` : ''}`,
        marcador: 'No se escribe a este numero',
      }
    : null;

  let ultimoDia = '';

  return (
    <div className={`space-y-2 ${aPantalla ? 'wa-completa' : ''}`}>
      <div className="flex items-center gap-2 text-xs bg-card border border-border rounded-lg px-3 py-1.5">
        <span className={`w-2 h-2 rounded-full ${conexion?.conectado ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {conexion?.conectado
          ? <span className="text-muted-foreground">
              {sesion.esMia ? 'Tu WhatsApp' : `WhatsApp de ${sesion.nombre}`}: <strong className="text-foreground">
                {conexion.nombre || (conexion.numero ? `+${conexion.numero}` : conexion.instancia)}
              </strong>
            </span>
          : <span className="text-amber-700 dark:text-amber-400">
              {sesion.esMia
                ? <>No tienes WhatsApp enlazado — <Link to="/whatsapp/conexion" className="underline">enlazar mi numero</Link></>
                : `El WhatsApp de ${sesion.nombre} no esta enlazado`}
            </span>}
        {/* La pantalla donde se enlaza o se desvincula el numero. Estaba solo en
            el menu lateral y desde el chat no habia forma de llegar. */}
        <button type="button" onClick={() => setAPantalla((v) => !v)}
          title={aPantalla ? 'Salir de pantalla completa (Esc)' : 'Ver solo el chat'}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          {aPantalla ? <ArrowsIn size={14} weight="bold" /> : <ArrowsOut size={14} weight="bold" />}
          <span className="font-medium">{aPantalla ? 'Salir' : 'Ampliar'}</span>
        </button>
        <Link to="/whatsapp/conexion" title="Conectar o desvincular el numero"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <PlugsConnected size={14} weight="bold" />
          <span className="font-medium">Conexion</span>
        </Link>
      </div>

      <div ref={marco} className="wa-marco" style={{ height: alto }}
        onPaste={pegarOSoltar}
        onDrop={pegarOSoltar}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}>
        {/* Sin `responsive`: ese modo del kit no es para telefonos —encoge la
            lista a iconos, esconde el buscador y anula la flecha de volver—.
            Lo estrecho se resuelve aqui, enseñando la lista o el hilo. */}
        <MainContainer>
          {/* En un telefono se enseña una cosa u otra. Con las dos, el kit
              tapaba la lista en cuanto habia un hilo abierto —aunque estuviera
              vacio— y la pantalla arrancaba en blanco. */}
          {(!estrecho || !conv) && (
          <Sidebar position="left" scrollable>
            <div className="wa-barra-sesion">
              <SelectorDeSesion valor={sesion} onCambiar={setSesion} compacto />
            </div>
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
                  info={adelantoDe(c)}
                  active={abierto === c.id}
                  unreadCnt={c.no_leidos || undefined}
                  onClick={() => setAbierto(c.id)}>
                  <Avatar name={nombreDe(c)}><Foto nombre={nombreDe(c)} url={c.avatar_url} grupo={c.es_grupo} /></Avatar>
                </Conversation>
              ))}
            </ConversationList>
          </Sidebar>
          )}

          {conv ? (
            <ChatContainer>
              <ConversationHeader>
                <Avatar name={nombreDe(conv)}><Foto nombre={nombreDe(conv)} url={conv.avatar_url} grupo={conv.es_grupo} /></Avatar>
                {estrecho && (
                  /* Con su propio boton dentro, no con el que trae el kit.
                     El kit pinta un <div> vacio y le cuelga el clic a una
                     flechita minuscula de dentro: el div —que es lo que se ve y
                     lo que uno pulsa— no hace nada. Ademas es diminuta. */
                  <ConversationHeader.Back>
                    <button type="button" className="wa-volver" title="Ver todos los chats"
                      onClick={() => { setAbierto(null); setConv(null); }}>
                      <CaretLeft size={20} weight="bold" />
                    </button>
                  </ConversationHeader.Back>
                )}
                <ConversationHeader.Content userName={nombreDe(conv)}
                  info={escribiendo
                    // Debajo del nombre, como en WhatsApp. En un grupo, con el
                    // nombre de quien escribe: sin eso no sirve de nada.
                    ? <span className="wa-escribiendo">
                        {conv.es_grupo
                          ? `${escribiendo.quien} esta ${escribiendo.que}…`
                          : `${escribiendo.que}…`}
                      </span>
                    : conv.es_grupo ? 'Grupo'
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
                        {/* A que contestaba. Sin esto la respuesta salia suelta
                            y en una conversacion movida eso es la mitad de la
                            informacion: se veia el «si» sin la pregunta. */}
                        {m.responde_a && (m.citado_texto || m.citado_tipo) && (
                          <div className="wa-cita">
                            <span className="wa-cita-quien">
                              {m.citado_direccion === 'saliente' ? 'Tu' : nombreDe(conv)}
                            </span>
                            <span className="wa-cita-texto">
                              {m.citado_texto || ADELANTO[m.citado_tipo || ''] || `(${m.citado_tipo})`}
                            </span>
                          </div>
                        )}
                        {m.tipo !== 'texto' && <div className="wa-adjunto"><Adjunto m={m} alPedir={pedirAdjunto} bajando={bajando.includes(m.id)} /></div>}
                        {m.texto && <div className="wa-texto">{m.texto}</div>}
                        <span className={`wa-meta ${m.estado === 'leido' ? 'wa-leido' : ''}`}>
                          {hora(m.ts)}{mia && m.estado ? ` ${TIC[m.estado]}` : ''}
                        </span>
                        {/* Un mensaje que no salio se quedaba con su ⚠ y ahi
                            moria: habia que copiarlo a mano y volver a
                            escribirlo. Ahora se reintenta con el texto que ya
                            estaba guardado. */}
                        {/* Responder a ESTE mensaje. Aparece al pasar por
                            encima, como en WhatsApp: siempre visible seria
                            ruido en cada burbuja. */}
                        <button type="button" className="wa-responder"
                          title="Responder a este mensaje"
                          onClick={() => setCitando(m)}>
                          <ArrowBendUpLeft size={13} weight="bold" />
                        </button>
                        {m.estado === 'fallido' && m.texto && (
                          <button type="button" className="wa-reintentar"
                            disabled={reintentando === m.id}
                            onClick={() => reintentar(m)}>
                            {reintentando === m.id ? 'Enviando…' : '↻ Reintentar'}
                          </button>
                        )}
                      </Message.CustomContent>
                    </Message>,
                  ].filter(Boolean);
                })}
              </MessageList>

              {/* Un solo InputToolbox, y el campo SIEMPRE presente.
                  ChatContainer elige a sus hijos por TIPO —cabecera, lista,
                  campo y toolbox— y descarta lo demas sin decir nada. Los
                  avisos iban en un <div> suelto, asi que no se pintaban nunca.
                  Y solo cuenta el PRIMER toolbox, de ahi que aviso y cita
                  compartan hueco.

                  El campo no se quita cuando no se puede escribir: se
                  desactiva. Quitarlo mueve la pantalla entera de sitio cada vez
                  que la sesion parpadea. */}
              <InputToolbox className={bloqueo ? 'wa-bloqueado' : citando ? 'wa-citando' : 'wa-toolbox-vacia'}>
                {bloqueo ? (
                  <>
                    {bloqueo.icono}
                    <span>{bloqueo.texto}</span>
                  </>
                ) : citando ? (
                  <>
                    <div className="wa-citando-texto">
                      <span className="wa-citando-quien">
                        {citando.direccion === 'saliente' ? 'Tu' : nombreDe(conv)}
                      </span>
                      <span className="wa-citando-que">
                        {citando.texto || `(${citando.tipo})`}
                      </span>
                    </div>
                    <button type="button" onClick={() => setCitando(null)}
                      className="wa-panel-cerrar" title="Quitar la cita">
                      <X size={14} />
                    </button>
                  </>
                ) : null}
              </InputToolbox>

              <MessageInput
                placeholder={
                  bloqueo ? bloqueo.marcador
                  : grabando ? 'Grabando nota de voz…'
                  : 'Escribe un mensaje'
                }
                onSend={enviar} disabled={enviando || Boolean(bloqueo)} attachButton
                onAttachClick={() => ficheroRef.current?.click()}
                sendDisabled={enviando || Boolean(bloqueo)} />
            </ChatContainer>
          ) : estrecho ? null : (
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

      {tour && <Tour alCerrar={() => setTour(false)} />}

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
                Con prefijo de pais y sin signos. Vale cualquier numero, sea prospecto
                o no; queda apuntado a quien se escribe.
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
