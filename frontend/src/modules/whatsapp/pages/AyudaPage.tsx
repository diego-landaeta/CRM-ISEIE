import { Link } from 'react-router-dom';
import { reiniciarTour } from '../components/Tour';
import {
  DeviceMobile, QrCode, WarningCircle, Prohibit, ChatText, PaperPlaneTilt,
  Microphone, Paperclip, ArrowBendUpLeft, DownloadSimple, PlugsConnected,
  CheckCircle, Clock, Users,
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
  return (
    <div className="max-w-3xl space-y-4 pb-8">
      <div className="bg-card border border-border rounded-lg p-5">
        <h1 className="text-lg font-bold">Como se usa el WhatsApp del CRM</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enlazar tu numero, escribir a un prospecto, y que no te bloqueen la linea.
          Se lee en cinco minutos.
        </p>
        <button type="button" onClick={() => { reiniciarTour(); window.location.href = '../whatsapp/chat'; }}
          className="mt-3 h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">
          Ver el recorrido por el chat
        </button>
      </div>

      {/* ── Enlazar ─────────────────────────────────────────────────────── */}
      <Bloque icono={<QrCode size={20} weight="duotone" />} titulo="1 · Enlazar tu numero">
        <p className="text-sm text-muted-foreground mb-3">
          Se hace <strong className="text-foreground">una vez</strong>. Necesitas el movil de ese
          numero en la mano.
        </p>
        <ol className="space-y-3">
          <Paso n={1} titulo="Entra en Conexion">
            En el menu, <strong>WhatsApp → Conexion</strong>. O{' '}
            <Link to="/whatsapp/conexion" className="text-primary hover:underline">desde aqui</Link>.
          </Paso>
          <Paso n={2} titulo="Lee el aviso y marca la casilla">
            Sale en amarillo, antes del codigo. <strong>No es relleno</strong>: dice que WhatsApp
            puede bloquear el numero y que tus conversaciones se guardan en el servidor de la
            empresa. Hasta que no lo marques, el boton no hace nada.
          </Paso>
          <Paso n={3} titulo="Elige que traerte del movil">
            Por defecto viene <strong>«Empezar de cero»</strong>, y casi siempre es lo que quieres:
            solo lo que llegue a partir de ahora. Si vienes atendiendo gente por ese numero, «El
            ultimo mes». «Todo el historial» tarda un buen rato y se trae tambien lo personal.
          </Paso>
          <Paso n={4} titulo="Pulsa «Enlazar mi numero»">
            Sale un codigo QR en pantalla. Se renueva solo cada 18 segundos, no hace falta que
            hagas nada.
          </Paso>
          <Paso n={5} titulo="En el movil: Ajustes → Dispositivos vinculados">
            <span className="flex items-center gap-1.5 flex-wrap">
              <DeviceMobile size={14} /> Abre WhatsApp
              <span className="text-muted-foreground/60">→</span> Ajustes
              <span className="text-muted-foreground/60">→</span> <strong>Dispositivos vinculados</strong>
              <span className="text-muted-foreground/60">→</span> <strong>Vincular un dispositivo</strong>
            </span>
            <span className="block mt-1">Apunta la camara al codigo de la pantalla.</span>
          </Paso>
          <Paso n={6} titulo="Espera a que entren las conversaciones">
            Arriba de la lista veras <strong>«Sincronizando…»</strong> con lo que lleva entrando.
            Con «Empezar de cero» es inmediato; con el historial completo puede tardar minutos y
            llega por tandas.
          </Paso>
        </ol>
      </Bloque>

      {/* ── Se desconecto ───────────────────────────────────────────────── */}
      <Bloque icono={<PlugsConnected size={20} weight="duotone" />} titulo="2 · Si se desconecta">
        <p className="text-sm text-muted-foreground mb-3">
          Pasa, sobre todo si el movil se queda sin internet o sin bateria mucho rato. No es que
          se haya roto nada.
        </p>
        <ul className="text-sm text-muted-foreground space-y-2 leading-relaxed">
          <li className="flex gap-2">
            <WarningCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Como se nota:</strong> arriba del chat pone «No tienes
              WhatsApp enlazado», y la caja de escribir se pone gris. No te deja escribir al vacio.
            </span>
          </li>
          <li className="flex gap-2">
            <CheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Que hacer:</strong> ve a Conexion y vuelve a enlazar.
              Muchas veces se reconecta solo en cuanto el movil recupera internet.
            </span>
          </li>
          <li className="flex gap-2">
            <Clock size={16} className="text-muted-foreground shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Lo guardado no se pierde.</strong> Las conversaciones
              siguen ahi. Lo unico que para es enviar y recibir.
            </span>
          </li>
        </ul>
        <p className="text-xs text-muted-foreground mt-3 border-t border-border pt-3">
          Ojo: el historial completo solo llega <strong>al enlazar</strong>. Al reconectar, WhatsApp no
          lo reenvia — entran los mensajes nuevos, no los de mientras estabas caido.
        </p>
      </Bloque>

      {/* ── El dia a dia ────────────────────────────────────────────────── */}
      <Bloque icono={<ChatText size={20} weight="duotone" />} titulo="3 · El dia a dia">
        <ul className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <li className="flex gap-2">
            <PaperPlaneTilt size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Escribir a un prospecto:</strong> el lapiz encima de la
              lista. Busca por nombre, email o telefono. Si esa persona ya te escribio, su
              conversacion ya esta en la lista.
            </span>
          </li>
          <li className="flex gap-2">
            <ArrowBendUpLeft size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Responder a un mensaje concreto:</strong> pasa el raton
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
              <strong className="text-foreground">Nota de voz:</strong> el microfono. Se graba, se para
              con el mismo boton y se manda sola.
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
              <strong className="text-foreground">Un mensaje con ⚠ no salio.</strong> Debajo tiene
              «Reintentar»: lo vuelve a mandar con el mismo texto, no hay que reescribirlo.
            </span>
          </li>
        </ul>
      </Bloque>

      {/* ── Plantillas y cola ───────────────────────────────────────────── */}
      <Bloque icono={<ChatText size={20} weight="duotone" />} titulo="4 · Plantillas y cola de prospectos">
        <p className="text-sm text-muted-foreground mb-3">
          Lo que se repite veinte veces al dia no se escribe veinte veces.
        </p>
        <ul className="text-sm text-muted-foreground space-y-2.5 leading-relaxed">
          <li className="flex gap-2">
            <ChatText size={16} className="shrink-0 mt-0.5" />
            <span>
              <strong className="text-foreground">Plantillas</strong> (en el menu, debajo de Chat):
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
              rellenan con los datos de esa persona. Asi no sales con un «Hola {'{nombre}'}» tal cual.
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
              rapido acaban con un numero bloqueado. Cambia algo, y respeta el ritmo.
            </span>
          </li>
        </ul>
      </Bloque>

      {/* ── Lo que no hay que hacer ─────────────────────────────────────── */}
      <section className="border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-5">
        <h2 className="font-bold flex items-center gap-2 mb-1 text-amber-900 dark:text-amber-200">
          <Prohibit size={20} weight="duotone" /> 5 · Lo que hace que bloqueen un numero
        </h2>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 mb-3 leading-relaxed">
          No es que WhatsApp descubra que usas el CRM. Es que <strong>la gente te reporte</strong>. Todo
          lo de abajo lleva a eso.
        </p>
        <ul className="text-sm text-amber-800 dark:text-amber-300/90 space-y-2 leading-relaxed">
          <li>· <strong>Escribir a quien no dejo su telefono</strong> en un formulario nuestro. El CRM ya
            se niega; no le busques la vuelta con otro numero.</li>
          <li>· <strong>Envios masivos</strong> o el mismo mensaje en cadena a mucha gente seguida.</li>
          <li>· <strong>Insistir a quien no contesta.</strong> Si alguien pide que no le escribas,
            marcalo con el icono <Prohibit size={12} className="inline" /> de la cabecera del chat:
            no se le vuelve a enviar nada, ni con plantilla.</li>
          <li>· <strong>Usar tu numero personal.</strong> Si lo bloquean pierdes tambien tus
            conversaciones privadas.</li>
        </ul>
        <p className="text-sm text-amber-800 dark:text-amber-300/90 mt-3 pt-3 border-t border-amber-200 dark:border-amber-900/60 leading-relaxed">
          El CRM tiene topes puestos: <strong>6 mensajes por minuto, 60 por hora, 300 al dia</strong>, y
          una pausa entre uno y otro. Son por numero — lo que mande un companero no te frena a ti.
          Si te sale «vas muy rapido», espera: te esta protegiendo.
        </p>
      </section>

      {/* ── Privacidad ──────────────────────────────────────────────────── */}
      <Bloque icono={<WarningCircle size={20} weight="duotone" />} titulo="6 · Quien ve tus conversaciones">
        <ul className="text-sm text-muted-foreground space-y-2 leading-relaxed">
          <li>· <strong className="text-foreground">Tus companeros, no.</strong> Cada persona ve solo su
            propio WhatsApp.</li>
          <li>· <strong className="text-foreground">La administracion, si.</strong> Un administrador puede
            abrir el WhatsApp de las personas de sus proyectos. Cuando lo hace, la pantalla dice
            siempre de quien es lo que se esta viendo.</li>
          <li>· <strong className="text-foreground">Todo queda en el servidor de la empresa.</strong> Lo que
            traigas del movil al enlazar se guarda en la base del CRM y no se quita solo. Por eso
            «Empezar de cero» viene marcado por defecto.</li>
          <li>· <strong className="text-foreground">Puedes desvincular cuando quieras</strong>, desde
            Conexion o desde Dispositivos vinculados en tu movil.</li>
        </ul>
      </Bloque>

      <p className="text-xs text-muted-foreground text-center">
        ¿Algo no encaja con lo que ves en pantalla? Dilo — esta guia se queda vieja antes que el
        codigo.
      </p>
    </div>
  );
}
