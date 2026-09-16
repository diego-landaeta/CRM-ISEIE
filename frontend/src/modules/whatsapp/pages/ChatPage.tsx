import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MainContainer, ChatContainer, MessageList, Message, MessageInput,
  ConversationList, Conversation, Avatar, Sidebar, Search, ConversationHeader,
  MessageSeparator, InputToolbox,
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { Info, Prohibit, PencilSimpleLine, X, MagnifyingGlass, Microphone, Stop, UsersThree, PlugsConnected, WarningCircle, ArrowBendUpLeft, ArrowsOut, ArrowsIn, CaretLeft, Question, PhoneX, PhoneCall, VideoCamera, Trash, PaperPlaneRight, FileText, ShareFat, Tag } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import {
  chatApi, urlMedia, etiquetasWhatsapp,
  type ChatWhatsapp, type MensajeWhatsapp, type ConexionWhatsapp, type EtiquetaWhatsapp,
} from '../api/whatsapp.api';
import SelectorDeSesion, { type SesionElegida } from '../components/SelectorDeSesion';
import Tour, { tourPendiente, hayQueSeñalar } from '../components/Tour';
import NotaDeVoz from '../components/NotaDeVoz';
import VistaPreviaAdjunto from '../components/VistaPreviaAdjunto';
import ElegirChat from '../components/ElegirChat';
import FichaProspecto from '../components/FichaProspecto';
import AvisoAlSalir from '../components/AvisoAlSalir';
import SelectorPlantillas from '../components/SelectorPlantillas';
import Llamar from '../components/Llamar';
import EtiquetasDelChat from '../components/EtiquetasDelChat';
import type { DatosParaRellenar } from '../lib/plantilla';
import { altoDelMarco, rellenoDeAbajo } from '../lib/altoDelMarco';
import './chat.css';
import TextoDeWhatsapp from '../components/TextoDeWhatsapp';
import { STATUS_LABELS } from '@/shared/components/ui/StatusBadge';

// El chat de WhatsApp dentro del CRM.
//
// La maquetacion la pone @chatscope/chat-ui-kit-react (MIT), que es un kit de
// mensajeria ya hecho: burbujas, agrupado, separadores, lista de
// conversaciones. No tiene sentido reinventar eso a mano — lo que si es nuestro
// es lo de debajo: los frenos, el cruce con leads y los adjuntos.
const CADA_MS = 5000;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

/**
 * La fecha del ultimo mensaje, como en WhatsApp: la hora si es de hoy, «Ayer»,
 * y la fecha si es mas viejo (#99, punto 6).
 *
 * Sin esto no se sabe si una conversacion es de hace diez minutos o de hace
 * tres dias, que es lo primero que se mira para decidir a quien contestar.
 */
