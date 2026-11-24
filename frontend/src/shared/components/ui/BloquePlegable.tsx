import { useCallback, useState, type ReactNode } from 'react';
import { CaretDown } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
// Traído de MultiCRM. ISEIE no tiene sus tokens de texto ni de espaciado:
// `text-tabla` (11px, seminegrita, espaciada) se escribe entero, `text-
// secundario` es text-xs y `space-y-fila` es space-y-2.

/**
 * Un bloque que se puede plegar, y que recuerda cómo lo dejaste.
 *
 * Nace del #125: «Eso debe ser como un desplegable, está súper bien, pero que
 * se pueda desplegar». El bloque de arriba —salud, siguientes acciones,
 * accesos— ocupa la primera pantalla entera y empuja la tabla abajo del todo.
 * A quien viene a mirar la tabla le sobra; a quien viene a organizarse el día
 * le hace falta. Que lo decida cada cual, una vez.
 *
 * SE RECUERDA POR PANTALLA, no en general: alguien puede querer el resumen en
 * Prospectos y no en Clientes. Por eso la `clave`.
 *
 * NACE ABIERTO (Diego, 24/11: «todo abierto como antes»): lo plegado es lo que
 * cada uno pliega, y solo se recuerda eso.
 *
 * Si el navegador no deja guardar —ventana privada, permisos— se comporta como
 * si nada: abierto, y sin romperse.
 */

function leer(clave: string, porDefecto: boolean): boolean {
  try {
    const v = localStorage.getItem(clave);
    return v === null ? porDefecto : v === '1';
  } catch {
    return porDefecto;
  }
}

export default function BloquePlegable({
  clave,
  titulo,
  resumen,
  abiertoPorDefecto = true,
  children,
  className,
}: {
  /** Dónde se recuerda. Una por pantalla. */
  clave: string;
  titulo: string;
  /** Lo que se lee cuando está plegado, para no tener que abrirlo a ciegas. */
  resumen?: ReactNode;
  abiertoPorDefecto?: boolean;
  children: ReactNode;
  className?: string;
}) {
  // `v2` (24/11): con la 3.0.0 se guardaba «cerrado» nada más entrar, sin que
  // nadie lo plegara. Lo de antes no vale: todos vuelven a verlo abierto.
  const almacen = `crm.bloque.v2.${clave}`;
  const [abierto, setAbierto] = useState(() => leer(almacen, abiertoPorDefecto));

  // Solo se guarda lo que la persona ELIGE (al pulsar), nunca al entrar.
  const alternar = useCallback(() => setAbierto((v) => {
    try { localStorage.setItem(almacen, v ? '0' : '1'); } catch { /* sin guardar, pero funciona */ }
    return !v;
  }), [almacen]);
  const idContenido = `bloque-${clave}`;

  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={abierto}
          aria-controls={idContenido}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 -ml-2',
            'text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground',
            'transition-colors hover:bg-muted hover:text-foreground',
            'focus:outline-none focus:ring-2 focus:ring-ring/40',
          )}
        >
          <CaretDown
            size={11}
            weight="bold"
            className={cn('transition-transform duration-150', abierto ? '' : '-rotate-90')}
          />
          {titulo}
        </button>
        {/* Plegado, el resumen dice si vale la pena abrirlo. Sin el, plegar
            equivale a esconder y hay que abrirlo para saber si habia algo. */}
        {!abierto && resumen && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{resumen}</span>
        )}
      </div>
      {/* Se desmonta al plegar, no se esconde con CSS: lo de dentro pide datos
          y hace cuentas, y tenerlo vivo detras de un `display:none` es pagar
          por algo que nadie mira. */}
      {abierto && <div id={idContenido}>{children}</div>}
    </section>
  );
}
