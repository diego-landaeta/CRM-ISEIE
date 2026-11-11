import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowClockwise, Check, Copy, GithubLogo, Trash, Warning } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';
import { Button } from '@/shared/components/ui/button';
import { toast } from '@/shared/hooks/useToast';
import { inputClass } from '@/shared/lib/ui';
import * as tasksApi from '../api/tasks.api';
import type { GithubEstado } from '../api/tasks.api';

/*
  «Configurar tablero › GitHub» (CRM-ISEIE#435, Diego 11/11/2026): «GitHub manda y el
  tablero lo refleja». Aquí el superadmin elige el equipo y quién supervisa,
  guarda el secreto del webhook y el token de solo lectura (cifrados; nunca se
  vuelven a ver) y dice quién es quién en GitHub. El servidor lo vuelve a
  comprobar todo (`tasks.github`).
*/

const errorDe = (err: unknown) => (err instanceof Error && err.message) ? err.message : 'Inténtalo de nuevo.';
const fallo = (titulo: string, err: unknown) => toast({ title: titulo, description: errorDe(err), variant: 'destructive' });
const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export function GithubConfig() {
  const [e, setE] = useState<GithubEstado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secreto, setSecreto] = useState('');
  const [token, setToken] = useState('');
  const [copia, setCopia] = useState('');
  const [nuevo, setNuevo] = useState<{ login: string; user_id: number }>({ login: '', user_id: 0 });

  const recargar = useCallback(async () => {
    try {
      const d = await tasksApi.getGithub();
      setE(d);
      setCopia(d.config?.copia_repo || '');
      setError(null);
    } catch (err) { setError(errorDe(err)); }
  }, []);
  useEffect(() => { recargar(); }, [recargar]);

  async function guardar(body: Parameters<typeof tasksApi.updateGithub>[0], hecho = 'Guardado') {
    try {
      setE(await tasksApi.updateGithub(body));
      toast({ title: hecho });
    } catch (err) { fallo('No se pudo guardar', err); }
  }

  async function guardarSecretos(ev: FormEvent) {
    ev.preventDefault();
    const body: { webhook_secret?: string; token?: string } = {};
    if (secreto.trim()) body.webhook_secret = secreto.trim();
    if (token.trim()) body.token = token.trim();
    if (!Object.keys(body).length) return;
    try {
      await tasksApi.setGithubSecretos(body);
      setSecreto('');
      setToken('');
      toast({ title: 'Guardado y cifrado', description: 'No se vuelve a enseñar: si se pierde, se pone otro.' });
      recargar();
    } catch (err) { fallo('No se pudo guardar', err); }
  }

  async function ponerUsuario(ev: FormEvent) {
    ev.preventDefault();
    if (!nuevo.login.trim() || !nuevo.user_id) return;
    try {
      const r = await tasksApi.setGithubUsuario(nuevo.login.trim(), nuevo.user_id);
      toast({ title: `«${r.login}» guardado`, description: r.recolocadas ? `${r.recolocadas} tarea(s) pasan a esa persona.` : undefined });
      setNuevo({ login: '', user_id: 0 });
      recargar();
    } catch (err) { fallo('No se pudo guardar', err); }
  }

  async function quitarUsuario(login: string) {
    try {
      const r = await tasksApi.removeGithubUsuario(login);
      toast({ title: `«${r.login}» quitado`, description: r.recolocadas ? `${r.recolocadas} tarea(s) vuelven a «Por definir quién lo hará».` : undefined });
      recargar();
    } catch (err) { fallo('No se pudo quitar', err); }
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft text-destructive-soft-foreground p-6 text-center space-y-3">
        <p className="font-semibold text-sm">No se pudo cargar la conexión con GitHub</p>
        <p className="text-xs">{error}</p>
        <Button size="sm" variant="outline" onClick={recargar}><ArrowClockwise size={14} className="mr-1.5" /> Reintentar</Button>
      </div>
    );
  }
  if (!e) return <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>;

  const personas = e.personas.map((p) => ({ value: p.id, label: p.nombre }));
  const equipos = e.equipos.map((t) => ({ value: t.id, label: t.empresa ? `${t.name} · ${t.empresa}` : t.name }));
  const listo = e.activo && e.falta.length === 0 && e.secretos.webhook_secret;

  return (
    <section className="space-y-4" data-testid="github-config">
      <p className="text-sm text-muted-foreground">
        Cada issue de <strong>{e.config?.repo || 'el repositorio'}</strong> es una tarea del equipo. GitHub manda y el
        tablero lo refleja: abierta → «Por hacer», PR a <code>staging</code> → «En revisión», cerrada → «Hecha»,
        reabierta → «En curso». Nada del CRM sube a GitHub.
      </p>

      <div className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${listo ? 'border-success/30 bg-success-soft' : 'border-warning/30 bg-warning-soft'}`}>
        {listo ? <Check size={16} className="mt-0.5 text-success" aria-hidden /> : <Warning size={16} className="mt-0.5 text-warning" aria-hidden />}
        <div className="space-y-1">
          {!e.activo && <p><strong>Apagado en el servidor</strong> (GITHUB_TABLERO_ACTIVO): el webhook no está montado.</p>}
          {e.falta.length > 0 && <p>Falta {e.falta.join(' y ')}.</p>}
          {!e.secretos.webhook_secret && <p>Falta el secreto del webhook.</p>}
          {listo && <p>Conectado. {e.resumen.total} issues en el tablero ({e.resumen.abiertas} abiertas, {e.resumen.cerradas} cerradas).</p>}
          <p className="text-xs text-muted-foreground">Última sincronización: {fecha(e.resumen.ultima_sincronizacion)}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold">Equipo y supervisor</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Equipo de las tareas</span>
            <Select<number | null> value={e.config?.team_id ?? null} ariaLabel="Equipo de las tareas"
              placeholder="Elige el equipo" options={[{ value: null, label: 'Sin equipo' }, ...equipos]}
              onChange={(v) => guardar({ team_id: v }, 'Equipo guardado')} />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Supervisa (y lleva lo que no tiene responsable)</span>
            <Select<number | null> value={e.config?.supervisor_id ?? null} ariaLabel="Supervisor"
              placeholder="Elige quién supervisa" options={personas}
              onChange={(v) => guardar({ supervisor_id: v }, 'Supervisor guardado')} />
          </div>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(ev) => { ev.preventDefault(); guardar({ copia_repo: copia.trim() || null }, 'Copia guardada'); }}>
          <label className="flex-1 min-w-[14rem] space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Copia privada de la empresa (dueño/repositorio), para el enlace en cada tarea</span>
            <input className={inputClass} value={copia} onChange={(ev) => setCopia(ev.target.value)} placeholder="dueño/repositorio" />
          </label>
          <Button type="submit" size="sm" variant="outline" className="h-9">Guardar</Button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5"><GithubLogo size={16} aria-hidden /> El webhook en GitHub</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Dirección</dt>
          <dd className="flex items-center gap-2 min-w-0">
            <code className="truncate">{e.webhook_url}</code>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label="Copiar la dirección"
              onClick={() => { navigator.clipboard?.writeText(e.webhook_url); toast({ title: 'Dirección copiada' }); }}>
              <Copy size={14} />
            </Button>
          </dd>
          <dt className="text-muted-foreground">Tipo</dt><dd><code>application/json</code></dd>
          <dt className="text-muted-foreground">Eventos</dt><dd>{e.eventos.map((x) => <code key={x} className="mr-2">{x}</code>)}</dd>
          <dt className="text-muted-foreground">Secreto</dt><dd>{e.secretos.webhook_secret ? 'Guardado (cifrado)' : 'Sin guardar'}</dd>
          <dt className="text-muted-foreground">Token de lectura</dt><dd>{e.secretos.token ? 'Guardado (cifrado)' : 'Sin guardar (la importación lee sin autenticar)'}</dd>
        </dl>
        <form onSubmit={guardarSecretos} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Secreto del webhook (el mismo que en GitHub)</span>
            <input className={inputClass} type="password" autoComplete="off" value={secreto} onChange={(ev) => setSecreto(ev.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Token de solo lectura (para importar)</span>
            <input className={inputClass} type="password" autoComplete="off" value={token} onChange={(ev) => setToken(ev.target.value)} />
          </label>
          <Button type="submit" size="sm" className="h-9" disabled={!secreto.trim() && !token.trim()}>Guardar cifrado</Button>
        </form>
      </div>

      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold">Quién es quién en GitHub</h3>
        <p className="text-xs text-muted-foreground">
          El asignado de la issue es el responsable de la tarea. Si no tiene a nadie aquí, la tarea es de quien supervisa
          y lleva la etiqueta «Por definir quién lo hará».
        </p>
        {e.usuarios.length > 0 && (
          <ul className="divide-y divide-border border border-border rounded-md" data-testid="github-usuarios">
            {e.usuarios.map((u) => (
              <li key={u.login} className="flex items-center gap-3 px-3 py-2 text-sm">
                <code className="w-40 truncate">{u.login}</code>
                <span className="flex-1 truncate">{u.nombre}{!u.active && <span className="text-muted-foreground"> (desactivada)</span>}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{u.issues} issues</span>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Quitar ${u.login}`} onClick={() => quitarUsuario(u.login)}>
                  <Trash size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {e.sin_usuario.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Sin persona en el CRM: {e.sin_usuario.map((s) => `${s.login} (${s.issues})`).join(', ')}
          </p>
        )}
        <form onSubmit={ponerUsuario} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Login de GitHub</span>
            <input className={inputClass} value={nuevo.login} onChange={(ev) => setNuevo((n) => ({ ...n, login: ev.target.value }))} />
          </label>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Persona del CRM</span>
            <Select<number> value={nuevo.user_id} ariaLabel="Persona del CRM" placeholder="Elige a quién"
              options={personas} onChange={(v) => setNuevo((n) => ({ ...n, user_id: v }))} />
          </div>
          <Button type="submit" size="sm" className="h-9" disabled={!nuevo.login.trim() || !nuevo.user_id}>Añadir</Button>
        </form>
      </div>

      {e.entregas.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <h3 className="text-sm font-semibold">Últimos avisos de GitHub</h3>
          <ul className="text-xs space-y-1">
            {e.entregas.map((x, i) => (
              <li key={i} className="flex gap-3">
                <span className="tabular-nums text-muted-foreground">{fecha(x.recibida_at)}</span>
                <span>{x.evento}{x.accion ? ` · ${x.accion}` : ''}{x.number ? ` · #${x.number}` : ''}</span>
                <span className="text-muted-foreground truncate">{x.resultado}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
