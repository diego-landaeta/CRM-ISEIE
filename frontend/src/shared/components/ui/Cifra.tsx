import type { ComponentType } from 'react';
import type { IconProps } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
// Traído de MultiCRM. ISEIE no tiene su escala de texto: `text-cifra` (28px,
// seminegrita) va como text-[1.75rem] font-semibold y `text-secundario` como
// text-xs, para que la cifra se vea igual en los dos CRM.

/**
 * Una cifra de cabecera: etiqueta, número y una línea que lo explica.
 *
 * Estaba dentro de `CifrasProspectos`. Sale aquí porque Clientes lleva su
 * propia fila de cuatro y tiene que ser la misma pieza: dos tarjetas de cifra
 * distintas en el mismo CRM se notan enseguida.
 *
 * OJO — ya existe `KpiCard`, que es otra tarjeta de cifra y la usan diez
 * pantallas (contabilidad, campañas, comisiones). Son dos maquetaciones
 * diferentes conviviendo, y ninguna de las dos es la de la maqueta de
 * referencia. Está anotado para decidirlo; no lo unifico por mi cuenta porque
 * afecta a pantallas que no son mías.
 */

export type TonoCifra = 'neutro' | 'aviso' | 'peligro' | 'bien';

const TONOS: Record<TonoCifra, string> = {
  neutro: 'bg-muted text-muted-foreground',
  aviso: 'bg-warning-soft text-warning-soft-foreground',
  peligro: 'bg-destructive-soft text-destructive-soft-foreground',
  bien: 'bg-success-soft text-success-soft-foreground',
};

export function Cifra({
  icon: Icon, etiqueta, valor, detalle, tono = 'neutro', onClick, activo,
}: {
  icon: ComponentType<IconProps>;
  etiqueta: string;
  /** Un número, o ya formateado (importes, porcentajes). */
  valor: number | string;
  detalle: string;
  tono?: TonoCifra;
  onClick?: () => void;
  activo?: boolean;
}) {
  // Las que filtran son botones de verdad; las que no, no lo fingen. Un número
  // que parece pulsable y no hace nada es peor que uno quieto.
  const Elemento = onClick ? 'button' : 'div';
  return (
    <Elemento
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex min-w-0 items-start gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors',
        onClick && 'hover:border-muted-foreground/40 hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/40',
        activo && 'border-primary/50 bg-primary/5',
      )}
    >
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', TONOS[tono])}>
        <Icon size={17} weight="regular" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{etiqueta}</span>
        <span className="block text-[1.75rem] font-semibold tabular-nums leading-none">{valor}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{detalle}</span>
      </span>
    </Elemento>
  );
}

/**
 * La fila de cifras, a todo lo ancho y por encima de las columnas.
 *
 * Van dos por línea en pantalla estrecha y cuatro en ancha. Estaban dentro del
 * bloque de la izquierda y las etiquetas salían cortadas —«Pr…», «Si…»— con el
 * detalle en cinco líneas.
 */
export function FilaDeCifras({ children }: { children: React.ReactNode }) {
  return <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">{children}</section>;
}

export default Cifra;
