import { useState, useCallback, useRef, useEffect } from 'react';

let toastId = 0;
let listeners = [];

function dispatch(toast) {
  toastId++;
  const id = toastId;
  const newToast = { id, ...toast };
  listeners.forEach((l) => l(newToast));
  return id;
}

export function toast({ title, description = undefined, variant = 'default', duration = 4000 }) {
  return dispatch({ title, description, variant, duration });
}

export function useToast() {
  const [toasts, setToasts] = useState([]);
  // Track de timeouts activos para limpiarlos al desmontar
  const timeoutsRef = useRef(new Set());

  useEffect(() => () => {
    timeoutsRef.current.forEach((t) => clearTimeout(t));
    timeoutsRef.current.clear();
  }, []);

  const addListener = useCallback(() => {
    const handler = (newToast) => {
      setToasts((prev) => [...prev, newToast]);
      if (newToast.duration > 0) {
        const t = setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== newToast.id));
          timeoutsRef.current.delete(t);
        }, newToast.duration);
        timeoutsRef.current.add(t);
      }
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addListener, dismiss };
}
