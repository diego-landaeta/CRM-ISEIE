import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  User, EnvelopeSimple, ShieldCheck, Camera, Key, ArrowRight,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';

function initials(name) {
  return (name || '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();
}

// Los del cambio de correo, iguales que los del resto de la pantalla.
const CAMPO = 'w-full h-10 px-3 rounded-lg border border-border bg-card text-foreground text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all';
const BOTON = 'inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50';

const ROLE_LABELS = {
  superadmin: 'Super-admin',
  admin: 'Admin',
  gestor: 'Gestor',
  soporte: 'Soporte',
};

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const { logout } = useAuth();
  // El propio correo (#197, gemela de CRM#211), en dos pasos: con su contraseña,
  // un código a la dirección NUEVA; con el código, el cambio. Quien tenga
  // «Cambiar su correo»: todos los roles (Diego, 06/11).
  const { can } = usePermission();
  const puedeCambiarCorreo = can('cuenta.cambiar_correo');
  const [correoNuevo, setCorreoNuevo] = useState('');
  const [claveActual, setClaveActual] = useState('');
  const [codigo, setCodigo] = useState('');
  // null hasta que se manda el código; luego, a qué dirección fue.
  const [codigoEnviadoA, setCodigoEnviadoA] = useState(null);
  // A un tutor, mientras siga el freno de correos a tutores, no le sale el código
  // (Diego, 06/11): se le explica en vez del formulario. Lo dice /auth/me de
  // entrada, y por si acaso también la respuesta al pedirlo.
  const [frenadoAlPedir, setFrenado] = useState(null);
  const frenado = frenadoAlPedir || user?.correo_propio_frenado || null;
  const [cambiandoCorreo, setCambiandoCorreo] = useState(false);
  const mismoCorreo = correoNuevo.trim().toLowerCase() === String(user?.email || '').toLowerCase();
  async function onPedirCodigo(e) {
    e.preventDefault();
    const nuevo = correoNuevo.trim().toLowerCase();
    if (!nuevo || mismoCorreo || !claveActual) return;
    setCambiandoCorreo(true);
    try {
      const r = await client.post('/auth/me/email/codigo', { email: nuevo, password: claveActual });
      setClaveActual('');
      if (r?.data?.frenado) { setFrenado(r.data.motivo); return; }
      setCodigoEnviadoA(nuevo);
      toast({ title: 'Te hemos mandado un código', description: `Míralo en ${nuevo}. Caduca en ${r?.data?.minutos || 15} minutos.` });
    } catch (err) {
      toast({ title: 'No se pudo mandar el código', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setCambiandoCorreo(false); }
  }
  async function onConfirmarCodigo(e) {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo.trim())) return;
    setCambiandoCorreo(true);
    try {
      await client.patch('/auth/me/email', { codigo: codigo.trim() });
      // Es con lo que se entra: el servidor revoca las sesiones, hay que volver a entrar.
      toast({ title: 'Correo cambiado', description: `Vuelve a entrar con ${codigoEnviadoA}.` });
      setTimeout(() => { logout?.(); }, 2500);
    } catch (err) {
      toast({ title: 'No se pudo cambiar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setCambiandoCorreo(false); }
  }
  const [tab, setTab] = useState('general');
  const [nombre, setNombre] = useState(user?.nombre || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [savingPwd, setSavingPwd] = useState(false);

  if (!user) return null;

  async function handleSaveProfile() {
    if (!nombre.trim() || nombre.trim() === user.nombre) {
      toast({ title: 'Sin cambios', description: 'El nombre es el mismo.' });
      return;
    }
    setSavingProfile(true);
    try {
      await client.patch('/auth/me', { nombre: nombre.trim() });
      toast({ title: 'Perfil actualizado' });
      if (refreshUser) await refreshUser();
    } catch (err) {
      toast({ title: 'Error al guardar', description: err?.message || 'No se pudo actualizar', variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!pwd.currentPassword || !pwd.newPassword || !pwd.confirmPassword) {
      toast({ title: 'Completa todos los campos', variant: 'destructive' });
      return;
    }
    if (pwd.newPassword !== pwd.confirmPassword) {
      toast({ title: 'Las contraseñas no coinciden', variant: 'destructive' });
      return;
    }
    setSavingPwd(true);
    try {
      await client.post('/auth/change-password', pwd);
      toast({ title: 'Contraseña actualizada' });
      setPwd({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      toast({ title: 'No se pudo cambiar', description: err?.message || 'Verifica la contraseña actual', variant: 'destructive' });
    } finally {
      setSavingPwd(false);
    }
  }

  async function handleAvatarUpload(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: 'Imagen muy grande', description: 'Máximo 2 MB', variant: 'destructive' });
      return;
    }
    try {
      await client.upload(`/users/${user.id}/avatar`, file);
      toast({ title: 'Avatar actualizado' });
      if (refreshUser) await refreshUser();
    } catch (err) {
      toast({ title: 'No se pudo subir el avatar', description: err?.message || 'Error', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Mi cuenta</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Información personal y contraseña.
        </p>
      </header>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border -mt-2">
        {[
          { id: 'general',  label: 'Perfil' },
          { id: 'security', label: 'Contraseña' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Avatar card */}
          <div className="crm-card p-6 flex flex-col items-center text-center">
            <div className="relative">
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.nombre} className="w-24 h-24 rounded-full object-cover" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center text-white text-3xl font-bold">
                  {initials(user.nombre)}
                </div>
              )}
              <label
                title="Cambiar avatar"
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-sm cursor-pointer"
              >
                <Camera size={14} />
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => handleAvatarUpload(e.target.files?.[0])}
                />
              </label>
            </div>
            <h3 className="font-semibold text-foreground mt-4 mb-0.5">{user.nombre}</h3>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 rounded-full text-[11px] font-semibold uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck size={11} weight="bold" />
              {ROLE_LABELS[user.role] || user.role}
            </span>
          </div>

          {/* Info form */}
          <div className="lg:col-span-2 crm-card p-6 space-y-4">
            <h3 className="font-semibold tracking-tight">Información básica</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium mb-1.5">Nombre completo</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[13px] font-medium mb-1.5">Email</label>
                <div className="relative">
                  <EnvelopeSimple size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="email"
                    defaultValue={user.email}
                    disabled
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-muted text-muted-foreground text-sm cursor-not-allowed"
                  />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {puedeCambiarCorreo && !frenado ? 'Es con lo que entras. Puedes cambiarlo abajo.' : 'Es con lo que entras. Para cambiarlo, pídeselo a administración.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={handleSaveProfile}
                disabled={savingProfile}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingProfile ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>

            {puedeCambiarCorreo && frenado && (
              <p role="status" className="pt-4 border-t border-border text-sm text-muted-foreground">
                {frenado}
              </p>
            )}
            {puedeCambiarCorreo && !frenado && !codigoEnviadoA && (
              <form onSubmit={onPedirCodigo} aria-label="Cambiar mi correo" className="pt-4 border-t border-border space-y-3">
                <h4 className="text-sm font-semibold">Cambiar mi correo</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="correo-nuevo" className="block text-[13px] font-medium mb-1.5">Mi correo nuevo</label>
                    <input id="correo-nuevo" type="email" value={correoNuevo} onChange={(e) => setCorreoNuevo(e.target.value)} maxLength={255}
                      placeholder="tu.correo.nuevo@ejemplo.com" autoComplete="email" className={CAMPO} />
                  </div>
                  <div>
                    <label htmlFor="correo-clave" className="block text-[13px] font-medium mb-1.5">Mi contraseña actual</label>
                    <input id="correo-clave" type="password" value={claveActual} onChange={(e) => setClaveActual(e.target.value)}
                      autoComplete="current-password" className={CAMPO} />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Te mandamos un código de 6 cifras a la dirección nueva. Hasta que lo metas, sigues entrando con la de siempre.
                </p>
                <div className="flex justify-end">
                  <button type="submit" className={BOTON}
                    disabled={cambiandoCorreo || !correoNuevo.trim() || mismoCorreo || !claveActual}>
                    {cambiandoCorreo ? 'Mandando…' : 'Mandarme el código'}
                  </button>
                </div>
              </form>
            )}
            {puedeCambiarCorreo && !frenado && codigoEnviadoA && (
              <form onSubmit={onConfirmarCodigo} aria-label="Confirmar mi correo nuevo" className="pt-4 border-t border-border space-y-3">
                <h4 className="text-sm font-semibold">Cambiar mi correo</h4>
                <div className="max-w-xs">
                  <label htmlFor="correo-codigo" className="block text-[13px] font-medium mb-1.5 break-words">
                    El código que te ha llegado a {codigoEnviadoA}
                  </label>
                  <input id="correo-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric" autoComplete="one-time-code" placeholder="000000" maxLength={6}
                    className={`${CAMPO} tracking-[0.3em] font-mono`} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Caduca a los 15 minutos y admite 5 intentos. Al confirmarlo se cierra tu sesión y entras con el correo nuevo.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => { setCodigoEnviadoA(null); setCodigo(''); }} disabled={cambiandoCorreo}
                    className="inline-flex items-center h-9 px-3 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50">
                    Pedir otro
                  </button>
                  <button type="submit" className={BOTON} disabled={cambiandoCorreo || !/^\d{6}$/.test(codigo)}>
                    {cambiandoCorreo ? 'Cambiando…' : 'Cambiar mi correo'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {tab === 'security' && (
        <div className="crm-card p-6">
          <h3 className="font-semibold tracking-tight mb-1">Cambiar contraseña</h3>
          <p className="text-sm text-muted-foreground mb-5">
            Mínimo 8 caracteres, con al menos una mayúscula y un número.
          </p>

          <form
            className="space-y-4"
            onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }}
          >
            {[
              { key: 'currentPassword', label: 'Contraseña actual', placeholder: 'Tu contraseña actual' },
              { key: 'newPassword',     label: 'Nueva contraseña',  placeholder: 'Mínimo 8 caracteres, 1 mayúscula, 1 número' },
              { key: 'confirmPassword', label: 'Confirmar nueva',   placeholder: 'Repite la nueva contraseña' },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-[13px] font-medium mb-1.5">{f.label}</label>
                <div className="relative">
                  <Key size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    autoComplete={f.key === 'currentPassword' ? 'current-password' : 'new-password'}
                    placeholder={f.placeholder}
                    value={pwd[f.key]}
                    onChange={(e) => setPwd({ ...pwd, [f.key]: e.target.value })}
                    className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm focus:border-primary focus:ring-4 focus:ring-primary/10 outline-none transition-all"
                  />
                </div>
              </div>
            ))}

            <button
              type="submit"
              disabled={savingPwd}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-2 disabled:opacity-50"
            >
              {savingPwd ? 'Actualizando…' : <>Actualizar contraseña <ArrowRight size={14} weight="bold" /></>}
            </button>
          </form>
        </div>
      )}

    </div>
  );
}
