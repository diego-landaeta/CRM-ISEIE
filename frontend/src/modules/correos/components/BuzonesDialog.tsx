import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  X, Plus, PlugsConnected, PencilSimple, Trash, CheckCircle, WarningCircle, CaretDown, EnvelopeSimple,
} from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { invoicesApi } from '@/modules/invoices/api/invoices.api';
import {
  correosApi, type Buzon, type BuzonForm, type OfertaCorreoEmpresa,
} from '../api/correos.api';

/**
 * Los buzones de correo que lee la Bandeja (CRM-ISEIE#701, gemela de CRM#1032).
 *
 * Diego, 23/11: «poder conectar varios correos de Hostinger como hicimos en
 * CEDIA». Antes había uno, y estaba en el `.env` del servidor; ahora se
 * conectan aquí: facturación, soporte, admisiones de cada empresa o campus.
 *
 * Dos decisiones que no son de estilo, las mismas que en Claves (#80):
 *   · **La contraseña no vuelve.** Al cambiar un buzón el campo sale vacío; si
 *     no se escribe nada, se queda la guardada. La API ni siquiera la tiene para
 *     devolverla: guarda servidor, usuario y contraseña cifrados.
 *   · **«Probar conexión» no guarda.** Prueba lo escrito (y, en uno guardado,
 *     lo que falte de lo guardado) y dice si entra o por qué no.
 */

const CAMPO = 'mt-1 w-full h-9 px-3 rounded-md border border-border bg-muted/30 text-sm '
  + 'focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60';
const ROTULO = 'text-xs font-bold uppercase text-muted-foreground';

interface Empresa { id: number; razon_social: string; alias?: string | null; project_id: number | null }

const haceCuanto = (iso: string | null) => {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
};

interface Props {
  onCerrar: () => void;
  /** Para que la Bandeja recargue su selector de buzones. */
  onCambio: () => void;
}

