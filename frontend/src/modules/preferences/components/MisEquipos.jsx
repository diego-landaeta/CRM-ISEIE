import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Key, UsersThree } from '@phosphor-icons/react';
import * as tasksApi from '@/modules/tasks/api/tasks.api';

/**
 * Tus equipos del tablero, con tu cargo (Diego, 26/10/2026: «la tarjeta y el
 * perfil enseñan Equipo · Cargo»), y el atajo para cambiar la contraseña, que
 * vive en «Mi perfil».
 */
export default function MisEquipos() {
  const [equipos, setEquipos] = useState(null);
  useEffect(() => {
    let vivo = true;
    tasksApi.getMyTeams().then((e) => { if (vivo) setEquipos(e); }).catch(() => { if (vivo) setEquipos(false); });
    return () => { vivo = false; };
  }, []);

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <UsersThree size={18} weight="duotone" className="text-primary" />
        <h3 className="font-bold">Tus equipos</h3>
      </div>
      {equipos === false ? (
        <p className="text-sm text-muted-foreground">Tu rol no tiene tablero de tareas.</p>
      ) : equipos === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : equipos.length === 0 ? (
        <p className="text-sm text-muted-foreground">No estás en ningún equipo del tablero.</p>
      ) : (
        <ul className="space-y-1">
          {equipos.map((e) => (
            <li key={e.team_id} className="text-sm">
              <span className="font-semibold">{e.team_name}</span> · {e.cargo}
              <span className="text-muted-foreground"> ({e.empresa})</span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/perfil" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <Key size={14} /> Cambiar tu contraseña
      </Link>
    </div>
  );
}
