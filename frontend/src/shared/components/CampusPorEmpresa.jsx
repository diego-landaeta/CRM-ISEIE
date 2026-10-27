import { Buildings } from '@phosphor-icons/react';

/**
 * Los campus de un usuario, agrupados por empresa (#220).
 *
 * Diego, 10/10: «Un admin puede tener los proyectos futuros, pero de SU
 * empresa: mayormente los admin son por empresa». Cada empresa tiene su
 * «Marcar todos», y para un admin —si quien edita es super admin— la casilla
 * «Todos los campus de esta empresa, también los que se creen».
 *
 * La empresa es la sociedad emisora del campus (`sociedad_emisora_id`). Es el
 * mismo componente en el alta y en la edición, para que no diverjan.
 *
 * `assigned` es { [projectId]: recibeLeads }, como lo llevan los dos modales.
 * El interruptor de «recibe leads» solo sale para admin; al gestor se le pinta
 * fijo, porque recibe siempre (lead.model.js).
 */
export default function CampusPorEmpresa({
  projects, assigned, role, onToggle, onSetRecibe, onSetMany,
  empresas, empresasEnteras = [], onToggleEmpresa, faltaMigracion = false, esColaborador = false,
}) {
  // El colaborador (rol principal o añadido) también tiene empresa: el equipo de
  // desarrollo va por empresa en Tareas (26/10/2026). A él NO le da campus.
  const paraColaborador = role !== 'admin' && esColaborador;
  const conEmpresas = (role === 'admin' || paraColaborador) && !!onToggleEmpresa && Array.isArray(empresas);

  const porEmpresa = new Map();
  for (const p of projects) {
    const id = p.sociedad_emisora_id ? Number(p.sociedad_emisora_id) : null;
    if (!porEmpresa.has(id)) porEmpresa.set(id, { id, nombre: p.sociedad_nombre || (id ? 'Empresa' : 'Sin empresa'), campus: [] });
    porEmpresa.get(id).campus.push(p);
  }
  if (conEmpresas) {
    // También las que aún no tienen campus: el admin puede ir antes que el primero.
    for (const e of empresas) {
      const g = porEmpresa.get(e.id);
      if (g) g.nombre = e.razon_social;
      else porEmpresa.set(e.id, { id: e.id, nombre: e.razon_social, campus: [] });
    }
  }
  const grupos = [...porEmpresa.values()].sort((a, b) => {
    if (a.id === null) return 1;
    if (b.id === null) return -1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });
  const conCabeceras = grupos.length > 1 || conEmpresas;

  if (grupos.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No hay proyectos disponibles.</p>;
  }

  return (
    <div className="space-y-2 max-h-72 overflow-y-auto border border-border rounded-md p-2">
      {grupos.map((g) => {
        const ids = g.campus.map((p) => p.id);
        const todos = ids.length > 0 && ids.every((id) => id in assigned);
        const entera = g.id !== null && empresasEnteras.includes(g.id);
        return (
          <div key={g.id ?? 'sin'} className="space-y-1.5">
            {conCabeceras && (
              <div className="flex items-center gap-1.5 pt-1">
                <Buildings size={12} className="text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" title={g.nombre}>
                  {g.nombre}
                </span>
                <span className="text-[10px] text-muted-foreground">{ids.length} campus</span>
                {ids.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onSetMany(ids, !todos)}
                    disabled={entera && todos}
                    className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {todos ? 'Quitar todos' : 'Marcar todos'}
                  </button>
                )}
              </div>
            )}

            {conEmpresas && g.id !== null && (
              <label className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs ${entera ? 'border-primary/50 bg-primary/5' : 'border-dashed border-border'} ${faltaMigracion ? 'opacity-50' : 'cursor-pointer'}`}>
                <input type="checkbox" checked={entera} disabled={faltaMigracion} onChange={() => onToggleEmpresa(g.id)} className="mt-0.5" />
                {paraColaborador ? (
                <span>
                  Es del equipo de esta empresa (Tareas y su factura)
                  <span className="block text-[10px] text-muted-foreground">
                    Le pueden asignar tareas los encargados de la empresa. No le da ningún campus.
                  </span>
                </span>
                ) : (
                <span>
                  Todos los campus de esta empresa, también los que se creen
                  <span className="block text-[10px] text-muted-foreground">
                    {entera
                      ? 'Si la quitas, conserva los campus que ya tiene: solo deja de recibir los nuevos.'
                      : 'No es superadmin: no ve otras empresas ni gestiona usuarios.'}
                  </span>
                </span>
                )}
              </label>
            )}

            {g.campus.map((p) => {
              const checked = p.id in assigned;
              return (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <label
                    className={`flex items-center gap-2 text-sm ${entera ? '' : 'cursor-pointer'}`}
                    title={entera ? 'Va con la empresa entera. Para quitarlo, quita antes la casilla de la empresa.' : undefined}
                  >
                    <input type="checkbox" checked={checked || entera} disabled={entera} onChange={() => onToggle(p.id)} />
                    {p.nombre}
                  </label>
                  {checked && (
                    role === 'admin' ? (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer">
                        <input type="checkbox" checked={!!assigned[p.id]} onChange={(e) => onSetRecibe(p.id, e.target.checked)} />
                        recibe leads
                      </label>
                    ) : role === 'gestor' ? (
                      <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">recibe leads</span>
                    ) : null
                  )}
                </div>
              );
            })}

            {g.campus.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-1">
                Todavía sin campus. Con la casilla, el primero que se cree le llegará solo.
              </p>
            )}
          </div>
        );
      })}

      {conEmpresas && faltaMigracion && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 px-1">
          Falta aplicar la migración 203. Hasta entonces la empresa entera no se
          puede guardar: marca sus campus uno a uno o con «Marcar todos».
        </p>
      )}
    </div>
  );
}

/**
 * Lo mismo que hacen los dos modales con `assigned`, en un sitio: marcar o
 * quitar varios de golpe. Entran con «recibe leads» apagado, como al marcar uno
 * suelto (el gestor recibe igual: el reparto ni mira la casilla).
 */
export function marcarVarios(assigned, ids, marcar) {
  const next = { ...assigned };
  for (const id of ids) {
    if (marcar) { if (!(id in next)) next[id] = false; } else delete next[id];
  }
  return next;
}
