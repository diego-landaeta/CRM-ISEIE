import { Link } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import StatusDot from '@/shared/components/ui/StatusDot';
import { cn } from '@/shared/lib/utils';
import type { CampusMoodle } from '../api/moodle.api';

/**
 * La lista de campus, una fila por campus: si tiene Moodle conectado y, si lo tiene, sus
 * cifras. Pulsar una fila entra en el campus (sus cursos). Los que no tienen Moodle salen
 * atenuados, y su pantalla explica cómo conectarlo.
 */
function Estado({ c }: { c: CampusMoodle }) {
  if (c.error) return <StatusDot tono="warning" title={c.error}>No responde</StatusDot>;
  if (c.configurado) return <StatusDot tono="success">Conectado</StatusDot>;
  return <StatusDot tono="neutral">Sin conectar</StatusDot>;
}

export default function ListaDeCampus({ campus }: { campus: CampusMoodle[] }) {
  return (
    <>
      {/* En el móvil no cabe una tabla de cuatro columnas: una fila por campus, con las cifras debajo. */}
      <ul className="divide-y divide-border sm:hidden" data-testid="lista-campus-movil">
        {campus.map((c) => (
          <li key={c.id}>
            <Link
              to={`/conexion/moodle/${c.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/40"
            >
              <span className="min-w-0 space-y-1">
                <span className={cn('block truncate text-sm font-medium', c.configurado ? 'text-foreground' : 'text-muted-foreground')}>{c.nombre}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Estado c={c} />
                  {c.cursos && <span className="tabular-nums">{c.cursos.activos} activos · {c.cursos.total} en total</span>}
                </span>
              </span>
              <CaretRight size={14} weight="bold" className="shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="relative hidden overflow-x-auto sm:block">
      <table className="w-full text-sm" data-testid="lista-campus">
        <thead className="bg-muted/40">
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-5 py-3 font-semibold">Campus</th>
            <th scope="col" className="px-5 py-3 font-semibold">Moodle</th>
            <th scope="col" className="px-5 py-3 font-semibold text-right">Cursos activos</th>
            <th scope="col" className="px-5 py-3 font-semibold text-right">Cursos en total</th>
            <th scope="col" className="w-12 px-5 py-3"><span className="sr-only">Abrir</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {campus.map((c) => (
            <tr key={c.id} className="transition-colors hover:bg-muted/40">
              <td className={cn('px-5 py-3.5', !c.configurado && 'text-muted-foreground')}>
                <Link
                  to={`/conexion/moodle/${c.id}`}
                  className={cn('font-medium hover:text-primary focus:outline-none focus-visible:underline', c.configurado ? 'text-foreground' : 'text-muted-foreground')}
                >
                  {c.nombre}
                </Link>
              </td>
              <td className="px-5 py-3.5"><div className="flex items-center"><Estado c={c} /></div></td>
              <td className="px-5 py-3.5 text-right tabular-nums">{c.cursos ? c.cursos.activos : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-5 py-3.5 text-right tabular-nums">{c.cursos ? c.cursos.total : <span className="text-muted-foreground">—</span>}</td>
              <td className="px-5 py-3.5 text-right text-muted-foreground">
                <Link to={`/conexion/moodle/${c.id}`} aria-label={`Abrir ${c.nombre}`} tabIndex={-1}><CaretRight size={14} weight="bold" /></Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
