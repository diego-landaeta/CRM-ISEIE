import { ClockCounterClockwise } from '@phosphor-icons/react';
import type { ApunteDelRegistro } from '../api/permissions.api';

/**
 * #703 · Quién dio o quitó qué permiso, a quién y cuándo. Lo enseñan la ficha
 * de cada persona y, en Roles, cada rol fijo o a medida. El permiso va con su
 * nombre de pantalla («Facturación · Cambiar fechas»); la clave, al pasar el
 * ratón, por si hay que buscarla en `docs/PERMISOS.md`.
 *
 * `conPersona`: en el registro de un rol, cada apunte dice también a quién (si
 * lo hay); en la ficha sobra, es ella.
 */
export default function RegistroDeCambios({ apuntes, conPersona = false, titulo = 'Cambios de permisos' }: {
  apuntes: ApunteDelRegistro[];
  conPersona?: boolean;
  titulo?: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-1.5 text-normal font-semibold"><ClockCounterClockwise size={16} /> {titulo}</h3>
      {apuntes.length === 0 ? (
        <p className="text-secundario text-muted-foreground">Ninguno todavía.</p>
      ) : (
        <ul className="space-y-1 text-secundario" data-registro>
          {apuntes.map((r) => (
            <li key={r.id} className="text-muted-foreground">
              <span className="text-foreground">{new Date(r.cuando).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>
              {' · '}{r.quien_nombre || 'el sistema'}
              {conPersona && r.usuario_nombre ? ` a ${r.usuario_nombre}` : ''}
              {' · '}<span className="text-foreground" title={r.clave}>{r.nombre || r.clave}</span>
              {': '}{r.antes ?? '—'} → {r.despues ?? '—'}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}