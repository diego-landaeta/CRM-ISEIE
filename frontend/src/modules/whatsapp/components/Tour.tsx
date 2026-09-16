import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowRight, ArrowLeft } from '@phosphor-icons/react';

// El tour del chat.
//
// La guia escrita esta bien para leerla una vez, pero nadie la lee antes de
// empezar: se abre el chat y se prueba. Esto son seis pasos señalando lo que ya
// tiene delante, la primera vez que entra.
//
// Se marca en el navegador de cada persona, no en la base: es una preferencia
// suya, no un dato del CRM, y no merece una tabla ni una migracion.

const VISTO = 'wa-tour-visto-v1';

type Paso = {
  /** A que se apunta. Si no esta en pantalla, el paso se salta. */
  donde?: string;
  titulo: string;
  texto: string;
  /** Solo tiene sentido si NO hay numero enlazado. */
  soloSinNumero?: boolean;
  /** Sale tambien en el recorrido corto, el de quien todavia no ha enlazado. */
  enElCorto?: boolean;
  /**
   * A donde lleva, si el paso pide hacer algo.
   *
   * Diego lo resumio asi: «no me guia, me muestra un paso a paso». Y el que
   * decia «pulsa enlazar mi numero» era el peor ejemplo: el velo del recorrido
   * tapa toda la pantalla, asi que al pulsar lo que se estaba señalando se
   * cerraba el recorrido y no pasaba nada mas. Se le decia a la gestora que
   * hiciera algo y acto seguido se le impedia hacerlo.
   *
   * Con esto el cartel lleva su propio boton y va.
   */
  accion?: { texto: string; a: string };
};

const PASOS: Paso[] = [
  {
    // Se presenta la pantalla ANTES de pedir nada. Quien llega aqui no sabe
    // todavia que es esto: mandarla a enlazar un numero de entrada es pedirle
    // que conecte su telefono a algo que no le han explicado.
    enElCorto: true,
    titulo: 'Esto es tu WhatsApp',
    texto: 'Desde aquí escribes a los prospectos sin salir del CRM, con tu propio número. Las conversaciones quedan guardadas y atadas a su ficha, y solo las ves tú — ni el resto del equipo ni las demás gestoras. En {pasos} pasos te enseño por dónde va cada cosa.',
  },
  {
    // Y AHORA se guia a enlazar, ya sabiendo para que sirve.
    //
    // Solo sale si NO hay numero: ese aviso desaparece en cuanto lo hay, asi que
    // el paso se salta solo con el mecanismo que ya existe. Sin el, quien abria
    // el chat sin enlazar recibia un recorrido sobre buscar, escribir y llamar
    // —todo cosas que aun no puede hacer— y nadie le decia por donde empezar.
    soloSinNumero: true,
    enElCorto: true,
    donde: '.wa-sin-enlazar',
    titulo: 'Te falta conectar el tuyo',
    texto: 'Todavía no hay ninguno enlazado, por eso la pantalla está vacía. Te llevo: leerás un aviso sobre lo que supone —merece la pena leerlo— y saldrá un código para escanear con el móvil. Son dos minutos, y cuando vuelvas te enseño el resto con tus conversaciones ya delante.',
    accion: { texto: 'Enlazar mi número', a: '/whatsapp/conexion' },
  },
  {
    donde: '.wa-barra-lista .cs-search',
    titulo: 'Busca por aquí',
    texto: 'Por nombre o por teléfono. Con muchas conversaciones es más rápido que bajar la lista.',
  },
  {
    donde: '.wa-btn-nuevo',
    titulo: 'Escribir a alguien nuevo',
    texto: 'Busca al prospecto y abre su chat, o escribe a un número suelto. Si esa persona no está en el CRM se puede escribir igual, pero queda anotado: escribir a quien no pidió información es lo que hace que reporten un número.',
  },
  {
    donde: '.cs-message-input',
    titulo: 'Escribe, manda archivos o graba',
    texto: 'El clip para adjuntar, el micrófono para una nota de voz. Antes de enviar verás lo que mandas, con su pie de foto. También puedes pegar una imagen aquí o arrastrarla.',
  },
  {
    donde: '.wa-btn-llamar',
    titulo: 'Llamar, y las que te llegan',
    texto: 'Este botón abre la llamada en TU móvil: desde el CRM no se puede hablar, WhatsApp no lo permite. Lo que sí hace es apuntarla. Y si te llaman, sale un aviso aunque estés en otra pantalla del CRM — cógela en el móvil. Las perdidas quedan en el chat y en la ficha del prospecto.',
  },
  {
    donde: '.wa-btn-prohibir',
    titulo: 'Si te piden que no escribas',
    texto: 'Márcalo aquí y el CRM no le vuelve a enviar nada, ni con plantilla. Es la regla que más protege tu línea.',
  },
  {
    donde: '.wa-btn-ampliar',
    titulo: 'Si vas a pasar la mañana aquí',
    texto: 'Amplía y desaparece todo lo demás del CRM: menú, cabecera y selector de proyecto. Se sale con Escape o con el mismo botón. Al lado tienes «Conexión», que es donde se enlaza el número.',
  },
  {
    titulo: 'Un par de cosas más',
    texto: 'Pasa el ratón por un mensaje para responderlo citándolo. Si sale con ⚠ es que no salió, y debajo tiene «Reintentar». En el menú lateral están «Plantillas» —los mensajes de siempre, que ve todo el equipo— y la cola de prospectos. Este recorrido vuelve con el «?» de arriba cuando quieras.',
  },
];

