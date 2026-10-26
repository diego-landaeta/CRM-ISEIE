import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Archive, ArrowCounterClockwise, Plus, Trash, Users } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/button';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import { BOARD_COLORS, boardColor } from '../lib/taskUi';
import type { Team, TeamMember } from '../types';

/*
  Equipos del tablero (Diego, 26/10/2026): «que el tablero lo separe en equipo:
  eres X, perteneces al equipo de SEO…» y «son por roles según jerarquía».

  Cada equipo es de una empresa y tiene sus CARGOS con un nivel: se asigna a
  quien tiene un nivel menor. Aquí el admin los crea, los renombra, los archiva,
  les añade cargos intermedios (1.5, 3…) y decide quién está y con qué cargo.
  El servidor lo vuelve a comprobar todo (tasks.manage_teams y su empresa).
*/

const COLORES = Object.entries(BOARD_COLORS).map(([value, c]) => ({ value, label: c.label }));
const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Inténtalo de nuevo.';
const fallo = (titulo: string, err: unknown) => toast({ title: titulo, description: errorDe(err), variant: 'destructive' });

export function EquiposConfig() {
  const [equipos, setEquipos] = useState<Team[]>([]);
  const [empresas, setEmpresas] = useState<{ id: number; razon_social: string }[]>([]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState({ issuer_id: 0, name: '', color: 'blue' });

  const recargar = useCallback(async () => {
    try {
      const [lista, emp] = await Promise.all([tasksApi.getTeams({ gestion: true }), tasksApi.getTeamEmpresas()]);
      setEquipos(lista);
      setEmpresas(emp);
      setNuevo((n) => (n.issuer_id ? n : { ...n, issuer_id: emp[0]?.id ?? 0 }));
    } catch (err) { fallo('No se pudieron cargar los equipos', err); }
  }, []);
  useEffect(() => { recargar(); }, [recargar]);

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (!nuevo.name.trim() || !nuevo.issuer_id) return;
    try {
      const t = await tasksApi.createTeam({ issuer_id: nuevo.issuer_id, name: nuevo.name.trim(), color: nuevo.color });
      toast({ title: `Equipo «${t.name}» creado`, description: 'Con «Encargado» (nivel 2) y «Miembro» (nivel 1).' });
      setNuevo((n) => ({ ...n, name: '' }));
      setAbierto(t.id);
      recargar();
    } catch (err) { fallo('No se pudo crear el equipo', err); }
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada equipo es de una empresa. Sus cargos tienen un <strong>nivel</strong>: se asignan tareas a quien tiene un nivel
        menor; el nivel más bajo solo se crea las suyas. Admin y superadmin asignan en todos.
      </p>
      <form onSubmit={crear} className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs font-semibold mb-1">Nuevo equipo</label>
          <input value={nuevo.name} onChange={(e) => setNuevo({ ...nuevo, name: e.target.value })} maxLength={80}
            placeholder="Desarrollo y SEO, Temarios…" className={inputClass} />
        </div>
        {empresas.length > 1 && (
          <div>
            <label className="block text-xs font-semibold mb-1">Empresa</label>
            <Select<number> value={nuevo.issuer_id} onChange={(v) => setNuevo({ ...nuevo, issuer_id: v })}
              options={empresas.map((e) => ({ value: e.id, label: e.razon_social }))} ariaLabel="Empresa" size="sm" className="w-56" />
          </div>
        )}
        <div>
          <label className="block text-xs font-semibold mb-1">Color</label>
          <Select<string> value={nuevo.color} onChange={(v) => setNuevo({ ...nuevo, color: v })} options={COLORES} ariaLabel="Color" size="sm" className="w-32" />
        </div>
        <Button type="submit" size="sm" className="h-9" disabled={!nuevo.name.trim() || !nuevo.issuer_id}>
          <Plus size={14} className="mr-1" /> Crear
        </Button>
      </form>

      {equipos.length === 0 && (
        <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">Todavía no hay equipos.</div>
      )}
      <ul className="space-y-2">
        {equipos.map((t) => (
          <li key={t.id} className={`bg-card border border-border rounded-lg ${t.is_active ? '' : 'opacity-60'}`}>
            <button type="button" onClick={() => setAbierto(abierto === t.id ? null : t.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
              <span className="flex items-center gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-full ${boardColor(t.color).dot}`} aria-hidden />
                <span className="font-semibold truncate">{t.name}</span>
                <span className="text-xs text-muted-foreground truncate">· {t.empresa}</span>
                {!t.is_active && <span className="text-[10px] uppercase font-semibold text-muted-foreground">Archivado</span>}
              </span>
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Users size={13} /> {t.miembros}</span>
            </button>
            {abierto === t.id && <Detalle equipo={t} alCambiar={recargar} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Detalle({ equipo, alCambiar }: { equipo: Team; alCambiar: () => void }) {
  const [miembros, setMiembros] = useState<TeamMember[]>([]);
  const [candidatos, setCandidatos] = useState<{ id: number; nombre: string }[]>([]);
  const [nombre, setNombre] = useState(equipo.name);
  const [cargoNuevo, setCargoNuevo] = useState({ name: '', level: '' });
  const [alta, setAlta] = useState<{ userId: number | ''; roleId: number | '' }>({ userId: '', roleId: '' });
  const cargosActivos = equipo.cargos.filter((c) => c.is_active);

  const cargar = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([tasksApi.getTeam(equipo.id), tasksApi.getTeamCandidates(equipo.id)]);
      setMiembros(d.miembros);
      setCandidatos(c);
    } catch (err) { fallo('No se pudo abrir el equipo', err); }
  }, [equipo.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const hecho = async (fn: () => Promise<unknown>, titulo: string) => {
    try { await fn(); await cargar(); alCambiar(); } catch (err) { fallo(titulo, err); }
  };

  return (
    <div className="border-t border-border p-3 space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs font-semibold mb-1">Nombre</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} className={inputClass} />
        </div>
        <Button size="sm" variant="outline" className="h-9" disabled={!nombre.trim() || nombre.trim() === equipo.name}
          onClick={() => hecho(() => tasksApi.updateTeam(equipo.id, { name: nombre.trim() }), 'No se pudo renombrar')}>
          Renombrar
        </Button>
        <Button size="sm" variant="outline" className="h-9"
          onClick={() => hecho(() => tasksApi.updateTeam(equipo.id, { is_active: !equipo.is_active }), 'No se pudo cambiar')}>
          {equipo.is_active ? <><Archive size={14} className="mr-1" /> Archivar</> : <><ArrowCounterClockwise size={14} className="mr-1" /> Recuperar</>}
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cargos (de más a menos nivel)</h4>
        <ul className="space-y-1">
          {equipo.cargos.map((c) => (
            <li key={c.id} className={`flex items-center gap-2 text-sm ${c.is_active ? '' : 'opacity-60'}`}>
              <span className="w-12 tabular-nums text-xs text-muted-foreground">nivel {c.level}</span>
              <span className="flex-1">{c.name}</span>
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => hecho(() => tasksApi.updateTeamRole(equipo.id, c.id, { is_active: !c.is_active }), 'No se pudo cambiar el cargo')}>
                {c.is_active ? 'Archivar' : 'Recuperar'}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input value={cargoNuevo.name} onChange={(e) => setCargoNuevo({ ...cargoNuevo, name: e.target.value })}
            placeholder="Jefe de proyecto…" maxLength={60} className={`${inputClass} flex-1 min-w-[10rem]`} />
          <input value={cargoNuevo.level} onChange={(e) => setCargoNuevo({ ...cargoNuevo, level: e.target.value })}
            placeholder="Nivel (3, 1.5…)" inputMode="decimal" className={`${inputClass} w-32`} />
          <Button size="sm" className="h-9" disabled={!cargoNuevo.name.trim() || !(Number(cargoNuevo.level.replace(',', '.')) > 0)}
            onClick={() => hecho(async () => {
              await tasksApi.createTeamRole(equipo.id, { name: cargoNuevo.name.trim(), level: Number(cargoNuevo.level.replace(',', '.')) });
              setCargoNuevo({ name: '', level: '' });
            }, 'No se pudo añadir el cargo')}>
            <Plus size={14} className="mr-1" /> Añadir cargo
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quién está</h4>
        {miembros.length === 0 && <p className="text-sm text-muted-foreground">Nadie todavía.</p>}
        <ul className="space-y-1">
          {miembros.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate">{m.nombre}</span>
              <Select<number> value={m.team_role_id} size="sm" className="w-48" ariaLabel={`Cargo de ${m.nombre}`}
                options={cargosActivos.map((c) => ({ value: c.id, label: `${c.name} (${c.level})` }))}
                onChange={(v) => hecho(() => tasksApi.setTeamMember(equipo.id, m.id, v), 'No se pudo cambiar el cargo')} />
              <button type="button" aria-label={`Quitar a ${m.nombre}`} className="text-muted-foreground hover:text-destructive"
                onClick={() => hecho(() => tasksApi.removeTeamMember(equipo.id, m.id), 'No se pudo quitar')}>
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
        {candidatos.length > 0 && cargosActivos.length > 0 && (
          <div className="flex flex-wrap gap-2 items-end">
            <Select<number | ''> value={alta.userId} onChange={(v) => setAlta({ ...alta, userId: v })} size="sm" className="flex-1 min-w-[12rem]"
              ariaLabel="Persona" options={[{ value: '', label: 'Añadir a…' }, ...candidatos.map((c) => ({ value: c.id as number | '', label: c.nombre }))]} />
            <Select<number | ''> value={alta.roleId} onChange={(v) => setAlta({ ...alta, roleId: v })} size="sm" className="w-48"
              ariaLabel="Cargo" options={[{ value: '', label: 'Con el cargo…' }, ...cargosActivos.map((c) => ({ value: c.id as number | '', label: c.name }))]} />
            <Button size="sm" className="h-9" disabled={!alta.userId || !alta.roleId}
              onClick={() => hecho(async () => {
                await tasksApi.setTeamMember(equipo.id, Number(alta.userId), Number(alta.roleId));
                setAlta({ userId: '', roleId: '' });
              }, 'No se pudo añadir')}>
              Añadir
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