export default function BuzonesDialog({ onCerrar, onCambio }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const tituloId = useId();
  const [buzones, setBuzones] = useState<Buzon[]>([]);
  const [cargando, setCargando] = useState(true);
  // null: la lista. 'nuevo': alta. Un buzón: su cambio.
  const [editando, setEditando] = useState<Buzon | 'nuevo' | null>(null);
  const [quitando, setQuitando] = useState<Buzon | null>(null);
  const [oferta, setOferta] = useState<(OfertaCorreoEmpresa & { buzonId: number }) | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [probando, setProbando] = useState<number | null>(null);

  useModalAccesible(ref, { open: !quitando && !oferta, onClose: onCerrar, bloqueado: ocupado });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await correosApi.buzones();
      if (r.success) setBuzones(r.data);
    } catch (e) {
      toast({ title: 'No se pudieron cargar los buzones', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function probarGuardado(b: Buzon) {
    setProbando(b.id);
    try {
      const r = await correosApi.probarBuzon({}, b.id);
      if (r.data.ok) toast({ title: `«${b.nombre}» conecta`, description: `${r.data.mensajes ?? 0} correos en la bandeja de entrada.` });
      else toast({ title: `«${b.nombre}» no conecta`, description: r.data.motivo, variant: 'destructive' });
    } catch (e) {
      toast({ title: 'No se pudo probar', description: (e as Error).message, variant: 'destructive' });
    } finally { setProbando(null); }
  }

  async function quitar() {
    if (!quitando) return;
    setOcupado(true);
    try {
      await correosApi.quitarBuzon(quitando.id);
      toast({ title: `«${quitando.nombre}» quitado`, description: 'Sus correos siguen en la Bandeja.' });
      setQuitando(null);
      await cargar();
      onCambio();
    } catch (e) {
      toast({ title: 'No se pudo quitar', description: (e as Error).message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function usarComoCorreo() {
    if (!oferta) return;
    setOcupado(true);
    try {
      const r = await correosApi.usarComoCorreoDeEmpresa(oferta.buzonId);
      if (r.data) toast({ title: 'Correo de facturación puesto', description: `${r.data.razon_social}: ${r.data.email}` });
      else toast({ title: 'No se ha cambiado', description: 'La empresa ya tenía un correo de facturación.' });
      setOferta(null);
      await cargar();
    } catch (e) {
      toast({ title: 'No se pudo poner', description: (e as Error).message, variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function alGuardar(b: Buzon, ofrecer: OfertaCorreoEmpresa | null) {
    setEditando(null);
    await cargar();
    onCambio();
    if (ofrecer) setOferta({ ...ofrecer, buzonId: b.id });
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[75] flex items-center justify-center sm:p-4 bg-black/50 backdrop-blur-sm"
        onClick={() => !ocupado && onCerrar()}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={tituloId}
          onClick={(e) => e.stopPropagation()}
          className="bg-card sm:rounded-2xl border border-border shadow-2xl w-full max-w-2xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col">
          <header className="flex items-center justify-between gap-3 p-5 border-b border-border">
            <div className="min-w-0">
              <h2 id={tituloId} className="font-extrabold">
                {editando === 'nuevo' ? 'Conectar un buzón' : editando ? `Cambiar «${editando.nombre}»` : 'Buzones de correo'}
              </h2>
              {!editando && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Los buzones que lee la Bandeja. El CRM los abre en solo lectura: no marca, no borra, no mueve nada.
                </p>
              )}
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" disabled={ocupado}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground shrink-0">
              <X size={16} weight="bold" />
            </button>
          </header>

          {editando ? (
            <FormBuzon
              buzon={editando === 'nuevo' ? null : editando}
              onCancelar={() => setEditando(null)}
              onGuardado={alGuardar}
            />
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-5 space-y-2">
                {cargando && !buzones.length ? (
                  <p className="text-sm text-muted-foreground">Cargando…</p>
                ) : buzones.length === 0 ? (
                  <div className="text-center py-8 space-y-2">
                    <EnvelopeSimple size={28} className="mx-auto text-muted-foreground" />
                    <p className="text-sm font-semibold">Aún no hay buzones conectados</p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      Mientras no haya ninguno, la Bandeja sigue leyendo el buzón configurado en el servidor, si lo hay.
                    </p>
                  </div>
                ) : buzones.map((b) => (
                  <div key={b.id} className="border border-border rounded-lg p-3 flex flex-wrap items-start gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1 basis-60">
                      <p className="text-sm font-semibold truncate">{b.nombre}</p>
                      <p className="text-xs text-muted-foreground truncate">{b.direccion}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {b.project_nombre || 'Todos los campus'}
                        </span>
                        {b.empresa_nombre && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Facturación · {b.empresa_nombre}
                          </span>
                        )}
                        {b.ultimo_resultado === 'error' ? (
                          <span className="text-[11px] inline-flex items-center gap-1 text-destructive" title={b.ultimo_error || ''}>
                            <WarningCircle size={12} weight="fill" /> {b.ultimo_error || 'No se pudo leer'}
                          </span>
                        ) : b.ultima_lectura_at ? (
                          <span className="text-[11px] inline-flex items-center gap-1 text-success">
                            <CheckCircle size={12} weight="fill" /> Leído {haceCuanto(b.ultima_lectura_at)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Aún no se ha leído</span>
                        )}
                        <span className="text-[11px] text-muted-foreground">· {b.recibidos} recibidos</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => probarGuardado(b)} disabled={probando === b.id}
                        className="h-8 px-2.5 rounded-md border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
                        <PlugsConnected size={13} weight="bold" /> {probando === b.id ? 'Probando…' : 'Probar'}
                      </button>
                      <button type="button" onClick={() => setEditando(b)} aria-label={`Cambiar ${b.nombre}`}
                        className="h-8 w-8 rounded-md border border-border inline-flex items-center justify-center hover:bg-muted">
                        <PencilSimple size={13} weight="bold" />
                      </button>
                      <button type="button" onClick={() => setQuitando(b)} aria-label={`Quitar ${b.nombre}`}
                        className="h-8 w-8 rounded-md border border-border inline-flex items-center justify-center hover:bg-destructive/10 text-destructive">
                        <Trash size={13} weight="bold" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <footer className="p-4 border-t border-border flex justify-end">
                <button type="button" onClick={() => setEditando('nuevo')}
                  className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold inline-flex items-center gap-1.5 hover:bg-primary/90">
                  <Plus size={14} weight="bold" /> Conectar un buzón
                </button>
              </footer>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!quitando}
        title={`¿Quitar «${quitando?.nombre ?? ''}»?`}
        message="La Bandeja deja de leerlo y se borra su contraseña guardada. Los correos que ya entraron se quedan, con su etiqueta."
        confirmLabel="Quitar"
        tone="destructive"
        loading={ocupado}
        onConfirm={quitar}
        onCancel={() => setQuitando(null)}
      />

      <ConfirmDialog
        open={!!oferta}
        title="¿Usarlo como correo de facturación?"
        message={oferta ? (
          <>
            <b>{oferta.empresa}</b> no tiene correo de facturación, y los avisos de «Han llegado N facturas» no llegan a nadie.
            ¿Poner <b>{oferta.direccion}</b>?
          </>
        ) : null}
        confirmLabel="Ponerlo"
        tone="info"
        loading={ocupado}
        onConfirm={usarComoCorreo}
        onCancel={() => setOferta(null)}
      />
    </Portal>
  );
}

/** El formulario de alta o cambio. La contraseña, en un cambio, sale vacía. */
function FormBuzon({ buzon, onCancelar, onGuardado }: {
  buzon: Buzon | null;
  onCancelar: () => void;
  onGuardado: (b: Buzon, ofrecer: OfertaCorreoEmpresa | null) => void;
}) {
  const { projects } = useProjectContext();
  const { user } = useAuth() as { user?: { role?: string } | null };
  const { can } = usePermission();
  const veTodo = ['superadmin', 'soporte'].includes(user?.role || '');
  const cambio = !!buzon;

  const [nombre, setNombre] = useState(buzon?.nombre || '');
  const [direccion, setDireccion] = useState(buzon?.direccion || '');
  const [clave, setClave] = useState('');
  const [projectId, setProjectId] = useState(buzon?.project_id != null ? String(buzon.project_id) : '');
  const [empresaId, setEmpresaId] = useState(buzon?.empresa_id != null ? String(buzon.empresa_id) : '');
  const [avanzado, setAvanzado] = useState(false);
  const [host, setHost] = useState('');
  const [puerto, setPuerto] = useState('');
  const [usuario, setUsuario] = useState('');
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    if (!can('facturas.view')) return;
    invoicesApi.listIssuers()
      .then((r: { success: boolean; data?: Empresa[] }) => { if (r.success) setEmpresas(r.data || []); })
      .catch(() => {});
    // `can` cambia de identidad en cada render; basta con pedirlas al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lo escrito, sin campos vacíos: en un cambio, vacío es «no lo toques».
  function datos(): BuzonForm {
    const d: BuzonForm = {};
    if (nombre.trim()) d.nombre = nombre.trim();
    if (direccion.trim()) d.direccion = direccion.trim();
    if (clave) d.clave = clave;
    if (host.trim()) d.host = host.trim();
    if (puerto.trim()) d.puerto = Number(puerto);
    if (usuario.trim()) d.usuario = usuario.trim();
    d.project_id = projectId ? Number(projectId) : null;
    d.empresa_id = empresaId ? Number(empresaId) : null;
    return d;
  }

  async function probar() {
    setProbando(true);
    setPrueba(null);
    try {
      const { nombre: _n, project_id: _p, empresa_id: _e, ...conexion } = datos();
      const r = await correosApi.probarBuzon(conexion, buzon?.id);
      setPrueba(r.data.ok
        ? { ok: true, texto: `Conecta. ${r.data.mensajes ?? 0} correos en la bandeja de entrada.` }
        : { ok: false, texto: r.data.motivo || 'No conecta.' });
    } catch (e) {
      setPrueba({ ok: false, texto: (e as Error).message });
    } finally { setProbando(false); }
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!cambio && !clave) {
      toast({ title: 'Falta la contraseña del buzón', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = cambio
        ? await correosApi.cambiarBuzon(buzon!.id, datos())
        : await correosApi.conectarBuzon(datos());
      toast({ title: cambio ? 'Buzón cambiado' : 'Buzón conectado', description: r.data.direccion });
      onGuardado(r.data, r.ofrecerCorreoEmpresa);
    } catch (err) {
      toast({ title: 'No se pudo guardar', description: (err as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  const empresasDelCampus = empresas.filter((x) => !projectId || x.project_id == null || String(x.project_id) === projectId);

  return (
    <form onSubmit={guardar} className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ROTULO}>Nombre *</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={120}
              data-autofocus placeholder="Facturación ISEIE" className={CAMPO} />
          </label>
          <label className="block">
            <span className={ROTULO}>Dirección del buzón *</span>
            <input type="email" value={direccion} onChange={(e) => setDireccion(e.target.value)} required
              autoComplete="off" placeholder="facturacion@iseie.com" className={CAMPO} />
          </label>
        </div>

        <label className="block">
          <span className={ROTULO}>{cambio ? 'Contraseña nueva' : 'Contraseña *'}</span>
          <input type="password" value={clave} onChange={(e) => setClave(e.target.value)}
            autoComplete="new-password" placeholder={cambio ? 'Déjala en blanco para no cambiarla' : 'La del buzón en Hostinger'}
            className={`${CAMPO} font-mono`} />
          <span className="block text-xs text-muted-foreground mt-1.5">
            Se guarda cifrada y no vuelve a mostrarse, ni a ti.
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className={ROTULO}>Campus{veTodo ? '' : ' *'}</span>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} required={!veTodo} className={CAMPO}>
              <option value="">{veTodo ? '— Todos los campus' : 'Elige el campus'}</option>
              {(projects || []).map((p: { id: number; nombre: string }) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={ROTULO}>Empresa de facturación</span>
            <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className={CAMPO}
              disabled={!empresasDelCampus.length}>
              <option value="">— No es de facturación</option>
              {empresasDelCampus.map((x) => (
                <option key={x.id} value={x.id}>{x.alias || x.razon_social}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="border border-border rounded-lg">
          <button type="button" onClick={() => setAvanzado((v) => !v)} aria-expanded={avanzado}
            className="w-full flex items-center justify-between px-3 h-9 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Servidor (si no es Hostinger)
            <CaretDown size={12} weight="bold" className={`transition-transform ${avanzado ? 'rotate-180' : ''}`} />
          </button>
          {avanzado && (
            <div className="grid gap-4 sm:grid-cols-3 p-3 pt-0">
              <label className="block sm:col-span-2">
                <span className={ROTULO}>Servidor IMAP</span>
                <input value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off"
                  placeholder={cambio ? 'El guardado' : 'imap.hostinger.com'} className={CAMPO} />
              </label>
              <label className="block">
                <span className={ROTULO}>Puerto</span>
                <input inputMode="numeric" value={puerto} onChange={(e) => setPuerto(e.target.value.replace(/\D/g, ''))}
                  placeholder={cambio ? 'El guardado' : '993'} className={CAMPO} />
              </label>
              <label className="block sm:col-span-3">
                <span className={ROTULO}>Usuario</span>
                <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="off"
                  placeholder={cambio ? 'El guardado' : 'Si no es la dirección del buzón'} className={CAMPO} />
              </label>
            </div>
          )}
        </div>

        {prueba && (
          <p role="status" className={`text-sm flex items-start gap-1.5 ${prueba.ok ? 'text-success' : 'text-destructive'}`}>
            {prueba.ok ? <CheckCircle size={16} weight="fill" className="shrink-0 mt-0.5" /> : <WarningCircle size={16} weight="fill" className="shrink-0 mt-0.5" />}
            {prueba.texto}
          </p>
        )}
      </div>

      <footer className="p-4 border-t border-border flex flex-wrap gap-2 justify-end">
        <button type="button" onClick={probar} disabled={probando || guardando}
          className="h-9 px-4 rounded-lg border border-border text-sm font-bold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50 mr-auto">
          <PlugsConnected size={14} weight="bold" /> {probando ? 'Probando…' : 'Probar conexión'}
        </button>
        <button type="button" onClick={onCancelar}
          className="h-9 px-4 rounded-lg text-sm font-bold hover:bg-muted transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={guardando}
          className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {guardando ? 'Guardando…' : cambio ? 'Guardar' : 'Conectar'}
        </button>
      </footer>
    </form>
  );
}
