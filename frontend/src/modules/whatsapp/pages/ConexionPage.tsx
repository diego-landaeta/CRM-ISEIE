import { useCallback, useEffect, useRef, useState } from 'react';
import SelectorDeSesion, { type SesionElegida } from '../components/SelectorDeSesion';
import { Link } from 'react-router-dom';
import {
  WhatsappLogo, QrCode, CheckCircle, WarningCircle, ArrowClockwise,
  SignOut, DeviceMobile, ArrowsClockwise, X, PhoneX,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { chatApi, type ConexionWhatsapp } from '../api/whatsapp.api';
// Los paneles comparten aspecto con los del chat: es la misma pantalla.
import './chat.css';

// Conectar TU numero de WhatsApp al CRM.
//
// Cada persona enlaza el suyo y solo ve sus conversaciones. No hay un WhatsApp
// del CRM compartido: lo habia, y significaba que quien lo enlazara dejaba sus
// chats privados a la vista de todos los demas usuarios.
//
// Pensada para que quien enlaza no tenga que saber nada: pulsa un boton, sale
// un codigo, lo escanea y ya. Si el codigo caduca se renueva solo, si algo va
// mal lo dice, y para desvincular hay un boton en vez de tener que buscarlo en
// los ajustes del movil.

// WhatsApp caduca el codigo cada 20 segundos. Se pide uno nuevo antes de que
// eso pase: si no, la persona escanea un codigo muerto y no entiende por que
// no funciona.
const RENUEVA_QR_MS = 18000;

// Lo que se contesta si no se escribe otra cosa. Corto y sin promesas de
// horario: «te llamamos en 5 minutos» es lo que genera la queja siguiente.
const RESPUESTA_POR_DEFECTO = 'Ahora no podemos atenderte por llamada. Escribenos por aquí y te respondemos lo antes posible.';

export default function ConexionPage() {
  const [estado, setEstado] = useState<ConexionWhatsapp | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [reintento, setReintento] = useState(0);
  // El aviso de confirmacion, dentro de la pantalla. Era un window.confirm: una
  // caja del sistema operativo, con la tipografia del navegador y encima de
  // todo. Ademas hay navegadores que las bloquean y la accion se perdia sin que
  // nadie se enterase.
  const [confirmando, setConfirmando] = useState(false);
  // Al desvincular, ¿se borra tambien lo guardado en el CRM?
  //
  // Por defecto NO: son conversaciones con clientes y eso no se deshace. Pero
  // hay que ofrecerlo — desvincular y volver a enlazar «desde cero» devolvia
  // los chats de siempre, porque «cero» era cero para WhatsApp, no para la base.
  const [borrarTodo, setBorrarTodo] = useState(false);
  // Cuanto historial traer. Por defecto lo rapido: con «todo», un numero de
  // anos manda decenas de miles de mensajes por tandas y la pantalla tarda un
  // buen rato en estar usable, que es justo la queja de siempre.
  // Empezar de cero por defecto, y no es una preferencia estetica: traerse anos
  // de conversaciones privadas a la base de la empresa casi nunca es lo que hace
  // falta para trabajar, y una vez estan ahi ya no se quitan solas.
  const [modo, setModo] = useState<'cero' | 'rápido' | 'todo'>('cero');
  // Enterarse ANTES, no despues.
  //
  // Enlazar por esta via no es la forma oficial de WhatsApp y quien paga si sale
  // mal es la persona con su numero. El aviso estaba al pie de la pagina, debajo
  // del codigo: para cuando alguien lo leyera, ya habia escaneado. Ahora va
  // primero y sin marcarlo no sale el codigo. El servidor lo exige tambien, que
  // si no bastaria con llamar al endpoint a mano.
  const [enterado, setEnterado] = useState(false);
  const [sync, setSync] = useState<{ conversaciones: number; mensajes: number; entrando: boolean; adjuntosPendientes: number } | null>(null);
  // De quien es la sesion que se esta viendo. Para una gestora siempre la suya
  // —el selector ni se pinta—; quien manda puede enlazar la de otra persona
  // teniendola al lado con su movil, que es mas rapido que explicarselo.
  const [sesion, setSesion] = useState<SesionElegida>({ usuarioId: null, nombre: '', esMia: true });
  // Que se le contesta a quien llama. `disponible` en false significa que no se
  // pudieron leer los ajustes —sesion caida—, no que este apagada.
  const [llamada, setLlamada] = useState<{ activa: boolean; texto: string; disponible: boolean } | null>(null);
  const [guardandoLlamada, setGuardandoLlamada] = useState(false);
  const deQuien = sesion.usuarioId;
  // Al cambiar de persona se desmarca: haber aceptado por una no es haber
  // aceptado por otra, y el registro tiene que decir la verdad.
  useEffect(() => { setEnterado(false); }, [deQuien]);

  const buscandoQR = useRef(false);

  const mirar = useCallback(async () => {
    try {
      const r = await chatApi.conexion(deQuien);
      if (r.success) {
        setEstado(r.data);
        if (r.data.conectado) { setQr(null); buscandoQR.current = false; }
      }
    } catch { /* la pantalla ya dice que no hay conexion */ }
  }, [deQuien]);

  useEffect(() => {
    mirar();
    const t = setInterval(mirar, qr ? 2500 : 12000);
    return () => clearInterval(t);
  }, [mirar, qr]);

  // Al cambiar de persona se tira lo que hubiera en pantalla: ensenar el codigo
  // de una junto al numero de otra es como se enlaza el telefono equivocado.
  useEffect(() => {
    setQr(null);
    setEstado(null);
    setSync(null);
    buscandoQR.current = false;
  }, [deQuien]);

  // Mientras esta conectado, se vigila cuanto lleva entrando.
  useEffect(() => {
    if (!estado?.conectado) return undefined;
    const leer = () => chatApi.sincronizacion(deQuien).then((r) => { if (r.success) setSync(r.data); }).catch(() => {});
    leer();
    const t = setInterval(leer, 4000);
    return () => clearInterval(t);
  }, [estado?.conectado, deQuien]);

  // Pedir el codigo, insistiendo.
  //
  // Antes, cualquier tropiezo salia como un error rojo: si el servidor estaba
  // reiniciando, o WhatsApp tardaba un segundo de mas en dar el codigo, quien
  // estaba enlazando veia «No se pudo emparejar» y se quedaba sin saber que
  // hacer, cuando bastaba con volver a pulsar. Ahora se reintenta solo y solo
  // se avisa si de verdad no hay manera.
  const pedirQR = useCallback(async (silencioso = false) => {
    if (!silencioso) { setPidiendo(true); setReintento(0); }
    const INTENTOS = 3;
    let ultimo = '';
    try {
      for (let n = 1; n <= INTENTOS; n++) {
        try {
          const r = await client.post('/whatsapp/emparejar', { modo, usuarioId: deQuien, enterado: true });
          if (!r.success) throw new Error(r.error || 'No se pudo pedir el código');
          if (r.data?.qr) { setQr(r.data.qr); buscandoQR.current = true; return; }
          await mirar();
          return;
        } catch (e) {
          ultimo = (e as Error).message;
          if (n < INTENTOS) {
            if (!silencioso) setReintento(n);
            await new Promise((espera) => setTimeout(espera, 2000 * n));
          }
        }
      }
      if (!silencioso) {
        toast({ title: 'No se pudo emparejar', description: ultimo, variant: 'destructive' });
      }
    } finally { if (!silencioso) { setPidiendo(false); setReintento(0); } }
    // `deQuien` va explicito aunque hoy `mirar` ya cambie con el: depender de
    // eso es una carambola, y el dia que alguien toque `mirar` esto emparejaria
    // la sesion equivocada — la de la gestora que estuviera antes seleccionada.
  }, [mirar, modo, deQuien]);

  // Renovar el codigo antes de que caduque, mientras nadie lo haya escaneado.
  useEffect(() => {
    if (!qr || estado?.conectado) return undefined;
    const t = setInterval(() => pedirQR(true), RENUEVA_QR_MS);
    return () => clearInterval(t);
  }, [qr, estado?.conectado, pedirQR]);

  // Se leen al conectar, no antes: sin sesion levantada Evolution no tiene
  // ajustes que dar y saldria un error que no significa nada.
  const conectadoAhora = Boolean(estado?.conectado);
  useEffect(() => {
    if (!conectadoAhora) { setLlamada(null); return; }
    let vivo = true;
    client.get('/whatsapp/respuesta-llamada')
      .then((r) => { if (vivo && r.success) setLlamada(r.data); })
      .catch(() => { /* que no se lea no rompe la pantalla */ });
    return () => { vivo = false; };
  }, [conectadoAhora, sesion.usuarioId]);

  /**
   * Guarda la respuesta a las llamadas.
   *
   * Rechaza y contesta con un texto: es lo unico que se puede hacer, porque por
   * esta via WhatsApp no da canal de audio y coger la llamada desde el CRM no
   * existe. Al menos quien llama recibe algo en vez de silencio.
   */
  async function guardarLlamada(activa: boolean, texto: string) {
    setGuardandoLlamada(true);
    try {
      const r = await client.post('/whatsapp/respuesta-llamada', { activa, texto });
      if (!r.success) throw new Error(r.error || 'No se pudo guardar');
      setLlamada({ ...r.data, disponible: true });
      toast({
        title: activa ? 'Respuesta automática activada' : 'Respuesta automática desactivada',
        description: activa
          ? 'Las llamadas se rechazaran y se contestara con ese texto.'
          : 'Las llamadas entrantes sonaran en tu móvil como siempre.',
      });
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardandoLlamada(false); }
  }

  async function desconectar() {
    setConfirmando(false);
    setCerrando(true);
    try {
      const r = await client.post('/whatsapp/desconectar', { usuarioId: deQuien, borrarConversaciones: borrarTodo });
      // Si ya no habia sesion, el resultado es el que se buscaba: no es un
      // fallo que haya que enseñar en rojo.
      if (!r.success && !/no.*sesion|sin sesion|not.*connect/i.test(r.error || '')) {
        throw new Error(r.error || 'No se pudo desconectar');
      }
      const borradas = r.data?.borradas;
      toast({
        title: 'Número desvinculado',
        description: borradas
          ? `Ya no aparece en «Dispositivos vinculados». Borradas ${borradas.conversaciones} conversaciones y ${borradas.ficheros} archivos.`
          : 'Ya no aparece en «Dispositivos vinculados» del móvil. Las conversaciones guardadas siguen aquí.',
      });
      setBorrarTodo(false);
      setQr(null);
      await mirar();
    } catch (e) {
      toast({ title: 'No se pudo desconectar', description: (e as Error).message, variant: 'destructive' });
    } finally { setCerrando(false); }
  }

  const conectado = estado?.conectado;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-card border border-border rounded-lg p-5">
        {/* Se parte en dos filas cuando no cabe. Antes era una sola fila con el
            titulo, el selector y dos botones: en un telefono el titulo se
            quedaba con dos centimetros y salia una palabra por linea. El ancho
            minimo del bloque de texto es lo que fuerza a los botones a bajar. */}
        <div className="flex flex-wrap items-start gap-3">
          <WhatsappLogo size={32} weight="duotone" className="text-emerald-600 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <h1 className="text-lg font-bold">
              {sesion.esMia ? 'Tu WhatsApp' : `WhatsApp de ${sesion.nombre}`}
            </h1>
            <p className="text-sm text-muted-foreground">
              {sesion.esMia
                ? 'Tu número, tus conversaciones. Cada persona del equipo enlaza el suyo y nadie más ve lo tuyo.'
                : `Estás enlazando el número de ${sesion.nombre}. Necesitas su móvil delante para meter el código.`}
            </p>
          </div>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <SelectorDeSesion valor={sesion} onCambiar={setSesion} />
            <Link to="/whatsapp/ayuda" title="Como se usa"
              className="p-2 rounded-md hover:bg-muted text-muted-foreground text-xs font-medium whitespace-nowrap">
              ¿Cómo se hace?
            </Link>
            <button type="button" onClick={mirar} title="Comprobar ahora"
              className="p-2 rounded-md hover:bg-muted text-muted-foreground">
              <ArrowClockwise size={16} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-sm">
          {estado === null ? (
            <span className="text-muted-foreground">Comprobando…</span>
          ) : !estado.configurado ? (
            <>
              <WarningCircle size={18} weight="fill" className="text-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">{estado.motivo}</span>
            </>
          ) : conectado ? (
            <>
              <CheckCircle size={18} weight="fill" className="text-emerald-600 shrink-0" />
              <span>
                Conectado como{' '}
                <strong>{estado.nombre || (estado.numero ? `+${estado.numero}` : estado.instancia)}</strong>
              </span>
            </>
          ) : (
            <>
              <WarningCircle size={18} weight="fill" className="text-amber-500 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">
                Todavía no has enlazado tu número.
              </span>
            </>
          )}
        </div>

        {/* En pantalla ancha, el aviso y las opciones van uno al lado del otro:
            apilados dejaban media pantalla vacia a la derecha. */}
        <div className="grid lg:grid-cols-2 gap-4 items-start">
        {estado?.configurado && !conectado && !qr && (
          <div className="mt-4 border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4">
            <p className="font-semibold text-amber-900 dark:text-amber-200 mb-2 text-sm">
              {sesion.esMia
                ? 'Antes de enlazar tu número, lee esto'
                : `Vas a enlazar el número de ${sesion.nombre}. Que lo lea esa persona:`}
            </p>
            <ul className="text-sm text-amber-800 dark:text-amber-300/90 space-y-1.5 leading-relaxed">
              <li>· El número queda vinculado al CRM. Esta <strong>no es la vía oficial de
                  WhatsApp</strong> y WhatsApp <strong>puede bloquearlo</strong>.</li>
              <li>· Mejor un <strong>número de empresa, nunca el personal</strong>. Si lo
                  bloquean se pierden también las conversaciones privadas de esa línea.</li>
              <li>· Las conversaciones <strong>se guardan en la base del CRM</strong>, en el
                  servidor de la empresa. Los demás del equipo no las ven, pero
                  <strong> la administración si puede</strong>.</li>
              <li>· Se puede <strong>desvincular cuando se quiera</strong>, desde aquí o desde
                  Dispositivos vinculados en el móvil.</li>
            </ul>
            <label className="flex items-start gap-2 mt-3 pt-3 border-t border-amber-200 dark:border-amber-900/60 cursor-pointer">
              <input type="checkbox" checked={enterado} className="mt-0.5"
                onChange={(e) => setEnterado(e.target.checked)} />
              <span className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {sesion.esMia
                  ? 'Lo he leído y enlazo mi número sabiéndolo'
                  : `${sesion.nombre} lo ha leído y enlaza su número sabiéndolo`}
              </span>
            </label>
            {!sesion.esMia && (
              <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-2">
                Queda escrito que lo enlazaste tu en su nombre.
              </p>
            )}
          </div>
        )}

        {estado?.configurado && !conectado && !qr && (
          <div className="mt-4">
            <p className="text-sm font-semibold mb-1">¿Qué se trae del móvil?</p>
            <p className="text-xs text-muted-foreground mb-2">
              Lo que traigas se guarda en la base del CRM y ya no se quita solo.
            </p>
            <div className="grid gap-2">
              {([
                {
                  id: 'cero',
                  titulo: 'Empezar de cero',
                  etiqueta: 'recomendado',
                  pie: 'Nada del pasado: solo lo que llegue a partir de ahora. Es lo que hace falta para trabajar, y lo único que no mete tus conversaciones antiguas en el servidor de la empresa.',
                },
                {
                  id: 'rápido',
                  titulo: 'El último mes',
                  pie: 'Las conversaciones de los últimos 30 días. Util si vienes atendiendo a gente por ese número y no quieres perder el hilo.',
                },
                {
                  id: 'todo',
                  titulo: 'Todo el historial',
                  etiqueta: 'piénsatelo',
                  pie: 'TODO lo que tenga el móvil, incluido lo personal y los grupos. En un número con años de uso son decenas de miles de mensajes, tarda un buen rato y llega por tandas.',
                },
              ] as const).map((o) => (
                <label key={o.id}
                  className={`flex gap-2.5 items-start p-2.5 rounded-md border cursor-pointer ${
                    modo === o.id ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20' : 'border-border hover:bg-muted/50'}`}>
                  <input type="radio" name="modo" checked={modo === o.id}
                    onChange={() => setModo(o.id)} className="mt-0.5" />
                  <span className="text-sm leading-tight">
                    <strong>{o.titulo}</strong>
                    {'etiqueta' in o && o.etiqueta && (
                      <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                        o.etiqueta === 'recomendado'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'}`}>
                        {o.etiqueta}
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground mt-0.5">{o.pie}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {estado?.configurado && !conectado && (
            <button type="button" onClick={() => pedirQR()} disabled={pidiendo || (!enterado && !qr)}
              className="h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold inline-flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50">
              <QrCode size={16} weight="bold" />
              {pidiendo
                ? (reintento ? `Reintentando (${reintento} de 3)…` : 'Pidiendo código…')
                : qr ? 'Pedir otro código'
                : sesion.esMia ? 'Enlazar mi número' : `Enlazar el número de ${sesion.nombre}`}
            </button>
          )}
          {conectado && (
            <button type="button" onClick={() => setConfirmando(true)} disabled={cerrando}
              className="h-9 px-3 rounded-md border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 text-sm font-semibold inline-flex items-center gap-2 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50">
              <SignOut size={16} weight="bold" />
              {cerrando ? 'Desvinculando…' : 'Desvincular mi número'}
            </button>
          )}
        </div>
      </div>

      {qr && !conectado && (
        <div className="bg-card border border-border rounded-lg p-5 text-center">
          <h2 className="font-semibold mb-3 flex items-center justify-center gap-2">
            <DeviceMobile size={18} weight="duotone" /> Escanea con el móvil de tu número
          </h2>
          <ol className="text-sm text-muted-foreground mb-4 inline-block text-left leading-relaxed">
            <li><strong>1.</strong> Abre WhatsApp</li>
            <li><strong>2.</strong> Ajustes → <strong>Dispositivos vinculados</strong></li>
            <li><strong>3.</strong> <strong>Vincular un dispositivo</strong> y apunta aquí</li>
          </ol>
          <div className="grid place-items-center">
            <img src={qr} alt="Código QR de WhatsApp" className="w-64 h-64 rounded-lg bg-white p-2" />
          </div>
          <p className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-1.5">
            <ArrowsClockwise size={12} className="animate-spin" />
            El código se renueva solo cada 18 segundos. No hace falta hacer nada.
          </p>
        </div>
      )}

      {conectado && (
        <div className="bg-card border border-border rounded-lg p-5 text-sm space-y-3">
          {sync?.entrando ? (
            <>
              <p className="font-semibold flex items-center gap-2">
                <ArrowsClockwise size={16} className="animate-spin text-emerald-600" />
                Trayendo las conversaciones…
              </p>
              <p className="text-muted-foreground">
                {sync.conversaciones} chats y {sync.mensajes} mensajes hasta ahora.
                WhatsApp los manda por tandas: puede tardar unos minutos.
              </p>
            </>
          ) : (
            <>
              {/* No dice «Todo listo».
                  Que no entre nada desde hace medio minuto significa «ha parado»,
                  no «ha terminado»: si el movil pierde cobertura o el servicio se
                  reinicia a mitad, el historial se corta y esto se veia
                  exactamente igual que si hubiera acabado. Se decia «Todo listo»
                  con la mitad de las conversaciones sin traer, y quien lo leia se
                  quedaba tan tranquilo hasta que echaba en falta un chat. */}
              <p className="font-semibold">
                {(sync?.mensajes ?? 0) > 0 ? 'Ya no entra nada nuevo' : 'Enlazado, pero no ha entrado nada'}
              </p>
              <p className="text-muted-foreground">
                {(sync?.mensajes ?? 0) > 0
                  ? <>Han entrado <strong className="text-foreground">{sync?.conversaciones} chats</strong> y{' '}
                      <strong className="text-foreground">{sync?.mensajes} mensajes</strong>. Las conversaciones
                      nuevas aparecen solas y se atan al prospecto que tenga ese teléfono. Solo las ves tú.</>
                  : <>El número está enlazado pero todavía no ha llegado ninguna conversación. Si elegiste
                      «Empezar de cero» es lo normal: entrarán según te escriban.</>}
              </p>
              {/* La salida, dicha antes de que la busque. */}
              <p className="text-xs text-muted-foreground">
                ¿Echas algo en falta? WhatsApp manda el historial de una vez y no se puede volver a pedir a
                medias: hay que <strong className="text-foreground">desvincular y enlazar otra vez</strong>,
                eligiendo cuánto traerte. Lo que ya está guardado no se pierde.
              </p>
            </>
          )}
          {(sync?.adjuntosPendientes ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Descargando {sync?.adjuntosPendientes} archivos en segundo plano.
            </p>
          )}
          <Link to="/whatsapp/chat" className="text-primary hover:underline font-medium inline-block">
            Ir al chat →
          </Link>
        </div>
      )}

      {/* Que se le contesta a quien llama.
          Va por sesion y se puede apagar: una gestora que si coge el telefono no
          debe rechazar automaticamente a nadie. Es el punto 2 de la tarea #47. */}
      {conectado && llamada && (
        <div className="bg-card border border-border rounded-lg p-5 text-sm space-y-3">
          <p className="font-semibold flex items-center gap-2">
            <PhoneX size={16} className="text-muted-foreground" />
            Si te llaman por WhatsApp
          </p>
          <p className="text-muted-foreground">
            Las llamadas <strong className="text-foreground">se cogen desde tu móvil</strong>, no desde
            aquí: WhatsApp no deja hablar por esta vía. Lo que si hace el CRM es{' '}
            <strong className="text-foreground">apuntarlas</strong> — las perdidas salen en el chat con
            su hora, para que no se te escape ninguna.
          </p>
          {!llamada.disponible ? (
            <p className="text-xs text-muted-foreground">
              Ahora mismo no se pueden leer estos ajustes. Vuelve a intentarlo en un momento.
            </p>
          ) : (
            <>
              <label className="flex items-start gap-2 pt-2 border-t border-border cursor-pointer">
                <input type="checkbox" checked={llamada.activa} className="mt-0.5"
                  disabled={guardandoLlamada}
                  onChange={(e) => guardarLlamada(
                    e.target.checked,
                    llamada.texto || RESPUESTA_POR_DEFECTO,
                  )} />
                <span>
                  Rechazar las llamadas y contestar con un mensaje.
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Si lo dejas apagado, el teléfono suena como siempre y la llamada se apunta igual.
                  </span>
                </span>
              </label>
              {llamada.activa && (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-md border border-border bg-background p-2 text-sm"
                    rows={3} maxLength={500} disabled={guardandoLlamada}
                    value={llamada.texto}
                    onChange={(e) => setLlamada({ ...llamada, texto: e.target.value })} />
                  <div className="flex items-center gap-2">
                    <button type="button" className="wa-btn-verde"
                      disabled={guardandoLlamada || !llamada.texto.trim()}
                      onClick={() => guardarLlamada(true, llamada.texto)}>
                      {guardandoLlamada ? 'Guardando…' : 'Guardar el mensaje'}
                    </button>
                    <span className="text-xs text-muted-foreground">{llamada.texto.length}/500</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* El aviso, para releerlo cuando ya se enlazo.
          Antes solo se pintaba sin sesion: en cuanto enlazabas desaparecia y no
          habia forma de volver a ver lo que habias aceptado. Es la tercera
          casilla del punto 1 de la tarea #45. */}
      {conectado && (
        <details className="bg-card border border-border rounded-lg text-sm">
          <summary className="px-4 py-3 cursor-pointer font-semibold select-none">
            Lo que aceptaste al enlazar
          </summary>
          <ul className="px-4 pb-4 text-muted-foreground space-y-1.5 leading-relaxed">
            <li>· El número queda vinculado al CRM. Esta <strong className="text-foreground">no es la
                vía oficial de WhatsApp</strong> y WhatsApp puede bloquearlo.</li>
            <li>· Mejor un <strong className="text-foreground">número de empresa, nunca el personal</strong>.
                Si lo bloquean se pierden también las conversaciones privadas de esa línea.</li>
            <li>· Las conversaciones <strong className="text-foreground">se guardan en la base del CRM</strong>,
                en el servidor de la empresa. Los demás del equipo no las ven, pero la
                administracion si puede.</li>
            <li>· Se puede <strong className="text-foreground">desvincular cuando se quiera</strong>, desde
                aquí o desde Dispositivos vinculados en el móvil.</li>
          </ul>
        </details>
      )}

      {confirmando && (
        <div className="wa-velo" onClick={() => setConfirmando(false)}>
          <div className="wa-panel" onClick={(e) => e.stopPropagation()}>
            <div className="wa-panel-cabecera">
              <span>Desvincular tu número</span>
              <button type="button" onClick={() => setConfirmando(false)} className="wa-panel-cerrar">
                <X size={15} />
              </button>
            </div>
            <div className="wa-panel-cuerpo">
              <p className="wa-panel-nota">
                El CRM dejara de recibir y de enviar mensajes con{' '}
                <strong>{estado?.nombre || (estado?.numero ? `+${estado.numero}` : 'tu número')}</strong>,
                y desaparecera de «Dispositivos vinculados» en tu móvil.
              </p>
              <p className="wa-panel-nota">
                Las conversaciones que ya están guardadas <strong>se quedan</strong>. Puedes
                volver a enlazar cuando quieras.
              </p>
            </div>
            <div className="wa-panel-cuerpo" style={{ paddingTop: 0 }}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={borrarTodo} className="mt-0.5"
                  onChange={(e) => setBorrarTodo(e.target.checked)} />
                <span className="wa-panel-nota">
                  <strong>Borrar también las conversaciones guardadas</strong> y sus archivos.
                  Empiezas limpio la próxima vez que enlaces. <strong>Esto no se puede deshacer.</strong>
                </span>
              </label>
            </div>
            <div className="wa-panel-pie">
              <button type="button" onClick={() => setConfirmando(false)} className="wa-btn-suave">Cancelar</button>
              <button type="button" onClick={desconectar} className="wa-btn-rojo">
                {borrarTodo ? 'Desvincular y borrar' : 'Desvincular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Este recuadro NO repite el aviso de arriba.
          Arriba va lo que se acepta al enlazar; aqui, como trabajar con ello sin
          que te bloqueen. Estaban diciendo casi lo mismo, en amarillo los dos, y
          leidos seguidos no se distinguian. */}
      <div className="border border-border bg-card rounded-lg p-5 text-sm">
        <p className="font-semibold mb-2">Cómo no acabar bloqueado</p>
        <ul className="text-muted-foreground space-y-1.5 leading-relaxed">
          <li>· <strong className="text-foreground">Piénsatelo antes de escribir a quien no dejó su
              teléfono</strong> en un formulario nuestro. El CRM te deja —a veces hay motivo— pero queda
              anotado, y es lo que hace que la gente reporte un número. Los reportes son lo que hace
              que lo suspendan.</li>
          <li>· <strong className="text-foreground">Nada de envíos masivos</strong> ni el mismo mensaje en
              cadena. Hay topes: 6 por minuto, 60 por hora, 300 al día. Son por número, así que lo
              que mande un companero no te frena a ti.</li>
          <li>· Si alguien pide que no le escribas, <strong className="text-foreground">márcalo en el
              chat</strong>. No se le envía nada más, ni con plantilla.</li>
          <li>· Si se desconecta —pasa, sobre todo con el móvil sin cobertura—, vuelve aquí y enlaza
              otra vez. Lo guardado no se pierde.</li>
        </ul>
        <Link to="/whatsapp/ayuda" className="text-primary hover:underline font-medium mt-3 inline-block">
          Ver la guía completa →
        </Link>
      </div>
    </div>
  );
}
