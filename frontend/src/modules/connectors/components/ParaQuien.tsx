import type { Conector } from '../api/connectors.api';

/**
 * De quién es un conector o una conexión de Claude: todo el sistema, una
 * empresa entera o un campus. Diego, 29/09: «que puedas ver quién gestiona o
 * quién creó un MCP y en dónde». El «en dónde» es esto.
 */
export default function ParaQuien({ c }: { c: Pick<Conector, 'alcance' | 'empresa' | 'proyecto'> }) {
  if (c.alcance === 'sistema') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
        Todo el sistema
      </span>
    );
  }
  if (c.alcance === 'empresa') {
    return (
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-info-soft text-info whitespace-nowrap">
        Toda {c.empresa || 'la empresa'}
      </span>
    );
  }
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary whitespace-nowrap">
      {c.proyecto || 'Un campus'}
    </span>
  );
}
