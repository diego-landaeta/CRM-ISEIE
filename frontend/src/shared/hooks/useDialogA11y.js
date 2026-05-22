import { useEffect } from 'react';

/**
 * useEscapeKey(onClose, enabled = true)
 *   Escucha la tecla Escape a nivel global y llama a onClose.
 */
export function useEscapeKey(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof onClose !== 'function') return;
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}
