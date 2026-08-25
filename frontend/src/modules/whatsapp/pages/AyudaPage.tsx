import { Link, useNavigate } from 'react-router-dom';
import { reiniciarTour } from '../components/Tour';
import {
  DeviceMobile, QrCode, WarningCircle, Prohibit, ChatText, PaperPlaneTilt,
  Microphone, Paperclip, ArrowBendUpLeft, DownloadSimple, PlugsConnected,
  CheckCircle, Clock, Users, PhoneX, PhoneCall, BellRinging,
} from '@phosphor-icons/react';

// La guia de WhatsApp, dentro del CRM.
//
// `docs/10-whatsapp.md` esta bien para nosotros, pero una gestora no entra al
// repositorio: necesita esto donde trabaja, y encontrarlo sin preguntar.
//
// Escrito para que se resuelva sola. Nada de «configure la instancia»: los
// pasos que hay que dar, en el orden en que se dan, y por que — porque lo que
// mas la protege es entender que hay un numero suyo en juego.

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold grid place-items-center mt-0.5">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-sm">{titulo}</p>
        <div className="text-sm text-muted-foreground leading-relaxed mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/**
 * El camino dentro de WhatsApp, dibujado.
 *
 * La tarea pedia capturas. Poner capturas de verdad significa meter imagenes de
 * la aplicacion de otro en el repositorio, y ademas envejecen: WhatsApp cambia
 * el menu y la captura pasa a enseñar algo que ya no esta. Esto es un dibujo de
 * las tres pantallas por las que hay que pasar, con los nombres exactos de los
 * botones — que es lo que se buscaba con la captura: saber donde mirar.
 */
