import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { CaretDown } from '@phosphor-icons/react';
import type { McpHerramienta } from '../api/mcp.api';

/**
 * «Consultas disponibles» de Conexión → MCP: lo que Claude puede preguntarle al CRM,
 * agrupado por apartado y RECOGIDO por defecto. Es una referencia que se abre cuando hace
 * falta, no algo que ocupe media pantalla cada vez que alguien viene a sacar su URL.
 *
 * El Moodle de los campus tiene su propia pantalla (Conexión → Moodle); aquí solo se enlaza.
 */

/** La primera frase de la descripción: lo que hace la consulta, en una línea. */
const resumen = (descripcion: string) => `${descripcion.split('. ')[0].replace(/\.$/, '')}.`;

const GRUPO_MOODLE = 'Moodle de los campus';

export default function ConsultasDisponibles({ herramientas, verMoodle }: { herramientas: McpHerramienta[]; verMoodle: boolean }) {
  // Los apartados, en el orden en que aparece su primera consulta.
  const grupos = useMemo(() => {
    const mapa = new Map<string, McpHerramienta[]>();
    for (const h of herramientas) {
      const g = h.grupo || 'Otras';
      mapa.set(g, [...(mapa.get(g) ?? []), h]);
    }
    return [...mapa.entries()];
  }, [herramientas]);

  return (
    <details className="group rounded-lg border border-border bg-card" data-testid="consultas-disponibles">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4">
        <span className="font-semibold text-sm">Consultas disponibles</span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {herramientas.length} consultas en {grupos.length} apartados
          <CaretDown size={14} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="grid gap-x-8 gap-y-4 border-t border-border p-4 md:grid-cols-2">
        {grupos.map(([nombre, consultas]) => (
          <section key={nombre} className="space-y-1.5">
            <h3 className="flex items-baseline justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {nombre}
              {nombre === GRUPO_MOODLE && verMoodle && (
                <Link to="/conexion/moodle" className="normal-case tracking-normal font-semibold text-primary hover:underline">Abrir el panel de Moodle →</Link>
              )}
            </h3>
            <ul className="space-y-1.5">
              {consultas.map((h) => (
                <li key={h.nombre} className="text-sm leading-snug">
                  <span className="font-medium">{h.titulo}</span>
                  <span className="block text-xs text-muted-foreground">{resumen(h.descripcion)}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
