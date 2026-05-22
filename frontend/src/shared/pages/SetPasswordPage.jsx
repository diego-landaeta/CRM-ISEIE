import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import client from '@/shared/api/client';
import { Eye, EyeSlash, Check, X, ShieldCheck, ArrowRight, WarningCircle } from '@phosphor-icons/react';

const RULES = [
  { id: 'length', label: 'Mínimo 8 caracteres', test: (v) => v.length >= 8 },
  { id: 'upper',  label: 'Al menos una mayúscula', test: (v) => /[A-Z]/.test(v) },
  { id: 'number', label: 'Al menos un número', test: (v) => /\d/.test(v) },
  { id: 'match',  label: 'Las contraseñas coinciden', test: (v, c) => v.length > 0 && v === c },
];

const INPUT_CLS = 'w-full h-11 px-3.5 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-60';

export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const checks = useMemo(
    () => RULES.map((r) => ({ ...r, ok: r.test(password, confirm) })),
    [password, confirm]
  );
  const allOk = checks.every((c) => c.ok);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token) {
      setError('Falta el token de invitación. Pide al admin que te reenvíe el email.');
      return;
    }
    if (!allOk) {
      setError('La contraseña no cumple los requisitos.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await client.post('/auth/set-password', { token, password });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err?.message || 'No se pudo establecer la contraseña');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <img src="/iseie-logo-color.png" alt="ISEIE" className="h-9 w-auto object-contain dark:hidden" />
          <img src="/iseie-logo.png"       alt="ISEIE" className="h-9 w-auto object-contain hidden dark:block" />
          <div className="border-l border-border pl-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Plataforma de gestión</div>
          </div>
        </div>

        <div className="crm-card p-7">
          {success ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-4">
                <Check size={28} weight="bold" />
              </div>
              <h2 className="text-xl font-bold tracking-tight mb-1">¡Contraseña establecida!</h2>
              <p className="text-sm text-muted-foreground">Redirigiendo al login en 2 segundos…</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <ShieldCheck size={20} weight="duotone" />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">Establece tu contraseña</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Crea una contraseña segura para acceder al CRM.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[13px] font-medium mb-1.5">Nueva contraseña</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 8 caracteres"
                      className={INPUT_CLS + ' pr-10'}
                      disabled={loading}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] font-medium mb-1.5">Confirmar contraseña</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repite la contraseña"
                    className={INPUT_CLS}
                    disabled={loading}
                  />
                </div>

                {/* Checklist */}
                <ul className="space-y-1.5 pt-1">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-[12px]">
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                        c.ok ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                      }`}>
                        {c.ok ? <Check size={10} weight="bold" /> : <X size={10} weight="bold" />}
                      </span>
                      <span className={c.ok ? 'text-foreground' : 'text-muted-foreground'}>{c.label}</span>
                    </li>
                  ))}
                </ul>

                {error && (
                  <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-[13px]">
                    <WarningCircle size={16} weight="fill" className="flex-shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !allOk || !token}
                  className="w-full h-11 mt-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-sm disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  ) : (
                    <>Establecer contraseña <ArrowRight size={16} weight="bold" /></>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