function cuandoDe(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const igual = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (igual(d, hoy)) return hora(iso);
  if (igual(d, ayer)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
}

/**
 * Un mensaje es «el mismo» si nada de lo que se pinta ha cambiado.
 *
 * El hilo y la lista se vuelven a pedir cada cinco segundos, y hasta ahora se
 * reemplazaba el array entero SIEMPRE, aunque llegara identico. Cada vuelta
 * eran objetos nuevos, asi que React repintaba todas las burbujas y el kit
 * volvia a colocar el desplazamiento: un parpadeo cada cinco segundos.
 *
 * Se notaba sobre todo al ampliar (#64) — cambia el alto, se remide, y si en
 * ese momento cae el refresco parece que la conversacion se recarga sola. Y
 * leyendo hacia arriba era peor: cada vuelta devolvia al final.
 *
 * Comparando y conservando el array anterior cuando no hay nada nuevo, React
 * no toca nada y el desplazamiento se queda donde estaba.
 */
/**
 * Un texto que de verdad dice algo, o nada.
 *
 * `||` solo cae con un valor falso, y una cadena de ESPACIOS no lo es. WhatsApp
 * manda nombres asi mas de lo que parece: alguien con el nombre en blanco, o
 * con caracteres invisibles. Ese «  » se tomaba como nombre bueno y la cabecera
 * se quedaba vacia — se veia el fondo claro del kit, una barra blanca donde
 * deberia estar el nombre, y el avatar caia a su interrogante. Reportado desde
 * produccion.
 */
const conTexto = (v?: string | null) => (v || '').trim() || null;

/**
 * El telefono de una conversacion, SOLO si de verdad es un telefono.
 *
 * WhatsApp identifica cada vez a mas gente por «@lid», su direccionamiento
 * nuevo: un identificador que dice quien es la persona sin dar su numero. La
 * pantalla pintaba sus catorce cifras donde va el telefono —«95069319217252 ·
 * sin prospecto»— y eso no es el movil de nadie. No se puede marcar, no se
 * puede buscar y no significa nada para quien lo lee.
 *
 * Un grupo tampoco tiene telefono: lo que hay ahi son las dieciocho cifras de
 * su identificador.
 *
 * Devuelve null cuando no hay numero que ensenar, y quien llama decide que
 * poner en su lugar.
 */
export const telefonoVisible = (c: { jid?: string | null; telefono?: string | null; es_grupo?: boolean }) => {
  const jid = String(c.jid || '');
  if (c.es_grupo || jid.endsWith('@lid') || jid.endsWith('@g.us')) return null;
  return conTexto(c.telefono);
};

const mismoMensaje = (a: MensajeWhatsapp, b: MensajeWhatsapp) =>
  a.id === b.id && a.estado === b.estado && a.texto === b.texto
  && a.media_url === b.media_url && a.media_firma === b.media_firma;

const mismoChat = (a: ChatWhatsapp, b: ChatWhatsapp) =>
  a.id === b.id && a.ultimo_at === b.ultimo_at && a.no_leidos === b.no_leidos
  && a.ultimo_texto === b.ultimo_texto && a.ultimo_autor === b.ultimo_autor
  && a.lead_status === b.lead_status
  && a.nombre_push === b.nombre_push && a.avatar_url === b.avatar_url;

const igualesPor = <T,>(a: T[], b: T[], iguales: (x: T, y: T) => boolean) =>
  a.length === b.length && a.every((x, i) => iguales(x, b[i]));

function diaDe(iso: string) {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  const igual = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (igual(d, hoy)) return 'Hoy';
  if (igual(d, ayer)) return 'Ayer';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Las iniciales para cuando no hay foto.
 *
 * Cogia la primera letra de las dos primeras palabras, a secas. Con «Tu
 * (mensajes contigo mismo)» eso da «T(» — la segunda palabra empieza por
 * parentesis. Y con un nombre entre comillas o con un emoji delante, peor.
 *
 * Se quita lo que va entre parentesis —suele ser una aclaracion nuestra, no
 * parte del nombre— y de cada palabra solo cuenta su primera letra o cifra.
 */
const iniciales = (n: string) =>
  (n || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((p) => (p.match(/[\p{L}\p{N}]/u) || [''])[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

/**
 * Un color estable a partir del nombre.
 *
 * La gracia es que sea SIEMPRE el mismo para la misma persona: en un grupo
 * movido se reconoce quién habla por el color antes de leer el nombre. Al azar
 * cambiaría en cada recarga, y por posición se movería según quién más hubiera
 * escrito, que es justo lo contrario de reconocible.
 *
 * Tonos oscuros a propósito: el texto encima es blanco y este panel es oscuro
 * en los dos temas de la aplicación.
 */
function colorDeNombre(nombre: string) {
  let n = 0;
  for (let i = 0; i < nombre.length; i++) n = (n * 31 + nombre.charCodeAt(i)) % 360;
  return `hsl(${n} 45% 32%)`;
}

/**
 * La foto de perfil de WhatsApp, con las iniciales de recurso.
 *
 * La direccion que da WhatsApp caduca, asi que puede fallar en cualquier
 * momento: cuando pasa se cae a las letras en vez de dejar un hueco roto.
 */
export function Foto({ nombre, url, grupo }: { nombre: string; url?: string | null; grupo?: boolean }) {
  // Se recuerda QUE direccion fallo, no un «fallo» a secas (#112, punto 2).
  //
  // Antes esto era `const [rota, setRota] = useState(false)`, y ese booleano
  // vivia mientras viviera el componente. En la LISTA da igual: cada fila tiene
  // su propia Foto, asi que una caducada solo se estropea a si misma. En la
  // CABECERA hay UNA sola que sobrevive al cambiar de conversacion — y las
  // direcciones que da WhatsApp caducan.
  //
  // Asi que bastaba abrir un chat con la foto caducada para que la cabecera se
  // quedara en la inicial para TODOS los siguientes, con la lista enseñando la
  // foto al lado. Es lo que vio Diego: en la fila la foto, en la cabecera una
  // «D». El dato llegaba bien; lo viejo era el estado.
  //
  // Guardando la direccion, cambiar de chat lo reinicia solo: `falla !== url`
  // vuelve a ser cierto sin efectos ni parpadeo.
  const [falla, setFalla] = useState<string | null>(null);
  if (url && falla !== url) {
    return <img src={url} alt={nombre} className="wa-foto" onError={() => setFalla(url)} />;
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
  // Un «otro» NO tiene archivo que bajar, y ofrecerlo es un boton que no puede
  // funcionar nunca. Asi se ve hoy en produccion el numero por el que entran los
  // leads: una fila tras otra de «⬇ Descargar otro» y ni una palabra.
  //
  // «otro» quiere decir que el CRM no supo leer ese tipo de mensaje. Se dice, y
  // se dice que el movil si lo enseña — que es lo unico util que se le puede
  // contar a la gestora mientras se arregla.
  if (m.tipo === 'otro') {
    return (
      <span className="wa-no-legible" title="El CRM no reconoce este tipo de mensaje">
        Mensaje que el CRM aún no sabe mostrar — míralo en el móvil
      </span>
    );
  }
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

// `…` y no un reloj: los tics son texto suelto dentro de la burbuja y los
// glifos de reloj no estan en todas las fuentes — donde falten saldria un
// cuadrado. Tres puntos se entienden y se ven en cualquier sitio.
const TIC = { enviando: '…', enviado: '✓', entregado: '✓✓', leido: '✓✓', fallido: '⚠' } as const;

/** Un mensaje que se esta mandando, con la conversacion a la que pertenece. */
type EnCamino = MensajeWhatsapp & { paraConversacion: number };

/**
 * Como se cuenta una llamada.
 *
 * En la base solo se guarda el desenlace en seco («perdida»), no la frase: asi
 * se puede filtrar por llamadas perdidas sin buscar dentro de un texto, y la
 * forma de decirlo se cambia aqui sin tocar ni un registro.
 */
const LLAMADA = {
  perdida:    { texto: 'Llamada perdida',    video: 'Videollamada perdida',    grave: true },
  rechazada:  { texto: 'Llamada rechazada',  video: 'Videollamada rechazada',  grave: false },
  contestada: { texto: 'Llamada contestada', video: 'Videollamada contestada', grave: false },
  // La que sale del boton de llamar.
  //
  // Ponia «Llamaste desde el móvil», y eso es FALSO: lo unico que ha pasado es
  // que alguien pulso el boton en el CRM. Puede que no llegara a marcar, o que
  // marcara y no descolgaran. Reportado tal cual — «no llamé desde el móvil,
  // solo le di al botón».
  //
  // Y no es una pega de estilo: esto se lee en el historial de un cliente para
  // decidir si se le vuelve a llamar. Un apunte que afirma una llamada que no
  // existio es peor que no tener apunte.
  //
  // Se dice lo unico que el CRM sabe de verdad: que se pidio.
  intento:    { texto: 'Pediste llamar', video: 'Pediste llamar', grave: false },
  // Sono y acabo, y WhatsApp no dice como.
  //
  // Es el caso mas comun de todos: quien llama cuelga antes de que salte el
  // buzon, o lo coges en el movil. Baileys manda el mismo `terminate` para los
  // dos, asi que llamarlo «perdida» seria mentir. Antes esto no se guardaba y la
  // llamada no dejaba ni rastro.
  terminada:  { texto: 'Llamada', video: 'Videollamada', grave: false },
} as const;

/**
 * El desenlace de una llamada y, si se sabe, cuanto sono: «terminada:16».
 *
 * Los segundos van pegados al desenlace porque no hay columna donde meterlos y
 * las migraciones estan paradas.
 */
function comoAcabo(texto?: string | null) {
  const [clave, segundos] = String(texto || 'perdida').split(':');
  const cual = LLAMADA[clave as keyof typeof LLAMADA] || LLAMADA.perdida;
  return { cual, segundos: segundos ? Number(segundos) : null };
}

/**
 * Una llamada en el hilo.
 *
 * No lleva burbuja: no es algo que nadie escribiera. Va centrada, como el
 * separador de fecha, porque es un hecho de la conversacion y no un mensaje.
 * Tiene que ir dentro de un <Message>: el kit descarta los hijos de MessageList
 * que no reconoce, asi que un <div> suelto no se pintaria.
 */
function Llamada({ m }: { m: MensajeWhatsapp }) {
  const { cual, segundos } = comoAcabo(m.texto);
  const esVideo = m.media_mime === 'video';
  const Icono = esVideo ? VideoCamera : cual.grave ? PhoneX : PhoneCall;
  return (
    <div className={`wa-llamada ${cual.grave ? 'wa-llamada-perdida' : ''}`}>
      <Icono size={15} weight="fill" />
      <span>
        {esVideo ? cual.video : cual.texto}
        {segundos ? ` · sonó ${segundos} s` : ''}
      </span>
      <span className="wa-llamada-hora">{hora(m.ts)}</span>
    </div>
  );
}

/**
 * Lo que de verdad acepta el servidor para un adjunto.
 *
 * NO es el limite de la aplicacion: multer deja pasar 16 MB. Es el de Nginx,
 * cuyo `client_max_body_size` por defecto es 1 MB, y por eso un dossier de
 * 1,4 MB devolvia «Error 413» sin llegar a tocar Node.
 *
 * Va aqui como constante y no adivinado, porque adivinarlo seria peor: avisar
 * de un tope que no es el real deja pasar ficheros que despues fallan. Cuando
 * se suba el de Nginx, se sube este a la vez — o se pone VITE_WHATSAPP_TOPE_MB.
 */
/**
 * Mientras el servidor no diga el suyo. En cuanto contesta `/conexion`, manda
 * el de verdad: el numero no se adivina desde aqui.
 */
const TOPE_POR_DEFECTO = 16 * 1024 * 1024;

/** Lo que WhatsApp deja para corregir un mensaje ya enviado (#75). */
const VENTANA_EDICION_MS = 15 * 60 * 1000;

/**
 * Las «etiquetas» de la lista de chats (#72).
 *
 * No son etiquetas nuevas: son los estados del prospecto, que ya existen en el
 * CRM. El ticket sugeria «reutilizar el sistema de etiquetas para prospectos»,
 * pero ese sistema no existe — en las migraciones solo hay etiquetas del menu
 * lateral y tags de cifrado.
 *
 * Y estos encajan literalmente con lo que pidio: «pendiente de contestar»,
 * «ya vendido», «no interesado». Ademas viajan con la PERSONA y no con el chat,
 * que es lo que el propio ticket dice que probablemente se quiere.
 *
 * Se dejan fuera «nuevo» y «contactado» a proposito: con siete pastillas no se
 * filtra, se busca entre pastillas.
 */
const ETIQUETAS = ['por_contactar', 'en_seguimiento', 'convertido', 'no_interesado', 'grupos'] as const;

/** «Grupos» no es un estado de prospecto, así que su nombre no sale de STATUS_LABELS. */
const ETIQUETA_GRUPOS = 'grupos';

export default function ChatPage() {
  const { activeProject, activeIssuer, activeIssuerId } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuer: { nombre?: string; campus: Array<{ id: number }> } | null;
    activeIssuerId: number | null;
  };
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;
  // Para el hueco {proyecto} de las plantillas.
  // Con una EMPRESA puesta no hay UN proyecto, hay sus campus. Lo que sabe
  // recibir una lista --buscar prospectos, las plantillas-- la recibe; el
  // chat en si es de la gestora, no del proyecto, y le da igual.
  const campusIds = (activeIssuer?.campus || []).map((c) => c.id);
  const ambitoCsv = !projectId && campusIds.length ? campusIds.join(',') : null;
  const hayAmbito = !!projectId || !!ambitoCsv;
  const nombreProyecto = activeIssuer?.nombre ?? activeProject?.nombre ?? null;

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
  /**
   * Lo que ya se ve pero aun no ha vuelto del servidor (#99, punto 4).
   *
   * Aparte de `mensajes` a proposito: el hilo se recarga entero cada cinco
   * segundos, y si estos vivieran ahi la siguiente vuelta los borraria de la
   * pantalla justo mientras se estan mandando.
   *
   * Cada uno lleva A QUE CONVERSACION pertenece. Sin eso, mandar algo y cambiar
   * de chat antes de que conteste el servidor pintaba esa burbuja en el chat
   * de otra persona — el mensaje no se manda ahi, pero verlo ya es bastante
   * malo.
   */
  const [pendientes, setPendientes] = useState<EnCamino[]>([]);
  /** Lo ultimo que se mando, para no repetirlo por un rebote del teclado. */
  const ultimoEnvio = useRef<{ texto: string; chat: number; cuando: number } | null>(null);
  /** Que mensaje se esta reenviando, mientras se elige a quien (#99, punto 5). */
  const [reenviando, setReenviando] = useState<MensajeWhatsapp | null>(null);
  const [reenvioEnCurso, setReenvioEnCurso] = useState(false);
  const [conexion, setConexion] = useState<ConexionWhatsapp | null>(null);
  const [filtro, setFiltro] = useState('');
  // Lo que se le pide al servidor para filtrar la LISTA de chats. Va detras del
  // filtro con un respiro para no mandar una consulta por tecla. Ojo, no
  // confundir con `busca`, que es el buscador de prospectos del chat nuevo.
  const [buscaChats, setBuscaChats] = useState('');
  // La «etiqueta» por la que se filtra (#72). Es el estado del prospecto: no
  // hay sistema de etiquetas en el CRM, y este encaja con lo que pidio —
  // «pendiente de contestar / ya vendido / no interesado»— y viaja con la
  // persona en vez de con el chat.
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  // La etiqueta de WhatsApp por la que se filtra, y las que hay para ofrecer.
  // Se piden una vez: cambian cuando la gestora las toca en el móvil, no cada
  // cinco segundos, y esta pantalla ya pregunta bastante.
  const [etiquetaWa, setEtiquetaWa] = useState<string | null>(null);
  const [etiquetasWa, setEtiquetasWa] = useState<EtiquetaWhatsapp[]>([]);

  // Dos estados distintos, y la diferencia importa:
  //   · `cargando`  — todavia no ha vuelto la primera peticion.
  //   · `llegando`  — ya hay conversaciones, pero siguen entrando. Al emparejar,
  //                   WhatsApp manda el historial en tandas y la lista crece
  //                   durante un minuto largo: sin avisar, parece que faltan.
  const [cargando, setCargando] = useState(true);
  const [sync, setSync] = useState<{ entrando: boolean; mensajes: number; conversaciones: number; adjuntosPendientes: number } | null>(null);
  const cuantasAntes = useRef(0);
  // Buscar es cosa de Postgres, no del navegador: con el tope de 50 chats,
  // filtrar lo ya cargado dejaba fuera cualquier seguimiento de hace semanas.
  // Lo reporto una gestora — buscaba por nombre y por numero y no salia nada, y
  // en cuanto le mandaba un mensaje, aparecia.
  useEffect(() => {
    const t = setTimeout(() => setBuscaChats(filtro.trim()), 300);
    return () => clearTimeout(t);
  }, [filtro]);
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
  const [corrigiendo, setCorrigiendo] = useState<number | null>(null);
  const [editando, setEditando] = useState<number | null>(null);
  const [textoEditado, setTextoEditado] = useState('');
  // El mensaje al que se esta respondiendo, si hay alguno.
  const [citando, setCitando] = useState<MensajeWhatsapp | null>(null);
  // El tour, solo la primera vez y solo cuando ya hay algo que enseñar: sobre
  // una pantalla vacia no señala nada y no se entiende.
  const [tour, setTour] = useState(false);
  // Solo el chat, sin el resto del CRM alrededor. Para cuando se pasa la
  // mañana aqui: el menu, la cabecera y el selector de proyecto no pintan nada.
  const [aPantalla, setAPantalla] = useState(false);
  // Que conversacion tiene la ficha abierta. Se guarda el id y no el objeto:
  // asi el popup se pide sus datos y no depende de lo que ya hubiera cargado la
  // lista, que trae menos campos.
  const [fichaDe, setFichaDe] = useState<number | null>(null);
  // El campo de escribir pasa a estar CONTROLADO. Antes no lo estaba y por eso
  // no habia forma de meterle texto: elegir una plantilla no podia hacer nada.
  const [borrador, setBorrador] = useState('');
  const [plantillasAbiertas, setPlantillasAbiertas] = useState(false);
  // Los datos con los que se rellenan los huecos de la plantilla. Se piden al
  // abrir el selector y no antes: la mayoria de los mensajes no usan plantilla.
  const [datosPlantilla, setDatosPlantilla] = useState<DatosParaRellenar>({});
  // A quien se va a llamar, y si el intento quedo apuntado.
  const [llamando, setLlamando] = useState<
    { telefono: string; nombre: string | null; apuntada: boolean } | null
  >(null);
  // Lo que se va a mandar, esperando confirmacion. Antes se enviaba directo al
  // elegir el fichero y no habia forma de ver que era hasta despues — y en
  // WhatsApp un mensaje no se recoge pasados unos minutos.
  const [porEnviar, setPorEnviar] = useState<File[]>([]);
  // Mientras se abre el microfono. Son decimas, pero sin decirlo el usuario ya
  // esta hablando contra un boton que todavia no graba.
  const [abriendoMicro, setAbriendoMicro] = useState(false);
  // La nota de voz que esta saliendo, para pintarla en el hilo mientras va.
  const [vozSaliendo, setVozSaliendo] = useState<number | null>(null);
  // La nota grabada esperando a que se decida: enviarla o tirarla.
  const [vozGrabada, setVozGrabada] = useState<
    { blob: Blob; ext: string; segundos: number; url: string } | null>(null);
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
  // El microfono, abierto de antemano. Ver prepararMicro().
  const micro = useRef<MediaStream | null>(null);
  const trozos = useRef<Blob[]>([]);

  useEffect(() => {
    // `deQuien` NO es opcional aqui. Sin el, un administrador que abre el
    // WhatsApp de una gestora ve el estado de SU PROPIA conexion: si el tiene el
    // numero enlazado, la pantalla dice «conectado» aunque el de ella este
    // caido — y al reves, sale «no tienes WhatsApp enlazado» sobre una sesion
    // que funciona. Es el mismo descuido que ya aparecio en otras llamadas de
    // esta pantalla, y Diego lo arreglo en integracion/todo (cb3dc57).
    const leer = () => chatApi.conexion(deQuien).then((r) => setConexion(r.success ? r.data : null)).catch(() => {});
    leer();
    // La sesion se cae sola si el movil se queda sin internet. Se vigila para
    // que la gestora se entere en vez de escribir contra el vacio.
    const t = setInterval(leer, 30000);
    return () => clearInterval(t);
      // Depende de `deQuien`: al cambiar de sesion hay que volver a preguntar.
    // Con [] se quedaba con la sesion con la que se abrio la pantalla y
    // seguia enseñando el estado de la anterior.
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
      // La lista NO se filtra por proyecto, a proposito. Es lo mismo que hizo
      // Diego en `integracion/todo` (33101c8) y que esta rama no tenia:
      //
      //   El WhatsApp de una gestora es UNA bandeja. Sus conversaciones son de
      //   los proyectos que sean, y muchas de nadie todavia. Filtrando por el
      //   proyecto elegido se veian 6 de 28 — y lo peor no era no verlas: era
      //   mandar un mensaje, no encontrarlo en la lista y pensar que el CRM no
      //   lo habia guardado. Estaba guardado; estaba escondido.
      //
      // Se vio otra vez al probar las etiquetas: seis conversaciones en la base
      // y una sola en pantalla.
      const r = await chatApi.lista(null, deQuien, buscaChats, etiqueta, etiquetaWa);
      if (!r.success) return;
      const lista = r.data || [];
      // Si han aparecido conversaciones desde la ultima vuelta, el historial
      // sigue entrando. Se apaga solo cuando deja de crecer.
      //
      // Pero buscando NO: la lista encoge y crece segun lo que se teclea, y ese
      // vaiven diria «sincronizando…» sin que este entrando nada.
      if (!buscaChats) cuantasAntes.current = lista.length;
      setChats((antes) => (igualesPor(antes, lista, mismoChat) ? antes : lista));
    } finally {
      setCargando(false);
    }
  }, [deQuien, buscaChats, etiqueta, etiquetaWa]);

  const cargarHilo = useCallback(async (id: number, limite = cuantos) => {
    const r = await chatApi.hilo(id, limite, deQuien);
    if (!r.success) return;
    const llegan = r.data.mensajes || [];
    setConv(r.data.conversacion);
    setMensajes((antes) => (igualesPor(antes, llegan, mismoMensaje) ? antes : llegan));
    setEscribiendo(r.data.escribiendo || null);
  }, [cuantos, deQuien]);

  // Las etiquetas de esta sesión, para poder filtrar por ellas. Una vez.
  useEffect(() => {
    let vivo = true;
    etiquetasWhatsapp(deQuien)
      .then((r) => { if (vivo) setEtiquetasWa(r.success ? (r.data || []) : []); })
      .catch(() => { if (vivo) setEtiquetasWa([]); });
    return () => { vivo = false; };
  }, [deQuien]);

  useEffect(() => {
    cargarLista();
    const t = setInterval(() => {
      cargarLista();
      if (abierto) cargarHilo(abierto);
    }, CADA_MS);
    return () => clearInterval(t);
  }, [cargarLista, cargarHilo, abierto]);

  useEffect(() => { setCuantos(100); setCitando(null); }, [abierto]);

  // Al salir de la pantalla se suelta el microfono. Dejarlo abierto mantiene el
  // punto rojo del navegador encendido, y eso inquieta con razon.
  useEffect(() => () => {
    micro.current?.getTracks().forEach((t) => t.stop());
    micro.current = null;
  }, []);

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

  // El recorrido, AL ENTRAR.
  //
  // Antes esperaba a `chats.length && conv`: a que hubiera conversaciones Y una
  // abierta. Quien acababa de enlazar no tenia ninguna, asi que el recorrido
  // saltaba cuando ya llevaba un rato trabajando — «medio ano despues me sale
  // el tutorial», textual. Justo cuando ya no hace falta.
  //
  // Ahora basta con que haya algo que señalar. Los pasos que apunten a cosas
  // que aun no existen se saltan solos.
  useEffect(() => {
    if (!tourPendiente() || cargando) return undefined;
    // Un respiro para que la pantalla acabe de pintarse: medir antes de que
    // exista la lista daria «no hay nada que señalar» siempre.
    const t = setTimeout(() => { if (hayQueSeñalar()) setTour(true); }, 700);
    return () => clearTimeout(t);
  }, [cargando]);
  useEffect(() => { if (abierto) cargarHilo(abierto); }, [abierto, cargarHilo]);

  // El alto se MIDE, no se adivina.
  //
  // Estaba fijado a `100vh - 225px`, que es el mismo error que ya cometi con el
  // marco anterior: encima hay una barra de estado que aparece y desaparece, y
  // el relleno de la pagina cambia con el ancho. Sobraba media pantalla sin
  // usar. Se mide donde empieza el marco y se le da todo lo que queda, menos el
  // relleno de los contenedores — el porque de eso esta en `altoDelMarco.ts`.
  useEffect(() => {
    const medir = () => {
      const arriba = marco.current?.getBoundingClientRect().top;
      if (arriba === undefined) return;
      setAlto(altoDelMarco(arriba, window.innerHeight, rellenoDeAbajo(marco.current)));
    };
    const mirarAncho = () => setEstrecho(window.innerWidth < 900);
    mirarAncho();
    window.addEventListener('resize', mirarAncho);
    medir();
    const ro = new ResizeObserver(medir);
    if (document.body) ro.observe(document.body);
    window.addEventListener('resize', medir);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', medir);
      window.removeEventListener('resize', mirarAncho);
    };
    // `aPantalla` cambia el contenedor del que cuelga el marco, y con el lo que
    // sobra por debajo. Sin volver a medir aqui, ampliar deja el alto de la
    // pagina —y salir, el de la pantalla completa—: el ResizeObserver mira el
    // body, que en ninguno de los dos casos cambia de tamaño.
  }, [aPantalla]);
  // Se pregunta al servidor si sigue entrando historial, en vez de adivinarlo
  // mirando si la lista crece: al emparejar hay tandas de varios minutos con
  // pausas largas en medio, y por el tamaño de la lista parecia que se habia
  // parado cuando no.
  //
  // Y depende de `deQuien`: sin eso se quedaba preguntando por la sesion con la
  // que se abrio la pantalla. Un administrador que cambiaba a la sesion de otra
  // gestora seguia viendo el avance de la anterior, y ni el numero ni el «esta
  // entrando historial» eran de quien creia estar mirando.
  useEffect(() => {
    const mirar = () => chatApi.sincronizacion(deQuien)
      .then((r) => { if (r.success) setSync(r.data); })
      .catch(() => {});
    mirar();
    const t = setInterval(mirar, 4000);
    return () => clearInterval(t);
  }, [deQuien]);

  useEffect(() => {
    if (!nuevoAbierto) return undefined;
    const t = setTimeout(async () => {
      const r = await chatApi.buscarProspectos(projectId, busca, ambitoCsv);
      if (r.success) setCandidatos((r.data || []).filter((l) => l.telefono));
    }, 300);
    return () => clearTimeout(t);
  }, [nuevoAbierto, busca, projectId, ambitoCsv]);

  function fallo(e: unknown) {
    // Aqui contestan los frenos: ritmo, «no me escribas» y sin consentimiento.
    // El texto del servidor se enseña tal cual: esta escrito para una gestora.
    // Un 413 en crudo no le dice nada a nadie. Puede llegar aqui aunque se
    // avise antes: si el tope de Nginx cambia y este no, o si el pie del
    // mensaje engorda la peticion por encima del limite.
    const bruto = (e as Error).message || '';
    const esDemasiadoGrande = /(^|[^0-9])413([^0-9]|$)|too large|entity too large/i.test(bruto);
    toast({
      title: esDemasiadoGrande ? 'El archivo pesa demasiado' : 'No se ha enviado',
      description: esDemasiadoGrande
        ? 'El servidor lo ha rechazado por tamaño. Mandalo comprimido, o por otra via.'
        : bruto,
      variant: 'destructive',
    });
  }

  /**
   * Manda un mensaje sin dejar el teclado muerto (#99, punto 4).
   *
   * Antes se bloqueaba el campo, se esperaba a que Evolution contestara Y
   * ademas a que volviera el hilo entero. Dos viajes de ida y vuelta con el
   * teclado apagado: escribiendo dos seguidos, el segundo no salia hasta
   * pasados unos cinco segundos. «Se nota y molesta», y con razon.
   *
   * Ahora el mensaje se pinta al momento y el campo queda libre en el acto. Si
   * el envio falla, esa burbuja se queda marcada como fallida — con su texto,
   * que es lo que no hay que perder— en vez de desaparecer.
   */
  async function enviar(texto: string) {
    // Llega TEXTO, no HTML.
    //
    // Antes se recibia el innerHTML de la caja y se le quitaban las etiquetas
    // con una expresion. Dos motivos para no seguir asi:
    //
    //   · Desde que mayusculas+enter hace un salto de parrafo, ese salto es un
    //     `<br>` — y quitarlo dejaba «primera lineasegunda linea», pegadas.
    //   · La expresion se comia texto de verdad: «3 < 5 > 2» tiene algo que
    //     parece una etiqueta, y se borraba el trozo de en medio.
    //
    // Ahora `onSend` pasa el texto con sus saltos y aqui solo se recorta.
    const t = texto.trim();
    if (!t || !abierto) return;

    // Ni bloquear el teclado ni mandar tres veces lo mismo.
    //
    // El guardian de antes era `enviando`, que apagaba el campo entero — el
    // problema del punto 4. Pero quitarlo a secas abrio otro peor: una sola
    // pulsacion de Enter llamaba aqui TRES veces y el prospecto recibia el
    // mensaje repetido. Comprobado contra la base: tres filas de un Enter.
    //
    // Asi que el freno va sobre el TEXTO y no sobre el campo: el mismo mensaje,
    // al mismo chat, dos veces en menos de un segundo y medio, es un rebote del
    // teclado y no una persona escribiendo. Uno distinto sale al momento, que
    // es de lo que se trataba.
    const ahora = Date.now();
    const ultimo = ultimoEnvio.current;
    if (ultimo && ultimo.texto === t && ultimo.chat === abierto && ahora - ultimo.cuando < 1500) return;
    ultimoEnvio.current = { texto: t, chat: abierto, cuando: ahora };

    const cita = citando?.id ?? null;
    // Negativo para que no choque nunca con un id de la base.
    const tempId = -Date.now();
    const enCurso: EnCamino = {
      id: tempId, wa_id: null, direccion: 'saliente', tipo: 'texto', texto: t,
      media_url: null, media_mime: null, nombre_archivo: null, media_firma: null,
      estado: 'enviando', enviado_por: null, ts: new Date().toISOString(),
      paraConversacion: abierto,
    } as EnCamino;

    setPendientes((p) => [...p, enCurso]);
    setCitando(null);
    setBorrador('');

    try {
      const r = await chatApi.enviar(abierto, t, cita, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      // Se quita de los pendientes y se recarga: el bueno llega del servidor
      // con su id, su estado y su hora.
      setPendientes((p) => p.filter((m) => m.id !== tempId));
      await cargarHilo(abierto); cargarLista();
    } catch (e) {
      setPendientes((p) => p.map((m) => (m.id === tempId ? { ...m, estado: 'fallido' } : m)));
      fallo(e);
    }
  }

  /**
   * Corrige un mensaje ya enviado.
   *
   * «Se siguen enviando y no permite corregir desde la app» (#75). Hasta ahora
   * un error de dedo en un mensaje a un prospecto se quedaba ahi para siempre.
   *
   * El boton solo sale donde WhatsApp lo permite —propio, texto y menos de 15
   * minutos—, asi que quien lo ve puede usarlo. Ofrecerlo siempre y contestar
   * «fuera de plazo» al pulsarlo es peor que no ofrecerlo.
   */
  function sePuedeCorregir(m: MensajeWhatsapp) {
    // Lo primero, si este WhatsApp lo permite. El servidor lo pone en falso en
    // cuanto un 404 le dice que esta versión no trae la función: sin esto, el
    // botón se seguía ofreciendo en cada mensaje y fallaba siempre igual.
    if (conexion?.puedeCorregir === false) return false;
    return m.direccion === 'saliente' && m.tipo === 'texto' && Boolean(m.texto) && Boolean(m.wa_id)
      && m.estado !== 'fallido'
      && (Date.now() - new Date(m.ts).getTime()) < VENTANA_EDICION_MS;
  }

  /**
   * Se corrige DENTRO de la burbuja, no en un dialogo del navegador.
   *
   * Aqui habia un `window.prompt`. Funcionaba y estaba mal: sale un cartel del
   * sistema con «localhost:5173 dice» encima del CRM, no se puede dar estilo, no
   * respeta el tema y rompe la sensacion de estar en una aplicacion. Ademas
   * bloquea la pestaña entera mientras esta abierto.
   */
  function empezarACorregir(m: MensajeWhatsapp) {
    setEditando(m.id);
    setTextoEditado(m.texto || '');
  }

  async function guardarCorreccion(m: MensajeWhatsapp) {
    const limpio = textoEditado.trim();
    if (!abierto || !limpio || limpio === m.texto) { setEditando(null); return; }
    setCorrigiendo(m.id);
    try {
      const r = await chatApi.editarMensaje(m.id, abierto, limpio, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo corregir');
      setEditando(null);
      await cargarHilo(abierto); cargarLista();
      toast({ title: 'Corregido', description: 'Al otro lado se ve el texto nuevo, con la marca de editado.' });
    } catch (e) { fallo(e); } finally { setCorrigiendo(null); }
  }

  /** Vuelve a enviar un mensaje que no salio, con su mismo texto. */
  async function reintentar(m: MensajeWhatsapp) {
    if (!abierto || !m.texto) return;
    setReintentando(m.id);
    try {
      // Con `deQuien`: reintentar tiene que salir por la MISMA linea por la que
      // se intento. Sin el, un administrador que reintenta un mensaje fallido de
      // una gestora lo manda desde su propio numero — y el prospecto recibe a un
      // desconocido en mitad de una conversacion.
      const r = await chatApi.enviar(abierto, m.texto, null, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      // Si lo que se reintentaba era uno que nunca llego a salir —id negativo,
      // de los que se pintan al momento— hay que retirarlo: si no, quedarian
      // los dos, el fallido y el que acaba de salir bien.
      if (m.id < 0) setPendientes((p) => p.filter((x) => x.id !== m.id));
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setReintentando(null); }
  }

  /**
   * Llamar: lo apunta el CRM, lo marca el telefono.
   *
   * Por esta via WhatsApp no da canal de audio —no es que sea dificil, es que
   * no existe—, asi que la llamada la hace el movil de la gestora. Lo que se
   * arregla aqui es el otro problema: hoy una llamada que sale no aparece en
   * ningun historial, y media conversacion con un prospecto se pierde.
   *
   * El registro va PRIMERO y el marcado despues. Al reves, `tel:` cambia de
   * aplicacion y en un movil eso puede congelar la pestaña antes de que salga
   * el aviso: se llamaria sin que quedara constancia, que es justo lo que se
   * viene a resolver.
   */
  async function llamar(c: ChatWhatsapp) {
    let apuntada = false;
    try {
      // `deQuien` NO es opcional: sin el, con la sesion de otra persona elegida
      // el servidor busca en la del propio administrador y contesta que la
      // conversacion no existe. Por eso en pruebas habia CERO llamadas
      // apuntadas mientras el boton parecia funcionar (tarea #67). Es la
      // septima llamada de esta pantalla donde faltaba lo mismo.
      const r = await chatApi.apuntarLlamada(c.id, deQuien);
      apuntada = Boolean(r?.success);
      await cargarHilo(c.id);
      cargarLista();
    } catch {
      // Que no quede apuntado no puede impedir llamar: el trabajo es hablar con
      // la persona, no alimentar el historial. Pero se DICE, en el propio
      // dialogo, en vez de con un aviso que se va solo.
      apuntada = false;
    }
    // Y NO se navega a `tel:` a ciegas: en un ordenador eso no hace nada y el
    // navegador lo ignora en silencio. Se enseña el numero con sus dos salidas.
    setLlamando({ telefono: String(c.telefono || ''), nombre: c.lead_nombre || c.nombre_push || null, apuntada });
  }

  /**
   * Cambia el estado del prospecto sin salir del chat (#72).
   *
   * Lo que pedia el ticket de verdad: «que se le pueda anadir en seguimiento al
   * chat que estoy viendo». Las etiquetas de arriba solo filtran; para cambiar
   * una habia que irse a Prospectos y volver — y volver recarga el chat entero,
   * que es justo lo que la #64 acaba de quitar.
   *
   * Se pinta primero y se manda despues: el estado es de la persona y el
   * servidor no lo va a discutir. Si falla, se deshace y se dice.
   */
  async function cambiarEstado(c: ChatWhatsapp, status: string) {
    if (!c.lead_id || status === c.lead_status) return;
    const antes = c.lead_status;
    setChats((prev) => prev.map((x) => (x.id === c.id ? { ...x, lead_status: status } : x)));
    setConv((prev) => (prev && prev.id === c.id ? { ...prev, lead_status: status } : prev));
    try {
      const r = await chatApi.cambiarEstado(c.lead_id, status);
      if (!r?.success) throw new Error('no');
      cargarLista();
    } catch (e) {
      setChats((prev) => prev.map((x) => (x.id === c.id ? { ...x, lead_status: antes } : x)));
      setConv((prev) => (prev && prev.id === c.id ? { ...prev, lead_status: antes } : prev));
      // Se dice el motivo del servidor cuando lo hay.
      //
      // El caso real es «ese contacto es de otra gestora»: el chat es tuyo pero
      // el prospecto esta asignado a otra persona, y eso no se adivina mirando
      // la pantalla. Con un «vuelve a intentarlo» generico, quien lo vea lo
      // intentara otra vez y volvera a fallar.
      const motivo = (e as { message?: string })?.message;
      toast({
        title: 'No se pudo cambiar el estado',
        description: motivo && !/^Error \d/.test(motivo)
          ? motivo
          : 'Se queda como estaba. Vuelve a intentarlo.',
        variant: 'destructive',
      });
    }
  }

  /** Los pone en la vista previa. No envia nada todavia. */
  function proponerArchivos(fs: File[]) {
    // El destino sale de lo que se está VIENDO, no solo de `abierto`.
    //
    // Con el chat abierto en pantalla, soltar un archivo contestaba «Elige una
    // conversación antes». `conv` es la conversación que la cabecera está
    // pintando: si hay cabecera, hay destino, y no puede desajustarse con lo
    // que el usuario ve. `abierto` va primero porque es quien manda cuando los
    // dos están puestos.
    const destino = abierto ?? conv?.id ?? null;
    if (!destino) {
      toast({ title: 'Elige una conversacion antes', variant: 'destructive' });
      return;
    }
    // Y si se cayó el desajuste, se recupera: sin esto el archivo se quedaría
    // en la vista previa y al enviar volvería a fallar por lo mismo.
    if (!abierto) setAbierto(destino);
    // Se avisa AQUI, antes de subir nada. Lo que pasaba: se elegia el dossier,
    // se pulsaba enviar, se esperaba, y salia «Error 413» — que no le dice nada
    // a nadie. Ese 413 no es de la aplicacion (multer acepta 16 MB): lo corta
    // Nginx, cuyo client_max_body_size por defecto es 1 MB. Mientras no se
    // suba en el servidor, al menos que se sepa antes y en cristiano.
    const tope = conexion?.topeAdjuntoBytes || TOPE_POR_DEFECTO;
    const pesados = fs.filter((f) => f.size > tope);
    if (pesados.length) {
      const cual = pesados[0];
      toast({
        title: 'El archivo pesa demasiado',
        description: `«${cual.name}» ocupa ${(cual.size / 1024 / 1024).toFixed(1)} MB y el servidor `
          + `solo acepta ${(tope / 1024 / 1024).toFixed(0)} MB. Mandalo comprimido, o por otra via.`,
        variant: 'destructive',
      });
      const caben = fs.filter((f) => f.size <= tope);
      if (!caben.length) return;
      setPorEnviar(caben);
      return;
    }
    if (fs.length) setPorEnviar(fs);
  }

  /** Ahora si: manda lo que hay en la vista previa, con su pie. */
  async function enviarLoPropuesto(pie: string) {
    if (!abierto || !porEnviar.length) return;
    setEnviando(true);
    try {
      // De uno en uno: cada envio pasa por sus frenos y por su pausa. El pie
      // va solo en el primero, que es lo que hace WhatsApp — repetirlo en cada
      // uno seria mandar el mismo texto tres veces.
      //
      // `deQuien` dice de quien es el WhatsApp: sin el, un admin mirando la
      // sesion de una gestora adjuntaria desde la suya.
      for (const [i, f] of porEnviar.entries()) {
        const r = await chatApi.adjunto(abierto, f, i === 0 ? pie : '', undefined, deQuien);
        if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      }
      setPorEnviar([]);
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); }
  }

  async function mandarArchivo(f: File, extra?: { segundos?: number }) {
    if (!abierto) return;
    setEnviando(true);
    // Una nota de voz se manda sin vista previa —ya la has grabado tu— pero
    // tiene que verse que esta saliendo: antes se soltaba el boton y no pasaba
    // nada visible hasta que aparecia en el hilo. Con la red lenta, quien graba
    // no sabe si salio y vuelve a grabar.
    if (extra?.segundos) setVozSaliendo(extra.segundos);
    try {
      const r = await chatApi.adjunto(abierto, f, '', extra?.segundos, deQuien);
      if (!r.success) throw new Error(r.error || 'No se pudo enviar');
      await cargarHilo(abierto); cargarLista();
    } catch (e) { fallo(e); } finally { setEnviando(false); setVozSaliendo(null); }
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
    // Tambien por la vista previa. Este es el camino donde mas facil es mandar
    // lo que no era: se pega una captura sin mirar.
    proponerArchivos(archivos);
  }

  /**
   * Abre el microfono y lo deja abierto.
   *
   * Pedirlo tarda entre dos y ocho decimas —mas la primera vez, que hay que dar
   * permiso—. Si se pide al pulsar, se pierde el principio: o sale «grabando»
   * cuando ya has dicho media palabra, o empiezas a hablar antes de que el
   * microfono este abierto y esa parte no se graba.
   *
   * Se pide al pasar por encima del boton, que es medio segundo antes de
   * pulsarlo. Cuando llega el clic, ya esta listo.
   */
  async function prepararMicro() {
    if (micro.current) return micro.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micro.current = stream;
      return stream;
    } catch {
      return null;
    }
  }

  async function alternarGrabacion() {
    if (grabando) { grabadora.current?.stop(); return; }

    // Si el microfono aun no esta abierto se dice, en vez de dejar al usuario
    // hablando contra un boton que todavia no graba.
    let stream = micro.current;
    if (!stream) {
      setAbriendoMicro(true);
      stream = await prepararMicro();
      setAbriendoMicro(false);
    }
    if (!stream) {
      toast({ title: 'Sin micrófono', description: 'El navegador no dio permiso para grabar.', variant: 'destructive' });
      return;
    }

    // WhatsApp espera opus. Chrome NO graba ogg aunque se le pida —
    // isTypeSupported('audio/ogg;codecs=opus') devuelve false— y cae a webm.
    // El codec de dentro es opus igualmente, asi que WhatsApp lo entiende.
    const formatos = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
    const formato = formatos.find((f) => MediaRecorder.isTypeSupported(f));
    const mr = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined);
    trozos.current = [];
    const empezo = Date.now();

    mr.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
    mr.onstop = async () => {
      setGrabando(false);
      const blob = new Blob(trozos.current, { type: mr.mimeType || 'audio/webm' });
      const ext = (mr.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
      if (blob.size <= 800) return;   // un toque sin querer, no una nota

      // La duracion MEDIDA, no la del fichero.
      //
      // Lo que graba Chrome es webm, y ese contenedor sale sin duracion en la
      // cabecera porque es un flujo en vivo. WhatsApp entonces enseña una
      // duracion rara, casi siempre mas larga que la real: eso era «el retraso
      // que se envia». Se le manda cuanto duro de verdad.
      const segundos = Math.max(1, Math.round((Date.now() - empezo) / 1000));

      // PARAR NO ES ENVIAR.
      //
      // Antes se soltaba el boton y la nota salia disparada: sin oirla, sin
      // poder arrepentirse, y en WhatsApp un audio no se recoge pasados unos
      // minutos. Cualquiera que se equivoque de palabra o le entre un ruido de
      // fondo se queda con eso mandado.
      //
      // Ahora se para, se escucha si se quiere, y se decide. Es lo mismo que ya
      // se hace con las imagenes desde la tarea #45.
      // Aqui se acaba: lo manda el boton «Enviar» de la barra de revision.
      setVozGrabada({ blob, ext, segundos, url: URL.createObjectURL(blob) });
    };

    // El estado se pone cuando el MediaRecorder esta DE VERDAD en marcha, no
    // antes: asi lo que ve el usuario coincide con lo que se esta grabando.
    mr.onstart = () => setGrabando(true);
    mr.start();
    grabadora.current = mr;
  }

  async function abrirPorTelefono() {
    const t = telefonoNuevo.replace(/[^0-9]/g, '');
    if (t.length < 9) {
      toast({ title: 'Ese teléfono no vale', description: 'Ponlo con prefijo de pais y sin signos.', variant: 'destructive' });
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
        description: 'Si no es prospecto y nunca te ha escrito, se puede escribir igual — pero queda anotado.',
      });
    } catch (e) { fallo(e); }
  }

  /**
   * Abre el chat del numero que se acaba de buscar, sin mandarle nada.
   *
   * Es la salida del #73. El chat no esta en la base hasta que pasa un mensaje
   * por el CRM —`syncFullHistory` esta en false y esa conversacion es anterior
   * a enlazar el numero—, asi que ella tenia que ESCRIBIRLE para que apareciera:
   * «una vez se envia el mensaje desde la app, aparece el chat». Escribir a
   * alguien solo para poder verlo no es una forma de trabajar.
   *
   * `abrirChat` crea la conversacion y no manda nada. Un clic y esta ahi.
   */
  async function abrirLoBuscado() {
    const t = buscaChats.replace(/[^0-9]/g, '');
    if (t.length < 9) return;
    try {
      const r = await chatApi.abrirPorTelefono(t);
      if (!r.success) throw new Error(r.error || 'No se pudo abrir');
      setFiltro(''); setBuscaChats('');
      await cargarLista(); setAbierto(r.data.id);

      // Y se trae lo que Evolution tenga de ese chat (#73).
      //
      // Abrirlo y dejarlo vacio no resuelve nada: «no aparecen los
      // seguimientos de tiempo atras» es no poder LEER lo que se hablo, no que
      // falte una fila en la lista. Al enlazar solo entra el historial
      // reciente, asi que lo de hace dos meses hay que pedirlo.
      //
      // Va DESPUES de abrir y sin bloquear: el chat se ve al momento y los
      // mensajes viejos aparecen cuando lleguen. Si falla no se dice con un
      // aviso rojo — el chat esta abierto, que es lo que se pidio.
      chatApi.traerHistorial(r.data.id)
        .then(async (h) => {
          if (h?.success && h.data?.metidos) {
            await cargarHilo(r.data.id);
            cargarLista();
            toast({
              title: 'Historial traído',
              description: `${h.data.metidos} mensajes que no estaban en el CRM.`,
            });
          }
        })
        .catch(() => {});
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
      toast({ title: 'Marcado', description: 'El CRM no volvera a escribir a este número.' });
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
    // `||` solo cae con un valor falso, y una cadena de ESPACIOS no lo es.
    //
    // WhatsApp manda nombres asi mas de lo que parece: alguien con el nombre en
    // blanco, o con caracteres invisibles. Ese «  » se tomaba como nombre bueno
    // y la cabecera se quedaba vacia — se veia el fondo claro del kit, una
    // barra blanca donde deberia estar el nombre, y el avatar caia a su
    // interrogante. Reportado desde produccion.
    return conTexto(c.lead_nombre) || conTexto(c.nombre_push) || telefonoVisible(c)
      // Ni nombre ni telefono: pasa con quien llega por «@lid» y no esta en la
      // agenda. Antes caia a las cifras del identificador.
      || (c.es_grupo ? 'Grupo sin nombre' : 'Contacto de WhatsApp');
  };

  // Lo que se ensena debajo del nombre.
  //
  // Antes: el ultimo texto, y si no habia, el telefono. Pero un grupo no tiene
  // telefono: tiene un identificador de 18 cifras, y eso es lo que salia
  // pintado —dieciocho cifras seguidas— cada vez que el ultimo mensaje era una foto
  // o un sticker. Ahora se dice QUE fue, como en WhatsApp.
  const ADELANTO: Record<string, string> = {
    imagen: '📷 Foto', video: '🎥 Video', audio: '🎤 Nota de voz',
    documento: '📄 Documento', sticker: 'Sticker', llamada: '📞 Llamada',
    eliminado: 'Se eliminó este mensaje',
  };
  // De que proyecto es cada chat, dicho SIEMPRE.
  //
  // La lista ya no filtra por el proyecto elegido —el WhatsApp de una gestora es
  // una sola bandeja— asi que hace falta decir de donde viene cada conversacion.
  // Y las que no son de ningun proyecto tambien lo dicen: son las de alguien que
  // aun no esta en el CRM, y saber eso de un vistazo es justo lo util.
  const adelantoDe = (c: ChatWhatsapp) => {
    if (c.no_escribir) return 'no escribir';
    // La llamada va ANTES de `ultimo_texto`: en una llamada ese campo guarda el
    // desenlace en seco, asi que la lista ponia «perdida» a secas, sin decir de
    // que. Se mira el tipo primero y se dice la frase entera.
    if (c.ultimo_tipo === 'llamada') {
      return `📞 ${comoAcabo(c.ultimo_texto).cual.texto}`;
    }
    if (c.ultimo_texto) return c.ultimo_texto;
    if (c.ultimo_tipo && ADELANTO[c.ultimo_tipo]) return ADELANTO[c.ultimo_tipo];
    // Sin nada que adelantar: el telefono si lo hay de verdad. Ni el
    // identificador de un grupo ni un «@lid» le dicen nada a nadie.
    return telefonoVisible(c) || (c.es_grupo ? 'Grupo' : 'Sin mensajes todavía');
  };

  // Lo que va debajo del nombre de un grupo.
  //
  // Antes se listaba a quien habia ESCRITO y se leia como la lista de miembros.
  // En un grupo recien enlazado eso ponia «Angel y tú» debajo de un grupo de
  // doce personas: parece que faltan diez, y es lo que se reporto.
  //
  // Manda el numero de verdad, que se le pregunta a WhatsApp al abrir. Los
  // nombres se anaden cuando los sabemos, porque un nombre dice mas que una
  // cifra — pero nunca en lugar del recuento.
  //
  // Si WhatsApp no contesta se cae a lo que sabemos, sin el «y tú» que sugeria
  // que ahi estaban todos.
  const miembrosDe = (c: ChatWhatsapp) => {
    const cuantos = c.miembros ?? null;
    const nombres = c.participantes?.length
      ? `${c.participantes.slice(0, 3).join(', ')}${c.participantes.length > 3 ? '…' : ''}`
      : null;
    if (cuantos) {
      const recuento = `${cuantos} miembros`;
      return nombres ? `${recuento} · ${nombres}` : recuento;
    }
    return nombres || 'Grupo';
  };

  // Quien mando lo ultimo, delante del adelanto.
  //
  // En un grupo hablan varios y la lista ponia «Sticker» a secas: no habia
  // forma de saber quien lo habia mandado sin abrir el chat. WhatsApp escribe
  // «Dieguis: Sticker» y «Tu: Sticker», y eso es lo que se hace aqui.
  //
  // Solo en grupos. En el chat de una persona el nombre ya esta arriba, y
  // WhatsApp tampoco lo repite ahi.
  //
  // Nada si no hay nada que adelantar —no llegan mensajes— ni cuando el
  // adelanto no es un mensaje: «no escribir» es un aviso nuestro, no algo que
  // haya dicho nadie.
  const quienMandoDe = (c: ChatWhatsapp) => {
    if (!c.es_grupo || c.no_escribir || !c.ultimo_direccion) return null;
    if (c.ultimo_direccion === 'saliente') return 'Tú';
    return conTexto(c.ultimo_autor) || null;
  };
  // Ya vienen filtrados del servidor. Antes se filtraba aqui, sobre las 50
  // cargadas, y por eso no aparecia nada de mas atras.
  const visibles = chats;

  if (conexion && !conexion.configurado) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="font-semibold mb-1">WhatsApp no esta conectado</p>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{conexion.motivo}</p>
        <Link to="/whatsapp/conexion" className="text-sm text-primary hover:underline mt-3 inline-block">
          Ir a conectar el número
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
        marcador: 'Sin conexión con WhatsApp',
      }
    : conv?.no_escribir
    ? {
        icono: <Prohibit size={15} weight="bold" />,
        texto: `Esta persona pidió que no se le escriba.${conv.motivo_no_escribir ? ` (${conv.motivo_no_escribir})` : ''}`,
        marcador: 'No se escribe a este número',
      }
    : null;

  // Lo del servidor mas lo que todavia va en camino. Los pendientes van al
  // final porque son los ultimos por definicion.
  const enCamino = pendientes.filter((m) => m.paraConversacion === abierto);
  const hilo = enCamino.length ? [...mensajes, ...enCamino] : mensajes;


  let ultimoDia = '';

  return (
    <div className={`space-y-2 ${aPantalla ? 'wa-completa' : ''}`}>
      <div className="wa-barra-superior flex items-center gap-2 text-xs bg-card border border-border rounded-lg px-3 py-1.5">
        <span className={`wa-punto-estado w-2 h-2 rounded-full ${conexion?.conectado ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {conexion?.conectado
          ? <span className="text-muted-foreground">
              {sesion.esMia ? 'Tu WhatsApp' : `WhatsApp de ${sesion.nombre}`}: <strong className="text-foreground">
                {conexion.nombre || (conexion.numero ? `+${conexion.numero}` : conexion.instancia)}
              </strong>
            </span>
          : <span className="wa-sin-enlazar text-amber-700 dark:text-amber-400">
              {/* Si miras la sesion de otra persona, «no tienes WhatsApp
                  enlazado» es mentira: la que no lo tiene es ella. */}
              {sesion.esMia
                ? <>No tienes WhatsApp enlazado — <Link to="/whatsapp/conexion" className="underline">enlazar mi número</Link></>
                : `El WhatsApp de ${sesion.nombre} no está enlazado`}
            </span>}
        {/* La pantalla donde se enlaza o se desvincula el numero. Estaba solo en
            el menu lateral y desde el chat no habia forma de llegar. */}
        <button type="button" onClick={() => setAPantalla((v) => !v)}
          aria-label={aPantalla ? 'Salir' : 'Ampliar'}
          title={aPantalla ? 'Salir de pantalla completa (Esc)' : 'Ver solo el chat'}
          className="wa-btn-ampliar ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          {aPantalla ? <ArrowsIn size={14} weight="bold" /> : <ArrowsOut size={14} weight="bold" />}
          <span className="font-medium">{aPantalla ? 'Salir' : 'Ampliar'}</span>
        </button>
        {/* El recorrido, aqui y no en la cabecera del chat.

            Estaba dentro de <ConversationHeader>, que solo se pinta cuando hay
            una conversacion abierta. Quien acababa de llegar y no tenia ninguna
            no podia volver a verlo de ninguna manera — y es exactamente quien lo
            necesita, porque el recorrido salta solo una vez por navegador. */}
        <button type="button" onClick={() => setTour(true)} className="wa-btn-tour"
          aria-label="Ver el tutorial"
          title="Ver el recorrido por esta pantalla">
          <Question size={14} weight="bold" />
          <span className="font-medium">Tutorial</span>
        </button>
        <Link to="/whatsapp/conexion" aria-label="Conexión" title="Conectar o desvincular el número"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
          <PlugsConnected size={14} weight="bold" />
          <span className="font-medium">Conexión</span>
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

            {/* Las «etiquetas» de #72. Filtran en el servidor, no aqui: con el
                tope de 50 chats, filtrar lo ya cargado dejaria fuera justo lo
                que se busca — el mismo fallo que tenia el buscador. */}
            <div className="wa-etiquetas" role="group" aria-label="Filtrar por estado">
              {ETIQUETAS.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={etiqueta === e}
                  onClick={() => setEtiqueta(etiqueta === e ? null : e)}
                  className={`wa-etiqueta wa-et-${e} ${etiqueta === e ? "wa-etiqueta-puesta" : ""}`}>
                  {e === ETIQUETA_GRUPOS ? 'Grupos' : (STATUS_LABELS[e] || e)}
                </button>
              ))}
              {(etiqueta || etiquetaWa) && (
                <button type="button" onClick={() => { setEtiqueta(null); setEtiquetaWa(null); }}
                  className="wa-etiqueta wa-etiqueta-quitar">Quitar filtro</button>
              )}
            </div>

            {/* Las etiquetas DE WHATSAPP, en su propia fila (#128, #138).
                Van separadas y con un icono a propósito. Puestas junto a las de
                arriba salían DOS botones «Grupos» —el filtro de grupos del CRM y
                la etiqueta que WhatsApp trae de fábrica con ese nombre— sin nada
                que dijera cuál es cuál. Se vio en pantalla con un número real,
                no leyendo el código.

                Solo se pinta la fila si esa cuenta tiene etiquetas: sin WhatsApp
                Business no hay ninguna, y una fila de filtros vacía se lee como
                una avería. */}
            {etiquetasWa.length > 0 && (
              <div className="wa-etiquetas wa-etiquetas-wa" role="group"
                aria-label="Filtrar por una etiqueta de tu WhatsApp">
                <span className="wa-etiquetas-de">De tu WhatsApp</span>
                {etiquetasWa.map((e) => (
                  <button
                    key={e.wa_id}
                    type="button"
                    aria-pressed={etiquetaWa === e.wa_id}
                    title={`Etiqueta de tu WhatsApp · en ${e.conversaciones} chat(s)`}
                    onClick={() => setEtiquetaWa(etiquetaWa === e.wa_id ? null : e.wa_id)}
                    className={`wa-etiqueta wa-et-whatsapp ${etiquetaWa === e.wa_id ? 'wa-etiqueta-puesta' : ''}`}>
                    <Tag size={11} weight={etiquetaWa === e.wa_id ? 'fill' : 'regular'} />
                    {e.nombre}
                  </button>
                ))}
              </div>
            )}
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
                <Conversation key={c.id}
                  active={abierto === c.id}
                  unreadCnt={c.no_leidos || undefined}
                  onClick={() => setAbierto(c.id)}>
                  <Avatar name={nombreDe(c)}><Foto nombre={nombreDe(c)} url={c.avatar_url} grupo={c.es_grupo} /></Avatar>
                  {/* Con Conversation.Content y no con las props `name`/`info`:
                      hace falta meter la etiqueta AL LADO del nombre, y por prop
                      solo cabe texto plano. */}
                  <Conversation.Content>
                    <div className="wa-fila-nombre">
                      <span className="wa-fila-quien">{nombreDe(c)}</span>
                      {/* Un grupo se dice ANTES de mirar si es prospecto (#99,
                          punto 1): nunca tiene ficha, asi que por la via del
                          estado no le tocaba etiqueta ninguna y en la lista no
                          habia forma de distinguirlo de una persona suelta. */}
                      {c.es_grupo ? (
                        <span className="wa-fila-etiqueta wa-et-grupo">Grupo</span>
                      ) : c.lead_status && (
                        <span className={`wa-fila-etiqueta wa-et-${c.lead_status}`}>
                          {STATUS_LABELS[c.lead_status] || c.lead_status}
                        </span>
                      )}
                      {/* Las etiquetas que la gestora tiene puestas en SU
                          WhatsApp (#128, #138). Son otra cosa que el estado de
                          al lado: ese lo decide el CRM y va con la persona;
                          estas las puso ella en el móvil. Por eso se pintan
                          distintas y no se mezclan con la del estado.
                          Dos como mucho: la fila tiene el ancho que tiene, y
                          con cinco etiquetas no se leería ni el nombre. */}
                      {(c.etiquetas_wa || []).slice(0, 2).map((e) => (
                        <span key={e.waId} className="wa-fila-etiqueta wa-et-whatsapp"
                          title={`Etiqueta de WhatsApp: ${e.nombre}`}>
                          {e.nombre}
                        </span>
                      ))}
                      {(c.etiquetas_wa || []).length > 2 && (
                        <span className="wa-fila-etiqueta wa-et-whatsapp"
                          title={(c.etiquetas_wa || []).map((e) => e.nombre).join(', ')}>
                          +{(c.etiquetas_wa || []).length - 2}
                        </span>
                      )}
                      <span className="wa-fila-cuando">{cuandoDe(c.ultimo_at)}</span>
                    </div>
                    <div className="wa-fila-adelanto">
                      {quienMandoDe(c) && (
                        <span className="wa-fila-autor">{quienMandoDe(c)}: </span>
                      )}
                      {adelantoDe(c)}
                    </div>
                  </Conversation.Content>
                </Conversation>
              ))}
            </ConversationList>

            {/* Buscar y no encontrar nada tiene DOS motivos, y ninguno se veia.
                La gestora reporto los dos como si fueran fallos del buscador:
                «no aparecen los seguimientos de tiempo atras» (#73) y «no me
                aparece el chat del grupo de Psiko» (#74).

                Lo del grupo NO es un fallo: los grupos estan apagados a
                proposito en `groupsIgnore`, para no darle a Meta motivos de
                suspender el numero. Que ella lo sepa cuesta dos lineas, y le
                ahorra volver a reportarlo — y a nosotros, buscar un fallo que
                no existe. */}
            {/* Filtrando por una etiqueta del móvil y sin resultados.
                Antes salía la lista en blanco y punto: la gestora no tiene por
                qué saber si es que no hay ninguno con esa etiqueta o si el
                filtro está roto. Se dice cuál está puesta y se ofrece quitarla.

                Va ANTES que el de buscar porque puede haber las dos cosas a la
                vez, y el motivo más probable de no encontrar nada es el filtro
                —es la misma lección de la #72. */}
            {etiquetaWa && !visibles.length && (
              <div className="wa-sin-resultados">
                <p className="font-medium text-foreground">
                  Ninguno de tus chats tiene la etiqueta «
                  {etiquetasWa.find((e) => e.wa_id === etiquetaWa)?.nombre || etiquetaWa}»
                </p>
                <p>
                  Es una etiqueta de tu WhatsApp: si la pones desde el móvil o desde aquí, el chat
                  aparecerá en este filtro.
                </p>
                <button type="button" className="wa-etiqueta wa-etiqueta-quitar"
                  onClick={() => setEtiquetaWa(null)}>Quitar el filtro</button>
              </div>
            )}

            {buscaChats && !etiquetaWa && !visibles.length && (
              <div className="wa-sin-resultados">
                <p className="font-medium text-foreground">Sin resultados para «{buscaChats}»</p>
                {/* La etiqueta puesta, LO PRIMERO y antes que nada.
                    Es el motivo mas probable de que una busqueda no devuelva
                    nada, y era el unico que no se decia: se explicaba lo del
                    historial y lo de los grupos, y la gestora se quedaba
                    buscando a alguien que si esta pero con otro estado.
                    «Las etiquetas estan, pero no se puede buscar» (#72) — y
                    buscar si se puede; lo que no se puede es adivinar por que
                    no sale. Con el boton al lado, que quitar el filtro a mano
                    es volver arriba a buscar el chip pulsado. */}
                {etiqueta && (
                  <p>
                    Estás filtrando por{' '}
                    <strong>{etiqueta === ETIQUETA_GRUPOS ? 'Grupos' : (STATUS_LABELS[etiqueta] || etiqueta)}</strong>.
                    Puede que «{buscaChats}» esté aquí con otro estado.{' '}
                    <button type="button" onClick={() => setEtiqueta(null)} className="wa-quitar-filtro-enlace">
                      Buscar en todos
                    </button>
                  </p>
                )}
                <p>
                  Los chats aparecen aquí <strong>cuando pasa un mensaje por el CRM</strong>.
                  Una conversación anterior a enlazar el número puede seguir en tu móvil y
                  no estar todavía aquí.
                </p>
                {/* Y aqui se abre, sin tener que escribirle. Antes la unica forma
                    de que un chat viejo apareciera era mandarle un mensaje. */}
                {buscaChats.replace(/[^0-9]/g, '').length >= 9 && (
                  <button type="button" onClick={abrirLoBuscado} className="wa-abrir-buscado">
                    Abrir el chat con {buscaChats.trim()}
                  </button>
                )}
                {/* Esto lo dice ahora el servidor, no la pantalla.
                    Antes se afirmaba siempre «los grupos no se muestran», y era
                    falso: sí se muestran. Se le pedía a Evolution que los
                    ignorara y no lo hacía, así que la pantalla estaba dando por
                    buena una regla que nadie cumplía (#74). */}
                {conexion?.grupos === false && (
                  <p>
                    Y los <strong>grupos no se muestran</strong>, a propósito: este número es
                    para escribir a prospectos, y entrar en grupos suma para que WhatsApp lo
                    suspenda. No es un fallo.
                  </p>
                )}
              </div>
            )}
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
                    : conv.es_grupo ? miembrosDe(conv)
                    : [telefonoVisible(conv), conv.lead_id ? 'prospecto' : 'sin prospecto']
                        .filter(Boolean).join(' · ')} />
                <ConversationHeader.Actions>
                  {/* La etiqueta del prospecto, cambiable desde aqui (#72).
                      Solo con ficha: un grupo no tiene estado, y un numero que
                      no es prospecto tampoco — para ese esta el boton de al
                      lado, que abre la ficha y deja convertirlo.
                      Un <select> de verdad y no un menu propio: se abre con
                      teclado, se lee con lector de pantalla y en el movil sale
                      la rueda del sistema. */}
                  {conv.lead_id && (
                    <select
                      className={`wa-estado-elegir wa-et-${conv.lead_status || 'nuevo'}`}
                      value={conv.lead_status || ''}
                      aria-label="Estado del prospecto"
                      title="Cambiar el estado de este prospecto"
                      onChange={(e) => cambiarEstado(conv, e.target.value)}
                    >
                      {!conv.lead_status && <option value="">Sin estado</option>}
                      {Object.entries(STATUS_LABELS).map(([valor, texto]) => (
                        <option key={valor} value={valor}>{texto}</option>
                      ))}
                    </select>
                  )}
                  {/* La ficha, en un popup y SIN salir de aqui.
                      Antes era un enlace a /prospectos/:id que navegaba en esta
                      misma pestaña: al volver se recargaban las conversaciones,
                      los mensajes del hilo y las firmas de los adjuntos. Varios
                      segundos, y una gestora entra y sale cada dos mensajes.
                      Es el motivo de la tarea #64.

                      Y sale SIEMPRE, no solo con prospecto: la conversacion sin
                      ficha es justo la que hay que poder convertir en una. */}
                  <button type="button" onClick={() => setFichaDe(conv.id)}
                    className="wa-btn-ficha"
                    aria-label={conv.lead_id ? 'Ver la ficha del prospecto' : 'Ver quién es'}
                    title={conv.lead_id ? 'Ver la ficha del prospecto' : 'Ver quién es'}>
                    {/* Icono propio, no el `InfoButton` del kit.
                        El kit pinta SU PROPIO <button>, asi que envuelto en el
                        mio quedaba un boton dentro de otro: HTML invalido, y
                        React lo gritaba en la consola en cada apertura de chat
                        —enterrando lo que si importa mirar ahi—. Ademas sus dos
                        vecinos ya usan iconos de phosphor a 17, con lo que de
                        paso los tres van iguales. */}
                    <Info size={17} />
                  </button>
                  {/* Las etiquetas del WhatsApp de la gestora (#128, #138).
                      Van aparte del desplegable de estado que hay al lado: ese
                      es del CRM y va con la persona; estas son de su móvil.
                      Si esa cuenta no tiene etiquetas —no es Business— el botón
                      no se pinta, en vez de abrir una lista vacía. */}
                  <EtiquetasDelChat
                    conversacionId={conv.id}
                    puestas={conv.etiquetas_wa || []}
                    esGrupo={conv.es_grupo}
                    deQuien={deQuien}
                    alCambiar={() => { cargarHilo(conv.id); cargarLista(); }}
                  />
                  {/* Llamar. El CRM prepara, el telefono llama.
                      Solo cuando hay un numero de verdad al que llamar: a un
                      grupo no se puede, y de quien llega por «@lid» no tenemos
                      su movil — el boton abriria un dialogo con catorce cifras
                      que no marcan a nadie. Prometer eso es peor que no
                      ofrecerlo. */}
                  {telefonoVisible(conv) && (
                    <button type="button" onClick={() => llamar(conv)} className="wa-btn-llamar"
                      title={`Llamar a ${telefonoVisible(conv)} desde el móvil`}>
                      <PhoneCall size={17} />
                    </button>
                  )}
                  <button type="button" onClick={() => setPidiendoMotivo(true)} className="wa-btn-prohibir"
                    title="No volver a escribir a este número">
                    <Prohibit size={17} />
                  </button>
                </ConversationHeader.Actions>
              </ConversationHeader>

              <MessageList>
                {/* Un chat abierto y en blanco no puede quedarse en blanco (#76).
                    La gestora lo conto asi: «en el chat con el bot no me aparece
                    nada, NO SE SI DEBO ESCRIBIRLE AL PROSPECTO DESDE OTRO LUGAR».
                    Esa segunda parte es lo grave: no sabe si el CRM sirve para
                    esto o tiene que irse a otro sitio. Aunque el historial tarde
                    en entrar, la pantalla tiene que decirle que pasa.

                    Va como separador por lo mismo que el «ver mas» de abajo:
                    MessageList solo admite sus propios hijos. */}
                {!hilo.length && (
                  <MessageSeparator
                    className="wa-vacio"
                    content={sync?.entrando
                      ? 'Todavía no ha entrado el historial de esta conversación'
                      : 'Aquí no hay nada guardado todavía — escribe para empezar'} />
                )}
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
                {hilo.flatMap((m, i) => {
                  const día = diaDe(m.ts);
                  const nuevoDia = día !== ultimoDia;
                  if (nuevoDia) ultimoDia = día;
                  const prev = hilo[i - 1];
                  const sig = hilo[i + 1];
                  // En un grupo la tanda se corta tambien cuando cambia QUIEN
                  // escribe: dos personas seguidas no son un bloque, aunque las
                  // dos sean mensajes que entran.
                  const autorDe = (x?: MensajeWhatsapp) =>
                    (conv?.es_grupo ? (x?.participante_nombre || x?.participante || '') : '');
                  const mismoQuePrev = !nuevoDia && prev?.direccion === m.direccion
                    && autorDe(prev) === autorDe(m);
                  const mismoQueSig = sig?.direccion === m.direccion && diaDe(sig.ts) === día
                    && autorDe(sig) === autorDe(m);
                  const posicion = mismoQuePrev && mismoQueSig ? 'normal'
                    : mismoQuePrev ? 'last' : mismoQueSig ? 'first' : 'single';
                  const mia = m.direccion === 'saliente';
                  // Una llamada no es un mensaje: no tiene burbuja, ni autor,
                  // ni se puede responder ni reintentar. Sale antes de todo eso.
                  // Un mensaje borrado deja su hueco, como en WhatsApp: no
                  // desaparece de la conversacion, se dice que estuvo y ya no
                  // esta. En un historial de clientes, que una fila se esfume
                  // sin rastro es lo contrario de lo que hace falta.
                  if (m.tipo === 'eliminado') {
                    return [
                      nuevoDia ? <MessageSeparator key={`d${m.id}`} content={día} /> : null,
                      <Message key={m.id} className="wa-msg-eliminado"
                        model={{
                          direction: mia ? 'outgoing' : 'incoming',
                          position: posicion,
                          type: 'custom',
                        }}>
                        <Message.CustomContent>
                          <span className="wa-eliminado">
                            <Prohibit size={13} weight="bold" /> Se eliminó este mensaje
                          </span>
                          <span className="wa-meta">{hora(m.ts)}</span>
                        </Message.CustomContent>
                      </Message>,
                    ].filter(Boolean);
                  }
                  if (m.tipo === 'llamada') {
                    return [
                      nuevoDia ? <MessageSeparator key={`d${m.id}`} content={día} /> : null,
                      <Message key={m.id} className="wa-msg-llamada"
                        model={{ direction: 'incoming', position: 'single', type: 'custom' }}>
                        <Message.CustomContent><Llamada m={m} /></Message.CustomContent>
                      </Message>,
                    ].filter(Boolean);
                  }
                  return [
                    nuevoDia ? <MessageSeparator key={`d${m.id}`} content={día} /> : null,
                    <Message key={m.id} className={
                        m.tipo === 'sticker' ? 'wa-msg-sticker'
                        // Con imagen o video, la burbuja se estrecha para que el
                        // pie envuelva al ancho de la foto en vez de estirar la
                        // burbuja y dejar la foto suelta a un lado.
                        : (m.tipo === 'imagen' || m.tipo === 'video') ? 'wa-msg-media'
                        : undefined}
                      model={{
                        direction: mia ? 'outgoing' : 'incoming',
                        position: posicion,
                        type: 'custom',
                      }}
                      // El avatar de quien escribe va FUERA de la burbuja, a su
                      // izquierda, como en WhatsApp. Estaba dentro y en pequeño,
                      // pegado al nombre, y no se parecia en nada.
                      avatarPosition={conv?.es_grupo && !mia ? 'tl' : undefined}>
                      {conv?.es_grupo && !mia && (
                        // Solo en el PRIMERO de cada tanda. En los siguientes va
                        // un hueco del mismo tamaño para que las burbujas sigan
                        // alineadas, que es lo que hace WhatsApp.
                        <Avatar name={m.participante_nombre || 'Alguien'}>
                          {mismoQuePrev
                            ? <span className="wa-autor-hueco" aria-hidden="true" />
                            : (() => {
                                const quien = m.participante_nombre
                                  || `+${String(m.participante || '').split('@')[0]}`;
                                // Su foto de verdad si la tenemos —porque esa
                                // persona tiene su propio chat— y si no, sus
                                // iniciales con su color.
                                if (m.participante_foto) {
                                  return <img src={m.participante_foto} alt={quien} className="wa-autor-foto" />;
                                }
                                return (
                                  <span className="wa-autor-foto"
                                    style={{ background: colorDeNombre(quien) }}>
                                    {iniciales(quien)}
                                  </span>
                                );
                              })()}
                        </Avatar>
                      )}
                      <Message.CustomContent>
                        {/* QUIEN escribio. Solo en grupos, y solo en lo que
                            entra: lo que sale es tuyo y ponerte tu propio
                            nombre en cada burbuja seria ruido.

                            Sin esto, un grupo era una lista de mensajes sin
                            autor —todos iguales— y no se podia saber quien
                            había dicho qué, que es media razón para abrir un
                            grupo. En un chat de una persona sobra: la
                            conversación YA es ella. */}
                        {conv?.es_grupo && !mia && !mismoQuePrev
                          && (m.participante_nombre || m.participante) && (() => {
                          const quien = m.participante_nombre
                            || `+${String(m.participante).split('@')[0]}`;
                          // Sin la inicial al lado: el avatar ya esta fuera. Y
                          // solo en el primero de la tanda — repetir el nombre en
                          // cada burbuja de la misma persona es ruido, y no es lo
                          // que hace WhatsApp.
                          return (
                            <div className="wa-autor" style={{ color: colorDeNombre(quien) }}>
                              <span className="wa-autor-nombre">{quien}</span>
                            </div>
                          );
                        })()}
                        {/* A que contestaba. Sin esto la respuesta salia suelta
                            y en una conversacion movida eso es la mitad de la
                            informacion: se veia el «si» sin la pregunta. */}
                        {m.responde_a && (m.citado_texto || m.citado_tipo) && (
                          <div className="wa-cita">
                            <span className="wa-cita-quien">
                              {/* En un grupo, a QUIEN se cita. Aqui iba el nombre
                                  de la conversacion, que en un grupo es el del
                                  grupo: se leia «Fantasy» citando a una persona. */}
                              {m.citado_direccion === 'saliente'
                                ? 'Tú'
                                : (m.citado_autor || nombreDe(conv))}
                            </span>
                            <span className="wa-cita-texto">
                              {m.citado_texto || ADELANTO[m.citado_tipo || ''] || `(${m.citado_tipo})`}
                            </span>
                          </div>
                        )}
                        {m.tipo !== 'texto' && <div className="wa-adjunto"><Adjunto m={m} alPedir={pedirAdjunto} bajando={bajando.includes(m.id)} /></div>}
                        {editando === m.id ? (
                          <div className="wa-editando">
                            <textarea
                              autoFocus
                              value={textoEditado}
                              onChange={(e) => setTextoEditado(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') { setEditando(null); }
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guardarCorreccion(m); }
                              }}
                              rows={Math.max(2, Math.min(6, textoEditado.split(String.fromCharCode(10)).length))}
                              aria-label="Corrige el mensaje" />
                            <div className="wa-editando-botones">
                              <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
                              <button type="button" className="wa-editando-guardar"
                                disabled={corrigiendo === m.id || !textoEditado.trim()}
                                onClick={() => guardarCorreccion(m)}>
                                {corrigiendo === m.id ? 'Guardando…' : 'Guardar'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          m.texto && <div className="wa-texto"><TextoDeWhatsapp texto={m.texto} /></div>
                        )}
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
                        {/* Las acciones, en FILA y no apiladas.
                            Iban las dos con la misma posicion absoluta en la
                            esquina, asi que la segunda tapaba a la primera.

                            Y corregir entra aqui (#75): era un texto gris de
                            once pixeles dentro de la burbuja, siempre visible
                            pero invisible de hecho — «funciona, pero no se ve
                            como». Ahora es un icono al lado de los otros, que
                            es donde se busca. */}
                        <span className="wa-acciones">
                          <button type="button" className="wa-accion"
                            title="Responder a este mensaje"
                            aria-label="Responder a este mensaje"
                            onClick={() => setCitando(m)}>
                            <ArrowBendUpLeft size={13} weight="bold" />
                          </button>
                          {/* Una llamada no se reenvia, y uno que aun no ha
                              salido tampoco. */}
                          {m.tipo !== 'llamada' && m.id > 0 && (
                            <button type="button" className="wa-accion"
                              title="Reenviar a otro chat"
                              aria-label="Reenviar a otro chat"
                              onClick={() => setReenviando(m)}>
                              <ShareFat size={13} weight="bold" />
                            </button>
                          )}
                          {sePuedeCorregir(m) && editando !== m.id && (
                            <button type="button" className="wa-accion"
                              disabled={corrigiendo === m.id}
                              title="Corregir — WhatsApp lo permite durante 15 minutos"
                              aria-label="Corregir este mensaje"
                              onClick={() => empezarACorregir(m)}>
                              <PencilSimpleLine size={13} weight="bold" />
                            </button>
                          )}
                        </span>
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

                {/* La nota de voz, mientras sale.
                    Aparece en cuanto se suelta el boton y se confirma cuando
                    contesta el servidor — es lo mismo que hace WhatsApp. Antes
                    no pasaba nada visible hasta que el audio estaba en el hilo,
                    asi que con la red lenta quien grababa no sabia si habia
                    salido y volvia a grabar. Si el envio falla, desaparece y el
                    aviso dice por que. */}
                {vozSaliendo !== null && (
                  <Message model={{ direction: 'outgoing', position: 'single', type: 'custom' }}>
                    <Message.CustomContent>
                      <div className="wa-voz wa-voz-mia wa-voz-saliendo">
                        <span className="wa-voz-boton"><Microphone size={15} weight="fill" /></span>
                        <div className="wa-voz-barra"><span className="wa-voz-hecho" style={{ width: '100%' }} /></div>
                        <span className="wa-voz-tiempo">
                          {Math.floor(vozSaliendo / 60)}:{String(vozSaliendo % 60).padStart(2, '0')}
                        </span>
                      </div>
                      <span className="wa-meta">enviando…</span>
                    </Message.CustomContent>
                  </Message>
                )}
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
                <InputToolbox className={
                  bloqueo ? 'wa-bloqueado'
                    : vozGrabada ? 'wa-citando wa-voz-revisar'
                      : citando ? 'wa-citando' : 'wa-toolbox-vacia'}>
                  {vozGrabada ? (
                    <>
                      {/* Grabada y esperando. Se escucha y se decide: parar no
                          es enviar. Antes salia disparada al soltar el boton, sin
                          poder oirla ni arrepentirse — y en WhatsApp un audio no
                          se recoge pasados unos minutos. */}
                      <audio src={vozGrabada.url} controls className="wa-voz-revisar-audio" />
                      <button type="button" className="wa-btn-suave"
                        onClick={() => { URL.revokeObjectURL(vozGrabada.url); setVozGrabada(null); }}
                        title="Tirar esta nota y no enviarla">
                        <Trash size={14} /> Borrar
                      </button>
                      <button type="button" className="wa-btn-verde" disabled={enviando}
                        onClick={async () => {
                          const v = vozGrabada;
                          URL.revokeObjectURL(v.url);
                          setVozGrabada(null);
                          await mandarArchivo(
                            new File([v.blob], `nota-de-voz.${v.ext}`, { type: v.blob.type }),
                            { segundos: v.segundos },
                          );
                        }}>
                        {enviando ? 'Enviando…' : <>Enviar <PaperPlaneRight size={13} weight="fill" /></>}
                      </button>
                    </>
                  ) : bloqueo ? (
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
                {/* Las plantillas, AQUI. Estaban solo en su pantalla, asi que
                    habia que salir del chat, copiar a mano y volver — con lo
                    cual no ahorraban nada. */}
                {!bloqueo && hayAmbito && (
                  <button type="button" className="wa-btn-plantillas"
                    aria-label="Usar una plantilla"
                    title="Usar una plantilla"
                    aria-expanded={plantillasAbiertas}
                    onClick={() => {
                      setPlantillasAbiertas((v) => !v);
                      // Los datos para los huecos se piden al abrir, no antes.
                      if (!plantillasAbiertas && abierto) {
                        chatApi.ficha(abierto, deQuien)
                          .then((r) => {
                            if (!r.success) return;
                            const p = r.data.prospecto;
                            setDatosPlantilla(p
                              ? {
                                nombre: p.nombre, email: p.email, telefono: p.telefono,
                                producto: p.producto,
                                // Los de su formación (#129). Las plazas se
                                // cuentan AHORA, al abrir el selector: el
                                // documento comercial dice que no se arrastre
                                // nunca el dato del mensaje anterior.
                                plazas: p.plazas_libres,
                                cierre: p.fecha_cierre_convocatoria,
                                inicio: p.fecha_inicio_texto,
                              }
                              : { telefono: r.data.telefono, nombre: r.data.nombre });
                          })
                          .catch(() => setDatosPlantilla({}));
                      }
                    }}>
                    <FileText size={15} />
                    <span>Plantillas</span>
                  </button>
                )}
              </InputToolbox>

              {plantillasAbiertas && hayAmbito && (
                <SelectorPlantillas
                  projectId={projectId}
                  issuerId={activeIssuerId}
                  datos={datosPlantilla}
                  nombreProyecto={nombreProyecto}
                  alElegir={(texto, plantilla) => {
                    setBorrador(texto);
                    // El documento, dia 2: el mensaje anuncia la opinion y
                    // «(enviar la captura justo despues)». Si la plantilla lleva
                    // imagen detras, se abre ya el selector: acordarse del clip
                    // es justo lo que se olvida con prisa.
                    if (plantilla?.pide_adjunto) {
                      setTimeout(() => ficheroRef.current?.click(), 120);
                    }
                  }}
                  alCerrar={() => setPlantillasAbiertas(false)}
                />
              )}

              <MessageInput
                placeholder={
                  bloqueo ? bloqueo.marcador
                  : grabando ? 'Grabando… pulsa ■ para terminar (no se envía todavía)'
                  : 'Escribe un mensaje'
                }
                /* MAYÚSCULAS + ENTER TIENE QUE HACER UN SALTO DE PÁRRAFO.
                   Pedido: «necesito poder tocar mayus + enter y que haga un
                   salto de párrafo sin enviar el mensaje, ahora no lo hace».

                   El kit ya distingue —con Shift no envía— y el salto se
                   perdía aquí: de los tres valores que devuelve
                   (html, textContent, innerText) cogíamos el DEL MEDIO, y
                   `textContent` no conserva los saltos. Como la caja está
                   controlada, al siguiente render el <br> desaparecía: pulsabas
                   y no pasaba nada.

                   Ahora se guarda `innerText`, que sí los trae, y al pintar se
                   vuelven a <br> — en HTML un salto de línea es un espacio, así
                   que devolver el texto tal cual los borraría otra vez. Se
                   escapan los signos primero: esto entra como innerHTML y una
                   plantilla con «<» no puede romper la caja. */
                value={borrador
                  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                  .replace(/\n/g, '<br>')}
                onChange={(_html, _texto, conSaltos) => setBorrador(
                  (conSaltos ?? '').replace(/\r\n/g, '\n'))}
                /* El kit manda cuatro cosas y la PRIMERA es el HTML. Se coge
                   la tercera, que es el texto con los saltos de parrafo. */
                onSend={(_html, _texto, conSaltos) => enviar(conSaltos ?? '')}
                disabled={Boolean(bloqueo)} attachButton
                onAttachClick={() => ficheroRef.current?.click()}
                sendDisabled={Boolean(bloqueo)} />
            </ChatContainer>
          ) : estrecho ? null : (
            <ChatContainer>
              <MessageList>
                <MessageList.Content className="wa-vacio">
                  {chats.length === 0 && !cargando
                    ? 'Aquí aparecerán tus conversaciones en cuanto enlaces tu número.'
                    : 'Elige una conversacion, o escribe a un prospecto con el lapiz de la izquierda.'}
                </MessageList.Content>
              </MessageList>
            </ChatContainer>
          )}
        </MainContainer>

        {/* El microfono va aparte: el kit no trae boton de nota de voz. */}
        {conv && !conv.no_escribir && (
          <button type="button" onClick={alternarGrabacion} disabled={enviando}
            onMouseEnter={prepararMicro} onFocus={prepararMicro}
            title={grabando ? 'Terminar la nota — luego la escuchas antes de enviarla'
              : abriendoMicro ? 'Abriendo el micrófono…' : 'Grabar una nota de voz'}
            aria-label={grabando ? 'Terminar la nota de voz' : 'Grabar una nota de voz'}
            className={`wa-btn-micro ${grabando ? 'wa-grabando' : ''} ${abriendoMicro ? 'wa-abriendo' : ''}`}>
            {grabando ? <Stop size={17} weight="fill" /> : <Microphone size={18} />}
          </button>
        )}
      </div>

      <VistaPreviaAdjunto
        archivos={porEnviar}
        enviando={enviando}
        alEnviar={enviarLoPropuesto}
        alCancelar={() => setPorEnviar([])}
        alAnadir={(fs) => setPorEnviar((p) => [...p, ...fs])} />

      {tour && <Tour alCerrar={() => setTour(false)} />}

      {llamando && (
        <Llamar
          telefono={llamando.telefono}
          nombre={llamando.nombre}
          apuntada={llamando.apuntada}
          onCerrar={() => setLlamando(null)}
        />
      )}

      {/* Avisa antes de que un enlace se lleve la pestaña fuera del chat. No
          salta al moverse por dentro —cambiar de conversacion, plantillas— ni
          con lo que ya abre pestaña nueva. Se apaga mientras hay un dialogo
          abierto: dos ventanas encima de otra son un laberinto. */}
      <AvisoAlSalir activo={fichaDe === null && !tour} />

      {/* La ficha del prospecto. Crear una nueva SI saca del chat, pero es una
          accion deliberada y con destino: se va a Prospectos con el telefono ya
          puesto, en vez de dejar a la gestora copiandolo a mano. */}
      {reenviando && (
        <ElegirChat
          chats={chats}
          excluirId={abierto}
          deQuien={deQuien}
          nombreDe={nombreDe}
          enviando={reenvioEnCurso}
          onCerrar={() => setReenviando(null)}
          onElegir={async (destino) => {
            setReenvioEnCurso(true);
            try {
              const r = await chatApi.reenviar(destino.id, reenviando.id);
              if (!r.success) throw new Error(r.error || 'No se pudo reenviar');
              setReenviando(null);
              toast({ title: 'Reenviado', description: `A ${nombreDe(destino)}.` });
              // Si es el chat que se esta mirando, que se vea sin esperar al
              // refresco; si no, basta con actualizar la lista.
              if (destino.id === abierto) await cargarHilo(abierto);
              cargarLista();
            } catch (e) { fallo(e); } finally { setReenvioEnCurso(false); }
          }}
        />
      )}

      {fichaDe !== null && (
        <FichaProspecto
          conversacionId={fichaDe}
          deQuien={deQuien}
          onCerrar={() => setFichaDe(null)}
          onCrearProspecto={(telefono, nombre) => {
            setFichaDe(null);
            const q = new URLSearchParams();
            if (telefono) q.set('telefono', telefono);
            if (nombre) q.set('nombre', nombre);
            window.open(`${import.meta.env.BASE_URL}prospectos?nuevo=1&${q}`.replace(/\/{2,}/g, '/'),
              '_blank', 'noopener');
          }}
        />
      )}

      <input ref={ficheroRef} type="file" className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
        multiple
        onChange={(e) => { proponerArchivos([...(e.target.files || [])]); e.target.value = ''; }} />

      {/* Escribir a un numero suelto. Antes era un window.prompt del navegador:
          una caja gris del sistema encima del chat, imposible de dar estilo. */}
      {pidiendoTelefono && (
        <div className="wa-velo" onClick={() => setPidiendoTelefono(false)}>
          <form className="wa-panel" onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); abrirPorTelefono(); }}>
            <div className="wa-panel-cabecera">
              <span>Escribir a un número</span>
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
                te ha escrito, queda anotado quien fue el primero en escribir.
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
                ni con plantilla ni «solo una última vez». Se puede quitar después.
              </p>
              <input autoFocus value={motivoNuevo} onChange={(e) => setMotivoNuevo(e.target.value)}
                placeholder="Motivo (opcional): pidió que no le escribieran…" className="wa-campo" />
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
                  placeholder="Nombre, email o teléfono…" className="wa-campo wa-campo-lupa" />
              </div>
            </div>
            <div className="wa-lista-panel">
              <button type="button" onClick={() => { setPidiendoTelefono(true); setNuevoAbierto(false); }}
                className="wa-fila wa-fila-accion">
                + Escribir a un número que no esta en la base
              </button>
              {candidatos.length === 0 && (
                <p className="wa-panel-nota" style={{ padding: '14px', textAlign: 'center' }}>
                  Sin prospectos con teléfono. Solo se puede escribir a quien dejo el suyo.
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
