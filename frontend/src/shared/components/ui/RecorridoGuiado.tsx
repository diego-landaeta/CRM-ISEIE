import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, X } from '@phosphor-icons/react';
import { Button } from '@/shared/components/ui/button';

/**
 * Un recorrido guiado: carteles que señalan, paso a paso, lo que la persona ya tiene
 * delante. El mismo comportamiento que el del chat de WhatsApp (modules/whatsapp/
 * components/Tour.tsx), sin sus estilos, para usarlo en cualquier pantalla. Primero, el
 * tablero del equipo (Diego, 12/10: «un tutorial guiado, para verlo y todo»).
 *
 *  · Cada paso apunta a un selector (`donde`). Si no está en pantalla —un colaborador no
 *    ve «Configurar tablero»—, se espera un momento y se salta: lo que no tiene, no se
 *    le explica.
 *  · Se marca como visto en el navegador AL ABRIRSE (es una preferencia de cada persona,
 *    no un dato del CRM). Para volver a verlo, el botón de la pantalla.
 *  · Escape, la X o pulsar fuera lo cierran.
 *  · El cartel nunca se sale de lo que se VE (18/11, testeo en móvil: a 375 px se
 *    iba por la derecha y «Siguiente» quedaba fuera). Se mide con `visualViewport`,
 *    no con `innerWidth`: si la página es más ancha que la pantalla, `innerWidth`
 *    es el ancho de la página y el cartel se colocaba fuera de la vista. Como
 *    mucho, el ancho de la vista menos 32 px; en pantallas estrechas va pegado
 *    abajo (o arriba, si lo señalado está abajo), con los botones siempre a la vista.
 */
export interface PasoRecorrido {
  /** A qué se apunta (selector CSS). Sin él, el cartel sale centrado. */
  donde?: string;
  titulo: string;
  /** `{pasos}` se cambia por el número de pasos de este recorrido. */
  texto: string;
}

/** Lo que se ve de la ventana: ancho, alto y dónde empieza (con zoom o página más ancha). */
interface Vista { w: number; h: number; x: number; y: number }

function medirVista(): Vista {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv && vv.width > 0 && vv.height > 0) {
    return { w: vv.width, h: vv.height, x: vv.offsetLeft || 0, y: vv.offsetTop || 0 };
  }
  return { w: window.innerWidth, h: window.innerHeight, x: 0, y: 0 };
}

/** Margen con los bordes de la vista: el cartel mide, como mucho, el ancho menos 32 px. */
export const MARGEN_CARTEL = 16;
/** Por debajo de este ancho, el cartel va pegado abajo (o arriba), a todo lo ancho. */
export const ANCHO_ESTRECHO = 640;

/**
 * Dónde va el cartel (en coordenadas de la ventana, como `position: fixed`).
 * `hueco`: lo que se señala, o null (cartel centrado).
 */
export function colocarCartel(vista: Vista, hueco: Pick<DOMRect, 'left' | 'top' | 'bottom'> | null, alto: number) {
  const m = MARGEN_CARTEL;
  const ancho = Math.max(0, Math.min(340, vista.w - m * 2));
  const minX = vista.x + m;
  const maxX = vista.x + vista.w - m - ancho;
  const minY = vista.y + m;
  const maxY = Math.max(minY, vista.y + vista.h - m - alto);
  if (vista.w < ANCHO_ESTRECHO) {
    // Pegado abajo, a todo lo ancho; arriba si lo señalado está en la mitad de abajo.
    const abajo = !hueco || hueco.top - vista.y < vista.h / 2;
    return { izquierda: minX, arriba: abajo ? maxY : minY, ancho };
  }
  let izquierda = hueco ? hueco.left : vista.x + vista.w / 2 - ancho / 2;
  let arriba = hueco ? hueco.bottom + 12 : vista.y + vista.h / 2 - alto / 2;
  izquierda = Math.max(minX, Math.min(izquierda, maxX));
  if (arriba + alto + m > vista.y + vista.h) {
    const encima = (hueco?.top ?? vista.y + vista.h) - alto - 12;
    arriba = encima >= minY ? encima : minY;
  }
  arriba = Math.max(minY, Math.min(arriba, maxY));
  return { izquierda, arriba, ancho };
}

const visto = (clave: string) => {
  try { return localStorage.getItem(clave) === '1'; } catch { return true; }
};

/** ¿Hay que enseñarlo solo (primera vez de esta persona en este navegador)? */
export const recorridoPendiente = (clave: string) => !visto(clave);