export default function Tour({ alCerrar }: { alCerrar?: () => void }) {
  const navegar = useNavigate();

  /**
   * Sin numero enlazado, el recorrido es CORTO: presentar y mandar a enlazar.
   *
   * Enseñar nueve pasos sobre buscar, escribir, llamar y responder a alguien que
   * tiene la pantalla vacia es hacerle perder el tiempo — no puede probar nada
   * de lo que se le cuenta, y para cuando lo tenga se le habra olvidado. Dos
   * carteles y a enlazar.
   *
   * El recorrido no se marca como visto al salir por ese boton, asi que cuando
   * vuelva con el numero puesto lo tendra entero, y ya con conversaciones
   * delante. Se decide una vez al abrir: si cambiara a mitad, la cuenta de pasos
   * bailaria.
   */
  const [pasos] = useState<Paso[]>(() => {
    const sinNumero = Boolean(document.querySelector('.wa-sin-enlazar'));
    return sinNumero
      ? PASOS.filter((p) => p.enElCorto)
      : PASOS.filter((p) => !p.soloSinNumero);
  });

  const [paso, setPaso] = useState(0);
  const [hueco, setHueco] = useState<DOMRect | null>(null);
  // El alto real del cartel y el tamaño de la ventana. Los dos hacen falta para
  // colocarlo, y los dos cambian: el alto con cada paso, la ventana al girar el
  // movil o al ampliar la pantalla del chat.
  const cartel = useRef<HTMLDivElement | null>(null);
  const [altoCartel, setAltoCartel] = useState(0);
  const [ventana, setVentana] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  /**
   * Se marca como visto AL ABRIRSE, no al cerrarse.
   *
   * Antes solo contaba si se salia por la X. Quien recargaba, se iba a otra
   * pantalla o cerraba la pestaña se lo encontraba otra vez, y otra, y otra:
   * el recorrido pasaba de ayuda a estorbo. Un recorrido guiado se enseña una
   * vez; si alguien lo quiere de nuevo, esta el boton «Tutorial».
   *
   * La excepcion es el paso de enlazar: ese SI lo vuelve a armar, porque quien
   * lo sigue no ha visto el recorrido —ha visto dos carteles— y vuelve con el
   * numero puesto para verlo entero. Lo hace `seguirGuia`.
   */
  useEffect(() => {
    try { localStorage.setItem(VISTO, '1'); } catch { /* navegador sin permiso */ }
  }, []);

  useEffect(() => {
    const alRedimensionar = () => setVentana({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', alRedimensionar);
    return () => window.removeEventListener('resize', alRedimensionar);
  }, []);

  // Despues de pintar: el texto de cada paso ocupa distinto.
  useEffect(() => {
    if (cartel.current) setAltoCartel(cartel.current.offsetHeight);
  }, [paso]);

  const actual = pasos[paso];

  /**
   * Cierra el recorrido. `marcar` decide si cuenta como visto.
   *
   * Cuando se sale por un boton que LLEVA a otro sitio no se marca: la gestora
   * esta siguiendo lo que se le dijo, no abandonando. Si se marcara, iria a
   * enlazar su numero, volveria al chat y el recorrido ya no estaria — habiendo
   * visto dos de nueve pasos. Al volver sigue pendiente, y el paso de enlazar
   * se salta solo porque su aviso ya no esta.
   */
  const cerrar = useCallback((marcar = true) => {
    // Ya se marco al abrirse, asi que aqui solo queda el caso contrario: si se
    // sale siguiendo la guia, se VUELVE A ARMAR. Quien pulsa «Enlazar mi
    // numero» no ha visto el recorrido, ha visto dos carteles, y tiene que
    // encontrarselo entero al volver con el numero puesto.
    try {
      if (marcar) localStorage.setItem(VISTO, '1');
      else localStorage.removeItem(VISTO);
    } catch { /* navegador sin permiso */ }
    alCerrar?.();
  }, [alCerrar]);

  // Estables a proposito. El efecto que mide llama a `saltar`, asi que tiene que
  // poder declararlo como dependencia; si cambiara de identidad en cada render,
  // el temporizador de medir se reiniciaria sin parar y no llegaria nunca a los
  // 1,5 segundos de espera que hacen que un paso valido no se salte.
  const saltar = useCallback(() => {
    for (let i = paso + 1; i < pasos.length; i++) {
      const p = pasos[i];
      if (!p.donde || document.querySelector(p.donde)) { setPaso(i); return; }
    }
    cerrar();
  }, [paso, cerrar]);

  // Se mide donde esta lo que se señala, cada vez. Guardar la posicion no vale:
  // la ventana cambia de tamaño y la lista crece mientras entra el historial.
  //
  // Y si NO se encuentra, el paso se salta — que es lo que decia el comentario
  // del tipo `Paso` y el codigo no hacia: pintaba el cartel igual, sin recuadro
  // y centrado en mitad de la pantalla. Cuatro de los seis pasos apuntan a
  // cosas que solo existen con una conversacion abierta, asi que quien lo veia
  // sin chats abiertos recibia una lista de carteles, no un recorrido.
  //
  // Antes de saltarlo se ESPERA: en esa pantalla la lista se llena por tandas
  // mientras entra el historial, y el objetivo puede tardar un segundo en
  // existir. Rendirse a la primera saltaria pasos que si eran validos.
  useEffect(() => {
    if (!actual?.donde) { setHueco(null); return undefined; }

    let esperando = 0;
    let traido = false;
    const medir = () => {
      const el = document.querySelector(actual.donde!);
      if (el) {
        esperando = 0;
        // Una vez por paso: si lo que se señala esta fuera de la vista, el
        // recuadro se dibujaba donde nadie lo ve y el cartel apuntaba a la nada.
        if (!traido) {
          traido = true;
          // Se comprueba que exista: no lo traen todos los entornos, y sin la
          // comprobacion el recorrido revienta entero por no poder hacer un
          // desplazamiento — que es lo menos importante de todo lo que hace.
          if (typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        }
        setHueco(el.getBoundingClientRect());
        return;
      }
      setHueco(null);
      // Kilometro y medio de margen: 1,5 s de espera antes de darlo por perdido.
      esperando += 1;
      if (esperando > 3) saltar();
    };
    medir();
    window.addEventListener('resize', medir);
    const t = setInterval(medir, 500);
    return () => { window.removeEventListener('resize', medir); clearInterval(t); };
  }, [actual, saltar]);

  /**
   * Al paso ANTERIOR que tenga algo que señalar.
   *
   * Sin esto, «Atras» volvia a ciegas: caia en un paso cuyo objetivo no existe
   * —por ejemplo el de llamar, que no sale en un grupo— y ese se salta solo
   * hacia adelante. O sea que pulsar «Atras» te llevaba al siguiente.
   */
  const atras = useCallback(() => {
    for (let i = paso - 1; i >= 0; i--) {
      const p = pasos[i];
      if (!p.donde || document.querySelector(p.donde)) { setPaso(i); return; }
    }
  }, [paso]);

  // Escape cierra, como cualquier otra cosa que se abre encima. Sin esto habia
  // que buscar la X con el raton.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar(); };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [cerrar]);

  const ultimo = paso === pasos.length - 1;

  // El cartel, pegado a lo que señala pero sin salirse de la pantalla.
  //
  // El alto se MIDE. Antes estaba puesto a 190 px a ojo, y con un paso de texto
  // largo el cartel es bastante mas alto: se salia por abajo y las unicas dos
  // cosas que hay que poder pulsar —«Siguiente» y «Atras»— quedaban fuera de la
  // pantalla. Se mide despues de pintar y se recoloca.
  const margen = 12;
  const anchoCartel = 300;
  const alto = altoCartel || 190;
  let izquierda = hueco ? hueco.left : ventana.w / 2 - anchoCartel / 2;
  let arriba = hueco ? hueco.bottom + margen : ventana.h / 2 - alto / 2;
  izquierda = Math.max(margen, Math.min(izquierda, ventana.w - anchoCartel - margen));
  // Si no cabe debajo, encima. Y si tampoco cabe encima —pantalla corta—, se
  // pega arriba del todo: mejor tapar algo que dejar los botones fuera.
  if (arriba + alto + margen > ventana.h) {
    const encima = (hueco?.top ?? ventana.h) - alto - margen;
    arriba = encima >= margen ? encima : margen;
  }

  return (
    <div className="wa-tour" onClick={() => cerrar()}>
      {/* El recuadro que rodea lo que se esta explicando. */}
      {hueco && (
        <div className="wa-tour-foco" style={{
          left: hueco.left - 6, top: hueco.top - 6,
          width: hueco.width + 12, height: hueco.height + 12,
        }} />
      )}

      <div ref={cartel} className="wa-tour-cartel" style={{ left: izquierda, top: arriba }}
        onClick={(e) => e.stopPropagation()}>
        <div className="wa-tour-cabecera">
          <span>{actual.titulo}</span>
          <button type="button" onClick={() => cerrar()} className="wa-panel-cerrar" title="Cerrar">
            <X size={14} />
          </button>
        </div>
        <p className="wa-tour-texto">{actual.texto.replace('{pasos}', String(pasos.length))}</p>
        {/* Cuanto queda, sin tener que leer «4 de 8». */}
        <div className="wa-tour-avance" aria-hidden="true">
          <span style={{ width: `${((paso + 1) / pasos.length) * 100}%` }} />
        </div>
        <div className={`wa-tour-pie ${actual.accion ? 'wa-tour-con-accion' : ''}`}>
          <span className="wa-tour-cuenta">{paso + 1} de {pasos.length}</span>
          <div className="wa-tour-botones">
            {/* «Atrás» ocupa su sitio SIEMPRE, aunque en el primer paso no se
                pueda usar. Quitandolo del todo, «Siguiente» se corria a la
                izquierda al pasar del paso 1 al 2 y del 2 al 1: el boton que se
                esta pulsando repetidamente cambiaba de sitio bajo el raton. Se
                deja hueco y se apaga. */}
            <button type="button" className="wa-btn-suave"
              onClick={atras}
              disabled={paso === 0}
              aria-hidden={paso === 0}
              tabIndex={paso === 0 ? -1 : 0}
              style={paso === 0 ? { visibility: 'hidden' } : undefined}>
              <ArrowLeft size={13} /> Atrás
            </button>
            {/* «Siguiente» solo si queda algo detras: en el recorrido corto
                este es el ultimo paso, y ofrecerlo llevaria a ninguna parte. */}
            {actual.accion ? (
              !ultimo && (
                <button type="button" className="wa-btn-suave" onClick={saltar}>Siguiente</button>
              )
            ) : ultimo ? (
              <button type="button" className="wa-btn-verde" onClick={() => cerrar()}>Entendido</button>
            ) : (
              <button type="button" className="wa-btn-verde" onClick={saltar}>
                Siguiente <ArrowRight size={13} />
              </button>
            )}
          </div>

          {/* El boton que LLEVA va fuera del grupo y a fila entera.
              Dentro del grupo empujaba a «Atras» a otra linea y el pie quedaba
              en tres filas: cuenta, Atras y accion, cada una por su lado. */}
          {actual.accion && (
            <button type="button" className="wa-btn-verde wa-tour-accion"
              onClick={() => { cerrar(false); navegar(actual.accion!.a); }}>
              {actual.accion.texto} <ArrowRight size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ¿Toca enseñarlo? Solo la primera vez de cada persona en este navegador. */
export function tourPendiente() {
  try { return localStorage.getItem(VISTO) !== '1'; } catch { return false; }
}

/**
 * ¿Hay algo que señalar ahora mismo?
 *
 * Si ningun paso encuentra su objetivo, el recorrido serian seis carteles
 * sueltos. En ese caso no se abre.
 */
export function hayQueSeñalar() {
  return PASOS.some((p) => p.donde && document.querySelector(p.donde));
}

/** Para poder volver a verlo desde la guia. */
export function reiniciarTour() {
  try { localStorage.removeItem(VISTO); } catch { /* da igual */ }
}
