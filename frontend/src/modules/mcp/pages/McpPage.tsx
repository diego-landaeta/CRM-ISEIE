import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Robot, Key, Plus, Copy, Trash, ShieldCheck, Buildings, UsersThree, WarningCircle, CheckCircle,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { mcpApi, urlDelMcp, type McpEstado, type McpPersona, type McpToken } from '../api/mcp.api';
import ConexionesClaude from '../components/ConexionesClaude';
import CodigoParaClaude from '../components/CodigoParaClaude';

/**
 * Conexión → MCP.
 *
 * Diego, 28/09: «Vas a hacer una conexión por Claude MCP a CRM… Solo hará
 * consulta el MCP». Aquí cada persona con acceso crea su token personal y ve
 * cómo pegarlo en Claude. Super admin y admin, además, deciden quién más tiene
 * acceso.
 *
 * Y desde el 29/09 las CONEXIONES de Claude viven aquí, no en Conectores:
 * «lo de Claude MCP, ese formulario pasa a esa parte de MCP en conexión». Una
 * conexión acota lo que ve Claude a un campus, una empresa o todo el sistema,
 * y dice quién la creó y quién tiene URL (`ConexionesClaude`). La URL personal
 * de abajo es lo de siempre: todo lo que ve esa persona.
 *
 * El token se enseña UNA vez, justo al crearlo. No se guarda en ningún estado
 * que sobreviva a cerrar el aviso: el servidor tampoco lo tiene, solo su huella.
 */

const ROL: Record<string, string> = {
  superadmin: 'Super admin', admin: 'Admin', gestor: 'Gestor', soporte: 'Soporte', project_manager: 'Project manager',
};

/** Por qué se revocó una URL (#194). */
const MOTIVO: Record<string, string> = {
  manual: 'Revocada',
  sin_uso: 'Revocada por no usarse',
  usuario_desactivado: 'Revocada al desactivar el usuario',
  conector: 'Revocada (conector)',
};

