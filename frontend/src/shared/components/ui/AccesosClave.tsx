import type { ComponentType } from 'react';
import type { IconProps } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import Card from './Card';
import { cn } from '@/shared/lib/utils';
// Traído de MultiCRM. ISEIE no tiene su escala de texto (text-seccion,
// text-secundario, text-normal): van text-base, text-xs y text-sm.

/**
 * Los cuatro sitios a los que se va desde aquí.
 *
 * «Accesos clave a la derecha, para no obligar a volver al menú», que es lo que
 * pasaba: para ir de Prospectos al pipeline había que subir el ratón al menú,
 * buscar la entrada y bajar otra vez. El resto sigue viviendo en el menú — esto
 * son solo los cuatro que se usan desde esta pantalla.
 *
 * Cada uno lleva su icono y una línea que dice para qué es, igual que el menú:
 * un nombre suelto no dice si es el que buscas.
 */

export interface Acceso {
  label: string;
  detail: string;
  /** El tipo de Phosphor, no uno mío: escribirlo a mano dejaba fuera `weight`
      y los cuatro iconos daban error de tipos. */
  icon: ComponentType<IconProps>;
  to: string;
  /** Un número al lado cuando hay algo que mirar ahí. */
  badge?: number;
}

export default function AccesosClave({
  accesos, titulo = 'Accesos clave', subtitulo = 'El resto vive en el menú.',
}: {
  accesos: Acceso[];
  titulo?: string;
  subtitulo?: string;
}) {
  const navigate = useNavigate();

  return (
    <Card>
      <div>
        <h2 className="text-base font-semibold">{titulo}</h2>
        <p className="text-xs text-muted-foreground">{subtitulo}</p>
      </div>

      <ul className="mt-4 space-y-1.5">
        {accesos.map(({ label, detail, icon: Icon, to, badge }) => (
          <li key={to}>
            <button
              type="button"
              onClick={() => navigate(to)}
              className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon size={16} weight="regular" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{detail}</span>
              </span>
              {typeof badge === 'number' && badge > 0 && (
                <span className={cn('shrink-0 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-bold text-warning-soft-foreground')}>
                  {badge}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