function CaminoEnElMovil() {
  const pantallas = [
    { titulo: 'WhatsApp', filas: ['Chats', 'Novedades', 'Llamadas'], marca: null, pie: 'Menú ⋮ → Ajustes' },
    { titulo: 'Ajustes', filas: ['Cuenta', 'Privacidad', 'Dispositivos vinculados'], marca: 'Dispositivos vinculados', pie: 'Pulsa ahí' },
    { titulo: 'Dispositivos vinculados', filas: ['Vincular un dispositivo'], marca: 'Vincular un dispositivo', pie: 'Y apunta al código' },
  ];
  return (
    <div className="flex flex-wrap items-start gap-3 mt-3">
      {pantallas.map((p, i) => (
        <div key={p.titulo} className="flex items-center gap-3">
          <div className="w-[132px] rounded-lg border border-border bg-muted/40 overflow-hidden">
            <div className="bg-emerald-700 text-white text-[10px] font-semibold px-2 py-1.5 truncate">
              {p.titulo}
            </div>
            <ul className="p-1.5 space-y-1">
              {p.filas.map((f) => (
                <li key={f}
                  className={`text-[10px] leading-tight px-1.5 py-1 rounded ${
                    f === p.marca
                      ? 'bg-emerald-600 text-white font-semibold'
                      : 'text-muted-foreground'
                  }`}>
                  {f}
                </li>
              ))}
            </ul>
            <p className="text-[9px] text-muted-foreground px-2 pb-1.5 border-t border-border pt-1">{p.pie}</p>
          </div>
          {i < pantallas.length - 1 && (
            <span className="text-muted-foreground/50 text-lg" aria-hidden="true">→</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Bloque({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-5">
      <h2 className="font-bold flex items-center gap-2 mb-3">
        <span className="text-emerald-600">{icono}</span> {titulo}
      </h2>
      {children}
    </section>
  );
}

export default function AyudaPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl space-y-4 pb-8">
      <div className="bg-card border border-border rounded-lg p-5">
        <h1 className="text-lg font-bold">Cómo se usa el WhatsApp del CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enlazar tu número, escribir a un prospecto, y que no te bloqueen la línea.
          Se lee en cinco minutos.
        </p>
        {/* navigate() y no window.location: lo segundo recarga la aplicacion
            entera y ademas depende de la ruta relativa, asi que se rompe segun
            de donde cuelgue el CRM (/crm, /testeo). */}
        <button type="button" onClick={() => { reiniciarTour(); navigate('/whatsapp/chat'); }}
          className="mt-3 h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
          Ver el recorrido por el chat
        </button>
      </div>

      {/* ── Enlazar ─────────────────────────────────────────────────────── */}
      <Bloque icono={<QrCode size={20} weight="duotone" />} titulo="1 · Enlazar tu número">
        <p className="text-sm text-muted-foreground mb-3">
          Se hace <strong className="text-foreground">una vez</strong>. Necesitas el móvil de ese
          número en la mano.
        </p>
        <ol className="space-y-3">
          <Paso n={1} titulo="Entra en Conexión">
            En el menú, <strong>WhatsApp → Conexión</strong>. O{' '}
            <Link to="/whatsapp/conexion" className="text-primary hover:underline">desde aquí</Link>.
          </Paso>
          <Paso n={2} titulo="Lee el aviso y marca la casilla">
            Sale en amarillo, antes del código. <strong>No es relleno</strong>: dice que WhatsApp
            puede bloquear el número y que tus conversaciones se guardan en el servidor de la
            empresa. Hasta que no lo marques, el botón no hace nada.
          </Paso>
          <Paso n={3} titulo="Elige qué traerte del móvil">
            Por defecto viene <strong>«Empezar de cero»</strong>, y casi siempre es lo que quieres:
            solo lo que llegue a partir de ahora. Si vienes atendiendo gente por ese número, «El
            ultimo mes». «Todo el historial» tarda un buen rato y se trae también lo personal.
          </Paso>
          <Paso n={4} titulo="Pulsa «Enlazar mi número»">
            Sale un código QR en pantalla. Se renueva solo cada 18 segundos, no hace falta que
            hagas nada.
          </Paso>
          <Paso n={5} titulo="En el móvil: Ajustes → Dispositivos vinculados">
            <span className="flex items-center gap-1.5 flex-wrap">
              <DeviceMobile size={14} /> Abre WhatsApp
              <span className="text-muted-foreground/60">→</span> Ajustes
              <span className="text-muted-foreground/60">→</span> <strong>Dispositivos vinculados</strong>
              <span className="text-muted-foreground/60">→</span> <strong>Vincular un dispositivo</strong>
            </span>
            <span className="block mt-1">Apunta la cámara al código de la pantalla.</span>
            <CaminoEnElMovil />
          </Paso>
          <Paso n={6} titulo="Espera a que entren las conversaciones">
            Arriba de la lista verás <strong>«Sincronizando…»</strong> con lo que lleva entrando.
            Con «Empezar de cero» es inmediato; con el historial completo puede tardar minutos y
            llega por tandas.
          </Paso>
        </ol>
      </Bloque>

      {/* ── Se desconecto ───────────────────────────────────────────────── */}
      <Bloque icono={<PlugsConnected size={20} weight="duotone" />} titulo="2 · Si se desconecta">
        <p className="text-sm text-muted-foreground mb-3">
          Pasa, sobre todo si el móvil se queda sin internet o sin bateria mucho rato. No es que
          se haya roto nada.
        </p>
        <ul className="text-sm text-muted-foreground space-y-2 leading-relaxed">
          <li className="flex gap-2">
            <WarningCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Cómo se nota:</strong> arriba del chat pone «No tienes
              WhatsApp enlazado», y la caja de escribir se pone gris. No te deja escribir al vacio.
            </span>
          </li>
          <li className="flex gap-2">
            <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Qué hacer:</strong> ve a Conexión y vuelve a enlazar.
              Muchas veces se reconecta solo en cuanto el móvil recupera internet.
            </span>
          </li>
          <li className="flex gap-2">
            <Clock size={16} className="text-muted-foreground shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Lo guardado no se pierde.</strong> Las conversaciones
              siguen ahi. Lo único que para es enviar y recibir.
            </span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">
          Ojo: el historial completo solo llega <strong>al enlazar</strong>. Al reconectar, WhatsApp no
          lo reenvia — entran los mensajes nuevos, no los de mientras estabas caido.
        </p>
      </Bloque>

      {/* ── El dia a dia ────────────────────────────────────────────────── */}
      <Bloque icono={<ChatText size={20} weight="duotone" />} titulo="3 · El día a día">
        <ul className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <li className="flex gap-2">
            <PaperPlaneTilt size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Escribir a un prospecto:</strong> el lapiz encima de la
              lista. Busca por nombre, email o teléfono. Si esa persona ya te escribio, su
              conversacion ya esta en la lista.
            </span>
          </li>
          <li className="flex gap-2">
            <ArrowBendUpLeft size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Responder a un mensaje concreto:</strong> pasa el ratón
              por encima y pulsa la flecha. Sale citado, como en WhatsApp.
            </span>
          </li>
          <li className="flex gap-2">
            <Paperclip size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Mandar un archivo:</strong> el clip, o <strong>pega la
              imagen</strong> directamente en la caja, o arrastrala desde el escritorio.
            </span>
          </li>
          <li className="flex gap-2">
            <Microphone size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Nota de voz:</strong> el micrófono. Se graba, se para
              con el mismo botón y se manda sola.
            </span>
          </li>
          <li className="flex gap-2">
            <DownloadSimple size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">«Descargar» en vez de una foto:</strong> de las
              conversaciones viejas no se baja todo —serian miles de archivos—. Pulsa y se trae.
              Si WhatsApp ya lo borro, te lo dice.
            </span>
          </li>
          <li className="flex gap-2">
            <WarningCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <span>
              <strong className="text-foreground">Un mensaje con ⚠ no salió.</strong> Debajo tiene
              «Reintentar»: lo vuelve a mandar con el mismo texto, no hay que reescribirlo.
            </span>
          </li>
        </ul>
      </Bloque>

      {/* ── Plantillas y cola ───────────────────────────────────────────── */}
      <Bloque icono={<ChatText size={20} weight="duotone" />} titulo="4 · Plantillas y cola de prospectos">
        <p className="text-sm text-muted-foreground mb-3">
          Lo que se repite veinte veces al día no se escribe veinte veces.
        </p>
        <ul className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <li className="flex gap-2">
            <ChatText size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Plantillas</strong> (en el menú, debajo de Chat):
              mensajes guardados para lo de siempre — el primer contacto, el recordatorio, el envio
              del temario. Se crean una vez y se usan cuando toca.
            </span>
          </li>
          <li className="flex gap-2">
            <PaperPlaneTilt size={16} className="shrink-0 mt-0.5" />
            <span>
              Admiten <strong className="text-foreground">huecos</strong>: escribe{' '}
              <code className="px-1 rounded bg-muted text-foreground">{'{nombre}'}</code> o{' '}
              <code className="px-1 rounded bg-muted text-foreground">{'{producto}'}</code> y se
              rellenan con los datos de esa persona. Así no sales con un «Hola {'{nombre}'}» tal cual.
            </span>
          </li>
          <li className="flex gap-2">
            <Users size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">La cola</strong> son tus prospectos pendientes de
              contactar, los que te ha asignado el reparto. Cada gestora ve la suya; quien manda
              puede ver la de cualquiera.
            </span>
          </li>
          <li className="flex gap-2">
            <WarningCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <span>
              <strong className="text-foreground">Una plantilla no es permiso para el envio masivo.</strong>{' '}
              Mandar el mismo texto identico a cincuenta personas seguidas es de las cosas que mas
              rápido acaban con un número bloqueado. Cambia algo, y respeta el ritmo.
            </span>
          </li>
        </ul>
      </Bloque>

      {/* ── Llamadas ────────────────────────────────────────────────────── */}
      <Bloque icono={<PhoneCall size={20} weight="duotone" />} titulo="5 · Llamadas">
        {/* Lo primero y bien claro: lo que NO se puede. Si alguien busca el
            boton de descolgar durante diez minutos, el manual ha fallado. */}
        <p className="text-sm text-muted-foreground mb-3">
          <strong className="text-foreground">Las llamadas se hacen y se cogen desde tu móvil.</strong>{' '}
          Por aquí no se puede hablar — WhatsApp no lo permite fuera de su aplicacion, y no es
          que falte por hacer: no existe. Lo que hace el CRM es que{' '}
          <strong className="text-foreground">no se pierda ninguna</strong>.
        </p>
        <ul className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <li className="flex gap-2">
            <PhoneX size={16} className="shrink-0 mt-0.5 text-rose-500" />
            <span>
              <strong className="text-foreground">Si te llaman y no lo coges</strong>, sale en el chat
              como una línea con su hora — «Llamada perdida, 16:42» — y la conversacion se te marca
              sin leer. Si esa persona es un prospecto, <strong className="text-foreground">también
              queda en su ficha</strong>, junto al resto de contactos. Antes no quedaba rastro en
              ningun sitio: ni tu sabias que te habian llamado, ni el CRM.
            </span>
          </li>
          <li className="flex gap-2">
            <BellRinging size={16} className="shrink-0 mt-0.5 text-emerald-600" />
            <span>
              <strong className="text-foreground">Mientras suena te avisa el CRM</strong>, estés donde
              estés dentro de el — en Prospectos, en Facturacion, donde sea. Sale un cartel abajo a la
              derecha con quien llama. <strong className="text-foreground">Cógela en el móvil</strong>:
              el cartel esta para que te de tiempo a sacarlo, no para contestar desde aquí.
            </span>
          </li>
          <li className="flex gap-2">
            <PhoneCall size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Para llamar tu</strong>, el botón del teléfono
              arriba en el chat — y también lo tienes en la ficha del prospecto, al lado del
              teléfono. Abre la llamada en tu móvil con ese número ya marcado, y de paso lo apunta.
              Sin ese botón, las llamadas que salen no aparecian en ningun historial.
            </span>
          </li>
          <li className="flex gap-2">
            <Prohibit size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Si no quieres que te llamen</strong>, en{' '}
              <Link to="/whatsapp/conexion" className="text-primary hover:underline">Conexión</Link>{' '}
              puedes activar que se rechacen solas y se conteste con un mensaje tuyo. Va por persona:
              si tu si coges el teléfono, dejalo apagado y sonara como siempre.
            </span>
          </li>
          <li className="flex gap-2">
            <WarningCircle size={16} className="shrink-0 mt-0.5 text-amber-500" />
            <span>
              Si activas el rechazo automático, <strong className="text-foreground">no prometas
              horarios</strong> en el mensaje. Un «te llamamos en cinco minutos» que no se cumple
              es la queja siguiente.
            </span>
          </li>
        </ul>
      </Bloque>

      {/* ── Lo que no hay que hacer ─────────────────────────────────────── */}
      <section className="border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-5">
        <h2 className="font-bold flex items-center gap-2 mb-1 text-amber-900 dark:text-amber-200">
          <Prohibit size={20} weight="duotone" /> 6 · Lo que hace que bloqueen un número
        </h2>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 mb-3 leading-relaxed">
          No es que WhatsApp descubra que usas el CRM. Es que <strong>la gente te reporte</strong>. Todo
          lo de abajo lleva a eso.
        </p>
        <ul className="text-sm text-amber-800 dark:text-amber-300/90 space-y-2 leading-relaxed">
          <li>· <strong>Escribir a quien no dejó su teléfono</strong> en un formulario nuestro. El CRM
            te deja hacerlo —hay motivos buenos: un antiguo alumno, una madre preguntando por su
            hijo— pero <strong>queda anotado</strong>, y es lo que mas rápido lleva a que reporten
            un número. Piensatelo antes.</li>
          <li>· <strong>Envíos masivos</strong> o el mismo mensaje en cadena a mucha gente seguida.</li>
          <li>· <strong>Insistir a quien no contesta.</strong> Si alguien pide que no le escribas,
            márcalo con el icono <Prohibit size={12} className="inline" /> de la cabecera del chat:
            no se le vuelve a enviar nada, ni con plantilla.</li>
          <li>· <strong>Usar tu número personal.</strong> Si lo bloquean pierdes también tus
            conversaciones privadas.</li>
        </ul>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 mt-3 pt-3 border-t border-amber-200 dark:border-amber-900/60 leading-relaxed">
          El CRM tiene topes puestos: <strong>6 mensajes por minuto, 60 por hora, 300 al día</strong>, y
          una pausa entre uno y otro. Son por número — lo que mande un companero no te frena a ti.
          Si te sale «vas muy rápido», espera: te esta protegiendo.
        </p>
      </section>

      {/* ── Privacidad ──────────────────────────────────────────────────── */}
      <Bloque icono={<WarningCircle size={20} weight="duotone" />} titulo="7 · Quien ve tus conversaciones">
        <ul className="text-sm text-muted-foreground space-y-2 leading-relaxed">
          <li>· <strong className="text-foreground">Tus companeros, no.</strong> Cada persona ve solo su
            propio WhatsApp.</li>
          <li>· <strong className="text-foreground">La administración, sí.</strong> Un administrador puede
            abrir el WhatsApp de las personas de sus proyectos. Cuando lo hace, la pantalla dice
            siempre de quien es lo que se esta viendo.</li>
          <li>· <strong className="text-foreground">Todo queda en el servidor de la empresa.</strong> Lo que
            traigas del móvil al enlazar se guarda en la base del CRM y no se quita solo. Por eso
            «Empezar de cero» viene marcado por defecto.</li>
          <li>· <strong className="text-foreground">Puedes desvincular cuando quieras</strong>, desde
            Conexión o desde Dispositivos vinculados en tu móvil.</li>
        </ul>
      </Bloque>

      <p className="text-xs text-muted-foreground text-center">
        ¿Algo no encaja con lo que ves en pantalla? Dilo — esta guía se queda vieja antes que el
        código.
      </p>
    </div>
  );
}