/** «Claude-User» → «Claude Desktop / claude.ai», etc.: el User-Agent en cristiano. */
function cliente(ua: string | null | undefined): string {
  if (!ua) return '';
  if (/^claude-code\//i.test(ua)) return 'Claude Code';
  if (/Claude-User|Anthropic|python-httpx/i.test(ua)) return 'Claude Desktop / claude.ai';
  if (/mcp-remote|node/i.test(ua)) return 'Claude Desktop (archivo de configuración)';
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

function fecha(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function copiar(texto: string, que = 'Copiado al portapapeles') {
  navigator.clipboard?.writeText(texto);
  toast({ title: que });
}

const configEscritorio = (url: string, token: string) => JSON.stringify({
  mcpServers: {
    'crm-iseih': {
      command: 'npx',
      args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${CRM_MCP_AUTH}'],
      env: { CRM_MCP_AUTH: `Bearer ${token}` },
    },
  },
}, null, 2);

/**
 * La URL personal: lo único que pide «Agregar conector personalizado» en Claude
 * Desktop y claude.ai. El token va dentro, así que ESTA URL ES LA LLAVE.
 */
const urlPersonal = (url: string, token: string) => `${url}/u/${token}`;

const comandoClaudeCode = (url: string, token: string) =>
  `claude mcp add --transport http crm-iseih ${url} --header "Authorization: Bearer ${token}"`;

function Bloque({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase">{titulo}</p>
        <button
          onClick={() => copiar(texto)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        ><Copy size={12} weight="bold" /> Copiar</button>
      </div>
      <pre className="text-[12px] bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all">{texto}</pre>
    </div>
  );
}

export default function McpPage() {
  const [estado, setEstado] = useState<McpEstado | null>(null);
  const [personas, setPersonas] = useState<McpPersona[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  // El token recien creado. Vive solo aqui y se olvida al cerrar el aviso.
  const [nuevo, setNuevo] = useState<string | null>(null);

  const url = urlDelMcp();

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await mcpApi.estado();
      const e = r.data as McpEstado;
      setEstado(e);
      if (e.puedeAdministrar) {
        const p = await mcpApi.personas();
        setPersonas(p.data as McpPersona[]);
      }
    } catch (e) {
      toast({ title: 'No se pudo cargar la conexión MCP', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    if (!nombre.trim()) return;
    setCreando(true);
    try {
      const r = await mcpApi.crearToken(nombre.trim());
      setNuevo((r.data as McpToken & { token: string }).token);
      setNombre('');
      cargar();
    } catch (e) {
      toast({ title: 'No se pudo crear la URL', description: (e as Error).message, variant: 'destructive' });
    } finally { setCreando(false); }
  }

  async function revocar(t: McpToken) {
    if (!window.confirm(`Se va a revocar la URL «${t.nombre}».\n\nEl Claude que la use dejará de poder consultar el CRM al momento. Borra también el conector en Claude → Configuración → Conectores. ¿Seguir?`)) return;
    try {
      await mcpApi.revocarToken(t.id);
      toast({ title: 'URL revocada' });
      cargar();
    } catch (e) {
      toast({ title: 'No se pudo revocar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function cambiarAcceso(p: McpPersona, valor: boolean) {
    // Quitar el acceso PAUSA, no borra: su URL deja de traer datos, pero si se
    // le devuelve el acceso vuelve a funcionar en su Claude sin tocar nada.
    if (!valor && p.tokens_vivos > 0
      && !window.confirm(`${p.nombre} dejará de poder consultar el CRM desde Claude.

Su URL no se borra: si le devuelves el acceso, volverá a funcionar sin que tenga que cambiar nada. ¿Seguir?`)) return;
    try {
      await mcpApi.cambiarAcceso(p.id, valor);
      setPersonas((lista) => lista.map((x) => (x.id === p.id
        ? { ...x, usa_mcp: valor, tieneAcceso: valor } : x)));
      toast({ title: valor ? `Acceso dado a ${p.nombre}` : `Acceso pausado a ${p.nombre}` });
    } catch (e) {
      toast({ title: 'No se pudo cambiar el acceso', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const porEmpresa = useMemo(() => {
    const grupos = new Map<string, string[]>();
    for (const p of estado?.proyectos || []) {
      const k = p.sociedad_nombre || 'Sin empresa';
      grupos.set(k, [...(grupos.get(k) || []), p.nombre]);
    }
    return [...grupos.entries()];
  }, [estado]);

  if (cargando && !estado) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Conexión MCP"
        subtitle="Conecta Claude al CRM para consultar prospectos, ventas y facturas · solo consulta"
      />

      {/* Las conexiones por campus, empresa o todo el sistema: quien administra. */}
      {estado?.tieneAcceso && estado.puedeAdministrar && <ConexionesClaude />}

      {!estado?.tieneAcceso ? (
        <div className="bg-card border border-border rounded-lg">
          <EmptyState
            icon={Robot}
            title="No tienes acceso al MCP"
            description="Lo tienen super admin y admin, y las personas a las que ellos se lo den. Pídeselo a un administrador."
          />
        </div>
      ) : (
        <>
          {/* Alcance: lo primero que tiene que quedar claro es QUE va a ver Claude. */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} weight="bold" className="text-emerald-600" />
              <h2 className="font-semibold text-sm">Lo que Claude podrá consultar con tu URL personal</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {estado.soloLoSuyo
                ? 'Solo tus propios prospectos, ventas y facturas, dentro de tus campus.'
                : 'Todos los datos de tus campus.'}
              {' '}Nunca datos de otros campus, ni DNI, IBAN, datos fiscales o contraseñas. No puede crear, cambiar ni borrar nada.
            </p>
            {porEmpresa.length === 0 ? (
              <p className="text-sm text-amber-600 flex items-center gap-1.5">
                <WarningCircle size={16} weight="fill" /> No tienes ningún campus asignado: Claude no verá nada.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {porEmpresa.map(([empresa, campus]) => (
                  <div key={empresa} className="flex items-start gap-2 text-sm">
                    <Buildings size={16} className="text-muted-foreground mt-0.5" />
                    <span><strong>{empresa}</strong>: {campus.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Segundo factor (#192): solo con el interruptor encendido. */}
          {estado.codigo?.obligatorio && <CodigoParaClaude config={estado.codigo} />}

          {/* El token recien creado, UNA vez. */}
          {nuevo && (
            <div className="border border-emerald-300 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-4 space-y-3">
              <div className="flex items-start gap-2">
                <CheckCircle size={20} weight="fill" className="text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">URL creada. Cópiala ahora: no se volverá a mostrar.</p>
                  <p className="text-xs text-muted-foreground">Si la pierdes, revócala y crea otra. No la compartas: da acceso a tus datos del CRM.</p>
                </div>
              </div>
              <Bloque titulo="Tu URL para Claude · Conectores → Agregar conector personalizado" texto={urlPersonal(url, nuevo)} />
              <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
                <WarningCircle size={14} weight="fill" className="flex-shrink-0 mt-0.5" />
                Esta URL es tu llave: quien la tenga consulta el CRM con tus permisos. No la compartas ni la pegues en capturas.
              </p>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">Otras formas de conectar (Claude Code, archivo de configuración) · más seguras: la llave no va en la dirección</summary>
                <div className="space-y-3 mt-3">
                  <Bloque titulo="Claude Code · terminal" texto={comandoClaudeCode(url, nuevo)} />
                  <Bloque titulo="Claude Desktop · claude_desktop_config.json" texto={configEscritorio(url, nuevo)} />
                  <Bloque titulo="Solo el token" texto={nuevo} />
                </div>
              </details>
              <button
                onClick={() => setNuevo(null)}
                className="h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted"
              >Ya lo he copiado</button>
            </div>
          )}

          {/* Mis URLs */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-4 border-b border-border flex flex-wrap items-center gap-2">
              <Key size={18} weight="bold" className="text-primary" />
              <div className="flex-1 min-w-[200px]">
                <h2 className="font-semibold text-sm">Tu URL personal</h2>
                <p className="text-xs text-muted-foreground">Todo lo que ves tú, en todos tus campus.{estado.puedeAdministrar ? ' Para acotarla a una empresa o un campus, usa una conexión de arriba.' : ''}</p>
                {/* Caducidad y rotación (#194). */}
                {(estado.diasDeVida || estado.diasSinUso) && (
                  <p className="text-xs text-muted-foreground">
                    {estado.diasDeVida ? `Cada URL caduca a los ${estado.diasDeVida} días (te avisamos por correo antes). ` : ''}
                    {estado.diasSinUso ? `Si no se usa en ${estado.diasSinUso} días, se revoca sola.` : ''}
                  </p>
                )}
              </div>
              <input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') crear(); }}
                maxLength={100}
                placeholder="Nombre, p. ej. «Claude del portátil»"
                className="h-9 px-3 rounded-md border border-border bg-card text-sm min-w-[220px] focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <button
                onClick={crear}
                disabled={creando || !nombre.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
              ><Plus size={14} weight="bold" /> Crear mi URL personal</button>
            </div>
            {!estado.tokens.length ? (
              <EmptyState icon={Key} title="Aún no tienes URL personal"
                description={estado.diasDeVida
                  ? `Crea una para conectar tu Claude. Caduca a los ${estado.diasDeVida} días.`
                  : 'Crea una para conectar tu Claude. No caduca: funciona hasta que la revoques.'} />
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-[11px] uppercase text-muted-foreground">
                    <th className="text-left font-bold px-4 py-2.5">Nombre</th>
                    <th className="text-left font-bold px-4 py-2.5">URL</th>
                    <th className="text-left font-bold px-4 py-2.5">Creado</th>
                    <th className="text-left font-bold px-4 py-2.5">Caduca</th>
                    <th className="text-left font-bold px-4 py-2.5">Último uso</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {estado.tokens.map((t) => (
                    <tr key={t.id} className={`border-b border-border last:border-0 ${t.vivo ? '' : 'opacity-50'}`}>
                      <td className="px-4 py-3 font-semibold">{t.nombre}</td>
                      <td className="px-4 py-3"><code className="text-[13px] text-muted-foreground">{t.prefijo}…</code></td>
                      <td className="px-4 py-3 text-muted-foreground">{fecha(t.created_at)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {t.revoked_at ? (MOTIVO[t.revocado_motivo || ''] || 'Revocada') : !t.vivo ? 'Caducada' : t.expires_at ? fecha(t.expires_at) : 'Nunca'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {fecha(t.last_used_at)}
                        {/* Desde dónde (#194): para notar un cliente o una IP que no son tuyos. */}
                        {t.last_used_at && (t.last_used_cliente || t.last_used_ip) && (
                          <span className="block text-[11px]" title={t.last_used_cliente || ''}>
                            {[cliente(t.last_used_cliente), t.last_used_ip].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {t.vivo && (
                          <button
                            onClick={() => revocar(t)}
                            aria-label={`Revocar la URL ${t.nombre}`}
                            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:text-destructive hover:border-destructive/30"
                          ><Trash size={14} weight="bold" /> Revocar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Como conectar */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <h2 className="font-semibold text-sm">Cómo conectar Claude</h2>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Pulsa <strong>Sacar mi URL</strong> en una conexión, o <strong>Crear mi URL personal</strong>, y cópiala.</li>
              <li>Claude Desktop o claude.ai: <em>Configuración → Conectores → Agregar → Agregar conector personalizado</em>, ponle un nombre y pega la URL.</li>
              <li>
                <strong>Sin OAuth:</strong> deja vacíos «OAuth Client ID» y «OAuth Client Secret» (en «Configuración avanzada»).
                La llave ya va en la URL; con OAuth puesto, Claude dice «Couldn&apos;t register with … sign-in service».
              </li>
              <li>
                Claude Code, o Claude Desktop por archivo de configuración: usa «Otras formas de conectar». <strong>Es la opción más segura</strong>:
                la llave viaja en una cabecera y no en la dirección, así que no queda escrita en ningún registro.
              </li>
              {estado.codigo?.obligatorio && (
                <li>
                  Cuando Claude te pida el código, pulsa <strong>Sacar código para Claude</strong> arriba y díselo.
                  Te lo volverá a pedir tras un rato sin usarlo.
                </li>
              )}
              <li>Pregúntale a Claude, por ejemplo: «¿cuántos prospectos nuevos entraron este mes en mis campus?».</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              «Agregar conector personalizado» solo acepta direcciones <strong>https</strong>: funciona con el CRM publicado, no con uno abierto en tu equipo (localhost).
            </p>
            <Bloque titulo="Dirección general del MCP (sin tu llave)" texto={url} />
          </div>

          {/* Que puede consultar */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-2">
            <h2 className="font-semibold text-sm">Consultas disponibles</h2>
            <ul className="grid md:grid-cols-2 gap-2">
              {estado.herramientas.map((h) => (
                <li key={h.nombre} className="text-sm">
                  <span className="font-semibold">{h.titulo}</span>
                  <span className="text-muted-foreground"> — {h.descripcion.split('. ')[0].replace(/\.$/, '')}.</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {/* Quien tiene acceso: solo super admin y admin. */}
      {estado?.puedeAdministrar && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <UsersThree size={18} weight="bold" className="text-primary" />
            <h2 className="font-semibold text-sm">Quién tiene acceso</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] uppercase text-muted-foreground">
                <th className="text-left font-bold px-4 py-2.5">Persona</th>
                <th className="text-left font-bold px-4 py-2.5">Rol</th>
                <th className="text-left font-bold px-4 py-2.5">URLs activas</th>
                <th className="text-left font-bold px-4 py-2.5">Último uso</th>
                <th className="text-left font-bold px-4 py-2.5">Acceso</th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{p.nombre}</p>
                    <p className="text-xs text-muted-foreground">{p.email}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ROL[p.role] || p.role}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.tokens_vivos}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fecha(p.ultimo_uso)}</td>
                  <td className="px-4 py-3">
                    {p.porRol ? (
                      <span className="text-xs text-muted-foreground">Por su rol</span>
                    ) : (
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={p.usa_mcp}
                          onChange={(e) => cambiarAcceso(p, e.target.checked)}
                          className="h-4 w-4 accent-primary"
                          aria-label={`Acceso MCP de ${p.nombre}`}
                        />
                        <span className="text-xs">{p.usa_mcp ? 'Sí' : 'No'}</span>
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