export default function RecorridoGuiado({ pasos, clave, alCerrar }: {
  pasos: PasoRecorrido[]; clave: string; alCerrar: () => void;
}) {
  const [paso, setPaso] = useState(0);
  const [hueco, setHueco] = useState<DOMRect | null>(null);
  const cartel = useRef<HTMLDivElement | null>(null);
  const [altoCartel, setAltoCartel] = useState(0);
  const [ventana, setVentana] = useState<Vista>(medirVista);

  useEffect(() => {
    try { localStorage.setItem(clave, '1'); } catch { /* navegador sin permiso */ }
  }, [clave]);

  useEffect(() => {
    const alRedimensionar = () => setVentana(medirVista());
    const vv = window.visualViewport;
    window.addEventListener('resize', alRedimensionar);
    vv?.addEventListener('resize', alRedimensionar);
    vv?.addEventListener('scroll', alRedimensionar);
    return () => {
      window.removeEventListener('resize', alRedimensionar);
      vv?.removeEventListener('resize', alRedimensionar);
      vv?.removeEventListener('scroll', alRedimensionar);
    };
  }, []);

  useEffect(() => {
    if (cartel.current) setAltoCartel(cartel.current.offsetHeight);
  }, [paso, hueco]);

  const actual = pasos[paso];
  const cerrar = useCallback(() => alCerrar(), [alCerrar]);

  const saltar = useCallback(() => {
    for (let i = paso + 1; i < pasos.length; i++) {
      const p = pasos[i];
      if (!p.donde || document.querySelector(p.donde)) { setPaso(i); return; }
    }
    cerrar();
  }, [paso, pasos, cerrar]);

  const atras = useCallback(() => {
    for (let i = paso - 1; i >= 0; i--) {
      const p = pasos[i];
      if (!p.donde || document.querySelector(p.donde)) { setPaso(i); return; }
    }
  }, [paso, pasos]);

  // Se mide cada medio segundo: el tablero carga por tandas y la ventana cambia. Si lo
  // señalado no aparece en 1,5 s, el paso se salta.
  useEffect(() => {
    if (!actual?.donde) { setHueco(null); return undefined; }
    let esperando = 0;
    let traido = false;
    const medir = () => {
      const el = document.querySelector(actual.donde!);
      if (el) {
        esperando = 0;
        if (!traido) {
          traido = true;
          if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        }
        setHueco(el.getBoundingClientRect());
        return;
      }
      setHueco(null);
      esperando += 1;
      if (esperando > 3) saltar();
    };
    medir();
    window.addEventListener('resize', medir);
    const t = setInterval(medir, 500);
    return () => { window.removeEventListener('resize', medir); clearInterval(t); };
  }, [actual, saltar]);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
      if (e.key === 'ArrowRight') saltar();
      if (e.key === 'ArrowLeft') atras();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [cerrar, saltar, atras]);

  if (!actual) return null;
  const ultimo = paso === pasos.length - 1;

  // El cartel, pegado a lo que señala y sin salirse de lo que se ve (debajo; si no cabe,
  // encima; si tampoco, arriba del todo; en móvil, abajo a todo lo ancho), para que los
  // botones se puedan pulsar siempre.
  const { izquierda, arriba, ancho: anchoCartel } = colocarCartel(ventana, hueco, altoCartel || 200);

  return (
    <div className="fixed inset-0 z-[90]" onClick={cerrar} role="presentation">
      {hueco ? (
        // El recuadro que rodea lo que se explica; su sombra oscurece todo lo demás.
        <div
          className="pointer-events-none fixed rounded-lg ring-2 ring-primary transition-all duration-200 motion-reduce:transition-none"
          style={{
            left: hueco.left - 6, top: hueco.top - 6, width: hueco.width + 12, height: hueco.height + 12,
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-black/55" />
      )}

      <div
        ref={cartel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recorrido-titulo"
        className="fixed overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl"
        style={{
          left: izquierda, top: arriba, width: anchoCartel,
          // Por si algo se mide mal: nunca más ancho ni más alto que la vista.
          maxWidth: `calc(100vw - ${MARGEN_CARTEL * 2}px)`, maxHeight: `calc(100dvh - ${MARGEN_CARTEL * 2}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="recorrido-titulo" className="text-sm font-semibold">{actual.titulo}</h2>
          <button type="button" onClick={cerrar} aria-label="Cerrar el recorrido"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X size={14} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{actual.texto.replace('{pasos}', String(pasos.length))}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${((paso + 1) / pasos.length) * 100}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">{paso + 1} de {pasos.length}</span>
          <div className="flex gap-2">
            {/* «Atrás» guarda su sitio aunque no se pueda usar: «Siguiente» no se mueve bajo el ratón. */}
            <Button type="button" variant="ghost" size="sm" onClick={atras} disabled={paso === 0}
              style={paso === 0 ? { visibility: 'hidden' } : undefined} tabIndex={paso === 0 ? -1 : 0}>
              <ArrowLeft size={13} className="mr-1" /> Atrás
            </Button>
            {ultimo ? (
              <Button type="button" size="sm" onClick={cerrar} data-autofocus>Entendido</Button>
            ) : (
              <Button type="button" size="sm" onClick={saltar} data-autofocus>
                Siguiente <ArrowRight size={13} className="ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
