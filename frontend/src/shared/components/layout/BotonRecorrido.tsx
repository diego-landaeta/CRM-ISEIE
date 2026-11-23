import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Compass, CaretDown } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import { rolesDe } from '@/shared/lib/roles';
import { cn } from '@/shared/lib/utils';
import { RECORRIDOS_COBROS, claveRecorrido, pasosPara, tienePermiso } from '@/shared/lib/recorridosCobros';
import { recorridosDeLaRuta } from '@/shared/lib/recorridosPorRuta';
import { abrirRecorrido, useRecorridosApuntados } from '@/shared/lib/lanzadorRecorridos';
import { NOMBRE_DEL_ROL, pasosDelRecorridoGeneral, type BloqueVisible } from '@/shared/lib/recorridoGeneral';
import {
  NAV_SECTIONS, anclaDelBloque, canSeeItem, entradasDeSeccion, esSoloColaboraciones,
} from './Sidebar';

/*
  EL BOTÓN «RECORRIDO» DE ARRIBA (CRM-ISEIE#681, gemela de CRM#1012; Diego, 23/11).

  «QUE SOLO SE ACTIVE AL TOCAR EL BOTÓN ARRIBA DE RECORRIDO.» Siempre en el mismo
  sitio, arriba a la derecha de todas las pantallas (ISEIE no tiene la cabecera
  del 360: en el PC va en una franja encima de la pantalla y en el móvil en la
  barra de arriba). Son dos botones pegados:

   · «Recorrido»: abre el de ESTA pantalla. Si la pantalla no tiene (o esa
     persona no tiene permiso para el suyo), abre el GENERAL según su rol. Si
     tiene varios (la ficha de la venta: cuotas, links, cobro automático…),
     despliega el menú para elegir.
   · La flecha de al lado despliega siempre el menú, con:
       – «Recorrido de esta pantalla»: los de la ruta en la que se está (el
         registro `recorridosPorRuta`) y los que la pantalla montada ha apuntado
         (el tablero, el chat de WhatsApp, los «Ver cómo funciona»). Solo los que
         esa persona tiene permiso de ver. Si la pantalla no tiene, lo dice.
       – «Recorrido general»: su menú, según su rol y sus permisos.

  Con teclado: Intro o espacio lo abre, las flechas se mueven por las opciones,
  Escape lo cierra y devuelve el foco al botón.
*/

interface Opcion { clave: string; titulo: string; abrir: () => void }

type Usuario = { id?: number | string; nombre?: string | null; name?: string | null; role?: string | null; roles_extra?: string[] | null } | null;

/**
 * Los bloques del menú tal como los ve esa persona: el MISMO filtro que el menú
 * lateral (`entradasDeSeccion` y, dentro de un grupo, `canSeeItem`). En ISEIE no
 * hay tipos de proyecto ni módulos: mandan su rol y sus permisos.
 */
export function bloquesQueVe(user: Usuario, can: (p: string) => boolean): BloqueVisible[] {
  const soloColab = esSoloColaboraciones(user);
  const roles = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  return (NAV_SECTIONS as Array<{ label: string }>)
    .map((s) => {
      const items = entradasDeSeccion(s, { user, can, soloColab }) as Array<{ label: string; children?: unknown[] }>;
      const entradas = items.flatMap((it) => {
        if (!it.children) return [it.label];
        const hijos = it.children.filter((c) => canSeeItem(c, roles, soloColab, user, can));
        return hijos.length ? [it.label] : [];
      });
      return { label: s.label, ancla: anclaDelBloque(s.label), entradas };
    })
    .filter((b) => b.entradas.length > 0);
}

const ES_PC = '(min-width: 1024px)';

