import { Link } from 'react-router-dom';
import { Plugs } from '@phosphor-icons/react';
import type { CampusMoodle } from '../api/moodle.api';

/**
 * Los campus que aún no tienen Moodle, como una lista corta con lo único que se puede hacer
 * con ellos: conectarlos. Quien no es super admin no puede, y la fila se lo dice.
 */
export default function CampusPendientes({ campus, puedeConectar }: { campus: CampusMoodle[]; puedeConectar: boolean }) {
  return (
    <ul className="divide-y divide-border" data-testid="campus-pendientes">
      {campus.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-3">
          <span className="min-w-0 truncate text-sm font-medium">{c.nombre}</span>
          {puedeConectar ? (
            <Link
              to={`/conexion/moodle/${c.id}`}
              aria-label={`Conectar el Moodle de ${c.nombre}`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-primary/40 px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Plugs size={15} weight="bold" /> Conectar
            </Link>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">Lo conecta un super admin</span>
          )}
        </li>
      ))}
    </ul>
  );
}
