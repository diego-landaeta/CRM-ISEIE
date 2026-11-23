import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { PasoRecorrido } from '@/shared/components/ui/RecorridoGuiado';

/*
  EL LANZADOR DE LOS RECORRIDOS (CRM#1012 · CRM-ISEIE#681; Diego, 23/11/2026).

  «QUE SOLO SE ACTIVE AL TOCAR EL BOTÓN ARRIBA DE RECORRIDO, NO SIEMPRE COMO
  PASA EN ALGUNAS PÁGINAS.»

  Ningún recorrido se abre solo. Se abren desde el botón «Recorrido» de la
  cabecera (`BotonRecorrido`), que tira de aquí:

   · `abrirRecorrido(...)`: lo pone en pantalla. Lo pinta `PresentadorRecorrido`
     (montado una vez en `AppLayout`), en el `body`, con el `RecorridoGuiado`
     de siempre. Uno a la vez: abrir otro cierra el que hubiera.
   · `useRegistrarRecorrido(...)`: una pantalla con un recorrido que no va en
     el registro por ruta (el tablero de Tareas, el chat y las plantillas de
     WhatsApp, los «Ver cómo funciona» de staging) se apunta mientras está
     montada, y la cabecera lo ofrece en «Recorrido de esta pantalla».

  Es un almacén mínimo (sin contexto de React): la cabecera, las pantallas y el
  presentador viven en ramas distintas del árbol y aquí se encuentran.
*/

export interface RecorridoEnCurso {
  /** Para quién y de qué va: sale en el menú y como nombre accesible. */
  titulo: string;
  pasos: PasoRecorrido[];
  /** Clave del navegador (se marca como visto al abrirse; ya no decide nada). */
  clave: string;
  /**
   * La ventana que explica, si el recorrido va DENTRO de una (el asistente de
   * crear link, el plan de pago). Sin esto, abrir el recorrido con una ventana
   * encima lo cerraría al instante (la regla del 27/10).
   */
  dentroDe?: string;
}

export interface RecorridoDePantalla {
  id: string;
  titulo: string;
  abrir: () => void;
}

let activo: RecorridoEnCurso | null = null;
let vez = 0;
const deLaPantalla = new Map<string, RecorridoDePantalla>();
let version = 0;
const oyentes = new Set<() => void>();

function avisar() {
  version += 1;
  oyentes.forEach((f) => f());
}

function suscribir(f: () => void) {
  oyentes.add(f);
  return () => { oyentes.delete(f); };
}

/** Pone un recorrido en pantalla (y quita el que hubiera). Solo desde un botón. */
export function abrirRecorrido(r: RecorridoEnCurso) {
  vez += 1;
  activo = r;
  avisar();
}

export function cerrarRecorrido() {
  if (!activo) return;
  activo = null;
  avisar();
}

/** El recorrido que hay en pantalla, y cuántas veces se ha abierto uno (para reiniciarlo). */
export function useRecorridoActivo(): { recorrido: RecorridoEnCurso | null; vez: number } {
  const v = useSyncExternalStore(suscribir, () => version, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ recorrido: activo, vez }), [v]);
}

/** Los recorridos que la pantalla montada ha apuntado (además de los de su ruta). */
export function useRecorridosApuntados(): RecorridoDePantalla[] {
  const v = useSyncExternalStore(suscribir, () => version, () => version);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => [...deLaPantalla.values()], [v]);
}

/**
 * Apunta el recorrido de una pantalla mientras está montada. `null` = no tiene
 * (sin permiso, apagado...). `abrir` puede cambiar en cada pintada: se usa la última.
 */
export function useRegistrarRecorrido(r: RecorridoDePantalla | null) {
  const ultimo = useRef(r);
  ultimo.current = r;
  const id = r?.id;
  const titulo = r?.titulo;
  useEffect(() => {
    if (!id || !titulo) return undefined;
    const entrada: RecorridoDePantalla = { id, titulo, abrir: () => ultimo.current?.abrir() };
    deLaPantalla.set(id, entrada);
    avisar();
    return () => {
      if (deLaPantalla.get(id) === entrada) {
        deLaPantalla.delete(id);
        avisar();
      }
    };
  }, [id, titulo]);
}

/** Solo para las pruebas: deja el almacén vacío. */
export function _reiniciarLanzador() {
  activo = null;
  deLaPantalla.clear();
  avisar();
}