export default function BotonRecorrido({ className }: { className?: string }) {
  const { pathname } = useLocation();
  const { user } = useAuth() as { user: Usuario };
  const { can } = usePermission();
  const apuntados = useRecorridosApuntados();
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement | null>(null);
  const flecha = useRef<HTMLButtonElement | null>(null);
  const caja = useRef<HTMLDivElement | null>(null);

  // Los de esta pantalla: los de su ruta, y los que la pantalla ha apuntado.
  const deLaRuta: Opcion[] = recorridosDeLaRuta(pathname)
    .map((id) => RECORRIDOS_COBROS[id])
    .filter((r) => r && tienePermiso(r.permiso, can))
    .map((r) => ({ r, pasos: pasosPara(r, can) }))
    .filter(({ pasos }) => pasos.length > 0)
    .map(({ r, pasos }) => ({
      clave: r.id,
      titulo: r.titulo,
      abrir: () => abrirRecorrido({ titulo: r.titulo, pasos, clave: claveRecorrido(r.id, user?.id) }),
    }));
  const vistos = new Set(deLaRuta.map((o) => o.clave));
  const deLaPantalla: Opcion[] = [
    ...deLaRuta,
    ...apuntados.filter((a) => !vistos.has(a.id)).map((a) => ({ clave: a.id, titulo: a.titulo, abrir: a.abrir })),
  ];

  const roles = rolesDe(user);
  const nombreRol = roles.map((r) => NOMBRE_DEL_ROL[r] || r).join(' y ');

  function lanzarGeneral() {
    const pasos = pasosDelRecorridoGeneral({
      roles,
      bloques: bloquesQueVe(user, can),
      nombre: user?.nombre || user?.name || null,
    });
    const abrir = () => abrirRecorrido({ titulo: 'Recorrido general', pasos, clave: `recorrido-general-u${user?.id ?? ''}` });
    // En el móvil el menú va en un cajón cerrado: se abre antes (lo escucha AppLayout).
    const esPC = typeof window === 'undefined' || !window.matchMedia || window.matchMedia(ES_PC).matches;
    if (esPC) { abrir(); return; }
    window.dispatchEvent(new Event('crm:abrir-menu'));
    setTimeout(abrir, 350);
  }

  // Al abrir, el foco a la primera opción; fuera de la caja o con Escape, se cierra.
  useEffect(() => {
    if (!abierto) return undefined;
    const primera = caja.current?.querySelector<HTMLElement>('[role="menuitem"]');
    primera?.focus();
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!caja.current?.contains(t) && !boton.current?.contains(t) && !flecha.current?.contains(t)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);

  // Al cambiar de pantalla, el menú se cierra (sus opciones eran de la otra).
  useEffect(() => { setAbierto(false); }, [pathname]);

  function alTeclear(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(caja.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setAbierto(false); (deLaPantalla.length > 1 ? boton : flecha).current?.focus(); return; }
    if (e.key === 'Tab') { setAbierto(false); return; }
    if (!items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
  }

  function elegir(o: Opcion) {
    setAbierto(false);
    o.abrir();
  }

  // El botón principal: el de esta pantalla; sin ninguno, el general; con varios, a elegir.
  function alPulsar() {
    if (deLaPantalla.length === 1) { setAbierto(false); deLaPantalla[0].abrir(); return; }
    if (deLaPantalla.length === 0) { setAbierto(false); lanzarGeneral(); return; }
    setAbierto((v) => !v);
  }
  const queAbre = deLaPantalla.length === 1 ? `el recorrido de esta pantalla: ${deLaPantalla[0].titulo}`
    : deLaPantalla.length === 0 ? `el recorrido general${nombreRol ? ` (como ${nombreRol})` : ''}`
      : 'los recorridos de esta pantalla, para elegir';

  if (!user) return null;

  const item = 'w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted focus:bg-muted focus:outline-none';
  return (
    <div className={cn('relative flex-shrink-0', className)}>
      <div className="inline-flex h-9 items-stretch rounded-md border border-border bg-card" data-recorrido="cabecera-recorrido">
        <button
          ref={boton}
          type="button"
          onClick={alPulsar}
          aria-label="Recorrido"
          aria-haspopup={deLaPantalla.length > 1 ? 'menu' : undefined}
          aria-expanded={deLaPantalla.length > 1 ? abierto : undefined}
          title={`Abre ${queAbre}`}
          data-abre={deLaPantalla.length === 1 ? 'pantalla' : deLaPantalla.length === 0 ? 'general' : 'menu'}
          className="inline-flex items-center gap-1.5 rounded-l-md px-2.5 text-sm font-semibold hover:bg-muted"
        >
          <Compass size={16} weight="bold" aria-hidden="true" />
          <span className="hidden sm:inline">Recorrido</span>
        </button>
        <button
          ref={flecha}
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={abierto}
          aria-controls="menu-recorrido"
          aria-label="Más recorridos"
          title="Elegir: el de esta pantalla o el general"
          className="inline-flex items-center rounded-r-md border-l border-border px-1.5 hover:bg-muted"
        >
          <CaretDown size={11} weight="bold" aria-hidden="true" className={cn('transition-transform', abierto && 'rotate-180')} />
        </button>
      </div>
      {abierto && (
        <div
          ref={caja}
          id="menu-recorrido"
          role="menu"
          aria-label="Recorridos"
          onKeyDown={alTeclear}
          className="absolute right-0 top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-1.5 shadow-xl"
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground" id="recorrido-de-esta-pantalla">
            Recorrido de esta pantalla
          </p>
          <div role="group" aria-labelledby="recorrido-de-esta-pantalla">
            {deLaPantalla.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Esta pantalla todavía no tiene recorrido.</p>
            ) : deLaPantalla.map((o) => (
              <button key={o.clave} type="button" role="menuitem" tabIndex={-1} className={item}
                data-recorrido-opcion={o.clave} onClick={() => elegir(o)}>
                {o.titulo}
              </button>
            ))}
          </div>
          <div className="my-1.5 border-t border-border" aria-hidden="true" />
          <p className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground" id="recorrido-general-titulo">
            Recorrido general
          </p>
          <div role="group" aria-labelledby="recorrido-general-titulo">
            <button type="button" role="menuitem" tabIndex={-1} className={item}
              data-recorrido-opcion="general" onClick={() => elegir({ clave: 'general', titulo: 'Recorrido general', abrir: lanzarGeneral })}>
              <span className="block">Tu menú, paso a paso</span>
              <span className="block text-xs text-muted-foreground">{nombreRol ? `Como ${nombreRol}: lo que tú ves y para qué sirve` : 'Lo que tú ves y para qué sirve'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
