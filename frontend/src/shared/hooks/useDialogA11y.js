import { useEffect, useRef } from 'react';

/**
 * useEscapeKey(onClose, enabled = true)
 *   Escucha la tecla Escape a nivel global y llama a onClose.
 */
const DESPLEGABLE_ABIERTO = '[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]';

export function useEscapeKey(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof onClose !== 'function') return;
    function onKey(e) {
      if (e.key === 'Escape') {
        // Con un desplegable abierto, Escape cierra el desplegable y no el
        // diálogo, como en useModalAccesible. Este escuchador se registra antes
        // que el del desplegable, así que aquí aún está abierto. Sin esto, un
        // Escape en «Descuento» cerraba «Nueva venta» y se perdía lo escrito
        // (#106: el desplegable del CRM entró en esos diálogos).
        // Solo los desplegables de verdad (combobox o con aria-haspopup): las
        // secciones del menú lateral también llevan aria-expanded, y con una
        // abierta Escape no cerraba ningún diálogo (visto en la prueba a mano).
        if (document.querySelector(DESPLEGABLE_ABIERTO)) return;
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}

// ── Modal accesible ───────────────────────────────────────────────────────────

/** Los modales abiertos, de abajo arriba: el teclado solo lo maneja el de arriba. */
const pila = [];

const ENFOCABLES = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', '[tabindex]:not([tabindex="-1"])',
].join(',');

function enfocables(el) {
  return [...el.querySelectorAll(ENFOCABLES)].filter((x) => x.getClientRects().length > 0);
}

/**
 * useModalAccesible(ref, { open, onClose, bloqueado })
 *
 * Lo que necesita cualquier modal para usarse con teclado y lector de pantalla:
 *  · al abrir, el foco entra (al elemento con `data-autofocus`, o al primero enfocable);
 *  · al cerrar, vuelve a donde estaba (el boton que lo abrio);
 *  · Tab y Mayus+Tab no salen del modal;
 *  · Escape cierra, salvo `bloqueado` (guardando) o si hay un desplegable abierto dentro:
 *    entonces Escape solo cierra el desplegable. Se mira en fase de CAPTURA, antes de que
 *    el desplegable cambie su `aria-expanded`; si no, el mismo Escape cerraba los dos.
 * Con varios modales apilados, solo actua el de arriba.
 *
 * @param {{ current: HTMLElement | null }} ref
 * @param {{ open?: boolean, onClose?: () => void, bloqueado?: boolean }} [opciones]
 */
export function useModalAccesible(ref, { open = true, onClose, bloqueado = false } = {}) {
  const cerrar = useRef(onClose);
  const bloq = useRef(bloqueado);
  cerrar.current = onClose;
  bloq.current = bloqueado;

  useEffect(() => {
    if (!open) return undefined;
    const previo = document.activeElement;
    const yo = {};
    pila.push(yo);
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const destino = el.querySelector('[data-autofocus]') || enfocables(el)[0] || el;
      destino.focus?.();
    }, 30);

    function onKey(e) {
      const el = ref.current;
      if (!el || pila[pila.length - 1] !== yo) return;
      if (e.key === 'Escape') {
        if (el.querySelector('[aria-expanded="true"]')) return;
        e.stopPropagation();
        if (!bloq.current) cerrar.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const lista = enfocables(el);
      if (lista.length === 0) { e.preventDefault(); return; }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (!el.contains(activo)) { e.preventDefault(); primero.focus(); return; }
      if (e.shiftKey && activo === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && activo === ultimo) { e.preventDefault(); primero.focus(); }
    }

    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      const i = pila.indexOf(yo);
      if (i >= 0) pila.splice(i, 1);
      if (previo && typeof previo.focus === 'function' && document.contains(previo)) previo.focus();
    };
  }, [open, ref]);
}
