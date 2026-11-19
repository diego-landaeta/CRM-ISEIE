import { cn } from '@/shared/lib/utils';

/*
  El avatar de una persona sin foto: sus iniciales sobre un color que es siempre el
  mismo para el mismo nombre. Así, en una bandeja o en una conversación, a cada
  persona se la reconoce de un vistazo sin leer el nombre.

  Los colores son los pares suaves del tema (fondo -soft y su letra -soft-foreground),
  que ya cumplen 4,5:1 en claro y en oscuro: nada de colores con número.
*/
const TONOS = [
  'bg-info-soft dark:bg-info/15 text-info-soft-foreground',
  'bg-success-soft dark:bg-success/15 text-success-soft-foreground',
  'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground',
  'bg-indigo-soft dark:bg-indigo/15 text-indigo-soft-foreground',
  'bg-accent text-accent-foreground',
];

const TAMANOS = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-10 w-10 text-sm',
} as const;

export function iniciales(nombre: string | null | undefined) {
  return String(nombre || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}

function tono(nombre: string) {
  let h = 0;
  for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONOS[h % TONOS.length];
}

export default function Iniciales({ nombre, tamano = 'sm', className }: {
  nombre: string | null | undefined; tamano?: keyof typeof TAMANOS; className?: string;
}) {
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold', TAMANOS[tamano], tono(String(nombre || '?')), className)}>
      {iniciales(nombre)}
    </span>
  );
}
